import { useCallback, useEffect, useRef, useState } from "react";
import type { Geometry, Position } from "geojson";
import type { LngLat, MapGeoJSONFeature } from "maplibre-gl";
import { MapController, type InspectHandler } from "./map";
import {
  bufferPoint,
  conflictForAoi,
  config,
  countiesLayer,
  facilitiesLayer,
  hexDensity,
  jurisdictionFor,
  parseKmz,
  recentTickets,
  stats as loadStats,
  ticketsLayer,
  type ConflictResult,
  type Stats,
  type TicketRow,
} from "./services/demo";

type Phase = "loading" | "ready" | "error";
type Mode = "idle" | "buffer" | "draw";

interface ConflictInfo {
  count: number;
  jurisdiction: string | null;
  via: string;
}

interface TicketDetail {
  ticket_id: string;
  source: string;
  status: string;
  county: string | null;
  storedCount: number;
  liveCount: number;
  radius: number;
  facilities: { owner?: string; voltage_class?: string }[];
}

// Minimal ticket shape shared by map-click (feature.properties) and the sidebar list (TicketRow).
type TicketLike = { ticket_id: string; source: string; status: string; conflict_count: number };

export default function App() {
  const mapEl = useRef<HTMLDivElement>(null);
  const ctrl = useRef<MapController | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [err, setErr] = useState<string>("");
  const [label, setLabel] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [mode, setMode] = useState<Mode>("idle");
  const [radius, setRadius] = useState(100);
  const [hexOn, setHexOn] = useState(false);
  const [hexRes] = useState(7);
  const [kmzName, setKmzName] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [ticketInfo, setTicketInfo] = useState<TicketDetail | null>(null);
  const radiusRef = useRef(radius);
  radiusRef.current = radius;
  // Stable indirection so enableInspect (wired once on mount) always calls the latest handler.
  const onInspectRef = useRef<InspectHandler>(() => {});

  // --- boot: map + data ----------------------------------------------------
  useEffect(() => {
    if (!mapEl.current || ctrl.current) return;
    const c = new MapController(mapEl.current);
    ctrl.current = c;
    c.whenReady(async () => {
      try {
        c.initLayers();
        c.enableInspect((layerId, feature, lngLat) => onInspectRef.current(layerId, feature, lngLat));
        const cfg = await config();
        setLabel(cfg.label);
        const [facilities, counties, ticketsFc] = await Promise.all([
          facilitiesLayer(),
          countiesLayer(),
          ticketsLayer(),
        ]);
        c.setData("facilities", facilities);
        c.setData("counties", counties);
        c.setData("tickets", ticketsFc);
        c.fitTo(facilities, 60);
        setStats(await loadStats());
        setTickets(await recentTickets());
        setPhase("ready");
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    });
    return () => {
      c.destroy();
      ctrl.current = null;
    };
  }, []);

  // --- conflict run --------------------------------------------------------
  const runConflict = useCallback(
    async (geom: Geometry, at: Position, via: string): Promise<ConflictResult> => {
      const c = ctrl.current;
      const empty: ConflictResult = { count: 0, facilities: { type: "FeatureCollection", features: [] } };
      if (!c) return empty;
      c.setData("aoi", { type: "FeatureCollection", features: [{ type: "Feature", geometry: geom, properties: {} }] });
      const res = await conflictForAoi(geom);
      c.setData("conflict", res.facilities);
      const jur = await jurisdictionFor(at[0], at[1]);
      setConflict({ count: res.count, jurisdiction: jur, via });
      c.fitTo({ type: "FeatureCollection", features: [{ type: "Feature", geometry: geom, properties: {} }] }, 120);
      return res;
    },
    [],
  );

  // --- feature inspection --------------------------------------------------
  // Buffer a ticket, recompute its conflicts live, and open the detail panel.
  // Shared by map ticket-clicks and the "Recent tickets" sidebar list.
  const handleTicketSelect = useCallback(
    async (t: TicketLike, lng: number, lat: number) => {
      const c = ctrl.current;
      if (!c) return;
      c.hideInspectPopup();
      const geom = bufferPoint(lng, lat, radiusRef.current);
      const res = await runConflict(geom, [lng, lat], `${radiusRef.current} m live (ticket ${t.ticket_id})`);
      const county = await jurisdictionFor(lng, lat);
      setTicketInfo({
        ticket_id: t.ticket_id,
        source: t.source,
        status: t.status,
        county,
        storedCount: Number(t.conflict_count),
        liveCount: res.count,
        radius: radiusRef.current,
        facilities: res.facilities.features.map((f) => (f.properties ?? {}) as { owner?: string; voltage_class?: string }),
      });
    },
    [runConflict],
  );

  const onInspect = useCallback<InspectHandler>(
    (layerId: string, feature: MapGeoJSONFeature, lngLat: LngLat) => {
      const c = ctrl.current;
      if (!c) return;
      const props = (feature.properties ?? {}) as Record<string, unknown>;
      if (layerId === "tickets-circle") {
        c.hideInspectPopup();
        void handleTicketSelect(
          {
            ticket_id: String(props.ticket_id ?? ""),
            source: String(props.source ?? ""),
            status: String(props.status ?? ""),
            conflict_count: Number(props.conflict_count ?? 0),
          },
          lngLat.lng,
          lngLat.lat,
        );
      } else {
        setTicketInfo(null);
        c.showInspectPopup(lngLat, buildPopupNode(layerId, props));
      }
    },
    [handleTicketSelect],
  );
  onInspectRef.current = onInspect;

  // --- modes ---------------------------------------------------------------
  const setBufferMode = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    c.stopPolygonDraw();
    c.hideInspectPopup();
    setTicketInfo(null);
    setMode("buffer");
    c.enableBufferClick((lng, lat) => {
      const geom = bufferPoint(lng, lat, radiusRef.current);
      void runConflict(geom, [lng, lat], `${radiusRef.current} m geodesic buffer (geokit)`);
    });
  }, [runConflict]);

  const setDrawMode = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    c.disableBufferClick();
    c.hideInspectPopup();
    setTicketInfo(null);
    setMode("draw");
    c.startPolygonDraw((geom) => {
      setMode("idle");
      void runConflict(geom, polygonCentroid(geom), "drawn AOI polygon");
    });
  }, [runConflict]);

  const clearAoi = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    c.disableBufferClick();
    c.stopPolygonDraw();
    c.setData("aoi", { type: "FeatureCollection", features: [] });
    c.setData("conflict", { type: "FeatureCollection", features: [] });
    c.hideInspectPopup();
    setConflict(null);
    setTicketInfo(null);
    setMode("idle");
  }, []);

  // --- hex toggle ----------------------------------------------------------
  const toggleHex = useCallback(async () => {
    const c = ctrl.current;
    if (!c) return;
    const next = !hexOn;
    setHexOn(next);
    if (next) c.setData("hex", await hexDensity(hexRes));
    c.setLayerVisible("hex-fill", next);
  }, [hexOn, hexRes]);

  // --- KMZ import ----------------------------------------------------------
  const onKmz = useCallback(async (file: File) => {
    const c = ctrl.current;
    if (!c) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fc = parseKmz(bytes);
    c.setData("kmz", fc);
    c.fitTo(fc, 80);
    setKmzName(`${file.name} — ${fc.features.length} features`);
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>GIS Conflict Dashboard</h1>
        <p className="subtitle">
          Fully client-side demo · DuckDB-WASM + a custom Rust/WASM geo engine. {label && <>Region: {label}.</>}
        </p>

        {stats && (
          <div className="stat-grid">
            <Stat n={stats.facilities} l="facilities" />
            <Stat n={stats.tickets} l="tickets" />
            <Stat n={stats.conflicts} l="with conflicts" />
            <Stat n={stats.counties.length} l="counties" />
          </div>
        )}

        <section className="card">
          <h2>Conflict analysis</h2>
          <div className="row">
            <button className={`btn ${mode === "buffer" ? "active" : ""}`} onClick={setBufferMode}>
              ◎ Buffer point
            </button>
            <button className={`btn ${mode === "draw" ? "active" : ""}`} onClick={setDrawMode}>
              ✐ Draw AOI
            </button>
          </div>
          <label className="muted" style={{ display: "block", margin: "10px 0 4px" }}>
            Buffer radius: <strong>{radius} m</strong>
          </label>
          <input
            type="range" min={25} max={500} step={25} value={radius}
            onChange={(e) => setRadius(Number(e.target.value))} style={{ width: "100%" }}
          />
          <div style={{ marginTop: 8 }}>
            <button className="btn danger" onClick={clearAoi}>Clear AOI</button>
          </div>
          {mode === "buffer" && <p className="muted">Click the map to drop a work point.</p>}
          {mode === "draw" && <p className="muted">Click to add vertices; double-click to finish.</p>}
        </section>

        <section className="card">
          <h2>Layers</h2>
          <button className={`btn ${hexOn ? "active" : ""}`} onClick={toggleHex}>
            ⬡ H3 ticket density {hexOn ? "(on)" : "(off)"}
          </button>
          <label className="btn" style={{ marginTop: 8 }}>
            ⤓ Import KMZ / KML
            <input
              type="file" accept=".kmz,.kml" style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && onKmz(e.target.files[0])}
            />
          </label>
          {kmzName && <p className="muted">{kmzName}</p>}
        </section>

        <section className="card">
          <h2>Legend</h2>
          <div className="legend">
            <LegendItem c="#5b9dff" t="Our transmission (eligible)" />
            <LegendItem c="#54607d" t="Other-owner transmission" />
            <LegendItem c="#3ecf8e" t="Ticket — no conflict" />
            <LegendItem c="#ff6b6b" t="Ticket — potential conflict" />
            <LegendItem c="#ffd166" t="Active AOI" />
            <LegendItem c="#ff3b3b" t="Conflicting facility" />
          </div>
        </section>

        {tickets.length > 0 && (
          <section className="card">
            <h2>Recent tickets</h2>
            <div className="ticket-list">
              {tickets.map((t) => (
                <div
                  key={t.ticket_id}
                  className="ticket"
                  onClick={() => {
                    ctrl.current?.map.flyTo({ center: [t.lon, t.lat], zoom: 14 });
                    void handleTicketSelect(t, t.lon, t.lat);
                  }}
                >
                  <span>{t.ticket_id}<br /><span className="meta">{t.source}</span></span>
                  <span className={`pill ${t.conflict_count > 0 ? "conflict" : "clear"}`}>
                    {t.conflict_count > 0 ? `${t.conflict_count} conflict` : "clear"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="foot">
          Personal project. Public-domain basemap data (EIA transmission, Census counties); sample
          tickets are synthetic.
        </div>
      </aside>

      <div className="map-wrap">
        <div id="map" ref={mapEl} />
        <div className="banner">browser-only · no backend · DuckDB-WASM + Rust/WASM</div>
        {conflict && (
          <div className="result">
            {conflict.count > 0 ? (
              <span>⚠ <strong>{conflict.count}</strong> facility conflict{conflict.count > 1 ? "s" : ""}</span>
            ) : (
              <span>✓ <strong>no</strong> conflicts</span>
            )}
            <span className="muted">· {conflict.jurisdiction ?? "outside tracked counties"} · {conflict.via}</span>
          </div>
        )}
        {ticketInfo && (
          <div className="ticket-panel card">
            <div className="tp-head">
              <h2>Ticket detail</h2>
              <button className="tp-close" onClick={clearAoi} aria-label="Close ticket detail">✕</button>
            </div>
            <div className="tp-id">{ticketInfo.ticket_id}</div>
            <div className="tp-row"><span className="muted">Source</span><span>{ticketInfo.source}</span></div>
            <div className="tp-row"><span className="muted">Status</span><span>{ticketInfo.status}</span></div>
            <div className="tp-row"><span className="muted">County</span><span>{ticketInfo.county ?? "—"}</span></div>
            <div className="tp-row">
              <span className="muted">Recorded (intake)</span>
              <span className={`pill ${ticketInfo.storedCount > 0 ? "conflict" : "clear"}`}>
                {ticketInfo.storedCount > 0 ? `${ticketInfo.storedCount} conflict` : "clear"}
              </span>
            </div>
            <div className="tp-row">
              <span className="muted">Live · {ticketInfo.radius} m</span>
              <span className={`pill ${ticketInfo.liveCount > 0 ? "conflict" : "clear"}`}>
                {ticketInfo.liveCount > 0 ? `${ticketInfo.liveCount} conflict` : "clear"}
              </span>
            </div>
            {ticketInfo.facilities.length > 0 && (
              <div className="tp-facs">
                <h3>Conflicting facilities</h3>
                {ticketInfo.facilities.map((f, i) => (
                  <div key={i} className="tp-fac">
                    <span>{f.owner ?? "—"}</span>
                    <span className="meta">{f.voltage_class ?? ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {phase !== "ready" && (
          <div className="loading">
            <div className="box">
              <div className="spinner" />
              {phase === "loading" ? "Booting DuckDB-WASM + loading GeoParquet…" : `Error: ${err}`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ n, l }: { n: number; l: string }) {
  return (
    <div className="stat">
      <div className="num">{n.toLocaleString()}</div>
      <div className="lbl">{l}</div>
    </div>
  );
}

function LegendItem({ c, t }: { c: string; t: string }) {
  return (
    <div className="item">
      <span className="swatch" style={{ background: c }} />
      {t}
    </div>
  );
}

// Field schema per clickable layer -> ordered [label, value] rows for the popup.
function rowsForLayer(layerId: string, props: Record<string, unknown>): { title: string; rows: [string, string][] } {
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const keep = (rows: [string, string][]) => rows.filter(([, v]) => v !== "");
  switch (layerId) {
    case "facilities-line":
    case "conflict-line":
      return {
        title: "Transmission line",
        rows: keep([
          ["Owner", s(props.owner)],
          ["Voltage", s(props.voltage_class)],
          ["Status", s(props.status)],
          ["ID", s(props.id)],
        ]),
      };
    case "counties-fill":
      return {
        title: "County",
        rows: keep([
          ["County", s(props.name)],
          ["State", s(props.state)],
          ["GEOID", s(props.geoid)],
        ]),
      };
    case "hex-fill":
      return { title: "Ticket density", rows: [["Tickets", s(props.count)]] };
    default: // kmz-line / kmz-fill / kmz-point — arbitrary user-supplied properties
      return {
        title: "Imported feature",
        rows: keep(Object.entries(props).map(([k, v]) => [k, s(v)] as [string, string])).slice(0, 12),
      };
  }
}

// Build a popup body as a DOM node. Values are set via textContent (never innerHTML), so
// arbitrary KMZ property values cannot inject markup/script.
function buildPopupNode(layerId: string, props: Record<string, unknown>): HTMLElement {
  const { title, rows } = rowsForLayer(layerId, props);
  const root = document.createElement("div");
  root.className = "ip";
  const head = document.createElement("div");
  head.className = "ip-title";
  head.textContent = title;
  root.appendChild(head);
  for (const [k, v] of rows) {
    const row = document.createElement("div");
    row.className = "ip-row";
    const key = document.createElement("span");
    key.className = "ip-k";
    key.textContent = k;
    const val = document.createElement("span");
    val.className = "ip-v";
    val.textContent = v;
    row.append(key, val);
    root.appendChild(row);
  }
  return root;
}

// Average of a polygon's exterior ring — good enough to pick a jurisdiction.
function polygonCentroid(geom: Geometry): Position {
  let ring: Position[] = [];
  if (geom.type === "Polygon") ring = geom.coordinates[0];
  else if (geom.type === "MultiPolygon") ring = geom.coordinates[0][0];
  if (ring.length === 0) return [0, 0];
  const sum = ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
  return [sum[0] / ring.length, sum[1] / ring.length];
}
