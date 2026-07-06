import type { Mode } from "../types";
import Info from "./Info";

// The conflict-analysis card: pick a mode (buffer a point / draw an AOI), tune the buffer
// radius, and clear the current AOI. The analysis itself is driven by the caller.
export default function AnalyzeCard({
  mode,
  onBuffer,
  onDraw,
  radius,
  onRadius,
  onClearAoi,
}: {
  mode: Mode;
  onBuffer: () => void;
  onDraw: () => void;
  radius: number;
  onRadius: (n: number) => void;
  onClearAoi: () => void;
}) {
  return (
    <section className="card">
      <h2>Conflict analysis <Info term="aoi" /></h2>
      <div className="row">
        <button
          className={`btn ${mode === "buffer" ? "active" : ""}`}
          onClick={onBuffer}
          aria-pressed={mode === "buffer"}
          title="Circle a single spot and see what infrastructure it overlaps"
        >
          ◎ Buffer point
        </button>
        <button
          className={`btn ${mode === "draw" ? "active" : ""}`}
          onClick={onDraw}
          aria-pressed={mode === "draw"}
          title="Outline an area on the map and see what it overlaps"
        >
          ✐ Draw AOI
        </button>
      </div>
      {mode === "idle" && (
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Buffer point = circle one spot · Draw AOI = outline an area — either way, see what it overlaps.
        </p>
      )}
      <label className="muted" htmlFor="radius" style={{ display: "block", margin: "10px 0 4px" }}>
        Buffer radius: <strong>{radius} m</strong> <Info term="buffer" />
      </label>
      <input
        id="radius"
        type="range" min={25} max={500} step={25} value={radius}
        onChange={(e) => onRadius(Number(e.target.value))} style={{ width: "100%" }}
      />
      <div style={{ marginTop: 8 }}>
        <button className="btn danger" onClick={onClearAoi}>Clear AOI</button>
      </div>
      {mode === "buffer" && <p className="muted">Click the map to drop a work point, or press Enter to drop one at the map center.</p>}
      {mode === "draw" && <p className="muted">Click to add vertices; double-click to finish the Area of Interest (AOI).</p>}
    </section>
  );
}
