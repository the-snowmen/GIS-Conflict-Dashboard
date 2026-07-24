import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { FeatureCollection } from "geojson";
import type { LngLat, MapGeoJSONFeature } from "maplibre-gl";
import { MapController, type InspectHandler } from "./map";
import Header from "./components/Header";
import WorkspacePanel from "./components/workspace/WorkspacePanel";
import AreaStep from "./components/workspace/AreaStep";
import ConfigStep from "./components/workspace/ConfigStep";
import RunButton from "./components/workspace/RunButton";
import ScreenControls from "./components/ScreenControls";
import ResultsTray from "./components/ResultsTray";
import LayersPopover from "./components/LayersPopover";
import MapCanvas from "./components/MapCanvas";
import FacilityDrawer from "./components/drawer/FacilityDrawer";
import ReportBody from "./components/results/ReportBody";
import SavedRunsMenu from "./components/SavedRunsMenu";
import EditForm from "./components/EditForm";
import HelpOverlay from "./components/HelpOverlay";
import MobileSheetChrome from "./components/MobileSheetChrome";
import { useIsMobile } from "./lib/useIsMobile";
import { usePersistedState } from "./lib/usePersistedState";
import { useHexLayer } from "./lib/useHexLayer";
import { useKmzImport } from "./lib/useKmzImport";
import { useMobileSheet } from "./lib/useMobileSheet";
import { useTicketFilters } from "./lib/useTicketFilters";
import { useAnalysisRun } from "./lib/useAnalysisRun";
import { useFacilityDetail } from "./lib/useFacilityDetail";
import { matchingPreset } from "./lib/cellPresets";
import { useKeyboardShortcuts } from "./lib/useKeyboardShortcuts";
import {
  defaultRunName,
  deleteRun,
  listRuns,
  newRunId,
  putRun,
  renameRun,
  workAreaOf,
  type AnalysisRun,
} from "./services/runs";
import { exportProject, mergeProject, parseProject } from "./services/project";
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
  liveTicketConflictCounts,
  removeTicket,
  ticketsLayer,
  ticketsToFC,
  updateTicket,
  computeCellFacts,
  scoreCells,
  cellsToFC,
  countyNames,
  DEFAULT_CELL_WEIGHTS,
  type CellFacts,
  type CellScore,
  type CellWeights,
  type ConflictRule,
  type FacilityFacets,
  type MergedTicket,
} from "./services/demo";
import type {
  Phase,
  Mode,
  AppMode,
  EditingState,
  ConflictInfo,
  RulePreset,
  EditableTicket,
  RunResult,
  RunStatus,
  WorkArea,
} from "./types";

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0");

// Height (px) of the mobile sheet chrome (grabber + Setup|Results) that rides above
// the sheet body — must match --sheet-chrome-h in styles.css.
const SHEET_CHROME_H = 76;

export default function App() {
  const mapEl = useRef<HTMLDivElement>(null);
  const ctrl = useRef<MapController | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [err, setErr] = useState<string>("");
  const [label, setLabel] = useState("");
  const [tickets, setTickets] = useState<MergedTicket[]>([]);
  // geoid → county name, for the drill table's jurisdiction column (read once).
  const [countyNameMap, setCountyNameMap] = useState<Map<string, string> | null>(null);
  // Per-ticket conflict counts recomputed live under the current rule (null until first
  // computed). Applied over the stored intake counts so the rule drives the picker/map.
  const [liveCounts, setLiveCounts] = useState<Map<string, number> | null>(null);
  const [appMode, setAppMode] = useState<AppMode>("assess");
  const [mapMode, setMapMode] = useState<Mode>("idle");
  const { hexOn, hexRes, toggleHex } = useHexLayer(ctrl);
  // The live conflict rule (owners that count as "ours" + statuses to exclude) and
  // the facet options that seed its chips. `rule` is null until demo_config loads.
  const [facets, setFacets] = useState<FacilityFacets | null>(null);
  const [rule, setRule] = useState<ConflictRule | null>(null);
  const [defaultRule, setDefaultRule] = useState<ConflictRule | null>(null); // config baseline, for presets
  const ruleRef = useRef<ConflictRule | null>(null);
  ruleRef.current = rule;
  const { kmzName, kmzInputRef, onKmz, clearKmz, selectImported, getImportedOverlay, restoreImported } = useKmzImport(ctrl);
  // --- H3 screening state ---------------------------------------------------
  const [cellRes, setCellRes] = useState(7);
  const [cellWeights, setCellWeights] = useState<CellWeights>(DEFAULT_CELL_WEIGHTS);
  const [cellThreshold, setCellThreshold] = useState(0);
  const [cellFacts, setCellFacts] = useState<CellFacts[] | null>(null);
  const [cellScores, setCellScores] = useState<CellScore[]>([]);
  const [drillCellId, setDrillCellId] = useState<string | null>(null);
  const cellDebounceRef = useRef<number | undefined>(undefined);
  // --- ticket create/edit (overlay CRUD) ------------------------------------
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [editConflict, setEditConflict] = useState<ConflictInfo | null>(null);
  // Live result announcements for the aria-live region.
  const [liveMsg, setLiveMsg] = useState("");
  // Persisted workspace preferences survive reloads.
  const [legendOpen, setLegendOpen] = usePersistedState("gcd.legendOpen", true);
  // Help overlay (keyboard-shortcut reference).
  const [helpOpen, setHelpOpen] = useState(false);
  // Mobile (phone) = a Maps-style bottom-sheet drawer over a full-bleed map.
  const isMobile = useIsMobile();
  const { sheetTab, sheetDetent, setSheetDetent, sheetH, onGrabDown, onGrabMove, onGrabUp, onHandleClick, selectTab } =
    useMobileSheet();
  // First-run welcome callout (dismissed flag persisted in localStorage).
  const [welcomeDismissed, setWelcomeDismissed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem("gcd.welcome.dismissed") === "1",
  );
  // Stable indirection so enableInspect (wired once on mount) always calls the latest handler.
  const onInspectRef = useRef<InspectHandler>(() => {});
  // Same indirection for the cell drill-down (pickCell is declared later; onInspect reads it via ref).
  const pickCellRef = useRef<(cell: CellScore) => void>(() => {});

  // --- the analysis run (DRAFT → RUNNING → FRESH ⇄ STALE) -------------------
  // Report state: the map snapshot (captured after each run) + the analyst's
  // name/notes for the record. Name/notes belong to the work area, not to an
  // individual run: re-running keeps them so saving updates the same saved run
  // instead of renaming it to the generated default.
  const [mapShot, setMapShot] = useState<string | null>(null);
  const [reportName, setReportName] = useState("");
  const [reportNotes, setReportNotes] = useState("");
  // The area the current name/notes describe. Opening a saved run seeds this with
  // the restored area so the reset below doesn't wipe the record's own name.
  const reportFor = useRef<WorkArea | null>(null);
  const {
    area,
    setArea,
    radiusM,
    setRadius,
    status,
    stale,
    result,
    run: runAnalysis,
    recenter,
    restore,
  } = useAnalysisRun({ ctrl, rule, onAnnounce: setLiveMsg, onSnapshot: setMapShot });

  useEffect(() => {
    if (reportFor.current === area) return;
    reportFor.current = area;
    setReportName("");
    setReportNotes("");
  }, [area]);

  // --- facility evidence selection (row ↔ map sync) ---------------------------
  // The selected facility is an index into result.facilities; the drawer shows it.
  const [selectedFacility, setSelectedFacility] = useState<number | null>(null);
  // A new run (or a cleared area, which nulls the result) resets the evidence selection.
  useEffect(() => setSelectedFacility(null), [result]);
  const { hover: hoverFacility, reveal: revealFacility } = useFacilityDetail(
    ctrl,
    result?.facilities ?? [],
    selectedFacility,
  );
  // Row click flies; a map click is already there, so it just pins the highlight.
  const selectFacility = useCallback(
    (idx: number | null, fly = true) => {
      setSelectedFacility(idx);
      revealFacility(idx, fly);
    },
    [revealFacility],
  );
  const closeFacilityDrawer = useCallback(() => selectFacility(null, false), [selectFacility]);

  // Mobile sheet follows the workflow: starting a run, a landing result, or a picked
  // facility (row or map) flips the sheet to Results — but only on the CHANGE, so the
  // user can still flip back to Setup afterwards.
  const mobileAutoRef = useRef<{ result: RunResult | null; status: RunStatus; fac: number | null }>({
    result: null,
    status: "draft",
    fac: null,
  });
  useEffect(() => {
    if (!isMobile) return;
    const prev = mobileAutoRef.current;
    const runStarted = status === "running" && prev.status !== "running";
    const newResult = result !== null && result !== prev.result;
    const facPicked = selectedFacility != null && selectedFacility !== prev.fac;
    mobileAutoRef.current = { result, status, fac: selectedFacility };
    if (runStarted || newResult || facPicked) selectTab("results");
  }, [isMobile, result, status, selectedFacility, selectTab]);

  // On the phone the bottom sheet covers the lower part of the map — tell the
  // controller so fits and flyToPoint frame features in the visible strip. The
  // latest inset also lands in a ref: the boot effect below creates the controller
  // *after* this effect first runs and must apply the inset before its initial fit.
  const viewInsetRef = useRef(0);
  useEffect(() => {
    const update = () => {
      // Prefer the live CSS value — pointer:coarse grows the chrome past the constant.
      const el = document.querySelector(".app");
      const cssChrome = el ? parseFloat(getComputedStyle(el).getPropertyValue("--sheet-chrome-h")) : NaN;
      const chromeH = Number.isFinite(cssChrome) ? cssChrome : SHEET_CHROME_H;
      viewInsetRef.current = isMobile ? (sheetH / 100) * window.innerHeight + chromeH : 0;
      ctrl.current?.setViewInset(isMobile ? { bottom: viewInsetRef.current } : null);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [isMobile, sheetH, phase]);

  // The ticket's recorded intake count, for the summary's run-vs-intake comparison.
  const intakeCount = useMemo(() => {
    if (!area?.ticketId) return null;
    return tickets.find((t) => t.ticket_id === area.ticketId)?.intake_conflict_count ?? null;
  }, [area, tickets]);

  // --- boot: map + data ----------------------------------------------------
  useEffect(() => {
    if (!mapEl.current || ctrl.current) return;
    const c = new MapController(mapEl.current);
    ctrl.current = c;
    // The inset effect ran before this controller existed — apply the current
    // value now so the boot-time fitTo below already respects the bottom sheet.
    if (viewInsetRef.current > 0) c.setViewInset({ bottom: viewInsetRef.current });
    c.whenReady(async () => {
      try {
        c.initLayers();
        c.setCellsVisible(false);
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
        setTickets(await allTicketsMerged());
        void countyNames().then(setCountyNameMap);
        void listRuns().then(setSavedRuns);
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

  // --- work-area selection ---------------------------------------------------
  const setTicketArea = useCallback(
    (ticketId: string, lon: number, lat: number) => {
      ctrl.current?.hideInspectPopup();
      setArea({
        source: "ticket",
        ticketId,
        label: `Ticket ${ticketId}`,
        geometry: { type: "Point", coordinates: [lon, lat] },
      });
    },
    [setArea],
  );

  // Tear down ticket add/edit (drag marker + form) when starting something else.
  const endTicketEdit = useCallback(() => {
    const c = ctrl.current;
    c?.disableAddPoint();
    c?.removeDragMarker();
    setEditing(null);
    setEditConflict(null);
  }, []);

  const cancelMapMode = useCallback(() => {
    const c = ctrl.current;
    c?.disableBufferClick();
    c?.disableAddPoint();
    c?.stopPolygonDraw();
    setMapMode("idle");
  }, []);

  const startPointMode = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    endTicketEdit();
    c.stopPolygonDraw();
    c.hideInspectPopup();
    setMapMode("point");
    c.enableBufferClick((lng, lat) => {
      c.disableBufferClick();
      setMapMode("idle");
      setArea({
        source: "point",
        label: `Point ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        geometry: { type: "Point", coordinates: [lng, lat] },
      });
    });
  }, [endTicketEdit, setArea]);

  const startDrawMode = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    endTicketEdit();
    c.disableBufferClick();
    c.hideInspectPopup();
    setMapMode("draw");
    void c.startPolygonDraw((geom) => {
      setMapMode("idle");
      setArea({ source: "polygon", label: "Drawn area", geometry: geom });
    });
  }, [endTicketEdit, setArea]);

  const setCoordinatesArea = useCallback(
    (lng: number, lat: number) => {
      const c = ctrl.current;
      setArea({
        source: "coordinates",
        label: `Point ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        geometry: { type: "Point", coordinates: [lng, lat] },
      });
      c?.flyToPoint([lng, lat], Math.max(c.map.getZoom(), 13));
    },
    [setArea],
  );

  // While in point mode, Enter (outside a form field) places the point at the map center.
  useEffect(() => {
    if (mapMode !== "point") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      const c = ctrl.current;
      if (!c) return;
      c.disableBufferClick();
      setMapMode("idle");
      const ctr = c.map.getCenter();
      setArea({
        source: "point",
        label: `Point ${ctr.lat.toFixed(5)}, ${ctr.lng.toFixed(5)}`,
        geometry: { type: "Point", coordinates: [ctr.lng, ctr.lat] },
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mapMode, setArea]);

  const goMode = useCallback(
    (m: AppMode) => {
      const c = ctrl.current;
      c?.hideInspectPopup();
      endTicketEdit();
      cancelMapMode();
      // The contextual drawer and the assess overlays belong to Assess. Leaving for
      // Screen closes the drawer and hides the AOI/conflict lines (which otherwise
      // stay drawn — and clickable — over the hex choropleth); returning repaints them.
      if (m === "screen") {
        closeFacilityDrawer();
        c?.setAssessLayersVisible(false);
        // Portfolio reads at metro altitude. Arriving from a work-area zoom, one
        // hex fills the whole viewport — pull back to the dataset extent. Only on
        // a real mode change, and never mid-drill (the drilled hex is the context).
        if (c && appMode !== "screen" && !drillCellId && c.map.getZoom() > 12) c.goHome();
      } else {
        c?.setAssessLayersVisible(true);
      }
      setAppMode(m);
    },
    [endTicketEdit, cancelMapMode, closeFacilityDrawer, appMode, drillCellId],
  );

  // S4→T1 hand-off: open a drilled ticket as the work area. The drill id survives,
  // so the assess workspace keeps the breadcrumb back-path to this cell.
  const assessTicket = useCallback(
    (t: MergedTicket) => {
      setTicketArea(t.ticket_id, t.lon, t.lat);
      goMode("assess");
      ctrl.current?.flyToPoint([t.lon, t.lat], Math.max(ctrl.current.map.getZoom(), 13));
    },
    [setTicketArea, goMode],
  );

  const locateTicket = useCallback((t: MergedTicket) => {
    ctrl.current?.flyToPoint([t.lon, t.lat], Math.max(ctrl.current.map.getZoom(), 13));
  }, []);

  // --- feature inspection --------------------------------------------------
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
        const id = String(props.ticket_id ?? "");
        // Drilled into a cell: a ticket-dot click is the same hand-off as the row's
        // Assess button (the cell stays restorable via the breadcrumb).
        if (drillCellId) {
          const t = tickets.find((x) => x.ticket_id === id);
          if (t) {
            assessTicket(t);
            return;
          }
        }
        setTicketArea(id, lngLat.lng, lngLat.lat);
        return;
      }
      if (layerId.startsWith("kmz-")) {
        const imported = selectImported(String(props.__import_id ?? ""));
        if (!imported) return;
        c.hideInspectPopup();
        const geom =
          imported.geometry.type === "Polygon" || imported.geometry.type === "MultiPolygon"
            ? imported.geometry
            : bufferGeometry(imported.geometry, radiusM);
        setArea({ source: "import", label: `Imported: ${imported.name}`, importName: imported.name, geometry: geom });
        return;
      }
      if (layerId === "conflict-line") {
        // A conflict-line click selects the matching evidence row (and opens the
        // drawer) instead of a popup — the line and the row are the same object.
        if (!result) return;
        let idx = result.facilities.findIndex(
          (f) => props.id != null && f.id === props.id && (props.asset_ref == null || f.asset_ref === props.asset_ref),
        );
        if (idx < 0) {
          const clicked = JSON.stringify(feature.geometry ?? null);
          idx = result.facilities.findIndex((f) => f.geometry && JSON.stringify(f.geometry) === clicked);
        }
        if (idx >= 0) selectFacility(idx, false);
        return;
      }
      c.showInspectPopup(lngLat, buildPopupNode(layerId, props));
    },
    [cellScores, selectImported, setTicketArea, setArea, radiusM, result, selectFacility, drillCellId, tickets, assessTicket],
  );
  onInspectRef.current = onInspect;

  // --- saved analyses (IndexedDB) + portable project ---------------------------
  const [savedRuns, setSavedRuns] = useState<AnalysisRun[]>([]);
  // The saved record the current workspace represents (null = never saved, or the
  // area changed since — saving then creates a new record, never clobbers).
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  // --- ticket CRUD (overlay-backed; the edit form lives in the workspace) ----
  // Live conflict preview for the edit form's derived status — computed silently
  // (no map sources), so it never masquerades as an analysis result.
  const computeEditConflict = useCallback(
    async (lng: number, lat: number) => {
      const geom = bufferPoint(lng, lat, radiusM);
      const res = await conflictForAoi(geom, ruleRef.current ?? undefined);
      setEditConflict({ count: res.count, jurisdiction: null, via: `${radiusM} m live` });
    },
    [radiusM],
  );

  const beginCreateAt = useCallback(
    (lng: number, lat: number) => {
      const c = ctrl.current;
      if (!c) return;
      void computeEditConflict(lng, lat);
      c.spawnDragMarker(lng, lat, (nlng, nlat) => {
        setEditing((ed) => (ed ? { ...ed, lon: nlng, lat: nlat } : ed));
        void computeEditConflict(nlng, nlat);
      });
      setEditing({ mode: "create", source: "", work_type: "permit", priority: "low", workflow_status: "new", lon: lng, lat, lon0: lng, lat0: lat });
    },
    [computeEditConflict],
  );

  const startAddTicket = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    c.disableBufferClick();
    c.stopPolygonDraw();
    c.hideInspectPopup();
    c.removeDragMarker();
    setMapMode("addTicket");
    c.enableAddPoint((lng, lat) => {
      c.disableAddPoint();
      setMapMode("idle");
      beginCreateAt(lng, lat);
    });
  }, [beginCreateAt]);

  const startEdit = useCallback(
    (t: EditableTicket) => {
      const c = ctrl.current;
      if (!c) return;
      c.disableBufferClick();
      c.disableAddPoint(); // an in-progress "new ticket" placement would otherwise stay armed
      c.stopPolygonDraw();
      c.hideInspectPopup();
      setMapMode("idle");
      void computeEditConflict(t.lon, t.lat);
      c.spawnDragMarker(t.lon, t.lat, (nlng, nlat) => {
        setEditing((ed) => (ed ? { ...ed, lon: nlng, lat: nlat } : ed));
        void computeEditConflict(nlng, nlat);
      });
      setEditing({
        mode: "edit", ticket_id: t.ticket_id, source: t.source, work_type: t.work_type,
        priority: t.priority, workflow_status: t.workflow_status, lon: t.lon, lat: t.lat, lon0: t.lon, lat0: t.lat,
      });
    },
    [computeEditConflict],
  );

  const refreshTickets = useCallback(async (): Promise<MergedTicket[]> => {
    const c = ctrl.current;
    if (!c) return [];
    const merged = await allTicketsMerged();
    c.setData("tickets", ticketsToFC(merged));
    setTickets(merged);
    if (hexOn) c.setData("hex", await hexDensity(hexRes));
    return merged;
  }, [hexOn, hexRes]);

  const saveEditing = useCallback(async () => {
    const ed = editing;
    const c = ctrl.current;
    if (!ed || !c) return;
    if (ed.mode === "create") {
      await createTicket({
        source: ed.source, work_type: ed.work_type, priority: ed.priority, workflow_status: ed.workflow_status,
        lon: ed.lon, lat: ed.lat, radiusM,
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
      await updateTicket(ed.ticket_id, patch, radiusM);
    }
    const savedId = ed.ticket_id;
    c.removeDragMarker();
    setEditing(null);
    setEditConflict(null);
    const merged = await refreshTickets();
    // Keep the work area in sync if it referenced the saved ticket (it may have moved).
    if (area?.ticketId && area.ticketId === savedId) {
      const t = merged.find((x) => x.ticket_id === savedId);
      if (t) setArea({ ...area, geometry: { type: "Point", coordinates: [t.lon, t.lat] } });
    }
  }, [editing, refreshTickets, radiusM, area, setArea]);

  const cancelEditing = useCallback(() => {
    endTicketEdit();
    setMapMode((m) => (m === "addTicket" ? "idle" : m));
  }, [endTicketEdit]);

  const deleteEditing = useCallback(async () => {
    const ed = editing;
    const c = ctrl.current;
    if (!ed?.ticket_id || !c) return;
    await removeTicket(ed.ticket_id);
    c.removeDragMarker();
    setEditing(null);
    setEditConflict(null);
    if (area?.ticketId === ed.ticket_id) setArea(null);
    await refreshTickets();
  }, [editing, refreshTickets, area, setArea]);

  // Turn the analyzed work point into a ticket (same point, already scored by the run).
  const saveAreaAsTicket = useCallback(() => {
    const a = area;
    if (!a || a.geometry.type !== "Point" || a.ticketId) return;
    const [lng, lat] = a.geometry.coordinates;
    beginCreateAt(lng, lat);
  }, [area, beginCreateAt]);

  // --- H3 screening ----------------------------------------------------------
  // The unified live evidence view drives the picker, H3 cells, and map dots.
  const viewTickets = useMemo(() => {
    if (!liveCounts) return tickets;
    return tickets.map((t) => ({ ...t, conflict_count: liveCounts.get(t.ticket_id) ?? 0 }));
  }, [tickets, liveCounts]);

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
      c.flyToPoint(cell.centroid, Math.max(c.map.getZoom(), 11));
      c.flashCell(cell.geometry); // pulse the picked hex so it's identifiable on the map
      // Stay in screen mode: the workspace shows the breadcrumb + metrics, the tray
      // lists member tickets. The mode flip happens only via the "Assess" hand-off.
    },
    [tickets, liveCounts],
  );
  pickCellRef.current = pickCell;

  // The drilled cell as a live CellScore (null once a re-score drops it, e.g. a
  // grain change — the drill exits on grain change below, so this tracks cleanly).
  const drillCell = useMemo(
    () => (drillCellId ? (cellScores.find((c) => c.cell_id === drillCellId) ?? null) : null),
    [drillCellId, cellScores],
  );

  // Grain is the cell identity — changing it mid-drill orphans the drilled hex.
  const changeCellRes = useCallback(
    (r: number) => {
      if (drillCellId) void clearDrill();
      setCellRes(r);
    },
    [drillCellId, clearDrill],
  );

  // Keep a drilled cell visible while its ticket evidence is reviewed.
  useEffect(() => {
    const c = ctrl.current;
    if (!c) return;
    const cells = appMode === "screen" || drillCellId !== null;
    c.setCellsVisible(cells);
    c.setLayerVisible("hex-fill", cells ? false : hexOn);
  }, [appMode, hexOn, drillCellId, clearDrill]);

  // (Re)compute the per-cell FACTS when the screen mode opens or the grain changes.
  useEffect(() => {
    if (appMode !== "screen" && !drillCellId) return;
    let live = true;
    setCellFacts(null);
    void computeCellFacts(cellRes, viewTickets).then((f) => {
      if (live) setCellFacts(f);
    });
    return () => {
      live = false;
    };
  }, [appMode, drillCellId, cellRes, viewTickets]);

  // Re-score (OPINIONS: weights/norm) whenever the facts or weights settle → repaint.
  useEffect(() => {
    const c = ctrl.current;
    if ((appMode !== "screen" && !drillCellId) || !c || !cellFacts) return;
    window.clearTimeout(cellDebounceRef.current);
    cellDebounceRef.current = window.setTimeout(() => {
      const scores = scoreCells(cellFacts, cellWeights);
      setCellScores(scores);
      c.setData("cells", cellsToFC(scores));
      c.setCellThreshold(cellThreshold);
    }, 60);
    return () => window.clearTimeout(cellDebounceRef.current);
    // cellThreshold intentionally omitted — it has its own paint-only effect below.
  }, [appMode, drillCellId, cellFacts, cellWeights]); // eslint-disable-line react-hooks/exhaustive-deps

  // Threshold is a paint-only change (dim below-threshold cells) — no re-score.
  useEffect(() => {
    if (appMode === "screen") ctrl.current?.setCellThreshold(cellThreshold);
  }, [cellThreshold, appMode]);

  // --- live rule: recolor + per-ticket recount --------------------------------
  // Recolor the facilities when the rule changes (the facilities are facts; the rule
  // is the tunable opinion over them). Result staleness is the run hook's job.
  useEffect(() => {
    const c = ctrl.current;
    if (!c || !rule) return;
    c.setRuleStyle(rule.selfOwners);
  }, [rule]);

  // Recompute every ticket's conflict count under the live rule (debounced), so the
  // picker pills and map dots move when the rule changes.
  useEffect(() => {
    if (!rule) return;
    const id = setTimeout(() => {
      void liveTicketConflictCounts(tickets, rule)
        .then(setLiveCounts)
        .catch((e) => console.warn("live conflict recompute failed", e));
    }, 200);
    return () => clearTimeout(id);
  }, [rule, tickets]);

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

  // --- saved analyses + portable project ---------------------------------------
  const refreshSavedRuns = useCallback(async () => setSavedRuns(await listRuns()), []);

  // Save the current workspace as a run. Re-saving the same opened run updates it;
  // if the area changed since the open, this becomes a new record instead of
  // silently overwriting the old analysis.
  const saveCurrentRun = useCallback(async () => {
    if (!area || !rule) return;
    const now = new Date().toISOString();
    const opened = activeRunId ? savedRuns.find((r) => r.id === activeRunId) : undefined;
    const sameArea =
      opened && JSON.stringify(opened.area.geometry) === JSON.stringify(area.geometry);
    const presetName = presets.find(
      (p) => sameSet(p.rule.selfOwners, rule.selfOwners) && sameSet(p.rule.excludedStatuses, rule.excludedStatuses),
    )?.name;
    const run: AnalysisRun = {
      id: sameArea ? opened.id : newRunId(),
      name: reportName.trim() || defaultRunName(
        { source: area.source, ticketId: area.ticketId, importName: area.importName, geometry: area.geometry },
        radiusM,
      ),
      notes: reportNotes,
      createdAt: sameArea ? opened.createdAt : now,
      updatedAt: now,
      area: { source: area.source, ticketId: area.ticketId, importName: area.importName, geometry: area.geometry },
      buffer: { radiusM },
      rule,
      rulePresetName: presetName,
      layers: { hexOn, importedOverlay: getImportedOverlay() },
      result: result ?? null,
    };
    const ok = await putRun(run);
    if (ok) setActiveRunId(run.id);
    await refreshSavedRuns();
    setLiveMsg(ok ? `Saved “${run.name}”.` : "Saving is unavailable in this browser session.");
  }, [area, rule, radiusM, result, reportName, reportNotes, presets, activeRunId, savedRuns, hexOn, getImportedOverlay, refreshSavedRuns]);

  // Re-open a saved run: rule + inputs + result snapshot, no queries needed.
  const openRun = useCallback(
    (r: AnalysisRun) => {
      endTicketEdit();
      cancelMapMode();
      setRule(r.rule);
      const wa = workAreaOf(r.area);
      reportFor.current = wa;
      setReportName(r.name);
      setReportNotes(r.notes);
      if (r.layers.hexOn !== hexOn) void toggleHex();
      if (r.layers.importedOverlay) restoreImported(r.layers.importedOverlay.name, r.layers.importedOverlay.features);
      else clearKmz();
      restore(wa, r.buffer.radiusM, r.result);
      setActiveRunId(r.id);
      goMode("assess");
      setLiveMsg(`Opened “${r.name}”${r.result ? "" : " — a draft; run it to see results"}.`);
    },
    [endTicketEdit, cancelMapMode, hexOn, toggleHex, restoreImported, clearKmz, restore, goMode],
  );

  const renameSavedRun = useCallback(
    async (id: string, name: string) => {
      if (await renameRun(id, name)) {
        if (id === activeRunId) setReportName(name);
        await refreshSavedRuns();
      }
    },
    [activeRunId, refreshSavedRuns],
  );

  const deleteSavedRun = useCallback(
    async (id: string) => {
      if (await deleteRun(id)) {
        if (id === activeRunId) setActiveRunId(null);
        await refreshSavedRuns();
      }
    },
    [activeRunId, refreshSavedRuns],
  );

  // Open a portable project file: validate, confirm the merge (existing runs are
  // updated only when the file is newer — never deleted), then refresh everything.
  const importProject = useCallback(
    async (file: File) => {
      try {
        const project = parseProject(await file.text());
        const overlap = project.runs.filter((r) => savedRuns.some((l) => l.id === r.id)).length;
        const msg =
          `Import ${project.runs.length} saved run${project.runs.length === 1 ? "" : "s"} from “${file.name}”?` +
          (overlap ? `\n\n${overlap} already exist${overlap === 1 ? "s" : ""} locally and will be updated only where the file is newer.` : "") +
          `\nLocal runs are never deleted by an import.`;
        if (!window.confirm(msg)) return;
        const summary = await mergeProject(project, savedRuns);
        await refreshSavedRuns();
        await refreshTickets(); // the project's ticket overlay merged too
        setLiveMsg(
          `Project imported: ${summary.runsAdded} run${summary.runsAdded === 1 ? "" : "s"} added, ` +
          `${summary.runsUpdated} updated, ${summary.tickets.added} ticket${summary.tickets.added === 1 ? "" : "s"} merged.`,
        );
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      }
    },
    [savedRuns, refreshSavedRuns, refreshTickets],
  );

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

  const drilledViewTickets = useMemo(() => {
    if (!drillCellId) return viewTickets;
    const ids = new Set(cellScores.find((c) => c.cell_id === drillCellId)?.ticket_ids ?? []);
    return viewTickets.filter((t) => ids.has(t.ticket_id));
  }, [viewTickets, drillCellId, cellScores]);

  // Ticket search/filter state + derived option lists and the filtered, date-sorted list.
  const filters = useTicketFilters(drilledViewTickets, tickets);

  // Push the live-rule ticket counts to the map dots (assess mode, not while drilled
  // into a cell — the drill sets its own subset).
  useEffect(() => {
    const c = ctrl.current;
    if (!c || !liveCounts || appMode !== "assess" || drillCellId) return;
    c.setData("tickets", ticketsToFC(viewTickets));
  }, [viewTickets, liveCounts, appMode, drillCellId]);

  // --- first-run example ------------------------------------------------------
  const dismissWelcome = useCallback(() => {
    setWelcomeDismissed(true);
    window.localStorage.setItem("gcd.welcome.dismissed", "1");
  }, []);

  const runExample = useCallback(() => {
    dismissWelcome();
    const t = viewTickets.find((x) => x.conflict_count > 0) ?? viewTickets[0];
    if (!t) return;
    void runAnalysis({
      source: "ticket",
      ticketId: t.ticket_id,
      label: `Ticket ${t.ticket_id}`,
      geometry: { type: "Point", coordinates: [t.lon, t.lat] },
    });
  }, [viewTickets, runAnalysis, dismissWelcome]);

  // --- global keyboard shortcuts ----------------------------------------------
  useKeyboardShortcuts({
    editing,
    mapMode,
    drawerOpen: selectedFacility != null,
    closeDrawer: closeFacilityDrawer,
    cancelEditing,
    cancelMapMode,
    isMobile,
    sheetDetent,
    setSheetDetent,
    helpOpen,
    setHelpOpen,
    appMode,
    goMode,
    startPoint: startPointMode,
    startDraw: startDrawMode,
    startAddTicket,
  });

  // Does the buffer distance still reach the analysis? Only for a Point area —
  // aoiOf buffers those at run time and passes polygons through verbatim. Note an
  // imported point/line is buffered when it is SELECTED (see onInspect), so by the
  // time it is the work area it is a polygon and the distance no longer moves it.
  const bufferApplies = area?.geometry.type === "Point";

  // --- mobile sheet status line (collapsed detent) ------------------------------
  const statusLine =
    appMode === "screen"
      ? `Screen · ${cellScores.length.toLocaleString()} cells · r${cellRes}`
      : result
        ? result.conflictCount > 0
          ? `⚠ ${result.conflictCount} conflicts · ${result.jurisdiction ?? "—"}`
          : `✓ No conflicts · ${result.jurisdiction ?? "—"}`
        : area
          ? // the distance only belongs in the line when it is part of the configuration
            `Assess · ${area.label}${bufferApplies ? ` · ${radiusM} m` : ""}`
          : "Assess · pick a ticket or place a point";

  const canSaveAsTicket = !!(area && area.geometry.type === "Point" && !area.ticketId && result && !editing);

  // First-run callout: only while there is nothing to look at yet, and only until dismissed.
  const showWelcome = phase === "ready" && !area && !result && !welcomeDismissed;

  return (
    <div
      className={`app${isMobile ? ` mobile sheet-${sheetDetent}` : ""}`}
      data-sheet={isMobile ? sheetTab : undefined}
      style={isMobile ? ({ "--sheet-hn": `${sheetH}` } as CSSProperties) : undefined}
    >
      <a className="skip-link" href="#main-map">Skip to map</a>
      <div className="sr-only" role="status" aria-live="polite">{liveMsg}</div>

      <Header
        label={label}
        mode={appMode}
        onMode={goMode}
        onOpenHelp={() => setHelpOpen(true)}
        savedRuns={
          <SavedRunsMenu
            runs={savedRuns}
            activeRunId={activeRunId}
            canSave={!!area && !!rule}
            onSave={() => void saveCurrentRun()}
            onOpen={openRun}
            onRename={(id, name) => void renameSavedRun(id, name)}
            onDelete={(id) => void deleteSavedRun(id)}
            onExportProject={() => exportProject(savedRuns, label)}
            onImportProject={(f) => void importProject(f)}
          />
        }
      />

      <WorkspacePanel mode={appMode}>
        {appMode === "assess" ? (
          editing ? (
            <EditForm
              editing={editing}
              sourceOptions={filters.sourceOptions}
              radius={radiusM}
              conflict={editConflict}
              onChangeSource={(v) => setEditing((ed) => (ed ? { ...ed, source: v } : ed))}
              onChangeWorkType={(v) => setEditing((ed) => (ed ? { ...ed, work_type: v } : ed))}
              onChangePriority={(v) => setEditing((ed) => (ed ? { ...ed, priority: v } : ed))}
              onChangeWorkflowStatus={(v) => setEditing((ed) => (ed ? { ...ed, workflow_status: v } : ed))}
              onSave={() => void saveEditing()}
              onDelete={() => void deleteEditing()}
              onCancel={cancelEditing}
            />
          ) : (
            <>
              <AreaStep
                area={area}
                mapMode={mapMode}
                filters={filters}
                ticketsTotal={tickets.length}
                ticketsLoading={phase !== "ready"}
                drillCellId={drillCellId}
                importName={kmzName}
                importInputRef={kmzInputRef}
                onAreaClear={() => setArea(null)}
                onStartPoint={startPointMode}
                onStartDraw={startDrawMode}
                onCoordinates={setCoordinatesArea}
                onImportFile={(f) => void onKmz(f)}
                onSelectTicket={(t) => {
                  setTicketArea(t.ticket_id, t.lon, t.lat);
                  ctrl.current?.flyToPoint([t.lon, t.lat], 14);
                }}
                onEditTicket={startEdit}
                onNewTicket={startAddTicket}
                onExitDrill={() => {
                  void clearDrill();
                  goMode("screen");
                }}
              />
              <ConfigStep
                disabled={!area}
                radius={radiusM}
                onRadius={setRadius}
                bufferApplies={bufferApplies}
                rule={rule}
                facets={facets}
                presets={presets}
                onSelectPreset={setRule}
                onToggleOwner={toggleRuleOwner}
                onToggleExcluded={toggleRuleExcluded}
              />
              <RunButton
                status={status}
                canRun={!!area && !!rule}
                stale={stale}
                onRun={() => void runAnalysis()}
              />
            </>
          )
        ) : (
          <ScreenControls
            weights={cellWeights}
            onWeights={patchCellWeights}
            res={cellRes}
            onRes={changeCellRes}
            threshold={cellThreshold}
            onThreshold={setCellThreshold}
            drill={drillCell}
            onExitDrill={() => void clearDrill()}
          />
        )}
      </WorkspacePanel>

      <MapCanvas
        mapRef={mapEl}
        phase={phase}
        err={err}
        showWelcome={showWelcome}
        onDismissWelcome={dismissWelcome}
        onExample={runExample}
      />

      {!isMobile && result && selectedFacility != null && result.facilities[selectedFacility] && (
        <FacilityDrawer
          facility={result.facilities[selectedFacility]}
          onCenter={() => revealFacility(selectedFacility)}
          onClose={closeFacilityDrawer}
        />
      )}

      {/* Also on mobile: the density heatmap and the legend have no other entry point
          (Setup's import step covers KMZ, but nothing else surfaces those two).
          It yields to the first-run callout on a phone, though: both are pinned to the
          same top-of-map band, and below the phone breakpoint the callout is wide enough
          that this button lands on its dismiss ✕ — which would make the callout
          undismissable. Dismissing it (or setting an area) brings the button back. */}
      {phase === "ready" && !(isMobile && showWelcome) && (
        <div className="map-pop-anchor">
          <LayersPopover
            hexOn={hexOn}
            onToggleHex={toggleHex}
            kmzName={kmzName}
            onImportKmz={(f) => void onKmz(f)}
            onClearKmz={clearKmz}
            legendOpen={legendOpen}
            onToggleLegend={() => setLegendOpen((o) => !o)}
          />
        </div>
      )}

      <ResultsTray
        mode={appMode}
        status={status}
        result={result}
        stale={stale}
        area={area}
        facets={facets}
        presets={presets}
        intakeCount={intakeCount}
        canSaveAsTicket={canSaveAsTicket}
        onRecenter={recenter}
        onSaveAsTicket={saveAreaAsTicket}
        selectedFacility={selectedFacility}
        onSelectFacility={selectFacility}
        onHoverFacility={hoverFacility}
        onCenterFacility={(idx) => revealFacility(idx)}
        cellsLoading={cellFacts === null}
        cellRes={cellRes}
        cellPresetName={matchingPreset(cellWeights)?.name ?? "Custom"}
        scores={cellScores}
        activeCell={drillCellId}
        onPickCell={pickCell}
        drillCell={drillCell}
        memberTickets={drillCellId ? drilledViewTickets : []}
        countyNames={countyNameMap}
        onExitDrill={() => void clearDrill()}
        onLocateTicket={locateTicket}
        onAssessTicket={assessTicket}
        isMobile={isMobile}
        region={label}
        mapShot={mapShot}
        reportName={reportName}
        reportNotes={reportNotes}
        onReportName={setReportName}
        onReportNotes={setReportNotes}
      />

      {/* The Results sheet hides the workspace, and the tray renders nothing before a
          run — so on a phone that combination is a blank page. Say what's missing. */}
      {isMobile && sheetTab === "results" && appMode === "assess" && !result && status !== "running" && (
        <div className="tray tray-empty">
          <p className="muted">
            <strong>No analysis yet.</strong> On <strong>Setup</strong>, pick a ticket or place a point,
            set a distance, then <strong>Run analysis</strong> — the verdict and its evidence land here.
          </p>
        </div>
      )}

      {isMobile && (
        <MobileSheetChrome
          detent={sheetDetent}
          tab={sheetTab}
          statusLine={statusLine}
          onGrabDown={onGrabDown}
          onGrabMove={onGrabMove}
          onGrabUp={onGrabUp}
          onHandleClick={onHandleClick}
          onSelectTab={selectTab}
        />
      )}

      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}

      {/* Print/PDF target: hidden on screen, the only thing visible when printing. */}
      {result && (
        <div className="print-report" aria-hidden="true">
          <ReportBody
            result={result}
            area={area}
            facets={facets}
            presets={presets}
            region={label}
            mapShot={mapShot}
            name={reportName}
            notes={reportNotes}
          />
        </div>
      )}
    </div>
  );
}
