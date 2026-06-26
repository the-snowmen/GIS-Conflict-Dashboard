// High-level demo queries: turns the GeoParquet tables (via DuckDB-WASM) and the geokit WASM
// engine into the shapes the UI needs. Talks to DuckDB-WASM + geokit instead of a REST backend, so
// everything runs in the browser.
import type {
  Feature,
  FeatureCollection,
  Geometry,
  GeoJsonProperties,
} from "geojson";
import { q } from "./duckdb";
import { getGeokit } from "./geokit";
import {
  addTicket,
  deleteTicket,
  editTicket,
  isUserTicket,
  mergeRows,
  nextTicketId,
  type MergedTicket,
  type OverlayTicket,
} from "./overlay";

export type { MergedTicket } from "./overlay";

export interface DemoConfig {
  metro: string;
  label: string;
  selfOwners: string[];
  excludedFacilityStatuses: string[];
  ticketStatuses: string[];
}

let cfgPromise: Promise<DemoConfig> | null = null;
export function config(): Promise<DemoConfig> {
  return (cfgPromise ??= fetch(`${import.meta.env.BASE_URL}data/demo_config.json`).then((r) =>
    r.json(),
  ));
}

// --- helpers ---------------------------------------------------------------
type GeomRow = { gj: string } & Record<string, unknown>;

// DuckDB returns BIGINT columns as JS BigInt, which MapLibre cannot serialize into its
// worker (features with BigInt properties are silently dropped). Coerce to plain numbers.
function jsonSafe(props: Record<string, unknown>): GeoJsonProperties {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) out[k] = typeof v === "bigint" ? Number(v) : v;
  return out as GeoJsonProperties;
}

function toFC(rows: GeomRow[]): FeatureCollection {
  const features: Feature[] = rows.map(({ gj, ...props }) => ({
    type: "Feature",
    geometry: JSON.parse(gj) as Geometry,
    properties: jsonSafe(props),
  }));
  return { type: "FeatureCollection", features };
}

const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

// --- layers ----------------------------------------------------------------
export async function facilitiesLayer(): Promise<FeatureCollection> {
  return toFC(
    await q<GeomRow>(
      `SELECT id, owner, voltage_class, status,
              ST_AsGeoJSON(ST_GeomFromWKB(geom)) AS gj
       FROM read_parquet('facility.parquet')`,
    ),
  );
}

export async function countiesLayer(): Promise<FeatureCollection> {
  return toFC(
    await q<GeomRow>(
      `SELECT geoid, name, state, ST_AsGeoJSON(ST_GeomFromWKB(geom)) AS gj
       FROM read_parquet('county.parquet')`,
    ),
  );
}

// --- tickets: immutable parquet baseline + a localStorage overlay ----------
type BaselineTicketRow = {
  ticket_id: string;
  source: string;
  status: string;
  conflict_count: number;
  county_geoid: string | null;
  lon: number;
  lat: number;
  created_at: string;
};

// The baseline never changes, so read it once and re-merge the overlay per call.
let baselinePromise: Promise<MergedTicket[]> | null = null;
function baselineTickets(): Promise<MergedTicket[]> {
  return (baselinePromise ??= q<BaselineTicketRow>(
    `SELECT ticket_id, source, status, conflict_count, county_geoid, lon, lat,
            CAST(created_at AS VARCHAR) AS created_at
     FROM read_parquet('ticket.parquet')`,
  ).then((rows) =>
    rows.map((r) => ({
      ticket_id: r.ticket_id,
      source: r.source,
      status: r.status,
      conflict_count: Number(r.conflict_count), // BIGINT -> Number (MapLibre drops BigInt props)
      county_geoid: r.county_geoid,
      lon: Number(r.lon),
      lat: Number(r.lat),
      created_at: r.created_at,
      origin: "baseline" as const,
    })),
  ));
}

/** Baseline tickets with user adds/edits/deletes applied. */
export async function allTicketsMerged(): Promise<MergedTicket[]> {
  return mergeRows(await baselineTickets());
}

export async function ticketsLayer(): Promise<FeatureCollection> {
  const rows = await allTicketsMerged();
  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lon, r.lat] },
      properties: {
        ticket_id: r.ticket_id,
        source: r.source,
        status: r.status,
        conflict_count: Number(r.conflict_count),
        county_geoid: r.county_geoid,
        origin: r.origin,
      },
    })),
  };
}

// --- stats / list ----------------------------------------------------------
export interface Stats {
  facilities: number;
  tickets: number;
  conflicts: number;
  counties: { name: string; tickets: number }[];
}

// geoid -> county name (immutable; read once).
let countyNamePromise: Promise<Map<string, string>> | null = null;
function countyNames(): Promise<Map<string, string>> {
  return (countyNamePromise ??= q<{ geoid: string; name: string }>(
    `SELECT geoid, name FROM read_parquet('county.parquet')`,
  ).then((rows) => new Map(rows.map((r) => [String(r.geoid), r.name]))));
}

export async function stats(): Promise<Stats> {
  const [agg] = await q<{ facilities: number }>(
    `SELECT count(*) AS facilities FROM read_parquet('facility.parquet')`,
  );
  const merged = await allTicketsMerged();
  const names = await countyNames();
  const byCounty = new Map<string, number>();
  for (const t of merged) {
    if (!t.county_geoid) continue;
    byCounty.set(t.county_geoid, (byCounty.get(t.county_geoid) ?? 0) + 1);
  }
  const counties = [...byCounty.entries()]
    .map(([geoid, tickets]) => ({ name: names.get(geoid) ?? geoid, tickets }))
    .sort((a, b) => b.tickets - a.tickets);
  return {
    facilities: Number(agg.facilities),
    tickets: merged.length,
    conflicts: merged.filter((t) => t.conflict_count > 0).length,
    counties,
  };
}

// --- conflict analysis (DuckDB) + jurisdiction -----------------------------
export interface ConflictResult {
  count: number;
  facilities: FeatureCollection;
}

/** Count "our" in-service facilities intersecting an AOI polygon (the config-driven rule). */
export async function conflictForAoi(aoi: Geometry): Promise<ConflictResult> {
  const cfg = await config();
  const owners = cfg.selfOwners.map(sqlString).join(",");
  const excl = cfg.excludedFacilityStatuses.map(sqlString).join(",");
  const aoiJson = sqlString(JSON.stringify(aoi));
  const rows = await q<GeomRow>(
    `WITH aoi AS (SELECT ST_GeomFromGeoJSON(${aoiJson}) AS g)
     SELECT f.id, f.owner, f.voltage_class, f.status,
            ST_AsGeoJSON(ST_GeomFromWKB(f.geom)) AS gj
     FROM read_parquet('facility.parquet') f, aoi
     WHERE f.owner IN (${owners})
       AND f.status NOT IN (${excl})
       AND ST_Intersects(aoi.g, ST_GeomFromWKB(f.geom))`,
  );
  return { count: rows.length, facilities: toFC(rows) };
}

export async function jurisdictionFor(lng: number, lat: number): Promise<string | null> {
  const rows = await q<{ name: string }>(
    `SELECT c.name AS name FROM read_parquet('county.parquet') c
     WHERE ST_Within(ST_Point(${lng}, ${lat}), ST_GeomFromWKB(c.geom)) LIMIT 1`,
  );
  return rows[0]?.name ?? null;
}

/** County (geoid + name) containing a point, or null if outside tracked counties. */
async function countyAt(lng: number, lat: number): Promise<{ geoid: string; name: string } | null> {
  const rows = await q<{ geoid: string; name: string }>(
    `SELECT c.geoid AS geoid, c.name AS name FROM read_parquet('county.parquet') c
     WHERE ST_Within(ST_Point(${lng}, ${lat}), ST_GeomFromWKB(c.geom)) LIMIT 1`,
  );
  return rows[0] ?? null;
}

// --- ticket CRUD (overlay-backed) ------------------------------------------
const todayIso = () => new Date().toISOString().slice(0, 10);

// Live conflict count for a point at a given radius, via geokit buffer + ST_Intersects.
async function conflictCountAt(lon: number, lat: number, radiusM: number): Promise<number> {
  const { count } = await conflictForAoi(bufferPoint(lon, lat, radiusM));
  return count;
}

// A ticket's status is its conflict state — derived from the count, not user-chosen
// (matches how baseline tickets are scored in build_demo_db.py).
const deriveStatus = (n: number): string => (n > 0 ? "potential_conflict" : "no_conflict");

export interface CreateTicketInput {
  source: string;
  lon: number;
  lat: number;
  radiusM: number;
}

export async function createTicket(input: CreateTicketInput): Promise<MergedTicket> {
  const conflict_count = await conflictCountAt(input.lon, input.lat, input.radiusM);
  const county = await countyAt(input.lon, input.lat);
  const t: OverlayTicket = {
    ticket_id: nextTicketId(),
    source: input.source,
    status: deriveStatus(conflict_count),
    conflict_count,
    radius_m: input.radiusM,
    lon: input.lon,
    lat: input.lat,
    county_geoid: county?.geoid ?? null,
    created_at: todayIso(),
    origin: "user",
  };
  addTicket(t);
  return { ...t };
}

export interface UpdateTicketPatch {
  source?: string;
  lon?: number;
  lat?: number;
}

/** Update fields and/or move a ticket. Conflict count (and the derived status) is
 *  recomputed only when the point moves (the facility set is static, so field edits
 *  can't change it). */
export async function updateTicket(
  ticket_id: string,
  patch: UpdateTicketPatch,
  radiusM: number,
): Promise<void> {
  const moved = patch.lon !== undefined && patch.lat !== undefined;
  const full: Partial<OverlayTicket> = { source: patch.source };
  if (moved) {
    full.lon = patch.lon;
    full.lat = patch.lat;
    full.conflict_count = await conflictCountAt(patch.lon!, patch.lat!, radiusM);
    full.status = deriveStatus(full.conflict_count);
    full.radius_m = radiusM;
    full.county_geoid = (await countyAt(patch.lon!, patch.lat!))?.geoid ?? null;
  }
  editTicket(ticket_id, full, !isUserTicket(ticket_id));
}

export async function removeTicket(ticket_id: string): Promise<void> {
  deleteTicket(ticket_id, !isUserTicket(ticket_id));
}

// --- geokit-powered pieces -------------------------------------------------
/** Geodesic buffer (meters) of a point -> AOI polygon, via the Rust/WASM engine. */
export function bufferPoint(lng: number, lat: number, meters: number): Geometry {
  const gk = getGeokit();
  const pt = JSON.stringify({ type: "Point", coordinates: [lng, lat] });
  return JSON.parse(gk.buffer_geojson(pt, meters, 8)) as Geometry;
}

/** Per-hex ticket density (FeatureCollection) at an H3 resolution, via geokit H3. */
export async function hexDensity(res: number): Promise<FeatureCollection> {
  const rows = await allTicketsMerged();
  const arr = rows.map((r) => [r.lon, r.lat] as [number, number]);
  const gk = getGeokit();
  return JSON.parse(gk.h3_hex_density_geojson(arr, res)) as FeatureCollection;
}

/** Parse a KMZ/KML file (bytes) into GeoJSON, via geokit. */
export function parseKmz(bytes: Uint8Array): FeatureCollection {
  const gk = getGeokit();
  return JSON.parse(gk.kmz_to_geojson(bytes)) as FeatureCollection;
}
