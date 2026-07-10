import type { RefObject } from "react";
import Info from "./Info";

// The Layers card: toggle the H3 density heatmap and import a KMZ/KML overlay. The hidden
// file input's ref is owned by the caller (so clearing can reset it to allow re-import).
export default function LayersCard({
  hexOn,
  onToggleHex,
  kmzName,
  onImportKmz,
  onClearKmz,
  kmzInputRef,
}: {
  hexOn: boolean;
  onToggleHex: () => void;
  kmzName: string | null;
  onImportKmz: (file: File) => void;
  onClearKmz: () => void;
  kmzInputRef: RefObject<HTMLInputElement>;
}) {
  return (
    <section className="card">
      <h2>Layers</h2>
      <button className={`btn ${hexOn ? "active" : ""}`} onClick={onToggleHex} aria-pressed={hexOn} title="Shows where tickets cluster (denser = more tickets)">
        ⬡ Density heatmap {hexOn ? "(on)" : "(off)"}
      </button>
      <p className="muted" style={{ margin: "6px 0 0" }}>
        Ticket clusters, binned into H3 <Info term="h3" /> hexes.
      </p>
      <button className="btn" style={{ marginTop: 8 }} onClick={() => kmzInputRef.current?.click()}>
        ⤓ Import KMZ / KML
      </button>
      <input
        ref={kmzInputRef}
        className="sr-only" tabIndex={-1} aria-hidden="true"
        type="file" accept=".kmz,.kml"
        onChange={(e) => e.target.files?.[0] && onImportKmz(e.target.files[0])}
      />
      {kmzName && (
        <div className="kmz-loaded">
          <span className="muted">{kmzName} · select a feature on the map to analyze it</span>
          <button className="mini" onClick={onClearKmz} title="Remove the imported layer">✕ Remove</button>
        </div>
      )}
    </section>
  );
}
