// Client-side export helpers: turn in-browser conflict/ticket data into downloadable
// GeoJSON or KMZ files. No backend, no dependencies — Blobs + a hand-built store ZIP.
//
// Exports are self-documenting: the filename is dated, and every conflict file carries
// the exact rule assumptions it was made under plus a disclaimer, so an exported file is
// never divorced from how it was produced (data honesty — synthetic tickets, modeled rule).
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

// The tunable assumptions baked into a conflict export (mirrors the live rule + AOI).
export interface ExportAssumptions {
  selfOwners: string[];
  excludedStatuses: string[];
  via: string; // how the AOI was made, e.g. "100 m buffer" or "drawn area"
  label: string; // region label, e.g. "Austin, TX"
}

export const DISCLAIMER =
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

// --- KMZ (KML wrapped in a store-only ZIP) ----------------------------------
export function conflictsToKmz(
  aoi: Geometry,
  facilities: FeatureCollection,
  assumptions?: ExportAssumptions,
): Uint8Array {
  const description = assumptions ? `${assumptionLine(assumptions)}\n\n${DISCLAIMER}` : DISCLAIMER;
  const legend = legendPngBytes();
  // Pass assumptions through so the AOI placemark also carries them (parity with GeoJSON).
  return kmlToKmz(
    styledConflictKml(conflictsToGeoJson(aoi, facilities, assumptions), "Conflict analysis", description, !!legend),
    legend ? [{ name: LEGEND_FILE, data: legend }] : [],
  );
}

export interface TicketKmzInput {
  ticket_id: string;
  source: string;
  work_type: string;
  priority: string;
  workflow_status: string;
  conflict_count: number;
  lon: number;
  lat: number;
}

/** A self-contained, styled analyst handoff for one ticket and its live conflict evidence. */
export function ticketConflictToKmz(
  ticket: TicketKmzInput,
  aoi: Geometry,
  facilities: FeatureCollection,
  assumptions?: ExportAssumptions,
): Uint8Array {
  const base = conflictsToGeoJson(aoi, facilities, assumptions);
  base.features[0].properties = { ...(base.features[0].properties ?? {}), role: "aoi_buffer" };
  base.features.unshift({
    type: "Feature",
    geometry: { type: "Point", coordinates: [ticket.lon, ticket.lat] },
    properties: { role: "ticket", ...ticket },
  });
  const description = `${assumptions ? `${assumptionLine(assumptions)}\n\n` : ""}` +
    "Legend: Ticket = cyan marker; AOI = orange outline/fill; conflicting facilities = red lines.\n\n" + DISCLAIMER;
  const legend = legendPngBytes();
  return kmlToKmz(
    styledConflictKml(base, `Ticket ${ticket.ticket_id} conflict analysis`, description, !!legend),
    legend ? [{ name: LEGEND_FILE, data: legend }] : [],
  );
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

// Friendly placemark names by role (raw role slugs like "aoi_buffer" read poorly in a viewer).
const ROLE_NAMES: Record<string, string> = {
  ticket: "Work ticket",
  aoi_buffer: "Area of interest",
  conflict_facility: "Conflicting facility",
};

// Placemark name/description derived from common properties (synthetic data only).
function placemark(f: Feature, styleUrl?: string): string {
  if (!f.geometry) return "";
  const p = (f.properties ?? {}) as Record<string, unknown>;
  const role = String(p.role ?? "");
  const name = p.ticket_id ?? p.owner ?? ROLE_NAMES[role] ?? p.role ?? "Feature";
  const desc = Object.entries(p)
    .filter(([k]) => k !== "role")
    .map(([k, v]) => `${k}: ${v ?? ""}`)
    .join("\n");
  return `<Placemark><name>${xml(name)}</name>${styleUrl ? `<styleUrl>${styleUrl}</styleUrl>` : ""}${
    desc ? `<description>${xml(desc)}</description>` : ""
  }${geomToKml(f.geometry)}</Placemark>`;
}

// On-screen legend — swatches mirror the KML styles. Rendered to a PNG embedded in the KMZ and
// pinned to a screen corner via <ScreenOverlay>, so the key is always visible in Google Earth.
const LEGEND_ITEMS: { color: string; label: string; kind: "box" | "line" | "dot" }[] = [
  { color: "#ffa500", label: "Area of interest", kind: "box" },
  { color: "#ec2b2b", label: "Conflicting facility", kind: "line" },
  { color: "#31d3c5", label: "Work ticket", kind: "dot" },
];
const LEGEND_W = 220;
const LEGEND_H = 24 + LEGEND_ITEMS.length * 26 + 12; // header + rows + pad
const LEGEND_FILE = "legend.png";

/** Draw the legend to a PNG (browser canvas). Returns null outside a DOM (e.g. Node tests). */
function legendPngBytes(): Uint8Array | null {
  if (typeof document === "undefined") return null;
  const scale = 2; // render at 2× and downscale via ScreenOverlay <size> for crisp text
  const canvas = document.createElement("canvas");
  canvas.width = LEGEND_W * scale;
  canvas.height = LEGEND_H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  const padX = 14;

  ctx.fillStyle = "rgba(16,18,26,0.86)";
  if (typeof ctx.roundRect === "function") { ctx.beginPath(); ctx.roundRect(0.5, 0.5, LEGEND_W - 1, LEGEND_H - 1, 8); ctx.fill(); }
  else ctx.fillRect(0, 0, LEGEND_W, LEGEND_H);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  if (typeof ctx.roundRect === "function") ctx.stroke();

  ctx.fillStyle = "#e8ecf4";
  ctx.font = `600 13px ${font}`;
  ctx.fillText("Legend", padX, 18);
  ctx.font = `12px ${font}`;
  const sw = 22;
  LEGEND_ITEMS.forEach((it, i) => {
    const y = 24 + i * 26 + 13;
    ctx.strokeStyle = it.color;
    ctx.fillStyle = it.color;
    ctx.lineWidth = 3;
    if (it.kind === "line") { ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(padX + sw, y); ctx.stroke(); }
    else if (it.kind === "box") { ctx.globalAlpha = 0.35; ctx.fillRect(padX, y - 7, sw, 14); ctx.globalAlpha = 1; ctx.strokeRect(padX + 0.5, y - 6.5, sw - 1, 13); }
    else { ctx.beginPath(); ctx.arc(padX + sw / 2, y, 6, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "#e8ecf4";
    ctx.fillText(it.label, padX + sw + 10, y + 4);
  });

  const b64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/** A KML <ScreenOverlay> pinning the legend PNG to the lower-left of the view. */
function legendOverlayKml(): string {
  return `<ScreenOverlay><name>Legend</name><Icon><href>${LEGEND_FILE}</href></Icon>` +
    `<overlayXY x="0" y="0" xunits="fraction" yunits="fraction"/>` +
    `<screenXY x="16" y="16" xunits="pixels" yunits="pixels"/>` +
    `<size x="${LEGEND_W}" y="${LEGEND_H}" xunits="pixels" yunits="pixels"/></ScreenOverlay>`;
}

function styledConflictKml(fc: FeatureCollection, docName: string, description?: string, legendOverlay = false): string {
  const groups: Record<string, Feature[]> = { Ticket: [], AOI: [], "Conflicting facilities": [] };
  for (const f of fc.features) {
    const role = String((f.properties ?? {}).role ?? "");
    groups[role === "ticket" ? "Ticket" : role === "aoi_buffer" ? "AOI" : "Conflicting facilities"].push(f);
  }
  // KML colors are aabbggrr (alpha, blue, green, red) — NOT rgba. Bold, opaque, high-contrast
  // fills/outlines so the export reads clearly over satellite imagery in Google Earth and other
  // viewers (KML's default is thin white lines + a white 50% fill, which is nearly invisible).
  // Self-contained: no external <Icon href> — points use a tinted default marker + a text label.
  const styles =
    `<Style id="ticket">` +
      `<IconStyle><color>ffc5d331</color><scale>1.3</scale></IconStyle>` +      // cyan marker
      `<LabelStyle><scale>0.9</scale></LabelStyle>` +
    `</Style>` +
    `<Style id="aoi">` +
      `<LineStyle><color>ff00a5ff</color><width>3</width></LineStyle>` +        // opaque orange outline
      `<PolyStyle><color>5a00a5ff</color><fill>1</fill><outline>1</outline></PolyStyle>` + // ~35% orange fill
    `</Style>` +
    `<Style id="conflict">` +
      `<LineStyle><color>ff2b2bec</color><width>4</width></LineStyle>` +        // vivid red line
      `<IconStyle><color>ff2b2bec</color><scale>1.1</scale></IconStyle>` +      // red marker (point facilities)
    `</Style>`;
  const styleFor = (name: string) => name === "Ticket" ? "#ticket" : name === "AOI" ? "#aoi" : "#conflict";
  const body = Object.entries(groups).map(([name, features]) =>
    `<Folder><name>${name}</name>${features.map((f) => placemark(f, styleFor(name))).join("")}</Folder>`,
  ).join("");
  const legend = `<Folder><name>Legend</name><description>${xml("Ticket: cyan marker; AOI: orange outline + translucent fill; Conflicting facilities: red line.")}</description></Folder>`;
  const desc = description ? `<description>${xml(description)}</description>` : "";
  const overlay = legendOverlay ? legendOverlayKml() : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(docName)}</name>${desc}${styles}${overlay}${legend}${body}</Document></kml>`
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

interface ZipEntry { name: string; data: Uint8Array; }

/** Wrap KML text (+ optional sibling assets like `legend.png`) in a store-only ZIP → a valid KMZ.
 *  `doc.kml` is written first so it is the archive's root document. */
function kmlToKmz(kml: string, assets: ZipEntry[] = []): Uint8Array {
  return zipStore([{ name: "doc.kml", data: new TextEncoder().encode(kml) }, ...assets]);
}

/** Minimal multi-entry store-only (uncompressed) ZIP — no dependency. */
function zipStore(files: ZipEntry[]): Uint8Array {
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (v: number) => out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  const bytes = (b: Uint8Array) => b.forEach((x) => out.push(x));

  const central: { nameBytes: Uint8Array; crc: number; len: number; offset: number }[] = [];
  for (const f of files) {
    const nameBytes = new TextEncoder().encode(f.name);
    const crc = crc32(f.data);
    const offset = out.length;
    // Local file header
    u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
    u32(crc); u32(f.data.length); u32(f.data.length);
    u16(nameBytes.length); u16(0);
    bytes(nameBytes);
    bytes(f.data);
    central.push({ nameBytes, crc, len: f.data.length, offset });
  }

  // Central directory
  const cdOffset = out.length;
  for (const c of central) {
    u32(0x02014b50); u16(20); u16(20); u16(0); u16(0); u16(0); u16(0);
    u32(c.crc); u32(c.len); u32(c.len);
    u16(c.nameBytes.length); u16(0); u16(0); u16(0); u16(0); u32(0);
    u32(c.offset);
    bytes(c.nameBytes);
  }
  const cdSize = out.length - cdOffset;

  // End of central directory
  u32(0x06054b50); u16(0); u16(0); u16(central.length); u16(central.length);
  u32(cdSize); u32(cdOffset); u16(0);

  return new Uint8Array(out);
}
