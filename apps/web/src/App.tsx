import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { FeatureCollection, Geometry, Position } from "geojson";
import type { LngLat, MapGeoJSONFeature } from "maplibre-gl";
import { MapController, type InspectHandler } from "./map";
import { conflictsToGeoJson, conflictsToKmz, downloadBytes, downloadText, ticketsToKmz, KMZ_MIME } from "./services/export";
import {
  allTicketsMerged,
  bufferPoint,
  conflictForAoi,
  config,
  countiesLayer,
  createTicket,
  facilitiesLayer,
  hexDensity,
  jurisdictionFor,
  parseKmz,
  removeTicket,
  stats as loadStats,
  ticketsLayer,
  updateTicket,
  type ConflictResult,
  type MergedTicket,
  type Stats,
} from "./services/demo";

type Phase = "loading" | "ready" | "error";
type Mode = "idle" | "buffer" | "draw" | "addTicket";

interface EditingState {
  mode: "create" | "edit";
  ticket_id?: string;
  source: string;
  lon: number;
  lat: number;
  lon0: number; // original position, to detect a move
  lat0: number;
}

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
  lon: number;
  lat: number;
  facilities: ConflictFacility[];
}

// One conflicting facility row in the detail panel. id + geometry power the
// hover-flash and click-to-inspect on the map; status feeds the popup.
interface ConflictFacility {
  id?: number;
  owner?: string;
  voltage_class?: string;
  status?: string;
  geometry?: Geometry;
}

// Minimal ticket shape shared by map-click (feature.properties) and the sidebar list.
type TicketLike = { ticket_id: string; source: string; status: string; conflict_count: number };
// Just what startEdit needs (satisfied by MergedTicket and by the detail panel).
type EditableTicket = { ticket_id: string; source: string; status: string; lon: number; lat: number };

export default function App() {
  const mapEl = useRef<HTMLDivElement>(null);
  const ctrl = useRef<MapController | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [err, setErr] = useState<string>("");
  const [label, setLabel] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [tickets, setTickets] = useState<MergedTicket[]>([]);
  const [mode, setMode] = useState<Mode>("idle");
  const [radius, setRadius] = useState(100);
  const [hexOn, setHexOn] = useState(false);
  const [hexRes] = useState(7);
  const [kmzName, setKmzName] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [ticketInfo, setTicketInfo] = useState<TicketDetail | null>(null);
  // Tickets panel: collapse + search/filter + create/edit form.
  const [ticketsOpen, setTicketsOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 900);
  const [tq, setTq] = useState("");
  const [fSource, setFSource] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [editing, setEditing] = useState<EditingState | null>(null);
  const radiusRef = useRef(radius);
  radiusRef.current = radius;
  // Last analyzed point, so moving the radius slider re-runs the conflict live.
  const lastPointRef = useRef<{ lng: number; lat: number; ticket: TicketLike | null } | null>(null);
  // Stable indirection so enableInspect (wired once on mount) always calls the latest handler.
  const onInspectRef = useRef<InspectHandler>(() => {});
  // The facility "clicked" in the detail panel; its highlight stays lit (sticky)
  // after the cursor leaves the row, until another is picked or the panel closes.
  const selectedFacRef = useRef<ConflictFacility | null>(null);
  // Collapsible side rail (open on desktop, closed on narrow viewports by default).
  const [railOpen, setRailOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 900);
  const [legendOpen, setLegendOpen] = useState(true);
  // Screen-reader announcement of the latest conflict result (aria-live region).
  const [liveMsg, setLiveMsg] = useState("");
  // First-run welcome callout (dismissed flag persisted in localStorage).
  const [welcomeDismissed, setWelcomeDismissed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem("gcd.welcome.dismissed") === "1",
  );
  // Last analyzed AOI geom + intersected facilities, so the export buttons can serialize them.
  const lastResultRef = useRef<{ geom: Geometry; facilities: FeatureCollection } | null>(null);
  const kmzInputRef = useRef<HTMLInputElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  // The control that opened the ticket detail (a ticket card), so closing the
  // panel can return focus there instead of dropping it to <body>.
  const lastTriggerRef = useRef<HTMLElement | null>(null);

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
        c.rememberHome(facilities);
        c.fitTo(facilities, 60);
        setStats(await loadStats());
        setTickets(await allTicketsMerged());
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
    async (geom: Geometry, at: Position, via: string, fit = true): Promise<ConflictResult> => {
      const c = ctrl.current;
      const empty: ConflictResult = { count: 0, facilities: { type: "FeatureCollection", features: [] } };
      if (!c) return empty;
      c.setData("aoi", { type: "FeatureCollection", features: [{ type: "Feature", geometry: geom, properties: {} }] });
      const res = await conflictForAoi(geom);
      c.setData("conflict", res.facilities);
      const jur = await jurisdictionFor(at[0], at[1]);
      setConflict({ count: res.count, jurisdiction: jur, via });
      lastResultRef.current = { geom, facilities: res.facilities };
      const where = jur ? `in ${jur}` : "outside the coverage area";
      setLiveMsg(
        res.count > 0
          ? `${res.count} facility conflict${res.count === 1 ? "" : "s"} ${where}.`
          : `No conflicts ${where}.`,
      );
      // maxZoom keeps a small buffer from slamming the view to a deep-zoom empty void.
      if (fit) c.fitTo({ type: "FeatureCollection", features: [{ type: "Feature", geometry: geom, properties: {} }] }, 120, 15);
      return res;
    },
    [],
  );

  // --- feature inspection --------------------------------------------------
  // Buffer a ticket, recompute its conflicts live, and open the detail panel.
  // Shared by map ticket-clicks and the "Recent tickets" sidebar list.
  const handleTicketSelect = useCallback(
    async (t: TicketLike, lng: number, lat: number, fit = true) => {
      const c = ctrl.current;
      if (!c) return;
      c.hideInspectPopup();
      c.highlightConflictFacility(null);
      selectedFacRef.current = null;
      lastPointRef.current = { lng, lat, ticket: t };
      const geom = bufferPoint(lng, lat, radiusRef.current);
      const res = await runConflict(geom, [lng, lat], `${radiusRef.current} m live (ticket ${t.ticket_id})`, fit);
      const county = await jurisdictionFor(lng, lat);
      setTicketInfo({
        ticket_id: t.ticket_id,
        source: t.source,
        status: t.status,
        county,
        storedCount: Number(t.conflict_count),
        liveCount: res.count,
        radius: radiusRef.current,
        lon: lng,
        lat,
        facilities: res.facilities.features.map((f) => {
          const p = (f.properties ?? {}) as Record<string, unknown>;
          return {
            id: p.id as number | undefined,
            owner: p.owner as string | undefined,
            voltage_class: p.voltage_class as string | undefined,
            status: p.status as string | undefined,
            geometry: f.geometry,
          };
        }),
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
        lastTriggerRef.current = null; // opened from the map, not a ticket card — no focus to return
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

  // Tear down ticket add/edit (drag marker + form) when switching to another mode.
  const endTicketEdit = useCallback(() => {
    const c = ctrl.current;
    c?.disableAddPoint();
    c?.removeDragMarker();
    setEditing(null);
  }, []);

  // --- modes ---------------------------------------------------------------
  const setBufferMode = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    c.stopPolygonDraw();
    c.hideInspectPopup();
    endTicketEdit();
    setTicketInfo(null);
    setMode("buffer");
    if (window.innerWidth <= 900) setRailOpen(false); // free the map to receive the click on mobile
    c.enableBufferClick((lng, lat) => {
      lastPointRef.current = { lng, lat, ticket: null };
      const geom = bufferPoint(lng, lat, radiusRef.current);
      void runConflict(geom, [lng, lat], `${radiusRef.current} m buffer`);
    });
  }, [runConflict, endTicketEdit]);

  const setDrawMode = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    c.disableBufferClick();
    c.hideInspectPopup();
    endTicketEdit();
    setTicketInfo(null);
    setMode("draw");
    if (window.innerWidth <= 900) setRailOpen(false);
    c.startPolygonDraw((geom) => {
      lastPointRef.current = null;
      setMode("idle");
      void runConflict(geom, polygonCentroid(geom), "drawn area");
    });
  }, [runConflict, endTicketEdit]);

  const clearAoi = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    c.disableBufferClick();
    c.stopPolygonDraw();
    endTicketEdit();
    c.setData("aoi", { type: "FeatureCollection", features: [] });
    c.setData("conflict", { type: "FeatureCollection", features: [] });
    c.hideInspectPopup();
    c.highlightConflictFacility(null);
    selectedFacRef.current = null;
    lastPointRef.current = null;
    setConflict(null);
    setTicketInfo(null);
    setMode("idle");
    // Return focus to the ticket card that opened the panel (keyboard/SR users).
    const trigger = lastTriggerRef.current;
    lastTriggerRef.current = null;
    if (trigger) requestAnimationFrame(() => trigger.focus());
  }, [endTicketEdit]);

  // Live buffer: moving the radius slider re-runs the conflict for the last point.
  useEffect(() => {
    const lp = lastPointRef.current;
    if (!lp) return;
    const id = setTimeout(() => {
      if (lp.ticket) {
        void handleTicketSelect(lp.ticket, lp.lng, lp.lat, false);
      } else {
        const geom = bufferPoint(lp.lng, lp.lat, radiusRef.current);
        void runConflict(geom, [lp.lng, lp.lat], `${radiusRef.current} m buffer`, false);
      }
    }, 120);
    return () => clearTimeout(id);
  }, [radius, handleTicketSelect, runConflict]);

  // --- ticket CRUD ---------------------------------------------------------
  const refreshTickets = useCallback(async () => {
    const c = ctrl.current;
    if (!c) return;
    c.setData("tickets", await ticketsLayer());
    setTickets(await allTicketsMerged());
    setStats(await loadStats());
    if (hexOn) c.setData("hex", await hexDensity(hexRes));
  }, [hexOn, hexRes]);

  // Open the create form at a point: run the conflict analysis (so the AOI/conflicts
  // show and status can be derived), drop a draggable marker that re-analyzes on move,
  // and seed the source-only form. Shared by "New ticket" and "Save as ticket".
  const beginCreateAt = useCallback(
    (lng: number, lat: number) => {
      const c = ctrl.current;
      if (!c) return;
      setRailOpen(true); // the create form lives in the rail — make sure it's visible
      lastPointRef.current = { lng, lat, ticket: null };
      void runConflict(bufferPoint(lng, lat, radiusRef.current), [lng, lat], `new ticket @ ${radiusRef.current} m`);
      c.spawnDragMarker(lng, lat, (nlng, nlat) => {
        setEditing((ed) => (ed ? { ...ed, lon: nlng, lat: nlat } : ed));
        lastPointRef.current = { lng: nlng, lat: nlat, ticket: null };
        void runConflict(bufferPoint(nlng, nlat, radiusRef.current), [nlng, nlat], `new ticket @ ${radiusRef.current} m`, false);
      });
      setEditing({ mode: "create", source: "", lon: lng, lat, lon0: lng, lat0: lat });
    },
    [runConflict],
  );

  const startAddTicket = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    c.disableBufferClick();
    c.stopPolygonDraw();
    c.hideInspectPopup();
    c.removeDragMarker();
    setTicketInfo(null);
    setRailOpen(window.innerWidth > 900); // on mobile, free the map so the placement tap lands
    setMode("addTicket");
    c.enableAddPoint((lng, lat) => {
      c.disableAddPoint();
      setMode("idle");
      beginCreateAt(lng, lat);
    });
  }, [beginCreateAt]);

  // Turn the current Buffer-point analysis into a ticket (same point, already scored).
  const saveBufferAsTicket = useCallback(() => {
    const lp = lastPointRef.current;
    if (!lp || lp.ticket) return;
    beginCreateAt(lp.lng, lp.lat);
  }, [beginCreateAt]);

  const startEdit = useCallback(
    (t: EditableTicket) => {
      const c = ctrl.current;
      if (!c) return;
      c.disableBufferClick();
      c.stopPolygonDraw();
      c.hideInspectPopup();
      setRailOpen(true);
      setMode("idle");
      lastPointRef.current = { lng: t.lon, lat: t.lat, ticket: null };
      void runConflict(bufferPoint(t.lon, t.lat, radiusRef.current), [t.lon, t.lat], `editing ${t.ticket_id} @ ${radiusRef.current} m`);
      c.spawnDragMarker(t.lon, t.lat, (nlng, nlat) => {
        setEditing((ed) => (ed ? { ...ed, lon: nlng, lat: nlat } : ed));
        lastPointRef.current = { lng: nlng, lat: nlat, ticket: null };
        void runConflict(bufferPoint(nlng, nlat, radiusRef.current), [nlng, nlat], `editing ${t.ticket_id} @ ${radiusRef.current} m`, false);
      });
      setEditing({ mode: "edit", ticket_id: t.ticket_id, source: t.source, lon: t.lon, lat: t.lat, lon0: t.lon, lat0: t.lat });
    },
    [runConflict],
  );

  // Drop the transient analysis (AOI/conflict/marker) drawn during create/edit.
  const clearTransient = useCallback(() => {
    const c = ctrl.current;
    c?.setData("aoi", { type: "FeatureCollection", features: [] });
    c?.setData("conflict", { type: "FeatureCollection", features: [] });
    c?.highlightConflictFacility(null);
    lastPointRef.current = null;
    setConflict(null);
  }, []);

  const saveEditing = useCallback(async () => {
    const ed = editing;
    const c = ctrl.current;
    if (!ed || !c) return;
    if (ed.mode === "create") {
      await createTicket({ source: ed.source, lon: ed.lon, lat: ed.lat, radiusM: radiusRef.current });
    } else if (ed.ticket_id) {
      const moved = ed.lon !== ed.lon0 || ed.lat !== ed.lat0;
      const patch: { source?: string; lon?: number; lat?: number } = { source: ed.source };
      if (moved) {
        patch.lon = ed.lon;
        patch.lat = ed.lat;
      }
      await updateTicket(ed.ticket_id, patch, radiusRef.current);
    }
    c.removeDragMarker();
    setEditing(null);
    clearTransient();
    await refreshTickets();
  }, [editing, refreshTickets, clearTransient]);

  const cancelEditing = useCallback(() => {
    endTicketEdit();
    if (mode === "addTicket") setMode("idle");
    clearTransient();
  }, [endTicketEdit, mode, clearTransient]);

  const deleteEditing = useCallback(async () => {
    const ed = editing;
    const c = ctrl.current;
    if (!ed?.ticket_id || !c) return;
    await removeTicket(ed.ticket_id);
    c.removeDragMarker();
    setEditing(null);
    setTicketInfo(null);
    await refreshTickets();
  }, [editing, refreshTickets]);

  // Filter options + filtered list derive from the merged set, so user-created
  // tickets (and any new source values) show up consistently.
  const sourceOptions = useMemo(
    () => [...new Set(tickets.map((t) => t.source).filter(Boolean))].sort(),
    [tickets],
  );
  const statusFilterOptions = useMemo(
    () => [...new Set(tickets.map((t) => t.status).filter(Boolean))].sort(),
    [tickets],
  );
  const filteredTickets = useMemo(() => {
    const query = tq.trim().toLowerCase();
    return tickets
      .filter((t) => {
        if (query && !`${t.ticket_id} ${t.source}`.toLowerCase().includes(query)) return false;
        if (fSource && t.source !== fSource) return false;
        if (fStatus && t.status !== fStatus) return false;
        return true;
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  }, [tickets, tq, fSource, fStatus]);

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

  // --- conflicting-facility interactions (detail panel) --------------------
  // Hover a facility row -> pulse its line on the map.
  const hoverFacility = useCallback((geom: Geometry | null) => {
    ctrl.current?.highlightConflictFacility(geom);
  }, []);

  // Leave a row -> drop the pulse, but re-assert the clicked facility's steady
  // highlight if one is selected (so a click stays lit after the cursor moves off).
  const leaveFacility = useCallback(() => {
    ctrl.current?.highlightConflictFacility(selectedFacRef.current?.geometry ?? null, false);
  }, []);

  // Click a facility row -> fly to it, keep it lit, and open its detail popup
  // (the same popup the map uses for a direct conflict-line click).
  const inspectFacility = useCallback((f: ConflictFacility) => {
    const c = ctrl.current;
    if (!c || !f.geometry) return;
    selectedFacRef.current = f;
    const center = lineCentroid(f.geometry) as [number, number];
    c.map.flyTo({ center, zoom: Math.max(c.map.getZoom(), 13), duration: 600 });
    c.highlightConflictFacility(f.geometry, false); // sticky (no pulse)
    c.showInspectPopup(
      center,
      buildPopupNode("conflict-line", {
        owner: f.owner,
        voltage_class: f.voltage_class,
        status: f.status,
        id: f.id,
      }),
    );
  }, []);

  // --- non-mouse buffer placement ------------------------------------------
  // Drop a geodesic buffer at an explicit coordinate (keyboard / coord-field path).
  const dropBufferAt = useCallback(
    (lng: number, lat: number) => {
      const c = ctrl.current;
      if (!c) return;
      c.hideInspectPopup();
      setTicketInfo(null);
      lastPointRef.current = { lng, lat, ticket: null };
      c.map.flyTo({ center: [lng, lat], zoom: Math.max(c.map.getZoom(), 13), duration: 600 });
      const geom = bufferPoint(lng, lat, radiusRef.current);
      void runConflict(geom, [lng, lat], `${radiusRef.current} m buffer`);
    },
    [runConflict],
  );

  // While in buffer mode, Enter (outside a form field) drops a buffer at the map center.
  useEffect(() => {
    if (mode !== "buffer") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      const c = ctrl.current;
      if (!c) return;
      const ctr = c.map.getCenter();
      dropBufferAt(ctr.lng, ctr.lat);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, dropBufferAt]);

  // Escape closes the topmost transient surface (edit form > detail panel > mobile rail).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editing) cancelEditing();
      else if (ticketInfo) clearAoi();
      else if (railOpen && window.innerWidth <= 900) setRailOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, ticketInfo, railOpen, cancelEditing, clearAoi]);

  // Move focus into the ticket detail panel when it opens (screen-reader + keyboard).
  useEffect(() => {
    if (ticketInfo) inspectorRef.current?.focus();
  }, [ticketInfo?.ticket_id]);

  // --- exports -------------------------------------------------------------
  const exportConflictGeoJson = useCallback(() => {
    const r = lastResultRef.current;
    if (!r) return;
    downloadText("conflicts.geojson", "application/geo+json", JSON.stringify(conflictsToGeoJson(r.geom, r.facilities), null, 2));
  }, []);
  const exportConflictKmz = useCallback(() => {
    const r = lastResultRef.current;
    if (!r) return;
    downloadBytes("conflicts.kmz", KMZ_MIME, conflictsToKmz(r.geom, r.facilities));
  }, []);
  const exportTicketsKmz = useCallback(() => {
    downloadBytes("tickets.kmz", KMZ_MIME, ticketsToKmz(filteredTickets));
  }, [filteredTickets]);

  return (
    <div className={`app${railOpen ? "" : " rail-collapsed"}`}>
      <a className="skip-link" href="#main-map">Skip to map</a>
      <div className="sr-only" role="status" aria-live="polite">{liveMsg}</div>
      <header className="topbar">
        <button
          className="rail-toggle"
          onClick={() => setRailOpen((o) => !o)}
          title={railOpen ? "Hide panel" : "Show panel"}
          aria-label="Toggle side panel"
        >
          ☰
        </button>
        <div className="brand">
          <span className="brand-mark" aria-hidden>◈</span>
          <div className="brand-text">
            <h1>GIS Conflict<span className="h1-rest"> Dashboard</span></h1>
            <p className="brand-sub">
              Find work tickets that conflict with transmission lines
              <Info title="Runs entirely in your browser — no server, and your data never leaves your machine." />
              {label ? ` · ${label}` : ""}
            </p>
          </div>
        </div>
        {stats && (
          <div className="chips">
            <Chip n={stats.facilities} l="facilities" title="Transmission features in the region (dataset total — not the impacted count)" />
            <Chip n={stats.tickets} l="tickets" title="Work points (synthetic sample)" />
            <Chip n={stats.conflicts} l="flagged" tone={stats.conflicts > 0 ? "danger" : undefined} title="Tickets with ≥1 conflicting facility" />
            <Chip n={stats.counties.length} l="counties" title="Counties covered" />
          </div>
        )}
      </header>

      {railOpen && <div className="rail-backdrop" aria-hidden onClick={() => setRailOpen(false)} />}
      <aside className="rail">
        <section className="card">
          <h2>Conflict analysis</h2>
          <div className="row">
            <button
              className={`btn ${mode === "buffer" ? "active" : ""}`}
              onClick={setBufferMode}
              aria-pressed={mode === "buffer"}
              title="Circle a single spot and see what infrastructure it overlaps"
            >
              ◎ Buffer point
            </button>
            <button
              className={`btn ${mode === "draw" ? "active" : ""}`}
              onClick={setDrawMode}
              aria-pressed={mode === "draw"}
              title="Outline an area on the map and see what it overlaps"
            >
              ✐ Draw AOI
            </button>
          </div>
          {mode === "idle" && (
            <p className="muted" style={{ margin: "8px 0 0" }}>
              Buffer point = circle one spot · Draw AOI = outline an area — either way, see what it overlaps.
            </p>
          )}
          <label className="muted" htmlFor="radius" style={{ display: "block", margin: "10px 0 4px" }}>
            Buffer radius: <strong>{radius} m</strong>
          </label>
          <input
            id="radius"
            type="range" min={25} max={500} step={25} value={radius}
            onChange={(e) => setRadius(Number(e.target.value))} style={{ width: "100%" }}
          />
          <div style={{ marginTop: 8 }}>
            <button className="btn danger" onClick={clearAoi}>Clear AOI</button>
          </div>
          {mode === "buffer" && <p className="muted">Click the map to drop a work point, or press Enter to drop one at the map center.</p>}
          {mode === "draw" && <p className="muted">Click to add vertices; double-click to finish the Area of Interest (AOI).</p>}
        </section>

        {editing && (
          <section className="card edit-card">
            <div className="tp-head">
              <h2>{editing.mode === "create" ? "New ticket" : "Edit ticket"}</h2>
              <button className="tp-close" onClick={cancelEditing} aria-label="Cancel">✕</button>
            </div>
            <label className="fld">
              Source
              <input
                list="src-list"
                value={editing.source}
                onChange={(e) => setEditing((ed) => (ed ? { ...ed, source: e.target.value } : ed))}
                placeholder="e.g. field_survey"
              />
            </label>
            <datalist id="src-list">
              {sourceOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <div className="fld">
              Status <span className="auto-tag">auto</span>
              <div className={`derived ${conflict && conflict.count > 0 ? "conflict" : "clear"}`}>
                {conflict
                  ? `${conflict.count} conflicting ${conflict.count === 1 ? "facility" : "facilities"} at ${radius} m → ${conflict.count > 0 ? "potential_conflict" : "no_conflict"}`
                  : "analyzing conflicts…"}
              </div>
            </div>
            <div className="fld-coords muted">
              Point: {editing.lat.toFixed(5)}, {editing.lon.toFixed(5)} · drag the marker to move
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn active"
                onClick={() => void saveEditing()}
                disabled={!editing.source}
              >
                Save
              </button>
              {editing.mode === "edit" && (
                <button className="btn danger" onClick={() => void deleteEditing()}>Delete</button>
              )}
            </div>
          </section>
        )}

        <section className="card">
          <h2>Layers</h2>
          <button className={`btn ${hexOn ? "active" : ""}`} onClick={toggleHex} aria-pressed={hexOn} title="Shows where tickets cluster (denser = more tickets)">
            ⬡ Density heatmap {hexOn ? "(on)" : "(off)"}
          </button>
          <button className="btn" style={{ marginTop: 8 }} onClick={() => kmzInputRef.current?.click()}>
            ⤓ Import KMZ / KML
          </button>
          <input
            ref={kmzInputRef}
            className="sr-only" tabIndex={-1} aria-hidden="true"
            type="file" accept=".kmz,.kml"
            onChange={(e) => e.target.files?.[0] && onKmz(e.target.files[0])}
          />
          {kmzName && <p className="muted">{kmzName}</p>}
        </section>

        <section className="card">
          <button className="panel-head" onClick={() => setLegendOpen((o) => !o)}>
            <h2>Legend</h2>
            <span className="chev">{legendOpen ? "▾" : "▸"}</span>
          </button>
          {legendOpen && (
            <div className="legend">
              <LegendItem c="#5b9dff" t="Our transmission (eligible)" kind="line" />
              <LegendItem c="#54607d" t="Other-owner transmission" kind="line" />
              <LegendItem c="#22d3c5" t="Ticket — no conflict (dot)" kind="point" />
              <LegendItem c="#ff6b6b" t="Ticket — potential conflict (triangle)" kind="tri" />
              <LegendItem c="#ffd166" t="Active AOI" kind="polygon" />
              <LegendItem c="#ff3b3b" t="Conflicting facility" kind="line" />
            </div>
          )}
        </section>

        <div className="foot">
          Personal project. Public-domain basemap data (EIA transmission, Census counties); sample
          tickets are synthetic.
        </div>
      </aside>

      <main className={`map-wrap${ticketInfo ? " has-inspector" : ""}`} id="main-map">
        <div id="map" ref={mapEl} />
        {phase === "ready" && !conflict && !ticketInfo && !welcomeDismissed && (
          <div className="welcome">
            <span>
              Find work tickets that conflict with transmission lines — <strong>click a ticket below</strong> to
              start, or drop a <strong>Buffer point</strong>.
            </span>
            <button
              className="welcome-x"
              aria-label="Dismiss"
              onClick={() => {
                setWelcomeDismissed(true);
                window.localStorage.setItem("gcd.welcome.dismissed", "1");
              }}
            >
              ✕
            </button>
          </div>
        )}
        {conflict && (
          <div className="result">
            {conflict.count > 0 ? (
              <span>⚠ <strong>{conflict.count}</strong> facility conflict{conflict.count > 1 ? "s" : ""}</span>
            ) : (
              <span>✓ <strong>no</strong> conflicts</span>
            )}
            <span className="muted">· {conflict.jurisdiction ?? "outside the coverage area"} · {conflict.via}</span>
            <span className="result-actions">
              <button className="btn-inline ghost" onClick={exportConflictGeoJson} title="Download buffer + conflicting facilities as GeoJSON (WGS84)">⤓ GeoJSON</button>
              <button className="btn-inline ghost" onClick={exportConflictKmz} title="Download buffer + conflicting facilities as KMZ (Google Earth)">⤓ KMZ</button>
              {lastPointRef.current && !lastPointRef.current.ticket && !editing && (
                <button className="btn-inline" onClick={saveBufferAsTicket}>＋ Save as ticket</button>
              )}
            </span>
          </div>
        )}
        {ticketInfo && (
          <aside className="inspector card" ref={inspectorRef} tabIndex={-1} aria-label="Ticket detail">
            <div className="tp-head">
              <h2>Ticket detail</h2>
              <div className="tp-actions">
                <button
                  className="mini"
                  title="Re-center on ticket"
                  aria-label="Re-center map on ticket"
                  onClick={() =>
                    void handleTicketSelect(
                      {
                        ticket_id: ticketInfo.ticket_id,
                        source: ticketInfo.source,
                        status: ticketInfo.status,
                        conflict_count: ticketInfo.storedCount,
                      },
                      ticketInfo.lon,
                      ticketInfo.lat,
                    )
                  }
                >
                  ⌖
                </button>
                <button
                  className="mini"
                  title="Edit ticket"
                  onClick={() =>
                    startEdit({
                      ticket_id: ticketInfo.ticket_id,
                      source: ticketInfo.source,
                      status: ticketInfo.status,
                      lon: ticketInfo.lon,
                      lat: ticketInfo.lat,
                    })
                  }
                >
                  ✎
                </button>
                <button className="tp-close" onClick={clearAoi} aria-label="Close ticket detail">✕</button>
              </div>
            </div>
            <div className="tp-id">{ticketInfo.ticket_id}</div>
            <div className="tp-row"><span className="muted">Source</span><span>{ticketInfo.source}</span></div>
            <div className="tp-row"><span className="muted">Status</span><span>{ticketInfo.status}</span></div>
            <div className="tp-row"><span className="muted">County</span><span>{ticketInfo.county ?? "—"}</span></div>
            <div className="tp-row">
              <span className="muted">
                Recorded (intake)
                <Info title="Conflict count captured at intake, using the ticket's recorded radius and a planar (UTM) buffer." />
              </span>
              <span className={`pill ${ticketInfo.storedCount > 0 ? "conflict" : "clear"}`}>
                {ticketInfo.storedCount > 0 ? `${ticketInfo.storedCount} conflict` : "clear"}
              </span>
            </div>
            <div className="tp-row">
              <span className="muted">
                Live · {ticketInfo.radius} m
                <Info title="Recomputed now at the current slider radius using a geodesic buffer. It differs from Recorded because the radius and the buffer method differ — this is expected." />
              </span>
              <span className={`pill ${ticketInfo.liveCount > 0 ? "conflict" : "clear"}`}>
                {ticketInfo.liveCount > 0 ? `${ticketInfo.liveCount} conflict` : "clear"}
              </span>
            </div>
            <p className="tp-note muted">
              Recorded = intake snapshot; Live = recomputed at the current radius. They differ by design.
            </p>
            <div className="tp-export">
              <button className="mini" onClick={exportConflictGeoJson} title="Export buffer + conflicts as GeoJSON (WGS84)">⤓ GeoJSON</button>
              <button className="mini" onClick={exportConflictKmz} title="Export buffer + conflicts as KMZ (Google Earth)">⤓ KMZ</button>
            </div>
            {ticketInfo.facilities.length > 0 && (
              <div className="tp-facs">
                <h3>Conflicting facilities <span className="muted">· click to inspect</span></h3>
                {ticketInfo.facilities.map((f, i) => (
                  <button
                    key={f.id ?? i}
                    type="button"
                    className="tp-fac"
                    title="Click to inspect · hover to locate on map"
                    onMouseEnter={() => hoverFacility(f.geometry ?? null)}
                    onMouseLeave={leaveFacility}
                    onFocus={() => hoverFacility(f.geometry ?? null)}
                    onBlur={leaveFacility}
                    onClick={() => inspectFacility(f)}
                  >
                    <span className="tp-fac-name">
                      {f.owner ?? "—"}
                      {f.id != null && <span className="tp-fac-id">#{f.id}</span>}
                    </span>
                    <span className="meta">{f.voltage_class ?? ""}</span>
                  </button>
                ))}
              </div>
            )}
          </aside>
        )}
        {phase !== "ready" && (
          <div className="loading">
            <div className="box">
              <div className="spinner" />
              {phase === "loading" ? "Booting DuckDB-WASM + loading GeoParquet…" : `Error: ${err}`}
            </div>
          </div>
        )}
      </main>

      <section className={`dock${ticketsOpen ? " open" : ""}`}>
        <div className="dock-head">
          <button className="panel-head dock-title" onClick={() => setTicketsOpen((o) => !o)}>
            <span className="chev">{ticketsOpen ? "▾" : "▸"}</span>
            <h2>
              Tickets ({filteredTickets.length === tickets.length
                ? tickets.length.toLocaleString()
                : `${filteredTickets.length.toLocaleString()} / ${tickets.length.toLocaleString()}`})
            </h2>
          </button>
          {ticketsOpen && (
            <div className="dock-filters">
              <input
                className="ti"
                name="ticket-search"
                aria-label="Search tickets by id or source"
                placeholder="Search id / source…"
                value={tq}
                onChange={(e) => setTq(e.target.value)}
              />
              <select name="source-filter" aria-label="Filter by source" value={fSource} onChange={(e) => setFSource(e.target.value)}>
                <option value="">all sources</option>
                {sourceOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select name="status-filter" aria-label="Filter by status" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
                <option value="">all statuses</option>
                {statusFilterOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button className={`btn ${mode === "addTicket" ? "active" : ""}`} onClick={startAddTicket}>
                ＋ New ticket
              </button>
              <button className="btn" onClick={exportTicketsKmz} title="Export the visible tickets as KMZ (Google Earth)">
                ⤓ Export KMZ
              </button>
              {mode === "addTicket" && !editing && (
                <span className="muted">Click the map to place the ticket.</span>
              )}
            </div>
          )}
        </div>
        {ticketsOpen && (
          <div className="dock-list">
            {filteredTickets.slice(0, 200).map((t) => (
              <div key={t.ticket_id} className="tk-card">
                <button
                  className="tk-main"
                  aria-label={`Ticket ${t.ticket_id}, source ${t.source || "none"}, ${
                    t.conflict_count > 0
                      ? `${t.conflict_count} potential conflict${t.conflict_count === 1 ? "" : "s"}`
                      : "no conflict"
                  }`}
                  onClick={(e) => {
                    lastTriggerRef.current = e.currentTarget;
                    ctrl.current?.map.flyTo({ center: [t.lon, t.lat], zoom: 14 });
                    void handleTicketSelect(t, t.lon, t.lat);
                  }}
                >
                  <span className="tk-id">
                    {t.ticket_id}
                    {t.origin === "user" && <span className="tag">user</span>}
                  </span>
                  <span className="meta">{t.source}</span>
                </button>
                <span className="tk-foot">
                  <span className={`pill ${t.conflict_count > 0 ? "conflict" : "clear"}`}>
                    {t.conflict_count > 0 ? `${t.conflict_count} conflict` : "clear"}
                  </span>
                  <button className="mini" title="Edit ticket" onClick={() => startEdit(t)}>✎</button>
                </span>
              </div>
            ))}
            {filteredTickets.length === 0 && (
              <div className="empty">
                <span aria-hidden>🔍</span>
                No tickets match these filters.
              </div>
            )}
            {filteredTickets.length > 200 && (
              <p className="muted dock-more">Showing 200 of {filteredTickets.length.toLocaleString()}.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Chip({ n, l, tone, title }: { n: number; l: string; tone?: "danger"; title?: string }) {
  return (
    <div className={`chip${tone ? ` chip-${tone}` : ""}`} title={title}>
      <span className="chip-n">{n.toLocaleString()}</span>
      <span className="chip-l">{l}</span>
    </div>
  );
}

// A focusable ⓘ that surfaces an explanation via the native tooltip.
function Info({ title }: { title: string }) {
  return (
    <span className="tp-info" title={title} tabIndex={0} role="img" aria-label={title}>
      ⓘ
    </span>
  );
}

function LegendItem({ c, t, kind }: { c: string; t: string; kind: "point" | "line" | "polygon" | "tri" }) {
  return (
    <div className="item">
      <span className={`glyph glyph-${kind}`} style={{ "--c": c } as CSSProperties} />
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

// A vertex on a line feature (true midpoint vertex), so a popup/flyTo anchor
// always lands on the line itself rather than off it.
function lineCentroid(geom: Geometry): Position {
  let pts: Position[] = [];
  if (geom.type === "LineString") pts = geom.coordinates;
  else if (geom.type === "MultiLineString") pts = geom.coordinates.flat();
  else if (geom.type === "Point") return geom.coordinates;
  else if (geom.type === "Polygon") return polygonCentroid(geom);
  if (pts.length === 0) return [0, 0];
  return pts[Math.floor(pts.length / 2)];
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
