import { useCallback, useRef, useState, type RefObject } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { parseKmz } from "../services/demo";
import type { MapController } from "../map";

export interface ImportedAoiFeature {
  id: string;
  name: string;
  geometry: Geometry;
}

// KMZ/KML is session-only input. Each parsed feature gets a stable local ID so map clicks
// can select one AOI without merging the whole uploaded file into a single analysis.
export function useKmzImport(ctrl: RefObject<MapController | null>) {
  const [kmzName, setKmzName] = useState<string | null>(null);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const kmzInputRef = useRef<HTMLInputElement>(null);
  const importedRef = useRef<ImportedAoiFeature[]>([]);

  const onKmz = useCallback(async (file: File) => {
    const c = ctrl.current;
    if (!c) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseKmz(bytes);
    const imported = parsed.features.flatMap((f, i) => {
      if (!f.geometry) return [];
      const props = (f.properties ?? {}) as Record<string, unknown>;
      return [{ id: `import-${i}`, name: String(props.name ?? props.Name ?? `Imported feature ${i + 1}`), geometry: f.geometry }];
    });
    importedRef.current = imported;
    const layer: FeatureCollection = {
      type: "FeatureCollection",
      features: imported.map((f) => ({
        type: "Feature", geometry: f.geometry,
        properties: { __import_id: f.id, __import_name: f.name },
      } satisfies Feature)),
    };
    c.setData("kmz", layer);
    c.setImportedSelection(null);
    c.fitTo(layer, 80);
    setSelectedImportId(null);
    setKmzName(`${file.name} — ${imported.length} selectable features`);
  }, [ctrl]);

  const selectImported = useCallback((id: string): ImportedAoiFeature | null => {
    const found = importedRef.current.find((f) => f.id === id) ?? null;
    setSelectedImportId(found?.id ?? null);
    ctrl.current?.setImportedSelection(found?.id ?? null);
    return found;
  }, []);

  const clearKmz = useCallback(() => {
    ctrl.current?.setData("kmz", { type: "FeatureCollection", features: [] });
    ctrl.current?.setImportedSelection(null);
    importedRef.current = [];
    setSelectedImportId(null);
    setKmzName(null);
    if (kmzInputRef.current) kmzInputRef.current.value = "";
  }, [ctrl]);

  return { kmzName, kmzInputRef, onKmz, clearKmz, selectImported, selectedImportId };
}
