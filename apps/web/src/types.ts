// Shared UI types. App.tsx owns all state; these describe the values it passes to
// the presentational components under components/.
import type { Geometry } from "geojson";
import type { ConflictRule } from "./services/demo";

export type Phase = "loading" | "ready" | "error";
export type Mode = "idle" | "buffer" | "draw" | "addTicket";
export type Altitude = "tickets" | "cells";

export interface EditingState {
  mode: "create" | "edit";
  ticket_id?: string;
  source: string;
  lon: number;
  lat: number;
  lon0: number; // original position, to detect a move
  lat0: number;
}

export interface ConflictInfo {
  count: number;
  jurisdiction: string | null;
  via: string;
}

// The selected ticket shown in the detail panel.
export interface TicketInfo {
  ticket_id: string;
  source: string;
  status: string;
  county: string | null;
  storedCount: number;
  liveCount: number;
  radius: number;
  lon: number;
  lat: number;
  facilities: ConflictFacility[];
}

// One conflicting facility row in the detail panel. id + geometry power the
// hover-flash and click-to-inspect on the map; status feeds the popup; dist_m is
// the approximate distance from the analyzed point to the facility.
export interface ConflictFacility {
  id?: number;
  owner?: string;
  voltage_class?: string;
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

// Minimal ticket shape shared by map-click (feature.properties) and the sidebar list.
export type TicketLike = { ticket_id: string; source: string; status: string; conflict_count: number };
// Just what startEdit needs (satisfied by MergedTicket and by the detail panel).
export type EditableTicket = { ticket_id: string; source: string; status: string; lon: number; lat: number };
