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

  // Live dashed preview of the AOI — map-only, no queries. Fires on area/radius
  // changes; after a run this is also what re-marks the preview as "not the
  // analyzed geometry" (dashed) once the user moves the distance slider.
  useEffect(() => {
    const c = ctrl.current;
    if (!c) return;
    if (!area) {
      c.setData("aoi", EMPTY_FC);
      return;
    }
    c.setData("aoi", asFC(aoiOf(area, radiusM)));
    c.setAoiStyle("preview");
  }, [ctrl, area, radiusM]);

  // Area change → new draft: drop the old result + conflict evidence entirely.
  const setArea = useCallback(
    (next: WorkArea | null) => {
      setAreaState(next);
      setResult(null);
      setStatus("draft");
      onSnapshot?.(null);
      const c = ctrl.current;
      if (!c) return;
      c.setData("conflict", EMPTY_FC);
      c.highlightConflictFacility(null);
      if (!next) c.setData("aoi", EMPTY_FC);
    },
    [ctrl, onSnapshot],
  );

  // Distance change → live preview + staleness computed against the run snapshot:
  // changing the value marks stale, changing it BACK restores fresh (the results
  // genuinely match again). Same reason a restored run opens fresh.
  const setRadius = useCallback(
    (n: number) => {
      setRadiusM(n);
      setStatus((s) => {
        if (s !== "fresh" && s !== "stale") return s;
        return result && n === result.radiusM ? "fresh" : "stale";
      });
    },
    [result],
  );

  // Rule change → staleness against the run snapshot (see setRadius).
  useEffect(() => {
    setStatus((s) => {
      if (s !== "fresh" && s !== "stale") return s;
      return result && rule && sameRule(rule, result.rule) ? "fresh" : "stale";
    });
  }, [rule, result]);

  const run = useCallback(
    async (areaOverride?: WorkArea) => {
      const c = ctrl.current;
      const r = ruleRef.current;
      const a = areaOverride ?? area;
      if (!c || !a || !r) return;
      if (areaOverride) setAreaState(areaOverride);
      setStatus("running");
      onAnnounce("Running analysis…");
      const aoi = aoiOf(a, radiusM);
      const at = anchorOf(a);
      const via = a.geometry.type === "Point" ? `${radiusM} m buffer on ${a.label}` : a.label;
      const res = await conflictForAoi(aoi, r);
      const jur = await jurisdictionFor(at[0], at[1]);
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
      c.map.once("idle", () => onSnapshot?.(captureMapPng(c.map)));
    },
    [ctrl, area, radiusM, onAnnounce, onSnapshot],
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
  // the staleness effects compare against the restored snapshot, so it opens fresh.
  const restore = useCallback(
    (a: WorkArea, radius: number, res: RunResult | null) => {
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
        c.map.once("idle", () => onSnapshot?.(captureMapPng(c.map)));
      } else {
        c.setData("aoi", asFC(aoiOf(a, radius)));
        c.setAoiStyle("preview");
        c.setData("conflict", EMPTY_FC);
        c.fitTo(asFC(aoiOf(a, radius)), 120, 15);
        onSnapshot?.(null);
      }
    },
    [ctrl, onSnapshot],
  );

  return {
    area,
    setArea,
    radiusM,
    setRadius,
    status,
    stale: status === "stale",
    result,
    run,
    recenter,
    restore,
  };
}
