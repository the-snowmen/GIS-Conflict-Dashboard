// Portable project: every saved run + the referenced ticket overlay as one JSON
// file, so analyses move between machines with no account and no backend.
// Import validates the envelope and merges per-record (incoming wins on updatedAt;
// nothing local is ever deleted by an import).
import type { FeatureCollection, Geometry } from "geojson";
import { downloadText, exportName } from "./export";
import {
  loadOverlay,
  mergeOverlay,
  type Overlay,
  type OverlayTicket,
  type Priority,
  type WorkType,
  type WorkflowStatus,
} from "./overlay";
import { areaLabel, defaultRunName, putRun, type AnalysisRun, type SavedArea } from "./runs";
import type { ConflictRule } from "./demo";
import type { ConflictFacility, RunResult } from "../types";

export const PROJECT_FORMAT = "gis-conflict-project";
export const PROJECT_VERSION = 1;

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  exportedAt: string;
  region: string;
  runs: AnalysisRun[];
  ticketOverlay: Partial<Overlay>;
}

export function exportProject(runs: AnalysisRun[], region: string): void {
  const overlay = loadOverlay();
  const project: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    exportedAt: new Date().toISOString(),
    region,
    runs,
    // Persist without the local schema-version field; it re-validates on merge.
    ticketOverlay: { added: overlay.added, edited: overlay.edited, deleted: overlay.deleted },
  };
  downloadText(exportName("project", "json"), "application/json", JSON.stringify(project, null, 2));
}

// --- run validation -----------------------------------------------------------
// An imported run goes straight into IndexedDB and is read back by every consumer
// without re-validation, so one malformed record poisons the whole store (listRuns
// sorts on updatedAt, mergeProject compares it) with no way out through the UI.
// Repair what the rest of the record implies; reject the run when it doesn't.

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const strOr = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
const numOr = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function malformed(): never {
  throw new Error("The project file contains a malformed run.");
}

// Structural only — geokit and the map handle the rest. Point coordinates get
// dereferenced directly (area label, buffer anchor), so that pair has to be real.
function asGeometry(v: unknown): Geometry | null {
  if (!isObj(v) || typeof v.type !== "string") return null;
  if (v.type === "Point") {
    const c = v.coordinates;
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  }
  return v as unknown as Geometry;
}

function asArea(v: unknown): SavedArea | null {
  if (!isObj(v)) return null;
  const geometry = asGeometry(v.geometry);
  if (!geometry) return null;
  const ticketId = typeof v.ticketId === "string" ? v.ticketId : undefined;
  const importName = typeof v.importName === "string" ? v.importName : undefined;
  // A source without its companion field would label as "Ticket undefined".
  const fallback: SavedArea["source"] = geometry.type === "Point" ? "point" : "polygon";
  const src = typeof v.source === "string" ? v.source : "";
  const source: SavedArea["source"] =
    src === "ticket" ? (ticketId ? "ticket" : fallback)
    : src === "import" ? (importName ? "import" : fallback)
    : src === "point" || src === "polygon" || src === "coordinates" ? src
    : fallback;
  return { source, ticketId, importName, geometry };
}

function asRule(v: unknown): ConflictRule {
  const o = isObj(v) ? v : {};
  return { selfOwners: strList(o.selfOwners), excludedStatuses: strList(o.excludedStatuses) };
}

// A saved result is the evidence a reopened run renders from: its metadata can be
// defaulted, but without the AOI or the facility list there is nothing to render.
function asResult(v: unknown, area: SavedArea, radiusM: number, rule: ConflictRule, now: string): RunResult | null {
  if (v == null) return null; // saved as a draft
  if (!isObj(v)) malformed();
  const aoiGeometry = asGeometry(v.aoiGeometry);
  if (!aoiGeometry || !Array.isArray(v.facilities)) malformed();
  const facilities = v.facilities.filter((f): f is ConflictFacility => isObj(f));
  return {
    ranAt: strOr(v.ranAt, now),
    aoiGeometry,
    conflictCount: numOr(v.conflictCount, facilities.length),
    jurisdiction: typeof v.jurisdiction === "string" ? v.jurisdiction : null,
    facilities,
    via: strOr(v.via, areaLabel(area)),
    radiusM: numOr(v.radiusM, radiusM),
    rule: isObj(v.rule) ? asRule(v.rule) : rule,
  };
}

// --- ticket-overlay validation ------------------------------------------------
// The imported overlay is written straight to localStorage by mergeOverlay and then
// read back — unvalidated — by every ticket consumer, so a malformed `added` record
// (missing id, non-numeric coordinates) would corrupt local ticket state with no way
// out through the UI. Coerce each record to a real OverlayTicket; drop what can't be.

const WORK_TYPES: readonly WorkType[] = ["locate", "design", "survey", "permit"];
const PRIORITIES: readonly Priority[] = ["low", "normal", "high"];
const WORKFLOWS: readonly WorkflowStatus[] = ["new", "in_review", "resolved"];
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

function asOverlayTicket(v: unknown, now: string): OverlayTicket | null {
  if (!isObj(v)) return null;
  // Dereferenced directly (rendered on the map, keyed by id) — these must be real.
  if (typeof v.ticket_id !== "string" || !v.ticket_id) return null;
  if (!Number.isFinite(v.lon) || !Number.isFinite(v.lat)) return null;
  return {
    ticket_id: v.ticket_id,
    source: strOr(v.source, "permit_intake"),
    work_type: oneOf(v.work_type, WORK_TYPES, "permit"),
    priority: oneOf(v.priority, PRIORITIES, "normal"),
    workflow_status: oneOf(v.workflow_status, WORKFLOWS, "new"),
    intake_conflict_count: numOr(v.intake_conflict_count, 0),
    radius_m: numOr(v.radius_m, 100),
    lon: v.lon as number,
    lat: v.lat as number,
    county_geoid: typeof v.county_geoid === "string" ? v.county_geoid : null,
    created_at: strOr(v.created_at, now),
    origin: "user",
  };
}

// A per-field edit patch: keep only recognized keys with the right type.
function asOverlayPatch(v: Record<string, unknown>): Partial<OverlayTicket> {
  const p: Partial<OverlayTicket> = {};
  if (typeof v.source === "string") p.source = v.source;
  if (typeof v.work_type === "string" && (WORK_TYPES as readonly string[]).includes(v.work_type)) p.work_type = v.work_type as WorkType;
  if (typeof v.priority === "string" && (PRIORITIES as readonly string[]).includes(v.priority)) p.priority = v.priority as Priority;
  if (typeof v.workflow_status === "string" && (WORKFLOWS as readonly string[]).includes(v.workflow_status)) p.workflow_status = v.workflow_status as WorkflowStatus;
  if (Number.isFinite(v.intake_conflict_count)) p.intake_conflict_count = v.intake_conflict_count as number;
  if (Number.isFinite(v.radius_m)) p.radius_m = v.radius_m as number;
  if (Number.isFinite(v.lon)) p.lon = v.lon as number;
  if (Number.isFinite(v.lat)) p.lat = v.lat as number;
  if (typeof v.county_geoid === "string" || v.county_geoid === null) p.county_geoid = v.county_geoid as string | null;
  return p;
}

function asOverlayImport(v: unknown, now: string): Partial<Overlay> {
  if (!isObj(v)) return {};
  const added = (Array.isArray(v.added) ? v.added : [])
    .map((t) => asOverlayTicket(t, now))
    .filter((t): t is OverlayTicket => t !== null);
  const edited: Record<string, Partial<OverlayTicket>> = {};
  if (isObj(v.edited)) {
    for (const [id, patch] of Object.entries(v.edited)) {
      if (typeof id === "string" && isObj(patch)) edited[id] = asOverlayPatch(patch);
    }
  }
  const deleted = Array.isArray(v.deleted) ? v.deleted.filter((x): x is string => typeof x === "string") : [];
  return { added, edited, deleted };
}

function asRun(v: unknown, now: string): AnalysisRun {
  if (!isObj(v) || typeof v.id !== "string" || !v.id) malformed();
  const area = asArea(v.area);
  if (!area) malformed();
  const radiusM = numOr(isObj(v.buffer) ? v.buffer.radiusM : undefined, 100);
  const rule = asRule(v.rule);
  const layers = isObj(v.layers) ? v.layers : {};
  const imported = isObj(layers.importedOverlay) ? layers.importedOverlay : null;
  const createdAt = strOr(v.createdAt, now);
  return {
    id: v.id,
    name: strOr(v.name, defaultRunName(area, radiusM)),
    notes: strOr(v.notes, ""),
    createdAt,
    // Sorting and merge precedence both key on updatedAt. Falling back to the
    // creation time (import time when that's missing too) keeps it a real
    // timestamp without letting a bare import outrank a genuine local run.
    updatedAt: strOr(v.updatedAt, createdAt),
    area,
    buffer: { radiusM },
    rule,
    rulePresetName: typeof v.rulePresetName === "string" ? v.rulePresetName : undefined,
    layers: {
      hexOn: layers.hexOn === true,
      importedOverlay:
        imported && typeof imported.name === "string" &&
        isObj(imported.features) && Array.isArray(imported.features.features)
          ? { name: imported.name, features: imported.features as unknown as FeatureCollection }
          : undefined,
    },
    result: asResult(v.result, area, radiusM, rule, now),
  };
}

/** Parse + validate a project file. Throws with a user-readable message on any problem. */
export function parseProject(text: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const p = raw as Partial<ProjectFile>;
  if (p?.format !== PROJECT_FORMAT) throw new Error("That file isn't a GIS Conflict project.");
  if (p.version !== PROJECT_VERSION) {
    throw new Error(`Project version ${String(p.version)} isn't supported (this app reads version ${PROJECT_VERSION}).`);
  }
  if (!Array.isArray(p.runs)) throw new Error("The project file has no runs list.");
  const now = new Date().toISOString();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    exportedAt: strOr(p.exportedAt, now),
    region: strOr(p.region, ""),
    runs: p.runs.map((r) => asRun(r, now)),
    ticketOverlay: asOverlayImport(p.ticketOverlay, now),
  };
}

export interface MergeSummary {
  runsAdded: number;
  runsUpdated: number;
  tickets: { added: number; edited: number; deleted: number };
}

/**
 * Merge an imported project into local state: runs by id (incoming wins when its
 * updatedAt is newer; same id + older incoming = skipped), ticket overlay merged
 * additively. Existing local runs are never deleted.
 */
export async function mergeProject(project: ProjectFile, localRuns: AnalysisRun[]): Promise<MergeSummary> {
  const byId = new Map(localRuns.map((r) => [r.id, r]));
  let runsAdded = 0;
  let runsUpdated = 0;
  for (const incoming of project.runs) {
    const local = byId.get(incoming.id);
    if (local && local.updatedAt >= incoming.updatedAt) continue;
    if (await putRun(incoming)) {
      if (local) runsUpdated++;
      else runsAdded++;
    }
  }
  const tickets = mergeOverlay(project.ticketOverlay ?? {});
  return { runsAdded, runsUpdated, tickets };
}
