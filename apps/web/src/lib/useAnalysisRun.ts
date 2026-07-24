import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { FeatureCollection, Geometry, Position } from "geojson";
import type { MapController } from "../map";
import {
  bufferPoint,
  conflictForAoi,
  jurisdictionFor,
  type ConflictRule,
} from "../services/demo";
import { distPointToGeomM, polygonCentroid } from "./geometry";
import { captureMapPng } from "./captureMap";
import type { ConflictFacility, RunResult, RunStatus, WorkArea } from "../types";

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

// By the time something becomes a WorkArea its geometry is a Point or a
// Polygon/MultiPolygon (imported lines are buffered at selection time).
function anchorOf(area: WorkArea): Position {
  return area.geometry.type === "Point" ? area.geometry.coordinates : polygonCentroid(area.geometry);
}

// The AOI actually analyzed: points get a geodesic buffer; polygons pass through.
function aoiOf(area: WorkArea, radiusM: number): Geometry {
  return area.geometry.type === "Point"
    ? bufferPoint(area.geometry.coordinates[0], area.geometry.coordinates[1], radiusM)
    : area.geometry;
}

function asFC(geom: Geometry): FeatureCollection {
  return { type: "FeatureCollection", features: [{ type: "Feature", geometry: geom, properties: {} }] };
}

// The conflict evidence back as a FeatureCollection (restore path — no DuckDB needed).
function facilitiesFC(facilities: ConflictFacility[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: facilities
      .filter((f) => f.geometry)
      .map((f) => ({ type: "Feature", geometry: f.geometry!, properties: { id: f.id, asset_ref: f.asset_ref } })),
  };
}

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0");
const sameRule = (a: ConflictRule, b: ConflictRule): boolean =>
  sameSet(a.selfOwners, b.selfOwners) && sameSet(a.excludedStatuses, b.excludedStatuses);

// Is the AOI implied by the current inputs still the geometry the run analyzed?
// A non-null result always belongs to the current area — every entry point that
// swaps the area (setArea, restore, a run started on an area of its own) clears or
// replaces it — so only the distance can pull them apart, and only for a point,
// since a polygon passes through aoiOf untouched. The rule is not geometry:
// changing it makes the numbers stale, not the outline.
const matchesAnalyzed = (area: WorkArea, radiusM: number, result: RunResult): boolean =>
  area.geometry.type !== "Point" || radiusM === result.radiusM;

/**
 * The analysis-run state machine: DRAFT → RUNNING → FRESH ⇄ STALE.
 *
 * The map preview of the AOI updates live and free (geodesic buffer is synchronous
 * geokit work; no queries), but the conflict SQL + jurisdiction query run only on
 * an explicit run(). After a run, distance/rule changes mark the result STALE
 * (results remain visible, from the previous configuration); an area change starts
 * a new draft (evidence for a different area would be misleading).
 */
export function useAnalysisRun({
  ctrl,
  rule,
  onAnnounce,
  onSnapshot,
}: {
  ctrl: RefObject<MapController | null>;
  rule: ConflictRule | null;
  onAnnounce: (msg: string) => void;
  // Report map image: refreshed after each run (once the map settles), cleared on
  // a new area. Null when the canvas can't be captured (tainted/unavailable).
  onSnapshot?: (dataUrl: string | null) => void;
}) {
  const [area, setAreaState] = useState<WorkArea | null>(null);
  const [radiusM, setRadiusM] = useState(100);
  const [status, setStatus] = useState<RunStatus>("draft");
  const [result, setResult] = useState<RunResult | null>(null);
  const ruleRef = useRef(rule);
  ruleRef.current = rule;

  // Live preview of the AOI — map-only, no queries. Fires on area/radius/result
  // changes. The dash is a claim ("live preview, not yet analyzed" — setAoiStyle in
  // map.ts), so it may only be painted over an outline no run has analyzed: while a
  // result still describes the current geometry (a run that just landed, or one
  // restored from a saved run) this repaints that geometry solid instead. Moving the
  // distance slider on a point is what genuinely makes the outline a preview again.
  useEffect(() => {
    const c = ctrl.current;
    if (!c) return;
    if (!area) {
      c.setData("aoi", EMPTY_FC);
      return;
    }
    if (result && matchesAnalyzed(area, radiusM, result)) {
      c.setData("aoi", asFC(result.aoiGeometry));
      c.setAoiStyle("ran");
      return;
    }
    c.setData("aoi", asFC(aoiOf(area, radiusM)));
    c.setAoiStyle("preview");
  }, [ctrl, area, radiusM, result]);

  // Run generation. A run awaits two queries, and the area can be swapped (or another
  // run started) while they're in flight; the loser must not write anything — result,
  // status, map layers or snapshot — over whatever replaced it. Bumped by every entry
  // point that invalidates a run in progress; each run re-checks it after its awaits.
  const runSeq = useRef(0);

  // The report snapshot is taken on the next map idle. Only one may ever be pending:
  // a superseded run's idle would otherwise attach its image to the current report.
  const pendingCapture = useRef<(() => void) | null>(null);
  const cancelCapture = useCallback(() => {
    const c = ctrl.current;
    if (c && pendingCapture.current) c.map.off("idle", pendingCapture.current);
    pendingCapture.current = null;
  }, [ctrl]);
  const captureOnIdle = useCallback(
    (c: MapController) => {
      cancelCapture();
      const handler = () => {
        pendingCapture.current = null;
        onSnapshot?.(captureMapPng(c.map));
      };
      pendingCapture.current = handler;
      c.map.once("idle", handler);
    },
    [cancelCapture, onSnapshot],
  );

  // Area change → new draft: drop the old result + conflict evidence entirely.
  const setArea = useCallback(
    (next: WorkArea | null) => {
      runSeq.current += 1; // any run still in flight was for the old area
      setAreaState(next);
      setResult(null);
      setStatus("draft");
      cancelCapture();
      onSnapshot?.(null);
      const c = ctrl.current;
      if (!c) return;
      c.setData("conflict", EMPTY_FC);
      c.highlightConflictFacility(null);
      if (!next) c.setData("aoi", EMPTY_FC);
    },
    [ctrl, onSnapshot, cancelCapture],
  );

  // Staleness, computed in one place against the run snapshot: changing the distance
  // or the rule marks stale, changing it BACK restores fresh (the results genuinely
  // match again), and a restored run opens fresh for the same reason. Running on the
  // result landing as well as on the inputs is what keeps the two honest with each
  // other: the distance slider and rule chips stay live during a run, so a change made
  // while the queries were in flight has to re-mark the arriving result stale instead
  // of letting it announce itself as fresh against inputs it never saw.
  useEffect(() => {
    setStatus((s) => {
      if (s !== "fresh" && s !== "stale") return s;
      const matches = !!result && !!rule && sameRule(rule, result.rule) && radiusM === result.radiusM;
      return matches ? "fresh" : "stale";
    });
  }, [rule, radiusM, result]);

  const run = useCallback(
    async (areaOverride?: WorkArea) => {
      const c = ctrl.current;
      const r = ruleRef.current;
      const a = areaOverride ?? area;
      if (!c || !a || !r) return;
      const seq = (runSeq.current += 1);
      if (areaOverride) {
        // A run that brings its own area replaces whatever was under assessment, so it
        // clears the old result and evidence exactly as setArea does. Leaving them
        // would strand a result on an area it never described — which matchesAnalyzed
        // could then paint as this area's analyzed outline.
        setAreaState(areaOverride);
        setResult(null);
        c.setData("conflict", EMPTY_FC);
        c.highlightConflictFacility(null);
        onSnapshot?.(null);
      }
      setStatus("running");
      cancelCapture(); // the previous run's snapshot is no longer the report's
      // The previous run's pinned facility highlight is no longer evidence — drop it
      // so a re-run can't strand a bright line on a facility this run may not flag.
      c.highlightConflictFacility(null);
      onAnnounce("Running analysis…");
      const aoi = aoiOf(a, radiusM);
      const at = anchorOf(a);
      const via = a.geometry.type === "Point" ? `${radiusM} m buffer on ${a.label}` : a.label;
      try {
        const res = await conflictForAoi(aoi, r);
        const jur = await jurisdictionFor(at[0], at[1]);
        // Superseded while the queries ran: the area this evidence describes is no
        // longer the one on screen, so this run gets to change nothing at all.
        if (seq !== runSeq.current) return;
        const facilities: ConflictFacility[] = res.facilities.features
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
              geometry: f.geometry ?? undefined,
              dist_m: f.geometry ? distPointToGeomM(at, f.geometry) : undefined,
            };
          })
          // Nearest conflicting facility first — the itemized "why", ordered by proximity.
          .sort((x, y) => (x.dist_m ?? Infinity) - (y.dist_m ?? Infinity));
        c.setData("aoi", asFC(aoi));
        c.setAoiStyle("ran");
        c.setData("conflict", res.facilities);
        setResult({
          ranAt: new Date().toISOString(),
          aoiGeometry: aoi,
          conflictCount: res.count,
          jurisdiction: jur,
          facilities,
          via,
          radiusM,
          rule: r,
        });
        setStatus("fresh");
        const where = jur ? `in ${jur}` : "outside the coverage area";
        onAnnounce(
          res.count > 0
            ? `Analysis complete: ${res.count} facility conflict${res.count === 1 ? "" : "s"} ${where}.`
            : `Analysis complete: no conflicts ${where}.`,
        );
        // maxZoom keeps a small buffer from slamming the view to a deep-zoom empty void.
        c.fitTo(asFC(aoi), 120, 15);
        // Report map image: capture once the framed view (AOI + conflict lines) settles.
        captureOnIdle(c);
      } catch (e) {
        // A failed query (dropped connection, DuckDB error) must not strand the UI in
        // RUNNING forever: surface an error state the user can retry from. A superseded
        // run stays silent — its failure is irrelevant to whatever replaced it.
        if (seq !== runSeq.current) return;
        console.error("[run] analysis failed:", e);
        setStatus("error");
        onAnnounce("Analysis failed — please try running it again.");
      }
    },
    [ctrl, area, radiusM, onAnnounce, onSnapshot, cancelCapture, captureOnIdle],
  );

  // Re-frame the map on the analyzed AOI.
  const recenter = useCallback(() => {
    const c = ctrl.current;
    if (!c || !result) return;
    c.fitTo(asFC(result.aoiGeometry), 120, 15);
  }, [ctrl, result]);

  // Re-open a saved run: inputs + result snapshot straight into state and onto the
  // map, with no queries (the saved evidence renders standalone; the user can
  // re-run against live data from there). The caller sets the rule state itself —
  // the staleness effect compares the restored inputs against the restored snapshot,
  // so it opens fresh (or stale, for a run that was already stale when it was saved).
  const restore = useCallback(
    (a: WorkArea, radius: number, res: RunResult | null) => {
      runSeq.current += 1; // the saved run replaces anything still in flight
      setAreaState(a);
      setRadiusM(radius);
      setResult(res);
      setStatus(res ? "fresh" : "draft");
      const c = ctrl.current;
      if (!c) return;
      if (res) {
        c.setData("aoi", asFC(res.aoiGeometry));
        c.setAoiStyle("ran");
        c.setData("conflict", facilitiesFC(res.facilities));
        c.fitTo(asFC(res.aoiGeometry), 120, 15);
        captureOnIdle(c);
      } else {
        c.setData("aoi", asFC(aoiOf(a, radius)));
        c.setAoiStyle("preview");
        c.setData("conflict", EMPTY_FC);
        c.fitTo(asFC(aoiOf(a, radius)), 120, 15);
        cancelCapture();
        onSnapshot?.(null);
      }
    },
    [ctrl, onSnapshot, cancelCapture, captureOnIdle],
  );

  return {
    area,
    setArea,
    radiusM,
    setRadius: setRadiusM,
    status,
    stale: status === "stale",
    result,
    run,
    recenter,
    restore,
  };
}
