// Tiny shared presenters for a conflicting facility — one wording everywhere the
// evidence appears (facilities table, drawer, CSV, report).
import type { ConflictFacility } from "../types";

export function facilityName(f: ConflictFacility): string {
  return f.asset_ref ?? f.owner ?? "Unnamed facility";
}

// How the facility relates to the work area, limited to what the query proved: the
// only predicate run is ST_Intersects (conflictForAoi in services/demo.ts), which
// establishes a shared point — not whether a line crosses the area, runs through it,
// or merely clips a corner. A point is the one case it pins down: intersecting the
// AOI polygon means it lies in the area.
export function facilityRelation(f: ConflictFacility): string {
  return f.geometry?.type === "Point" ? "Inside area" : "Intersects area";
}

// Status arrives from the Parquet as a raw enum ("in_service"). Presented here so
// the underscore form never reaches a label, a table cell, or the rule sentence.
// Derived rather than table-driven so a new status value still reads correctly.
export function statusLabel(status: string): string {
  const words = status.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
