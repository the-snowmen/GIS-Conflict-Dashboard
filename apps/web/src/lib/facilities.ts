// Tiny shared presenters for a conflicting facility — one wording everywhere the
// evidence appears (facilities table, drawer, CSV, report).
import type { ConflictFacility } from "../types";

export function facilityName(f: ConflictFacility): string {
  return f.asset_ref ?? f.owner ?? "Unnamed facility";
}

// What the facility does to the work area: a point lies inside; a line crosses in.
export function facilityRelation(f: ConflictFacility): string {
  return f.geometry?.type === "Point" ? "Inside area" : "Crosses area";
}
