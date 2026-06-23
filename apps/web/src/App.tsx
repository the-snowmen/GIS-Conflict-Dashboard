import { useCallback, useEffect, useRef, useState } from "react";
import type { Geometry, Position } from "geojson";
import { MapController } from "./map";
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
  const radiusRef = useRef(radius);
  radiusRef.current = radius;

  // --- boot: map + data ----------------------------------------------------
  useEffect(() => {
    if (!mapEl.current || ctrl.current) return;
    const c = new MapController(mapEl.current);
    ctrl.current = c;
    c.whenReady(async () => {
      try {
        c.initLayers();
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
  const runConflict = useCallback(async (geom: Geometry, at: Position, via: string) => {
    const c = ctrl.current;
    if (!c) return;
    c.setData("aoi", { type: "FeatureCollection", features: [{ type: "Feature", geometry: geom, properties: {} }] });
    const res = await conflictForAoi(geom);
    c.setData("conflict", res.facilities);
    const jur = await jurisdictionFor(at[0], at[1]);
    setConflict({ count: res.count, jurisdiction: jur, via });
    c.fitTo({ type: "FeatureCollection", features: [{ type: "Feature", geometry: geom, properties: {} }] }, 120);
  }, []);

  // --- modes ---------------------------------------------------------------
  const setBufferMode = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    c.stopPolygonDraw();
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
    setConflict(null);
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
                  onClick={() => ctrl.current?.map.flyTo({ center: [t.lon, t.lat], zoom: 14 })}
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

// Average of a polygon's exterior ring — good enough to pick a jurisdiction.
function polygonCentroid(geom: Geometry): Position {
  let ring: Position[] = [];
  if (geom.type === "Polygon") ring = geom.coordinates[0];
  else if (geom.type === "MultiPolygon") ring = geom.coordinates[0][0];
  if (ring.length === 0) return [0, 0];
  const sum = ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
  return [sum[0] / ring.length, sum[1] / ring.length];
}
