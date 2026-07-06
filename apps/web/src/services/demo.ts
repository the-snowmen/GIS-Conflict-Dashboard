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

// The conflict rule as a tunable "opinion": which facilities count as ours (owners)
// and which statuses to exclude. Defaults come from demo_config.json; the UI can
// override it live (the facilities themselves — the "facts" — never change).
export interface ConflictRule {
  selfOwners: string[];
  excludedStatuses: string[];
}

// Distinct owner/status values in the facility table, to seed the rule controls.
export interface FacilityFacets {
  owners: string[];
  statuses: string[];
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

export function ticketsToFC(rows: MergedTicket[]): FeatureCollection {
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

export async function ticketsLayer(): Promise<FeatureCollection> {
  return ticketsToFC(await allTicketsMerged());
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

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

/** Count "our" in-service facilities intersecting an AOI polygon. The rule (owner
 *  set + excluded statuses) defaults to demo_config.json but can be overridden live. */
export async function conflictForAoi(aoi: Geometry, rule?: ConflictRule): Promise<ConflictResult> {
  const cfg = await config();
  const selfOwners = rule?.selfOwners ?? cfg.selfOwners;
  const excludedStatuses = rule?.excludedStatuses ?? cfg.excludedFacilityStatuses;
  // An empty owner set means "nothing is ours" -> no conflicts (and avoids `IN ()`).
  if (selfOwners.length === 0) return { count: 0, facilities: EMPTY_FC };
  const owners = selfOwners.map(sqlString).join(",");
  const exclClause = excludedStatuses.length
    ? `AND f.status NOT IN (${excludedStatuses.map(sqlString).join(",")})`
    : "";
  const aoiJson = sqlString(JSON.stringify(aoi));
  const rows = await q<GeomRow>(
    `WITH aoi AS (SELECT ST_GeomFromGeoJSON(${aoiJson}) AS g)
     SELECT f.id, f.owner, f.voltage_class, f.status,
            ST_AsGeoJSON(ST_GeomFromWKB(f.geom)) AS gj
     FROM read_parquet('facility.parquet') f, aoi
     WHERE f.owner IN (${owners})
       ${exclClause}
       AND ST_Intersects(aoi.g, ST_GeomFromWKB(f.geom))`,
  );
  return { count: rows.length, facilities: toFC(rows) };
}

/** Per-ticket conflict count under a live rule, across ALL baseline tickets, using each
 *  ticket's recorded buffer polygon (aoi.parquet) intersected with the facilities matching
 *  the rule. Under the default rule this reproduces the stored intake `conflict_count`
 *  exactly; toggling owners/statuses moves it. Returns only tickets with count > 0. */
export async function liveTicketConflictCounts(rule?: ConflictRule): Promise<Map<string, number>> {
  const cfg = await config();
  const selfOwners = rule?.selfOwners ?? cfg.selfOwners;
  const excludedStatuses = rule?.excludedStatuses ?? cfg.excludedFacilityStatuses;
  if (selfOwners.length === 0) return new Map(); // nothing is "ours" -> no conflicts
  const owners = selfOwners.map(sqlString).join(",");
  const exclClause = excludedStatuses.length
    ? `AND f.status NOT IN (${excludedStatuses.map(sqlString).join(",")})`
    : "";
  const rows = await q<{ ticket_id: string; n: number }>(
    `SELECT a.ticket_id AS ticket_id, count(*) AS n
     FROM read_parquet('aoi.parquet') a, read_parquet('facility.parquet') f
     WHERE f.owner IN (${owners})
       ${exclClause}
       AND ST_Intersects(ST_GeomFromWKB(a.geom), ST_GeomFromWKB(f.geom))
     GROUP BY a.ticket_id`,
  );
  return new Map(rows.map((r) => [r.ticket_id, Number(r.n)]));
}

// Distinct owners/statuses in the facility table (read once) to seed the rule chips.
let facetsPromise: Promise<FacilityFacets> | null = null;
export function facilityFacets(): Promise<FacilityFacets> {
  return (facetsPromise ??= (async () => {
    const [owners, statuses] = await Promise.all([
      q<{ owner: string }>(
        `SELECT DISTINCT owner FROM read_parquet('facility.parquet')
         WHERE owner IS NOT NULL ORDER BY owner`,
      ),
      q<{ status: string }>(
        `SELECT DISTINCT status FROM read_parquet('facility.parquet')
         WHERE status IS NOT NULL ORDER BY status`,
      ),
    ]);
    return { owners: owners.map((r) => r.owner), statuses: statuses.map((r) => r.status) };
  })());
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

// --- H3 conflict-index cell layer (the "second altitude") ------------------
// A tunable multi-criteria index over H3 hexes. The per-cell aggregates are FACTS
// (ticket volume, conflict rate, mean severity, facility density) computed once per
// resolution; the weights + normalization + threshold are OPINIONS applied live in
// the browser. CD's dataset is small, so the whole thing runs client-side on demand
// — no baked cell files, no build step (mirrors the app's live-spatial-SQL ethos).

// Per-cell facts (independent of the weights).
export interface CellFacts {
  cell_id: string;
  geometry: Geometry; // hex boundary polygon (EPSG:4326)
  centroid: [number, number]; // [lon, lat] — fly-to anchor
  ticket_count: number;
  conflict_ticket_count: number; // tickets with ≥1 conflict
  conflict_rate: number; // conflict_ticket_count / ticket_count (0..1)
  mean_severity: number; // avg conflict_count over the cell's tickets
  facility_count: number; // facilities intersecting the hex (ST_Intersects)
  ticket_ids: string[]; // membership, for drill-down
}

export interface CellWeights {
  demand: number; // ticket volume
  rate: number; // conflict rate
  severity: number; // mean conflicts per ticket
  infra: number; // facility density
  norm: "z" | "minmax";
}

export const DEFAULT_CELL_WEIGHTS: CellWeights = {
  demand: 0.3,
  rate: 0.4,
  severity: 0.2,
  infra: 0.1,
  norm: "z",
};

// A scored cell (facts + the live index). `score01` is the index min-maxed to [0,1]
// for the choropleth ramp; `index` is the raw weighted score for the ranked table.
export interface CellScore extends CellFacts {
  index: number;
  score01: number;
  is_hotspot: boolean; // high ticket volume AND high conflict rate
}

// Average of a polygon's exterior ring — a good-enough hex centroid for fly-to.
function ringCentroid(g: Geometry): [number, number] {
  const ring = g.type === "Polygon" ? g.coordinates[0] : [];
  if (!ring.length) return [0, 0];
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

// Facilities intersecting each hex, via one DuckDB spatial join over a VALUES list
// of the occupied hex polygons. Resilient: on any failure every cell gets 0 (the
// infra axis simply contributes nothing), so the rest of the index still works.
async function facilityCountsByCell(
  cellIds: string[],
  geom: Map<string, Geometry>,
): Promise<Map<string, number>> {
  if (!cellIds.length) return new Map();
  try {
    const values = cellIds
      .map(
        (id) =>
          `(${sqlString(id)}, ST_GeomFromGeoJSON(${sqlString(JSON.stringify(geom.get(id)))}))`,
      )
      .join(",");
    const rows = await q<{ cell_id: string; n: number }>(
      `WITH cells(cell_id, g) AS (VALUES ${values})
       SELECT c.cell_id AS cell_id, count(*) AS n
       FROM cells c JOIN read_parquet('facility.parquet') f
         ON ST_Intersects(c.g, ST_GeomFromWKB(f.geom))
       GROUP BY c.cell_id`,
    );
    return new Map(rows.map((r) => [String(r.cell_id), Number(r.n)]));
  } catch (e) {
    console.warn("facility density unavailable (infra axis = 0):", e);
    return new Map();
  }
}

/** Aggregate the merged tickets into H3 cells at `res` → per-cell facts. */
export async function computeCellFacts(res: number): Promise<CellFacts[]> {
  const tickets = await allTicketsMerged();
  const gk = getGeokit();
  const bins = new Map<string, { ids: string[]; conflicts: number; sevSum: number }>();
  for (const t of tickets) {
    const h = gk.h3_index_point(t.lat, t.lon, res); // note: lat, lon order
    let b = bins.get(h);
    if (!b) {
      b = { ids: [], conflicts: 0, sevSum: 0 };
      bins.set(h, b);
    }
    b.ids.push(t.ticket_id);
    if (t.conflict_count > 0) b.conflicts++;
    b.sevSum += t.conflict_count;
  }
  const cellIds = [...bins.keys()];
  const geom = new Map<string, Geometry>();
  for (const id of cellIds) geom.set(id, JSON.parse(gk.h3_cell_boundary_geojson(id)) as Geometry);
  const facCounts = await facilityCountsByCell(cellIds, geom);
  return cellIds.map((id) => {
    const b = bins.get(id)!;
    const g = geom.get(id)!;
    return {
      cell_id: id,
      geometry: g,
      centroid: ringCentroid(g),
      ticket_count: b.ids.length,
      conflict_ticket_count: b.conflicts,
      conflict_rate: b.ids.length ? b.conflicts / b.ids.length : 0,
      mean_severity: b.ids.length ? b.sevSum / b.ids.length : 0,
      facility_count: facCounts.get(id) ?? 0,
      ticket_ids: b.ids,
    };
  });
}

/** Score the cell facts with the live weights → ranked CellScore[]. Pure + instant. */
export function scoreCells(facts: CellFacts[], w: CellWeights): CellScore[] {
  if (!facts.length) return [];
  const cols = ["ticket_count", "conflict_rate", "mean_severity", "facility_count"] as const;
  // A normalizer per column (z-score or min-max over the occupied-cell distribution).
  const normOf: Record<string, (v: number) => number> = {};
  for (const c of cols) {
    const vals = facts.map((f) => f[c]);
    if (w.norm === "minmax") {
      const mn = Math.min(...vals);
      const range = Math.max(...vals) - mn || 1;
      normOf[c] = (v) => (v - mn) / range;
    } else {
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
      normOf[c] = (v) => (v - mean) / sd;
    }
  }
  const scored = facts.map((f) => {
    const nDemand = normOf.ticket_count(f.ticket_count);
    const nRate = normOf.conflict_rate(f.conflict_rate);
    const nSev = normOf.mean_severity(f.mean_severity);
    const nInfra = normOf.facility_count(f.facility_count);
    const index = w.demand * nDemand + w.rate * nRate + w.severity * nSev + w.infra * nInfra;
    return { f, nDemand, nRate, index };
  });
  const idx = scored.map((s) => s.index);
  const mn = Math.min(...idx);
  const range = Math.max(...idx) - mn || 1;
  return scored
    .map((s) => ({
      ...s.f,
      index: s.index,
      score01: (s.index - mn) / range,
      // Hotspot = above the midpoint on BOTH activity and conflict rate (work meets risk).
      is_hotspot: s.nDemand >= 0.5 && s.nRate >= 0.5,
    }))
    .sort((a, b) => b.index - a.index);
}

/** A scored-cell FeatureCollection for MapLibre (index props ride on each hex). */
export function cellsToFC(scores: CellScore[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: scores.map((s) => ({
      type: "Feature",
      geometry: s.geometry,
      properties: {
        cell_id: s.cell_id,
        score01: s.score01,
        index: s.index,
        hotspot: s.is_hotspot,
        ticket_count: s.ticket_count,
        conflict_rate: s.conflict_rate,
      },
    })),
  };
}
