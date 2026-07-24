// Shared UI types. App.tsx owns all state; these describe the values it passes to
// the presentational components under components/.
import type { Geometry } from "geojson";
import type { ConflictRule } from "./services/demo";

export type Phase = "loading" | "ready" | "error";
// Top-level app mode: assess one work area, or screen the portfolio of H3 cells.
export type AppMode = "assess" | "screen";
// Transient map-interaction mode while placing a work area or a ticket point.
export type Mode = "idle" | "point" | "draw" | "addTicket";

// The work area under assessment: an existing ticket, a clicked/entered point,
// a drawn polygon, or a feature from an imported file.
export interface WorkArea {
  source: "ticket" | "point" | "polygon" | "coordinates" | "import";
  geometry: Geometry; // the ORIGINAL area (Point or Polygon/MultiPolygon), EPSG:4326
  ticketId?: string;
  label: string; // e.g. "Ticket T-1042", "Drawn area", "Imported: Site A"
  importName?: string;
}

// Lifecycle of an analysis run (lib/useAnalysisRun.ts): draft = configured, not run;
// running = queries in flight; fresh = results match the current config; stale =
// config changed after the run (results still shown, from the previous config).
export type RunStatus = "draft" | "running" | "fresh" | "stale" | "error";

// The result snapshot shown in the results tray. Carries the configuration it was
// produced under (radius + rule) so the summary, exports, and saved runs are exact.
export interface RunResult {
  ranAt: string; // ISO timestamp of the run
  aoiGeometry: Geometry; // the buffered AOI actually analyzed
  conflictCount: number;
  jurisdiction: string | null;
  facilities: ConflictFacility[];
  via: string; // provenance label, e.g. "100 m buffer on Ticket T-1042"
  radiusM: number;
  rule: ConflictRule;
}

export interface EditingState {
  mode: "create" | "edit";
  ticket_id?: string;
  source: string;
  work_type: "locate" | "design" | "survey" | "permit";
  priority: "low" | "normal" | "high";
  workflow_status: "new" | "in_review" | "resolved";
  lon: number;
  lat: number;
  lon0: number; // original position, to detect a move
  lat0: number;
}

// Live conflict info for the ticket create/edit form (derived status preview).
export interface ConflictInfo {
  count: number;
  jurisdiction: string | null;
  via: string;
}

// One conflicting facility row in the results tray. id + geometry power the
// hover-flash and click-to-inspect on the map; dist_m is the approximate
// distance from the analyzed point/centroid to the facility.
export interface ConflictFacility {
  id?: number;
  asset_ref?: string;
  owner?: string;
  voltage_class?: string;
  nominal_kv?: number;
  asset_type?: string;
  status?: string;
  geometry?: Geometry;
  dist_m?: number;
}

// A one-click conflict-rule bundle for the preset row.
export interface RulePreset {
  name: string;
  hint: string;
  rule: ConflictRule;
}

// Minimal ticket shape shared by map-click (feature.properties) and the picker list.
export type TicketLike = { ticket_id: string; source: string; intake_conflict_count: number; conflict_count: number };
// Just what startEdit needs (satisfied by MergedTicket).
export type EditableTicket = {
  ticket_id: string; source: string; work_type: "locate" | "design" | "survey" | "permit";
  priority: "low" | "normal" | "high"; workflow_status: "new" | "in_review" | "resolved";
  lon: number; lat: number;
};
