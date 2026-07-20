// Snapshot the map canvas as a PNG data URL for the report. The map runs with
// preserveDrawingBuffer so this works outside a render callback; the basemap
// (CARTO raster, CORS-clean) keeps the canvas untainted. If either assumption
// breaks (tainted canvas throws), the report ships without an image instead of failing.
import type { Map as MlMap } from "maplibre-gl";

export function captureMapPng(map: MlMap): string | null {
  try {
    return map.getCanvas().toDataURL("image/png");
  } catch {
    return null;
  }
}
