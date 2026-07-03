// Client-side export helpers: turn in-browser conflict/ticket data into downloadable
// GeoJSON or KMZ files. No backend, no dependencies — Blobs + a hand-built store ZIP.
//
// Exports are self-documenting: the filename is dated, and every conflict file carries
// the exact rule assumptions it was made under plus a disclaimer, so an exported file is
// never divorced from how it was produced (data honesty — synthetic tickets, modeled rule).
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { MergedTicket } from "./overlay";

// The tunable assumptions baked into a conflict export (mirrors the live rule + AOI).
export interface ExportAssumptions {
  selfOwners: string[];
  excludedStatuses: string[];
  via: string; // how the AOI was made, e.g. "100 m buffer" or "drawn area"
  label: string; // region label, e.g. "Austin, TX"
}

const DISCLAIMER =
  "Modeled screening over public-domain infrastructure + synthetic work tickets. A conflict = a " +
  "facility owned by the selected network, not in an excluded status, intersecting the Area of " +
  "Interest. Not a survey, locate, or authoritative clearance.";

const iso = (): string => new Date().toISOString().slice(0, 10);

/** Dated, self-labeling filename stem, e.g. `gis-conflict_conflicts_2026-07-02.kmz`. */
export function exportName(kind: string, ext: string): string {
  return `gis-conflict_${kind}_${iso()}.${ext}`;
}

/** One-line summary of the rule assumptions an export was produced under. */
function assumptionLine(a: ExportAssumptions): string {
  const owners = a.selfOwners.length ? a.selfOwners.join(", ") : "(none)";
  const excl = a.excludedStatuses.length ? a.excludedStatuses.join(", ") : "(none)";
  return `Region ${a.label} · AOI: ${a.via} · your network: ${owners} · excluded status: ${excl}`;
}

/** Trigger a browser download of text content as a file. */
export function downloadText(filename: string, mime: string, text: string): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

/** Trigger a browser download of binary content (e.g. a KMZ zip) as a file. */
export function downloadBytes(filename: string, mime: string, bytes: Uint8Array): void {
  downloadBlob(filename, new Blob([bytes as BlobPart], { type: mime }));
}

function downloadBlob(filename: string, blob: Blob): void {
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

// --- GeoJSON ----------------------------------------------------------------
interface FacilityProps {
  id?: number;
  owner?: string;
  voltage_class?: string;
  status?: string;
}

function facilityProps(f: Feature): FacilityProps {
  return (f.properties ?? {}) as FacilityProps;
}

/**
 * Buffer/AOI geometry + intersected facilities as one GeoJSON FeatureCollection.
 * Coordinates are WGS84 / EPSG:4326 (GeoJSON default, RFC 7946).
 */
export function conflictsToGeoJson(
  aoi: Geometry,
  facilities: FeatureCollection,
  assumptions?: ExportAssumptions,
): FeatureCollection {
  // Provenance rides on the AOI feature's `properties` (RFC 7946-safe — no custom root member).
  const aoiFeature: Feature = {
    type: "Feature",
    geometry: aoi,
    properties: {
      role: "aoi_buffer",
      ...(assumptions ? { assumptions: assumptionLine(assumptions), disclaimer: DISCLAIMER } : {}),
    },
  };
  const facs: Feature[] = facilities.features.map((f) => ({
    type: "Feature",
    geometry: f.geometry,
    properties: { role: "conflict_facility", ...facilityProps(f) },
  }));
  return { type: "FeatureCollection", features: [aoiFeature, ...facs] };
}

/** Merged tickets as a GeoJSON point FeatureCollection. */
function ticketsToFc(tickets: MergedTicket[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: tickets.map((t) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [t.lon, t.lat] },
      properties: {
        ticket_id: t.ticket_id,
        source: t.source,
        status: t.status,
        conflict_count: t.conflict_count,
        origin: t.origin,
      },
    })),
  };
}

// --- KMZ (KML wrapped in a store-only ZIP) ----------------------------------
export function conflictsToKmz(
  aoi: Geometry,
  facilities: FeatureCollection,
  assumptions?: ExportAssumptions,
): Uint8Array {
  const description = assumptions ? `${assumptionLine(assumptions)}\n\n${DISCLAIMER}` : DISCLAIMER;
  // Pass assumptions through so the AOI placemark also carries them (parity with GeoJSON).
  return kmlToKmz(
    geojsonToKml(conflictsToGeoJson(aoi, facilities, assumptions), "Conflict analysis", description),
  );
}

export function ticketsToKmz(tickets: MergedTicket[]): Uint8Array {
  return kmlToKmz(geojsonToKml(ticketsToFc(tickets), "Tickets", DISCLAIMER));
}

const KMZ_MIME = "application/vnd.google-earth.kmz";
export { KMZ_MIME };

function xml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// KML coordinates are lng,lat,alt — same axis order as GeoJSON, with a 0 altitude.
function coords(ring: Position[]): string {
  return ring.map((p) => `${p[0]},${p[1]},0`).join(" ");
}

function geomToKml(g: Geometry): string {
  switch (g.type) {
    case "Point":
      return `<Point><coordinates>${g.coordinates[0]},${g.coordinates[1]},0</coordinates></Point>`;
    case "LineString":
      return `<LineString><coordinates>${coords(g.coordinates)}</coordinates></LineString>`;
    case "MultiLineString":
      return `<MultiGeometry>${g.coordinates
        .map((l) => `<LineString><coordinates>${coords(l)}</coordinates></LineString>`)
        .join("")}</MultiGeometry>`;
    case "Polygon":
      return polygonKml(g.coordinates);
    case "MultiPolygon":
      return `<MultiGeometry>${g.coordinates.map(polygonKml).join("")}</MultiGeometry>`;
    default:
      return "";
  }
}

function polygonKml(rings: Position[][]): string {
  const [outer, ...inners] = rings;
  const boundary = (ring: Position[], tag: string) =>
    `<${tag}><LinearRing><coordinates>${coords(ring)}</coordinates></LinearRing></${tag}>`;
  return `<Polygon>${boundary(outer, "outerBoundaryIs")}${inners
    .map((r) => boundary(r, "innerBoundaryIs"))
    .join("")}</Polygon>`;
}

// Placemark name/description derived from common properties (synthetic data only).
function placemark(f: Feature): string {
  if (!f.geometry) return "";
  const p = (f.properties ?? {}) as Record<string, unknown>;
  const name = p.ticket_id ?? p.owner ?? p.role ?? "Feature";
  const desc = Object.entries(p)
    .filter(([k]) => k !== "role")
    .map(([k, v]) => `${k}: ${v ?? ""}`)
    .join("\n");
  return `<Placemark><name>${xml(name)}</name>${
    desc ? `<description>${xml(desc)}</description>` : ""
  }${geomToKml(f.geometry)}</Placemark>`;
}

function geojsonToKml(fc: FeatureCollection, docName: string, description?: string): string {
  const body = fc.features.map(placemark).join("");
  const desc = description ? `<description>${xml(description)}</description>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(docName)}</name>${desc}${body}</Document></kml>`
  );
}

// --- minimal store-only ZIP (no compression, no dependency) -----------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Wrap KML text as `doc.kml` inside a single-entry store ZIP → a valid KMZ. */
function kmlToKmz(kml: string): Uint8Array {
  const name = "doc.kml";
  const nameBytes = new TextEncoder().encode(name);
  const data = new TextEncoder().encode(kml);
  const crc = crc32(data);
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (v: number) => out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  const bytes = (b: Uint8Array) => b.forEach((x) => out.push(x));

  // Local file header
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(data.length); u32(data.length);
  u16(nameBytes.length); u16(0);
  bytes(nameBytes);
  bytes(data);

  // Central directory header
  const cdOffset = out.length;
  u32(0x02014b50); u16(20); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(data.length); u32(data.length);
  u16(nameBytes.length); u16(0); u16(0); u16(0); u16(0); u32(0);
  u32(0); // local header offset
  bytes(nameBytes);
  const cdSize = out.length - cdOffset;

  // End of central directory
  u32(0x06054b50); u16(0); u16(0); u16(1); u16(1);
  u32(cdSize); u32(cdOffset); u16(0);

  return new Uint8Array(out);
}
