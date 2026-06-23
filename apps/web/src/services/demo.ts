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

export interface DemoConfig {
  metro: string;
  label: string;
  selfOwners: string[];
  excludedFacilityStatuses: string[];
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

export async function ticketsLayer(): Promise<FeatureCollection> {
  return toFC(
    await q<GeomRow>(
      `SELECT ticket_id, source, status, conflict_count, county_geoid,
              ST_AsGeoJSON(ST_GeomFromWKB(geom)) AS gj
       FROM read_parquet('ticket.parquet')`,
    ),
  );
}

// --- stats / list ----------------------------------------------------------
export interface Stats {
  facilities: number;
  tickets: number;
  conflicts: number;
  counties: { name: string; tickets: number }[];
}

export async function stats(): Promise<Stats> {
  const [agg] = await q<{ facilities: number; tickets: number; conflicts: number }>(
    `SELECT
        (SELECT count(*) FROM read_parquet('facility.parquet')) AS facilities,
        (SELECT count(*) FROM read_parquet('ticket.parquet')) AS tickets,
        (SELECT count(*) FROM read_parquet('ticket.parquet') WHERE conflict_count > 0) AS conflicts`,
  );
  const counties = await q<{ name: string; tickets: number }>(
    `SELECT c.name AS name, count(*) AS tickets
     FROM read_parquet('ticket.parquet') t
     JOIN read_parquet('county.parquet') c ON t.county_geoid = c.geoid
     GROUP BY c.name ORDER BY tickets DESC`,
  );
  return {
    facilities: Number(agg.facilities),
    tickets: Number(agg.tickets),
    conflicts: Number(agg.conflicts),
    counties: counties.map((r) => ({ name: r.name, tickets: Number(r.tickets) })),
  };
}

export interface TicketRow {
  ticket_id: string;
  source: string;
  status: string;
  conflict_count: number;
  lon: number;
  lat: number;
}

export async function recentTickets(limit = 40): Promise<TicketRow[]> {
  const rows = await q<TicketRow>(
    `SELECT ticket_id, source, status, conflict_count, lon, lat
     FROM read_parquet('ticket.parquet')
     ORDER BY created_at DESC LIMIT ${limit}`,
  );
  return rows.map((r) => ({ ...r, conflict_count: Number(r.conflict_count) }));
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
     SELECT f.id, f.owner, f.voltage_class,
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

// --- geokit-powered pieces -------------------------------------------------
/** Geodesic buffer (meters) of a point -> AOI polygon, via the Rust/WASM engine. */
export function bufferPoint(lng: number, lat: number, meters: number): Geometry {
  const gk = getGeokit();
  const pt = JSON.stringify({ type: "Point", coordinates: [lng, lat] });
  return JSON.parse(gk.buffer_geojson(pt, meters, 8)) as Geometry;
}

/** Per-hex ticket density (FeatureCollection) at an H3 resolution, via geokit H3. */
export async function hexDensity(res: number): Promise<FeatureCollection> {
  const pts = await q<{ lon: number; lat: number }>(
    `SELECT lon, lat FROM read_parquet('ticket.parquet')`,
  );
  const arr = pts.map((p) => [Number(p.lon), Number(p.lat)] as [number, number]);
  const gk = getGeokit();
  return JSON.parse(gk.h3_hex_density_geojson(arr, res)) as FeatureCollection;
}

/** Parse a KMZ/KML file (bytes) into GeoJSON, via geokit. */
export function parseKmz(bytes: Uint8Array): FeatureCollection {
  const gk = getGeokit();
  return JSON.parse(gk.kmz_to_geojson(bytes)) as FeatureCollection;
}
