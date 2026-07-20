import { useRef, useState } from "react";
import Info from "./Info";
import Legend from "./Legend";

// The map-anchored layers popover: layer toggles, overlay import, and the legend,
// one click from the map they describe (replacing the old right-rail Layers tab).
export default function LayersPopover({
  hexOn,
  onToggleHex,
  kmzName,
  onImportKmz,
  onClearKmz,
  legendOpen,
  onToggleLegend,
}: {
  hexOn: boolean;
  onToggleHex: () => void;
  kmzName: string | null;
  onImportKmz: (file: File) => void;
  onClearKmz: () => void;
  legendOpen: boolean;
  onToggleLegend: () => void;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={`map-pop-btn${open ? " active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Layers, import, and legend"
        title="Layers, import, and legend"
      >
        ▤ Layers
      </button>
      {open && (
        <>
          <button
            type="button"
            className="map-pop-backdrop"
            aria-label="Close layers"
            onClick={() => setOpen(false)}
          />
          <div className="map-pop" role="dialog" aria-label="Layers, import, and legend">
            <div className="map-pop-head">
              <h2>Layers</h2>
              <button className="tp-close" onClick={() => setOpen(false)} aria-label="Close layers">✕</button>
            </div>
            <label className="layer-toggle">
              <input type="checkbox" checked={hexOn} onChange={onToggleHex} />
              <span>
                Ticket density heatmap <Info term="h3" />
                <span className="muted layer-toggle-sub">Ticket clusters binned into H3 hexes.</span>
              </span>
            </label>
            <button className="btn" onClick={() => inputRef.current?.click()}>
              ⤓ Import KML / KMZ / GeoJSON
            </button>
            <input
              ref={inputRef}
              className="sr-only" tabIndex={-1} aria-hidden="true"
              type="file" accept=".kmz,.kml,.geojson,.json"
              onClick={(e) => { e.currentTarget.value = ""; }}
              onChange={(e) => e.target.files?.[0] && onImportKmz(e.target.files[0])}
            />
            {kmzName && (
              <div className="kmz-loaded">
                <span className="muted">{kmzName} · click a feature on the map to use it as the work area</span>
                <button className="mini" onClick={onClearKmz} title="Remove the imported layer">✕ Remove</button>
              </div>
            )}
            <Legend open={legendOpen} onToggle={onToggleLegend} />
          </div>
        </>
      )}
    </>
  );
}
