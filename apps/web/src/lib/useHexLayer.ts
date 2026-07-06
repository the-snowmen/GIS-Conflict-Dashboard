import { useCallback, useState, type RefObject } from "react";
import { hexDensity } from "../services/demo";
import type { MapController } from "../map";

// The H3 density-heatmap layer toggle. Owns the on/off + resolution; the caller reads
// `hexOn`/`hexRes` so the cell-visibility effect and ticket refresh stay in sync.
export function useHexLayer(ctrl: RefObject<MapController | null>) {
  const [hexOn, setHexOn] = useState(false);
  const [hexRes] = useState(7);

  const toggleHex = useCallback(async () => {
    const c = ctrl.current;
    if (!c) return;
    const next = !hexOn;
    setHexOn(next);
    if (next) c.setData("hex", await hexDensity(hexRes));
    c.setLayerVisible("hex-fill", next);
  }, [ctrl, hexOn, hexRes]);

  return { hexOn, hexRes, toggleHex };
}
