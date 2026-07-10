import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { FeatureCollection, Geometry, Position } from "geojson";
import type { LngLat, MapGeoJSONFeature } from "maplibre-gl";
import { MapController, type InspectHandler } from "./map";
import Info from "./components/Info";
import CellControls from "./components/CellControls";
import EditForm from "./components/EditForm";
import TicketDetail from "./components/TicketDetail";
import TicketList from "./components/TicketList";
import FilterStrip from "./components/FilterStrip";
import ToolTabs from "./components/ToolTabs";
import HelpOverlay from "./components/HelpOverlay";
import AppHeader from "./components/AppHeader";
import AnalyzeCard from "./components/AnalyzeCard";
import RuleCard from "./components/RuleCard";
import LayersCard from "./components/LayersCard";
import Legend from "./components/Legend";
import MapCanvas from "./components/MapCanvas";
import RankedCellsPanel from "./components/RankedCellsPanel";
import MobileSheetChrome from "./components/MobileSheetChrome";
import { useIsMobile } from "./lib/useIsMobile";
import { usePersistedState } from "./lib/usePersistedState";
import { useHexLayer } from "./lib/useHexLayer";
import { useKmzImport } from "./lib/useKmzImport";
import { useMobileSheet } from "./lib/useMobileSheet";
import { useTicketFilters } from "./lib/useTicketFilters";
import { useFacilityDetail } from "./lib/useFacilityDetail";
import { useExports } from "./lib/useExports";
import { useKeyboardShortcuts } from "./lib/useKeyboardShortcuts";
import { polygonCentroid, distPointToGeomM } from "./lib/geometry";
import { buildPopupNode } from "./lib/popup";
import {
  allTicketsMerged,
  bufferGeometry,
  bufferPoint,
  conflictForAoi,
  config,
  countiesLayer,
  createTicket,
  facilitiesLayer,
  facilityFacets,
  hexDensity,
  jurisdictionFor,
  liveTicketConflictCounts,
  removeTicket,
  stats as loadStats,
  ticketsLayer,
  ticketsToFC,
  updateTicket,
  computeCellFacts,
  scoreCells,
  cellsToFC,
  DEFAULT_CELL_WEIGHTS,
  type ConflictResult,
  type ConflictRule,
  type FacilityFacets,
  type MergedTicket,
  type Stats,
  type CellFacts,
  type CellScore,
  type CellWeights,
} from "./services/demo";
import type {
  Phase,
  Mode,
  Altitude,
  EditingState,
  ConflictInfo,
  TicketInfo,
  ConflictFacility,
  RulePreset,
  TicketLike,
  EditableTicket,
} from "./types";

export default function App() {
  const mapEl = useRef<HTMLDivElement>(null);
  const ctrl = useRef<MapController | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [err, setErr] = useState<string>("");
  const [label, setLabel] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [tickets, setTickets] = useState<MergedTicket[]>([]);
  // Per-ticket conflict counts recomputed live under the current rule (null until first
  // computed). Applied over the stored intake counts so the rule drives the chip/list/map.
  const [liveCounts, setLiveCounts] = useState<Map<string, number> | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [radius, setRadius] = useState(100);
  const { hexOn, hexRes, toggleHex } = useHexLayer(ctrl);
  // The live conflict rule (owners that count as "ours" + statuses to exclude) and
  // the facet options that seed its chips. `rule` is null until demo_config loads.
  const [facets, setFacets] = useState<FacilityFacets | null>(null);
  const [rule, setRule] = useState<ConflictRule | null>(null);
  const [defaultRule, setDefaultRule] = useState<ConflictRule | null>(null); // config baseline, for presets
  const ruleRef = useRef<ConflictRule | null>(null);
  ruleRef.current = rule;
  const { kmzName, kmzInputRef, onKmz, clearKmz, selectImported } = useKmzImport(ctrl);
  // --- H3 conflict-index second altitude ---
  const [altitude, setAltitude] = useState<Altitude>("cells");
  // The map is initialized asynchronously. Keep the requested altitude available to
  // that one-time setup so its initially-hidden H3 layers are synchronized even
  // though the visibility effect ran before a controller existed.
  const altitudeRef = useRef<Altitude>(altitude);
  altitudeRef.current = altitude;
  const [cellRes, setCellRes] = useState(7);
  const [cellWeights, setCellWeights] = useState<CellWeights>(DEFAULT_CELL_WEIGHTS);
  const [cellThreshold, setCellThreshold] = useState(0);
  const [cellFacts, setCellFacts] = useState<CellFacts[] | null>(null);
  const [cellScores, setCellScores] = useState<CellScore[]>([]);
  const [drillCellId, setDrillCellId] = useState<string | null>(null);
  const cellDebounceRef = useRef<number | undefined>(undefined);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [ticketInfo, setTicketInfo] = useState<TicketInfo | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const radiusRef = useRef(radius);
  radiusRef.current = radius;
  // Last analyzed point, so moving the radius slider re-runs the conflict live.
  const lastPointRef = useRef<{ lng: number; lat: number; ticket: TicketLike | null } | null>(null);
  // Stable indirection so enableInspect (wired once on mount) always calls the latest handler.
  const onInspectRef = useRef<InspectHandler>(() => {});
  // Same indirection for the cell drill-down (pickCell is declared later; onInspect reads it via ref).
  const pickCellRef = useRef<(cell: CellScore) => void>(() => {});
  // The facility "clicked" in the detail panel; its highlight stays lit (sticky)
  // after the cursor leaves the row, until another is picked or the panel closes.
  const selectedFacRef = useRef<ConflictFacility | null>(null);
  // Persisted workspace preferences (rail collapse + legend open) survive reloads.
  const [legendOpen, setLegendOpen] = usePersistedState("gcd.legendOpen", true);
  const [leftOpen, setLeftOpen] = usePersistedState("gcd.leftOpen", true);
  const [rightOpen, setRightOpen] = usePersistedState("gcd.rightOpen", true);
  // Right tools column: which tab is open (mode-scoped).
  const [toolTab, setToolTab] = useState("index");
  // Help overlay (keyboard-shortcut reference).
  const [helpOpen, setHelpOpen] = useState(false);
  // Mobile (phone) = a Maps-style bottom-sheet drawer over a full-bleed map.
  const isMobile = useIsMobile();
  const { sheetTab, sheetDetent, setSheetDetent, sheetH, onGrabDown, onGrabMove, onGrabUp, onHandleClick, selectTab } =
    useMobileSheet();
  // Screen-reader announcement of the latest conflict result (aria-live region).
  const [liveMsg, setLiveMsg] = useState("");
  // First-run welcome callout (dismissed flag persisted in localStorage).
  const [welcomeDismissed, setWelcomeDismissed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem("gcd.welcome.dismissed") === "1",
  );
  // Last analyzed AOI geom + intersected facilities, so the export buttons can serialize them.
  const lastResultRef = useRef<{ geom: Geometry; facilities: FeatureCollection; via: string } | null>(null);
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
        c.setCellsVisible(altitudeRef.current === "cells");
        c.enableInspect((layerId, feature, lngLat) => onInspectRef.current(layerId, feature, lngLat));
        const cfg = await config();
        setLabel(cfg.label);
        // Seed the live conflict rule from the config defaults, and its chip options.
        const initialRule: ConflictRule = {
          selfOwners: cfg.selfOwners,
          excludedStatuses: cfg.excludedFacilityStatuses,
        };
        ruleRef.current = initialRule;
        setRule(initialRule);
        setDefaultRule(initialRule);
        c.setRuleStyle(cfg.selfOwners);
        void facilityFacets().then(setFacets);
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
      const res = await conflictForAoi(geom, ruleRef.current ?? undefined);
      c.setData("conflict", res.facilities);
      const jur = await jurisdictionFor(at[0], at[1]);
      setConflict({ count: res.count, jurisdiction: jur, via });
      lastResultRef.current = { geom, facilities: res.facilities, via };
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
        work_type: "work_type" in t ? String(t.work_type) : "permit",
        priority: "priority" in t ? String(t.priority) : "normal",
        workflow_status: "workflow_status" in t ? String(t.workflow_status) : "new",
        county,
        storedCount: Number(t.intake_conflict_count),
        liveCount: res.count,
        radius: radiusRef.current,
        lon: lng,
        lat,
        facilities: res.facilities.features
          .map((f) => {
            const p = (f.properties ?? {}) as Record<string, unknown>;
            return {
              id: p.id as number | undefined,
              asset_ref: p.asset_ref as string | undefined,
              owner: p.owner as string | undefined,
              voltage_class: p.voltage_class as string | undefined,
              nominal_kv: p.nominal_kv as number | undefined,
              asset_type: p.asset_type as string | undefined,
              status: p.status as string | undefined,
              geometry: f.geometry,
              dist_m: f.geometry ? distPointToGeomM([lng, lat], f.geometry) : undefined,
            };
          })
          // Nearest conflicting facility first — the itemized "why", ordered by proximity.
          .sort((a, b) => (a.dist_m ?? Infinity) - (b.dist_m ?? Infinity)),
      });
    },
    [runConflict],
  );

  const onInspect = useCallback<InspectHandler>(
    (layerId: string, feature: MapGeoJSONFeature, lngLat: LngLat) => {
      const c = ctrl.current;
      if (!c) return;
      const props = (feature.properties ?? {}) as Record<string, unknown>;
      if (layerId === "cells-fill") {
        const cell = cellScores.find((s) => s.cell_id === String(props.cell_id ?? ""));
        if (cell) pickCellRef.current(cell);
        return;
      }
      if (layerId === "tickets-circle") {
        c.hideInspectPopup();
        lastTriggerRef.current = null; // opened from the map, not a ticket card — no focus to return
        void handleTicketSelect(
          {
            ticket_id: String(props.ticket_id ?? ""),
            source: String(props.source ?? ""),
            intake_conflict_count: Number(props.intake_conflict_count ?? 0),
            conflict_count: Number(props.conflict_count ?? 0),
          },
          lngLat.lng,
          lngLat.lat,
        );
      } else if (layerId.startsWith("kmz-")) {
        const imported = selectImported(String(props.__import_id ?? ""));
        if (!imported) return;
        const geom = imported.geometry.type === "Polygon" || imported.geometry.type === "MultiPolygon"
          ? imported.geometry
          : bufferGeometry(imported.geometry, radiusRef.current);
        lastPointRef.current = null;
        void runConflict(geom, polygonCentroid(geom), `imported AOI: ${imported.name}`);
      } else {
        setTicketInfo(null);
        c.showInspectPopup(lngLat, buildPopupNode(layerId, props));
      }
    },
    [handleTicketSelect, cellScores, selectImported, runConflict],
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
  // Open the create form at a point: run the conflict analysis (so the AOI/conflicts
  // show and status can be derived), drop a draggable marker that re-analyzes on move,
  // and seed the source-only form. Shared by the analyze draw, "New ticket", and "Save as ticket".
  const beginCreateAt = useCallback(
    (lng: number, lat: number) => {
      const c = ctrl.current;
      if (!c) return;
      lastPointRef.current = { lng, lat, ticket: null };
      void runConflict(bufferPoint(lng, lat, radiusRef.current), [lng, lat], `new ticket @ ${radiusRef.current} m`);
      c.spawnDragMarker(lng, lat, (nlng, nlat) => {
        setEditing((ed) => (ed ? { ...ed, lon: nlng, lat: nlat } : ed));
        lastPointRef.current = { lng: nlng, lat: nlat, ticket: null };
        void runConflict(bufferPoint(nlng, nlat, radiusRef.current), [nlng, nlat], `new ticket @ ${radiusRef.current} m`, false);
      });
      setEditing({ mode: "create", source: "", work_type: "permit", priority: "low", workflow_status: "new", lon: lng, lat, lon0: lng, lat0: lat });
    },
    [runConflict],
  );

  // Analyze → draw: dropping a buffer point or finishing a drawn AOI flows straight into the
  // create form, seeded at that location (a drawn polygon uses its centroid — tickets are point+radius).
  const setBufferMode = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    c.stopPolygonDraw();
    c.hideInspectPopup();
    endTicketEdit();
    setTicketInfo(null);
    setMode("buffer");
    c.enableBufferClick((lng, lat) => {
      c.disableBufferClick();
      setMode("idle");
      beginCreateAt(lng, lat);
    });
  }, [beginCreateAt, endTicketEdit]);

  const setDrawMode = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    c.disableBufferClick();
    c.hideInspectPopup();
    endTicketEdit();
    setTicketInfo(null);
    setMode("draw");
    c.startPolygonDraw((geom) => {
      setMode("idle");
      const [clng, clat] = polygonCentroid(geom);
      beginCreateAt(clng, clat);
    });
  }, [beginCreateAt, endTicketEdit]);

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

  // Live rule: recolor the facilities and re-run the last analysis when the rule
  // changes (the facilities are facts; the rule is the tunable opinion over them).
  useEffect(() => {
    const c = ctrl.current;
    if (!c || !rule) return;
    c.setRuleStyle(rule.selfOwners);
    const lp = lastPointRef.current;
    const lastGeom = lastResultRef.current?.geom;
    if (!lp && !lastGeom) return; // nothing analyzed yet — just the recolor
    const id = setTimeout(() => {
      if (lp?.ticket) void handleTicketSelect(lp.ticket, lp.lng, lp.lat, false);
      else if (lp) void runConflict(bufferPoint(lp.lng, lp.lat, radiusRef.current), [lp.lng, lp.lat], `${radiusRef.current} m buffer`, false);
      else if (lastGeom) void runConflict(lastGeom, polygonCentroid(lastGeom), "drawn area", false);
    }, 120);
    return () => clearTimeout(id);
  }, [rule, handleTicketSelect, runConflict]);

  // Recompute every ticket's conflict count under the live rule (debounced), so the
  // Flagged chip, list badges, and map dots move when the rule changes.
  useEffect(() => {
    if (!rule) return;
    const id = setTimeout(() => {
      void liveTicketConflictCounts(tickets, rule)
        .then(setLiveCounts)
        .catch((e) => console.warn("live conflict recompute failed", e));
    }, 200);
    return () => clearTimeout(id);
  }, [rule, tickets]);

  // The unified live evidence view drives tickets, H3 cells, and detail badges.
  const viewTickets = useMemo(() => {
    if (!liveCounts) return tickets;
    return tickets.map((t) => ({ ...t, conflict_count: liveCounts.get(t.ticket_id) ?? 0 }));
  }, [tickets, liveCounts]);

  // One-click rule bundles, built from the config baseline + the live facet sets.
  const presets = useMemo<RulePreset[]>(() => {
    if (!defaultRule || !facets) return [];
    const primary = defaultRule.selfOwners[0] ?? facets.owners[0];
    const has = (s: string) => facets.statuses.includes(s);
    return [
      { name: "Default", hint: "the configured rule", rule: defaultRule },
      {
        name: "In-service only",
        hint: "your primary owner, active lines only (exclude planned + retired)",
        rule: {
          selfOwners: primary ? [primary] : [],
          excludedStatuses: [...new Set([...defaultRule.excludedStatuses, "planned"])].filter(has),
        },
      },
      {
        name: "All operators",
        hint: "every owner counts, only retired excluded",
        rule: { selfOwners: facets.owners, excludedStatuses: facets.statuses.filter((s) => s === "retired") },
      },
    ];
  }, [defaultRule, facets]);

  const toggleRuleOwner = useCallback((o: string) => {
    setRule((r) =>
      r ? { ...r, selfOwners: r.selfOwners.includes(o) ? r.selfOwners.filter((x) => x !== o) : [...r.selfOwners, o] } : r,
    );
  }, []);
  const toggleRuleExcluded = useCallback((s: string) => {
    setRule((r) =>
      r ? { ...r, excludedStatuses: r.excludedStatuses.includes(s) ? r.excludedStatuses.filter((x) => x !== s) : [...r.excludedStatuses, s] } : r,
    );
  }, []);

  // --- H3 conflict-index second altitude -----------------------------------
  const patchCellWeights = useCallback(
    (p: Partial<CellWeights>) => setCellWeights((w) => ({ ...w, ...p })),
    [],
  );

  // Drill: pin a cell → filter the ticket layer to its members + fly to it.
  const clearDrill = useCallback(async () => {
    setDrillCellId(null);
    const c = ctrl.current;
    if (c) c.setData("tickets", await ticketsLayer());
  }, []);

  const pickCell = useCallback(
    (cell: CellScore) => {
      const c = ctrl.current;
      if (!c) return;
      setDrillCellId(cell.cell_id);
      const ids = new Set(cell.ticket_ids);
      const subset: FeatureCollection = {
        type: "FeatureCollection",
        features: tickets
          .filter((t) => ids.has(t.ticket_id))
          .map((t) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [t.lon, t.lat] },
            properties: {
              ticket_id: t.ticket_id,
              source: t.source,
              work_type: t.work_type,
              priority: t.priority,
              workflow_status: t.workflow_status,
              intake_conflict_count: t.intake_conflict_count,
              conflict_count: liveCounts?.get(t.ticket_id) ?? t.conflict_count,
              county_geoid: t.county_geoid,
              origin: t.origin,
            },
          })),
      };
      c.setData("tickets", subset);
      c.map.flyTo({ center: cell.centroid, zoom: Math.max(c.map.getZoom(), 11), duration: 600 });
      c.flashCell(cell.geometry); // pulse the picked hex so it's identifiable on the map
      setToolTab("analyze");
      setAltitude("tickets");
    },
    [tickets, liveCounts],
  );
  pickCellRef.current = pickCell;

  const goAltitude = useCallback(
    (a: Altitude) => {
      // Switching mode clears any transient AOI/analysis so the result bar and
      // highlights don't linger across modes, and resets the tools tab.
      const c = ctrl.current;
      c?.disableBufferClick();
      c?.stopPolygonDraw();
      endTicketEdit();
      c?.hideInspectPopup();
      c?.setData("aoi", { type: "FeatureCollection", features: [] });
      c?.setData("conflict", { type: "FeatureCollection", features: [] });
      c?.highlightConflictFacility(null);
      selectedFacRef.current = null;
      lastPointRef.current = null;
      setMode("idle");
      setTicketInfo(null);
      setConflict(null);
      setToolTab(a === "cells" ? "index" : "analyze");
      setAltitude(a);
    },
    [endTicketEdit],
  );

  // Keep a drilled cell visible while its ticket evidence is reviewed.
  useEffect(() => {
    const c = ctrl.current;
    if (!c) return;
    const cells = altitude === "cells" || drillCellId !== null;
    c.setCellsVisible(cells);
    c.setLayerVisible("hex-fill", cells ? false : hexOn);
  }, [altitude, hexOn, drillCellId, clearDrill]);

  // (Re)compute the per-cell FACTS when the cell altitude opens or the grain changes.
  useEffect(() => {
    if (altitude !== "cells" && !drillCellId) return;
    let live = true;
    setCellFacts(null);
    void computeCellFacts(cellRes, viewTickets).then((f) => {
      if (live) setCellFacts(f);
    });
    return () => {
      live = false;
    };
  }, [altitude, drillCellId, cellRes, viewTickets]);

  // Re-score (OPINIONS: weights/norm) whenever the facts or weights settle → repaint.
  useEffect(() => {
    const c = ctrl.current;
    if ((altitude !== "cells" && !drillCellId) || !c || !cellFacts) return;
    window.clearTimeout(cellDebounceRef.current);
    cellDebounceRef.current = window.setTimeout(() => {
      const scores = scoreCells(cellFacts, cellWeights);
      setCellScores(scores);
      c.setData("cells", cellsToFC(scores));
      c.setCellThreshold(cellThreshold);
    }, 60);
    return () => window.clearTimeout(cellDebounceRef.current);
    // cellThreshold intentionally omitted — it has its own paint-only effect below.
  }, [altitude, drillCellId, cellFacts, cellWeights]); // eslint-disable-line react-hooks/exhaustive-deps

  // Threshold is a paint-only change (dim below-threshold cells) — no re-score.
  useEffect(() => {
    if (altitude === "cells") ctrl.current?.setCellThreshold(cellThreshold);
  }, [cellThreshold, altitude]);

  // --- ticket CRUD ---------------------------------------------------------
  const refreshTickets = useCallback(async () => {
    const c = ctrl.current;
    if (!c) return;
    c.setData("tickets", await ticketsLayer());
    setTickets(await allTicketsMerged());
    setStats(await loadStats());
    if (hexOn) c.setData("hex", await hexDensity(hexRes));
  }, [hexOn, hexRes]);

  const startAddTicket = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    c.disableBufferClick();
    c.stopPolygonDraw();
    c.hideInspectPopup();
    c.removeDragMarker();
    setTicketInfo(null);
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
      setMode("idle");
      lastPointRef.current = { lng: t.lon, lat: t.lat, ticket: null };
      void runConflict(bufferPoint(t.lon, t.lat, radiusRef.current), [t.lon, t.lat], `editing ${t.ticket_id} @ ${radiusRef.current} m`);
      c.spawnDragMarker(t.lon, t.lat, (nlng, nlat) => {
        setEditing((ed) => (ed ? { ...ed, lon: nlng, lat: nlat } : ed));
        lastPointRef.current = { lng: nlng, lat: nlat, ticket: null };
        void runConflict(bufferPoint(nlng, nlat, radiusRef.current), [nlng, nlat], `editing ${t.ticket_id} @ ${radiusRef.current} m`, false);
      });
      setEditing({
        mode: "edit", ticket_id: t.ticket_id, source: t.source, work_type: t.work_type,
        priority: t.priority, workflow_status: t.workflow_status, lon: t.lon, lat: t.lat, lon0: t.lon, lat0: t.lat,
      });
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
      await createTicket({
        source: ed.source, work_type: ed.work_type, priority: ed.priority, workflow_status: ed.workflow_status,
        lon: ed.lon, lat: ed.lat, radiusM: radiusRef.current,
      });
    } else if (ed.ticket_id) {
      const moved = ed.lon !== ed.lon0 || ed.lat !== ed.lat0;
      const patch: Parameters<typeof updateTicket>[1] = {
        source: ed.source, work_type: ed.work_type, priority: ed.priority, workflow_status: ed.workflow_status,
      };
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

  const drilledViewTickets = useMemo(() => {
    if (!drillCellId) return viewTickets;
    const ids = new Set(cellScores.find((c) => c.cell_id === drillCellId)?.ticket_ids ?? []);
    return viewTickets.filter((t) => ids.has(t.ticket_id));
  }, [viewTickets, drillCellId, cellScores]);

  // Ticket search/filter state + derived option lists and the filtered, date-sorted list.
  const {
    tq,
    setTq,
    fSource,
    setFSource,
    fWorkflowStatus,
    setFWorkflowStatus,
    fPriority,
    setFPriority,
    fWorkType,
    setFWorkType,
    fMinConflicts,
    setFMinConflicts,
    sourceOptions,
    workflowStatusOptions,
    filteredTickets,
  } = useTicketFilters(drilledViewTickets, tickets);

  // Push the live-rule ticket counts to the map dots (tickets mode, not while drilled
  // into a cell — the drill sets its own subset).
  useEffect(() => {
    const c = ctrl.current;
    if (!c || !liveCounts || altitude !== "tickets" || drillCellId) return;
    c.setData("tickets", ticketsToFC(viewTickets));
  }, [viewTickets, liveCounts, altitude, drillCellId]);

  // Flagged-ticket count under the live rule (falls back to the stored stat until computed).
  const flaggedCount = useMemo(
    () => (liveCounts ? viewTickets.filter((t) => t.conflict_count > 0).length : stats?.conflicts ?? 0),
    [liveCounts, viewTickets, stats],
  );

  // --- conflicting-facility interactions (detail panel) --------------------
  const { hoverFacility, leaveFacility, inspectFacility } = useFacilityDetail(ctrl, selectedFacRef);

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

  // Global keyboard shortcuts + the Escape close-topmost-surface ladder.
  useKeyboardShortcuts({
    editing,
    ticketInfo,
    cancelEditing,
    clearAoi,
    isMobile,
    sheetDetent,
    setSheetDetent,
    helpOpen,
    setHelpOpen,
    altitude,
    goAltitude,
    setBufferMode,
    setDrawMode,
    startAddTicket,
    setLeftOpen,
    setRightOpen,
  });

  // On mobile, opening a ticket detail raises the sheet so it's visible.
  useEffect(() => {
    if (isMobile && ticketInfo && sheetDetent === "collapsed") setSheetDetent("half");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketInfo?.ticket_id, isMobile]);

  // Move focus into the ticket detail panel when it opens (screen-reader + keyboard).
  useEffect(() => {
    if (ticketInfo) inspectorRef.current?.focus();
  }, [ticketInfo?.ticket_id]);

  // --- exports -------------------------------------------------------------
  const { recenterAoi, exportConflictKmz } = useExports({
    ctrl,
    lastResultRef,
    ruleRef,
    label,
  });


  return (
    <div
      className={`app${leftOpen ? "" : " left-collapsed"}${rightOpen ? "" : " right-collapsed"}${
        isMobile ? ` mobile sheet-${sheetDetent}` : ""
      }`}
      data-sheet={isMobile ? sheetTab : undefined}
      style={isMobile ? ({ "--sheet-h": `${sheetH}vh` } as CSSProperties) : undefined}
    >
      <a className="skip-link" href="#main-map">Skip to map</a>
      <div className="sr-only" role="status" aria-live="polite">{liveMsg}</div>

      <AppHeader
        isMobile={isMobile}
        leftOpen={leftOpen}
        onToggleLeft={() => setLeftOpen((o) => !o)}
        rightOpen={rightOpen}
        onToggleRight={() => setRightOpen((o) => !o)}
        label={label}
        altitude={altitude}
        onAltitude={goAltitude}
        stats={stats}
        flaggedCount={flaggedCount}
        onOpenHelp={() => setHelpOpen(true)}
      />

      {altitude === "tickets" && (
        <div className="filter">
          <FilterStrip
            query={tq}
            onQuery={setTq}
            source={fSource}
            onSource={setFSource}
            sourceOptions={sourceOptions}
            workflowStatus={fWorkflowStatus}
            onWorkflowStatus={setFWorkflowStatus}
            workflowStatusOptions={workflowStatusOptions}
            priority={fPriority}
            onPriority={setFPriority}
            workType={fWorkType}
            onWorkType={setFWorkType}
            minConflicts={fMinConflicts}
            onMinConflicts={setFMinConflicts}
          />
        </div>
      )}

      <aside className="left" aria-label="Details">
        {altitude === "tickets" ? (
          editing ? (
            <EditForm
              editing={editing}
              sourceOptions={sourceOptions}
              radius={radius}
              conflict={conflict}
              onChangeSource={(v) => setEditing((ed) => (ed ? { ...ed, source: v } : ed))}
              onChangeWorkType={(v) => setEditing((ed) => (ed ? { ...ed, work_type: v } : ed))}
              onChangePriority={(v) => setEditing((ed) => (ed ? { ...ed, priority: v } : ed))}
              onChangeWorkflowStatus={(v) => setEditing((ed) => (ed ? { ...ed, workflow_status: v } : ed))}
              onSave={() => void saveEditing()}
              onDelete={() => void deleteEditing()}
              onCancel={cancelEditing}
            />
          ) : ticketInfo ? (
            <TicketDetail
              info={ticketInfo}
              panelRef={inspectorRef}
              onRecenter={() =>
                void handleTicketSelect(
                  {
                    ticket_id: ticketInfo.ticket_id,
                    source: ticketInfo.source,
                    intake_conflict_count: ticketInfo.storedCount,
                    conflict_count: ticketInfo.storedCount,
                  },
                  ticketInfo.lon,
                  ticketInfo.lat,
                )
              }
              onEdit={() =>
                startEdit({
                  ticket_id: ticketInfo.ticket_id,
                  source: ticketInfo.source,
                  work_type: ticketInfo.work_type as EditableTicket["work_type"],
                  priority: ticketInfo.priority as EditableTicket["priority"],
                  workflow_status: ticketInfo.workflow_status as EditableTicket["workflow_status"],
                  lon: ticketInfo.lon,
                  lat: ticketInfo.lat,
                })
              }
              onClose={clearAoi}
              onExportKmz={() => exportConflictKmz({
                ticket_id: ticketInfo.ticket_id, source: ticketInfo.source, work_type: ticketInfo.work_type,
                priority: ticketInfo.priority, workflow_status: ticketInfo.workflow_status,
                conflict_count: ticketInfo.liveCount, lon: ticketInfo.lon, lat: ticketInfo.lat,
              })}
              onHoverFacility={hoverFacility}
              onLeaveFacility={leaveFacility}
              onInspectFacility={inspectFacility}
            />
          ) : (
            <>
              <div className="left-head">
                <h2 className="left-title">
                  Tickets ({filteredTickets.length === tickets.length
                    ? tickets.length.toLocaleString()
                    : `${filteredTickets.length.toLocaleString()} / ${tickets.length.toLocaleString()}`})
                </h2>
                <div className="left-actions">
                  <button className={`btn ${mode === "addTicket" ? "active" : ""}`} onClick={startAddTicket} title="Create a browser-local scenario ticket">
                    ＋ Local ticket
                  </button>
                </div>
              </div>
              {drillCellId && (
                <div className="cell-drill">
                  H3 screening → ticket evidence <code>{drillCellId.slice(0, 7)}…</code>
                  <button type="button" onClick={() => { void clearDrill(); goAltitude("cells"); }}>return to screening</button>
                </div>
              )}
              {mode === "addTicket" && !editing && (
                <p className="muted place-hint">Click the map to place the ticket.</p>
              )}
              <TicketList
                tickets={filteredTickets}
                onSelect={(t, trigger) => {
                  lastTriggerRef.current = trigger;
                  ctrl.current?.map.flyTo({ center: [t.lon, t.lat], zoom: 14 });
                  void handleTicketSelect(t, t.lon, t.lat);
                }}
                onEdit={startEdit}
              />
            </>
          )
        ) : (
          <RankedCellsPanel
            loading={cellFacts === null}
            scores={cellScores}
            drillCellId={drillCellId}
            onClearDrill={() => void clearDrill()}
            onPick={pickCell}
          />
        )}
      </aside>

      <MapCanvas
        mapRef={mapEl}
        phase={phase}
        err={err}
        conflict={conflict}
        showWelcome={phase === "ready" && !conflict && !ticketInfo && !welcomeDismissed}
        onDismissWelcome={() => {
          setWelcomeDismissed(true);
          window.localStorage.setItem("gcd.welcome.dismissed", "1");
        }}
        canSaveAsTicket={!!(lastPointRef.current && !lastPointRef.current.ticket && !editing)}
        onRecenter={recenterAoi}
        onSaveAsTicket={saveBufferAsTicket}
      />

      <aside className="right" aria-label="Tools">
        <ToolTabs
          tabs={
            altitude === "tickets"
              ? [
                  { id: "analyze", label: "Analyze" },
                  { id: "rule", label: "Rule" },
                  { id: "layers", label: "Layers" },
                ]
              : [
                  { id: "index", label: "Index" },
                  { id: "layers", label: "Layers" },
                ]
          }
          active={toolTab}
          onSelect={setToolTab}
        >
          {toolTab === "analyze" && (
            <AnalyzeCard
              mode={mode}
              onBuffer={setBufferMode}
              onDraw={setDrawMode}
              radius={radius}
              onRadius={setRadius}
              onClearAoi={clearAoi}
            />
          )}

          {toolTab === "rule" && (
            <RuleCard
              facets={facets}
              rule={rule}
              presets={presets}
              onSelectPreset={setRule}
              onToggleOwner={toggleRuleOwner}
              onToggleExcluded={toggleRuleExcluded}
            />
          )}

          {toolTab === "index" && (
            <section className="card cell-card">
              <h2>Conflict-index cells</h2>
              <p className="muted cell-honesty">
                A tunable screening <b>index</b> over H3 <Info term="h3" /> hexes — a weighted score of
                ticket volume, conflict rate, mean severity, and facility density. It is a screening index,
                not a severity measurement, and inherits every ticket caveat (synthetic sample). Scores
                shift with the weights <em>and</em> the grain (MAUP) — try r6 ⇄ r8.
              </p>
              <CellControls
                weights={cellWeights}
                onWeights={patchCellWeights}
                res={cellRes}
                onRes={setCellRes}
                threshold={cellThreshold}
                onThreshold={setCellThreshold}
              />
              <div className="cell-legend">
                <div className="cell-ramp" aria-hidden />
                <div className="cell-ramp-labels"><span>lower</span><span>higher index</span></div>
                <div className="cell-legend-note">
                  <i className="hot-swatch" aria-hidden /> hotspot — high ticket volume and conflict rate.
                  Click a hex or a row to drill into its tickets.
                </div>
              </div>
            </section>
          )}

          {toolTab === "layers" && (
            <>
              <LayersCard
                hexOn={hexOn}
                onToggleHex={toggleHex}
                kmzName={kmzName}
                onImportKmz={onKmz}
                onClearKmz={() => { clearKmz(); clearAoi(); }}
                kmzInputRef={kmzInputRef}
              />
              <Legend open={legendOpen} onToggle={() => setLegendOpen((o) => !o)} />
            </>
          )}
        </ToolTabs>

        <div className="foot">
          Personal project. Public-domain basemap data (EIA transmission, Census counties); sample
          tickets are synthetic.
        </div>
      </aside>

      {isMobile && (
        <MobileSheetChrome
          detent={sheetDetent}
          tab={sheetTab}
          onGrabDown={onGrabDown}
          onGrabMove={onGrabMove}
          onGrabUp={onGrabUp}
          onHandleClick={onHandleClick}
          onSelectTab={selectTab}
        />
      )}

      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
