// Pure geometry helpers shared across the app (no React, no map deps).
import type { Geometry, Position } from "geojson";
import type { WorkArea } from "../types";

// Compact distance label: meters under 1 km, else km with one decimal.
export function fmtMeters(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/**
 * The "Buffer" fact for a run, derived once so the Summary tab and the report
 * can never state opposite things about the same area.
 *
 * A run buffers exactly one shape (aoiOf in lib/useAnalysisRun.ts): a Point area
 * gets a geodesic buffer of radiusM, and a Polygon/MultiPolygon area is analyzed
 * as-is. Ticket, map-point and coordinate areas are always Points (App.tsx).
 *
 * Imports are the ambiguous case. An imported area is always a polygon by the time
 * it is analyzed, but that polygon is either the imported polygon itself (nothing
 * was ever buffered) or a point/line import buffered at selection, by whatever
 * radius was set at that moment. The WorkArea records neither the original geometry
 * type nor that distance, so the label states what is provable — this run added no
 * buffer — and names the selection-time buffer as the possibility it is.
 */
export function bufferLabel(area: WorkArea | null, radiusM: number): string {
  if (!area) return "Not recorded";
  if (area.geometry.type === "Point") return `${radiusM} m (geodesic)`;
  if (area.source === "import")
    return "Imported area — no buffer applied by this run (point and line imports are buffered at selection)";
  return "Drawn area (no buffer)";
}

// A vertex on a line feature (true midpoint vertex), so a popup/flyTo anchor
// always lands on the line itself rather than off it.
export function lineCentroid(geom: Geometry): Position {
  let pts: Position[] = [];
  if (geom.type === "LineString") pts = geom.coordinates;
  else if (geom.type === "MultiLineString") pts = geom.coordinates.flat();
  else if (geom.type === "Point") return geom.coordinates;
  else if (geom.type === "Polygon") return polygonCentroid(geom);
  if (pts.length === 0) return [0, 0];
  return pts[Math.floor(pts.length / 2)];
}

// Approximate distance (meters) from a point to a facility geometry, via a local
// equirectangular projection around the point (accurate at AOI scales) + point-to-
// segment distance. Screening-grade, labeled "≈" in the UI.
export function distPointToGeomM(pt: Position, geom: Geometry): number {
  const R = 6371008.8; // mean Earth radius (m)
  const [plng, plat] = pt;
  const cosLat = Math.cos((plat * Math.PI) / 180);
  const proj = (p: Position): [number, number] => [
    (((p[0] - plng) * Math.PI) / 180) * cosLat * R,
    (((p[1] - plat) * Math.PI) / 180) * R,
  ];
  const segDist = (a: Position, b: Position): number => {
    const [ax, ay] = proj(a);
    const [bx, by] = proj(b);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? -(ax * dx + ay * dy) / len2 : 0; // foot of perpendicular (point at origin)
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(ax + t * dx, ay + t * dy);
  };
  let rings: Position[][] = [];
  if (geom.type === "LineString") rings = [geom.coordinates];
  else if (geom.type === "MultiLineString") rings = geom.coordinates;
  else if (geom.type === "Polygon") rings = geom.coordinates;
  else if (geom.type === "MultiPolygon") rings = geom.coordinates.flat();
  else if (geom.type === "Point") return Math.hypot(...proj(geom.coordinates));
  let min = Infinity;
  for (const ring of rings)
    for (let i = 1; i < ring.length; i++) min = Math.min(min, segDist(ring[i - 1], ring[i]));
  return Number.isFinite(min) ? min : 0;
}

// Average of a polygon's exterior ring — good enough to pick a jurisdiction.
export function polygonCentroid(geom: Geometry): Position {
  let ring: Position[] = [];
  if (geom.type === "Polygon") ring = geom.coordinates[0];
  else if (geom.type === "MultiPolygon") ring = geom.coordinates[0][0];
  if (ring.length === 0) return [0, 0];
  const sum = ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
  return [sum[0] / ring.length, sum[1] / ring.length];
}
