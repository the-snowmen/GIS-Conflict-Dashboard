// Client-side ticket mutations layered over the immutable parquet baseline.
// The baseline tickets ship in ticket.parquet and are never modified; user
// creates/edits/deletes live here in localStorage and are merged at read time.
// Clearing browser storage therefore restores the original dataset.

const KEY = "gcd.tickets.overlay.v1";
const VERSION = 1;

export interface OverlayTicket {
  ticket_id: string;
  source: string;
  status: string;
  conflict_count: number;
  radius_m: number;
  lon: number;
  lat: number;
  county_geoid: string | null;
  created_at: string; // ISO "YYYY-MM-DD"
  origin: "user";
}

// A baseline row merged with any overlay overrides, or a user-created row.
export interface MergedTicket {
  ticket_id: string;
  source: string;
  status: string;
  conflict_count: number;
  lon: number;
  lat: number;
  county_geoid: string | null;
  created_at: string;
  origin: "baseline" | "user";
  radius_m?: number;
}

interface Overlay {
  v: number;
  added: OverlayTicket[];
  edited: Record<string, Partial<OverlayTicket>>;
  deleted: string[];
}

const empty = (): Overlay => ({ v: VERSION, added: [], edited: {}, deleted: [] });

// Parse + validate; any corruption or version mismatch falls back to empty
// (which is also what guarantees "clear storage -> baseline").
export function loadOverlay(): Overlay {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const o = JSON.parse(raw) as Partial<Overlay>;
    if (o?.v !== VERSION || !Array.isArray(o.added) || !Array.isArray(o.deleted) || typeof o.edited !== "object") {
      return empty();
    }
    return { v: VERSION, added: o.added, edited: o.edited ?? {}, deleted: o.deleted };
  } catch {
    return empty();
  }
}

export function saveOverlay(o: Overlay): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    // Quota exceeded / private mode: keep the in-memory overlay working for the
    // session; persistence just won't survive a reload.
    console.warn("[overlay] could not persist ticket changes to localStorage");
  }
}

let cache: Overlay | null = null;
function getOverlay(): Overlay {
  return (cache ??= loadOverlay());
}
function commit(o: Overlay): void {
  cache = o;
  saveOverlay(o);
}

export function resetOverlay(): void {
  cache = empty();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function isUserTicket(id: string): boolean {
  return id.startsWith("USR-");
}

// "USR-" prefix can never collide with baseline "AUS-…" ids; guard only against
// other user rows in the (astronomically rare) timestamp+random clash.
export function nextTicketId(): string {
  const o = getOverlay();
  const taken = new Set(o.added.map((t) => t.ticket_id));
  let id = "";
  do {
    const rand = Math.floor(Math.random() * 1296).toString(36).padStart(2, "0");
    id = `USR-${Date.now().toString(36)}${rand}`;
  } while (taken.has(id));
  return id;
}

export function addTicket(t: OverlayTicket): void {
  const o = getOverlay();
  o.added.push(t);
  // A previously-deleted id being re-added should resurface.
  o.deleted = o.deleted.filter((d) => d !== t.ticket_id);
  commit(o);
}

export function editTicket(ticket_id: string, patch: Partial<OverlayTicket>, isBaseline: boolean): void {
  const o = getOverlay();
  if (isBaseline) {
    o.edited[ticket_id] = { ...o.edited[ticket_id], ...patch };
  } else {
    const row = o.added.find((t) => t.ticket_id === ticket_id);
    if (row) Object.assign(row, patch);
  }
  commit(o);
}

export function moveTicket(ticket_id: string, patch: Partial<OverlayTicket>, isBaseline: boolean): void {
  editTicket(ticket_id, patch, isBaseline);
}

export function deleteTicket(ticket_id: string, isBaseline: boolean): void {
  const o = getOverlay();
  o.added = o.added.filter((t) => t.ticket_id !== ticket_id);
  delete o.edited[ticket_id];
  if (isBaseline && !o.deleted.includes(ticket_id)) o.deleted.push(ticket_id);
  commit(o);
}

// Apply added / edited / deleted onto a baseline list. Never mutates the input.
export function mergeRows(baseline: MergedTicket[]): MergedTicket[] {
  const o = getOverlay();
  const deleted = new Set(o.deleted);
  const out: MergedTicket[] = [];
  for (const b of baseline) {
    if (deleted.has(b.ticket_id)) continue;
    const patch = o.edited[b.ticket_id];
    out.push(patch ? { ...b, ...patch } : b);
  }
  for (const a of o.added) {
    if (deleted.has(a.ticket_id)) continue;
    out.push({ ...a });
  }
  return out;
}
