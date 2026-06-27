// Client-side export helpers: turn in-browser conflict/ticket data into downloadable
// CSV / GeoJSON files. No backend — everything is a Blob + an object URL.
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { MergedTicket } from "./overlay";

/** Trigger a browser download of `text` as a file. */
export function downloadText(filename: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// --- CSV --------------------------------------------------------------------
// RFC-4180-ish quoting: wrap in quotes when the value holds a comma, quote, or newline.
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return lines.join("\r\n");
}

interface FacilityProps {
  id?: number;
  owner?: string;
  voltage_class?: string;
  status?: string;
}

function facilityProps(f: Feature): FacilityProps {
  return (f.properties ?? {}) as FacilityProps;
}

/** Conflicting facilities -> CSV (one row per intersected line). */
export function conflictsToCsv(facilities: FeatureCollection): string {
  const rows = facilities.features.map((f) => {
    const p = facilityProps(f);
    return [p.id ?? "", p.owner ?? "", p.voltage_class ?? "", p.status ?? ""];
  });
  return toCsv(["id", "owner", "voltage_class", "status"], rows);
}

/**
 * Buffer/AOI geometry + intersected facilities as one GeoJSON FeatureCollection.
 * Coordinates are WGS84 / EPSG:4326 (GeoJSON default, RFC 7946).
 */
export function conflictsToGeoJson(aoi: Geometry, facilities: FeatureCollection): FeatureCollection {
  const aoiFeature: Feature = { type: "Feature", geometry: aoi, properties: { role: "aoi_buffer" } };
  const facs: Feature[] = facilities.features.map((f) => ({
    type: "Feature",
    geometry: f.geometry,
    properties: { role: "conflict_facility", ...facilityProps(f) },
  }));
  return { type: "FeatureCollection", features: [aoiFeature, ...facs] };
}

/** Merged ticket list -> CSV. */
export function ticketsToCsv(tickets: MergedTicket[]): string {
  const rows = tickets.map((t) => [
    t.ticket_id,
    t.source,
    t.status,
    t.conflict_count,
    t.lat,
    t.lon,
    t.county_geoid ?? "",
    t.created_at,
    t.origin,
  ]);
  return toCsv(
    ["ticket_id", "source", "status", "conflict_count", "lat", "lon", "county_geoid", "created_at", "origin"],
    rows,
  );
}
