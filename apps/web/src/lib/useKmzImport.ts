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
  // The raw file name (kmzName is the display string) — saved runs reference it.
  const fileNameRef = useRef<string | null>(null);

  // Push the parsed features onto the map + into the lookup (shared by file
  // import and saved-run restore).
  const loadFeatures = useCallback(
    (c: MapController, displayName: string, imported: ImportedAoiFeature[], fit: boolean) => {
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
      if (fit) c.fitTo(layer, 80);
      setSelectedImportId(null);
      setKmzName(displayName);
    },
    [ctrl],
  );

  const onKmz = useCallback(async (file: File) => {
    const c = ctrl.current;
    if (!c) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    // KMZ/KML goes through geokit; GeoJSON (or a bare Feature/geometry) parses directly.
    let parsed: FeatureCollection;
    if (/\.(geojson|json)$/i.test(file.name)) {
      const raw = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      parsed =
        raw.type === "FeatureCollection"
          ? (raw as unknown as FeatureCollection)
          : raw.type === "Feature"
            ? { type: "FeatureCollection", features: [raw as unknown as Feature] }
            : { type: "FeatureCollection", features: [{ type: "Feature", geometry: raw as unknown as Geometry, properties: {} }] };
    } else {
      parsed = parseKmz(bytes);
    }
    const imported = parsed.features.flatMap((f, i) => {
      if (!f.geometry) return [];
      const props = (f.properties ?? {}) as Record<string, unknown>;
      return [{ id: `import-${i}`, name: String(props.name ?? props.Name ?? `Imported feature ${i + 1}`), geometry: f.geometry }];
    });
    fileNameRef.current = file.name;
    loadFeatures(c, `${file.name} — ${imported.length} selectable features`, imported, true);
  }, [ctrl, loadFeatures]);

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
    fileNameRef.current = null;
    setSelectedImportId(null);
    setKmzName(null);
    if (kmzInputRef.current) kmzInputRef.current.value = "";
  }, [ctrl]);

  // The current import as saved-run overlay state (null when nothing is imported).
  const getImportedOverlay = useCallback((): { name: string; features: FeatureCollection } | undefined => {
    if (!importedRef.current.length || !fileNameRef.current) return undefined;
    return {
      name: fileNameRef.current,
      features: {
        type: "FeatureCollection",
        features: importedRef.current.map((f) => ({
          type: "Feature",
          geometry: f.geometry,
          properties: { name: f.name },
        })),
      },
    };
  }, []);

  // Re-load a saved run's overlay (no fit — the run's own framing wins).
  const restoreImported = useCallback(
    (name: string, fc: FeatureCollection) => {
      const c = ctrl.current;
      if (!c) return;
      const imported = fc.features.flatMap((f, i) => {
        if (!f.geometry) return [];
        const props = (f.properties ?? {}) as Record<string, unknown>;
        return [{ id: `import-${i}`, name: String(props.name ?? `Imported feature ${i + 1}`), geometry: f.geometry }];
      });
      fileNameRef.current = name;
      loadFeatures(c, `${name} — ${imported.length} selectable features`, imported, false);
    },
    [ctrl, loadFeatures],
  );

  return { kmzName, kmzInputRef, onKmz, clearKmz, selectImported, selectedImportId, getImportedOverlay, restoreImported };
}
