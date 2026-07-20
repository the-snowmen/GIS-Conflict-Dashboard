import { useCallback, type RefObject } from "react";
import { lineCentroid } from "./geometry";
import type { MapController } from "../map";
import type { ConflictFacility } from "../types";

// Map feedback for the facilities evidence: hovering a row pulses the facility's
// conflict line, leaving re-asserts the selected facility's steady highlight, and
// revealing (row click or drawer "center") flies to it and pins the highlight.
// Facilities are addressed by their index in the run result — stable within a run.
export function useFacilityDetail(
  ctrl: RefObject<MapController | null>,
  facilities: ConflictFacility[],
  selected: number | null,
) {
  // Hover a row → pulse its line; leave → re-assert the sticky selection (or clear).
  const hover = useCallback(
    (idx: number | null) => {
      const c = ctrl.current;
      if (!c) return;
      if (idx != null) {
        c.highlightConflictFacility(facilities[idx]?.geometry ?? null, true);
      } else {
        c.highlightConflictFacility(selected != null ? (facilities[selected]?.geometry ?? null) : null, false);
      }
    },
    [ctrl, facilities, selected],
  );

  // Reveal a facility on the map: pin the steady highlight, and fly to it unless
  // the selection already came from the map (fly = false).
  const reveal = useCallback(
    (idx: number | null, fly = true) => {
      const c = ctrl.current;
      if (!c) return;
      const f = idx != null ? facilities[idx] : undefined;
      if (!f?.geometry) {
        c.highlightConflictFacility(null);
        return;
      }
      if (fly) {
        const center = lineCentroid(f.geometry) as [number, number];
        c.map.flyTo({ center, zoom: Math.max(c.map.getZoom(), 13), duration: 600 });
      }
      c.highlightConflictFacility(f.geometry, false); // sticky (no pulse)
    },
    [ctrl, facilities],
  );

  return { hover, reveal };
}
