import { useCallback, type RefObject } from "react";
import type { FeatureCollection, Geometry } from "geojson";
import {
  downloadBytes,
  ticketConflictToKmz,
  KMZ_MIME,
  type ExportAssumptions,
} from "../services/export";
import type { ConflictRule } from "../services/demo";
import type { MapController } from "../map";

type LastResult = { geom: Geometry; facilities: FeatureCollection; via: string } | null;

// The client-side per-ticket KMZ export + AOI recenter. Exports bake in the active rule.
export function useExports({
  ctrl,
  lastResultRef,
  ruleRef,
  label,
}: {
  ctrl: RefObject<MapController | null>;
  lastResultRef: RefObject<LastResult>;
  ruleRef: RefObject<ConflictRule | null>;
  label: string;
}) {
  // The rule + AOI assumptions the last analysis was run under, baked into exports.
  const exportAssumptions = useCallback((): ExportAssumptions | undefined => {
    const r = ruleRef.current;
    const via = lastResultRef.current?.via ?? "AOI";
    return r ? { selfOwners: r.selfOwners, excludedStatuses: r.excludedStatuses, via, label } : undefined;
  }, [ruleRef, lastResultRef, label]);

  // Re-frame the map on the last analyzed AOI (buffer point or drawn polygon).
  const recenterAoi = useCallback(() => {
    const c = ctrl.current;
    const r = lastResultRef.current;
    if (!c || !r) return;
    c.fitTo({ type: "FeatureCollection", features: [{ type: "Feature", geometry: r.geom, properties: {} }] }, 120, 15);
  }, [ctrl, lastResultRef]);

  const exportConflictKmz = useCallback((ticket: {
    ticket_id: string; source: string; work_type: string; priority: string; workflow_status: string;
    conflict_count: number; lon: number; lat: number;
  }) => {
    const r = lastResultRef.current;
    if (!r) return;
    const assumptions = exportAssumptions();
    downloadBytes(
      `gis-conflict_ticket_${ticket.ticket_id}_${new Date().toISOString().slice(0, 10)}.kmz`,
      KMZ_MIME, ticketConflictToKmz(ticket, r.geom, r.facilities, assumptions),
    );
  }, [lastResultRef, exportAssumptions]);

  return { exportAssumptions, recenterAoi, exportConflictKmz };
}
