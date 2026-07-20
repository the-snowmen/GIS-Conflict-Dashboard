// Browser-local ticket mutations layered over the immutable GeoParquet baseline.
// This is intentionally scenario-only state: clearing browser storage restores the demo.

const KEY = "gcd.tickets.overlay.v2";
const LEGACY_KEY = "gcd.tickets.overlay.v1";
const VERSION = 2;

export type Priority = "low" | "normal" | "high";
export type WorkflowStatus = "new" | "in_review" | "resolved";
export type WorkType = "locate" | "design" | "survey" | "permit";

export interface OverlayTicket {
  ticket_id: string;
  source: string;
  work_type: WorkType;
  priority: Priority;
  workflow_status: WorkflowStatus;
  intake_conflict_count: number;
  radius_m: number;
  lon: number;
  lat: number;
  county_geoid: string | null;
  created_at: string;
  origin: "user";
}

export interface MergedTicket {
  ticket_id: string;
  source: string;
  work_type: WorkType;
  priority: Priority;
  workflow_status: WorkflowStatus;
  intake_conflict_count: number;
  /** Runtime evidence projection; initialized from intake and replaced by the active rule. */
  conflict_count: number;
  lon: number;
  lat: number;
  county_geoid: string | null;
  created_at: string;
  origin: "baseline" | "user";
  radius_m?: number;
}

export interface Overlay {
  v: number;
  added: OverlayTicket[];
  edited: Record<string, Partial<OverlayTicket>>;
  deleted: string[];
}

const empty = (): Overlay => ({ v: VERSION, added: [], edited: {}, deleted: [] });

function workTypeForSource(source: string): WorkType {
  switch (source) {
    case "811_locate": return "locate";
    case "design_review": return "design";
    case "field_survey": return "survey";
    default: return "permit";
  }
}

function priorityForCount(n: number): Priority {
  return n >= 3 ? "high" : n >= 1 ? "normal" : "low";
}

function validOverlay(o: Partial<Overlay>): o is Overlay {
  return o.v === VERSION && Array.isArray(o.added) && Array.isArray(o.deleted) && typeof o.edited === "object";
}

function migrateLegacy(): Overlay {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return empty();
    const legacy = JSON.parse(raw) as {
      added?: Array<Record<string, unknown>>;
      edited?: Record<string, Record<string, unknown>>;
      deleted?: string[];
    };
    const convert = (row: Record<string, unknown>): OverlayTicket => {
      const count = Number(row.conflict_count ?? 0);
      const source = String(row.source ?? "permit");
      return {
        ticket_id: String(row.ticket_id), source, work_type: workTypeForSource(source),
        priority: priorityForCount(count), workflow_status: "new",
        intake_conflict_count: count, radius_m: Number(row.radius_m ?? 100),
        lon: Number(row.lon), lat: Number(row.lat), county_geoid: row.county_geoid == null ? null : String(row.county_geoid),
        created_at: String(row.created_at ?? new Date().toISOString().slice(0, 10)), origin: "user",
      };
    };
    const migrated: Overlay = {
      v: VERSION,
      added: (legacy.added ?? []).map(convert),
      edited: Object.fromEntries(Object.entries(legacy.edited ?? {}).map(([id, row]) => {
        const source = row.source == null ? undefined : String(row.source);
        const count = Number(row.conflict_count ?? 0);
        return [id, {
          ...(source ? { source, work_type: workTypeForSource(source) } : {}),
          workflow_status: "new" as const,
          ...(row.conflict_count == null ? {} : { intake_conflict_count: count, priority: priorityForCount(count) }),
          ...(row.lon == null ? {} : { lon: Number(row.lon) }),
          ...(row.lat == null ? {} : { lat: Number(row.lat) }),
          ...(row.radius_m == null ? {} : { radius_m: Number(row.radius_m) }),
          ...(row.county_geoid == null ? {} : { county_geoid: String(row.county_geoid) }),
        }];
      })),
      deleted: legacy.deleted ?? [],
    };
    localStorage.setItem(KEY, JSON.stringify(migrated));
    localStorage.removeItem(LEGACY_KEY);
    return migrated;
  } catch {
    return empty();
  }
}

export function loadOverlay(): Overlay {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return migrateLegacy();
    const o = JSON.parse(raw) as Partial<Overlay>;
    return validOverlay(o) ? o : empty();
  } catch {
    return empty();
  }
}

function saveOverlay(o: Overlay): void {
  try { localStorage.setItem(KEY, JSON.stringify(o)); }
  catch { console.warn("[overlay] could not persist ticket changes to localStorage"); }
}

let cache: Overlay | null = null;
function getOverlay(): Overlay { return (cache ??= loadOverlay()); }
function commit(o: Overlay): void { cache = o; saveOverlay(o); }

export function isUserTicket(id: string): boolean { return id.startsWith("USR-"); }

export function nextTicketId(): string {
  const taken = new Set(getOverlay().added.map((t) => t.ticket_id));
  let id = "";
  do id = `USR-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;
  while (taken.has(id));
  return id;
}

export function addTicket(t: OverlayTicket): void {
  const o = getOverlay();
  o.added.push(t); o.deleted = o.deleted.filter((d) => d !== t.ticket_id); commit(o);
}

export function editTicket(ticketId: string, patch: Partial<OverlayTicket>, isBaseline: boolean): void {
  const o = getOverlay();
  if (isBaseline) o.edited[ticketId] = { ...o.edited[ticketId], ...patch };
  else Object.assign(o.added.find((t) => t.ticket_id === ticketId) ?? {}, patch);
  commit(o);
}

export function deleteTicket(ticketId: string, isBaseline: boolean): void {
  const o = getOverlay();
  o.added = o.added.filter((t) => t.ticket_id !== ticketId);
  delete o.edited[ticketId];
  if (isBaseline && !o.deleted.includes(ticketId)) o.deleted.push(ticketId);
  commit(o);
}

export function mergeRows(baseline: MergedTicket[]): MergedTicket[] {
  const o = getOverlay();
  const deleted = new Set(o.deleted);
  return [
    ...baseline.filter((b) => !deleted.has(b.ticket_id)).map((b) => ({ ...b, ...o.edited[b.ticket_id] })),
    ...o.added.filter((a) => !deleted.has(a.ticket_id)).map((a) => ({ ...a, conflict_count: a.intake_conflict_count })),
  ];
}

/**
 * Merge an imported overlay (from a project file) into the local one. Additive:
 * incoming added-tickets win per ticket_id, edits merge per field, deletes union —
 * nothing local is silently dropped. Returns the counts for a user-facing summary.
 */
export function mergeOverlay(incoming: Partial<Overlay>): { added: number; edited: number; deleted: number } {
  const o = getOverlay();
  const inAdded = Array.isArray(incoming.added) ? incoming.added : [];
  const inEdited = incoming.edited && typeof incoming.edited === "object" ? incoming.edited : {};
  const inDeleted = Array.isArray(incoming.deleted) ? incoming.deleted : [];
  let added = 0;
  for (const t of inAdded) {
    const i = o.added.findIndex((x) => x.ticket_id === t.ticket_id);
    if (i >= 0) o.added[i] = t;
    else o.added.push(t);
    added++;
  }
  let edited = 0;
  for (const [id, patch] of Object.entries(inEdited)) {
    o.edited[id] = { ...o.edited[id], ...patch };
    edited++;
  }
  let deleted = 0;
  for (const id of inDeleted) {
    if (!o.deleted.includes(id)) {
      o.deleted.push(id);
      deleted++;
    }
  }
  commit(o);
  return { added, edited, deleted };
}
