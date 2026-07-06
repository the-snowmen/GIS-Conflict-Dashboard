import { useCallback, type RefObject } from "react";
import type { FeatureCollection, Geometry } from "geojson";
import {
  conflictsToKmz,
  downloadBytes,
  exportName,
  ticketsToKmz,
  KMZ_MIME,
  type ExportAssumptions,
} from "../services/export";
import type { ConflictRule, MergedTicket } from "../services/demo";
import type { MapController } from "../map";

type LastResult = { geom: Geometry; facilities: FeatureCollection; via: string } | null;

// The client-side KMZ exports + the AOI recenter. Exports bake in the rule/AOI "assumptions"
// the last analysis ran under; `filteredTickets` is the currently visible ticket set.
export function useExports({
  ctrl,
  lastResultRef,
  ruleRef,
  label,
  filteredTickets,
}: {
  ctrl: RefObject<MapController | null>;
  lastResultRef: RefObject<LastResult>;
  ruleRef: RefObject<ConflictRule | null>;
  label: string;
  filteredTickets: MergedTicket[];
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

  const exportConflictKmz = useCallback(() => {
    const r = lastResultRef.current;
    if (!r) return;
    downloadBytes(exportName("conflicts", "kmz"), KMZ_MIME, conflictsToKmz(r.geom, r.facilities, exportAssumptions()));
  }, [lastResultRef, exportAssumptions]);

  const exportTicketsKmz = useCallback(() => {
    downloadBytes(exportName("tickets", "kmz"), KMZ_MIME, ticketsToKmz(filteredTickets));
  }, [filteredTickets]);

  return { exportAssumptions, recenterAoi, exportConflictKmz, exportTicketsKmz };
}
