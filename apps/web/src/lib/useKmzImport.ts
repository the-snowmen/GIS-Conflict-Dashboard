import { useCallback, useRef, useState, type RefObject } from "react";
import { parseKmz } from "../services/demo";
import type { MapController } from "../map";

// KMZ/KML overlay import. Owns the imported-layer label + the hidden file input's ref
// (reset on clear so the same file can be re-imported).
export function useKmzImport(ctrl: RefObject<MapController | null>) {
  const [kmzName, setKmzName] = useState<string | null>(null);
  const kmzInputRef = useRef<HTMLInputElement>(null);

  const onKmz = useCallback(
    async (file: File) => {
      const c = ctrl.current;
      if (!c) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const fc = parseKmz(bytes);
      c.setData("kmz", fc);
      c.fitTo(fc, 80);
      setKmzName(`${file.name} — ${fc.features.length} features`);
    },
    [ctrl],
  );

  const clearKmz = useCallback(() => {
    ctrl.current?.setData("kmz", { type: "FeatureCollection", features: [] });
    setKmzName(null);
    if (kmzInputRef.current) kmzInputRef.current.value = ""; // allow re-importing the same file
  }, [ctrl]);

  return { kmzName, kmzInputRef, onKmz, clearKmz };
}
