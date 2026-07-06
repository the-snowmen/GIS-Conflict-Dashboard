import { useCallback, type MutableRefObject, type RefObject } from "react";
import type { Geometry } from "geojson";
import { lineCentroid } from "./geometry";
import { buildPopupNode } from "./popup";
import type { MapController } from "../map";
import type { ConflictFacility } from "../types";

// The conflicting-facility row interactions in the detail panel: hover pulses the line,
// leaving re-asserts the sticky (clicked) highlight, clicking flies to it + opens the popup.
// `selectedFacRef` holds the sticky selection (shared with the analysis core).
export function useFacilityDetail(
  ctrl: RefObject<MapController | null>,
  selectedFacRef: MutableRefObject<ConflictFacility | null>,
) {
  // Hover a facility row -> pulse its line on the map.
  const hoverFacility = useCallback(
    (geom: Geometry | null) => {
      ctrl.current?.highlightConflictFacility(geom);
    },
    [ctrl],
  );

  // Leave a row -> drop the pulse, but re-assert the clicked facility's steady
  // highlight if one is selected (so a click stays lit after the cursor moves off).
  const leaveFacility = useCallback(() => {
    ctrl.current?.highlightConflictFacility(selectedFacRef.current?.geometry ?? null, false);
  }, [ctrl, selectedFacRef]);

  // Click a facility row -> fly to it, keep it lit, and open its detail popup
  // (the same popup the map uses for a direct conflict-line click).
  const inspectFacility = useCallback(
    (f: ConflictFacility) => {
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
    },
    [ctrl, selectedFacRef],
  );

  return { hoverFacility, leaveFacility, inspectFacility };
}
