import type { AppMode } from "../types";

// Top-level app mode tabs: Assess work area vs Screen portfolio. Named for the
// outcome (what you get done), not the implementation (tickets / H3 cells).
export default function ModeTabs({
  mode,
  onMode,
}: {
  mode: AppMode;
  onMode: (m: AppMode) => void;
}) {
  return (
    <div className="mode-seg" role="group" aria-label="Application mode">
      <button
        type="button"
        className={`mode-btn ${mode === "assess" ? "active" : ""}`}
        aria-pressed={mode === "assess"}
        onClick={() => onMode("assess")}
      >
        Assess work area
      </button>
      <button
        type="button"
        className={`mode-btn ${mode === "screen" ? "active" : ""}`}
        aria-pressed={mode === "screen"}
        onClick={() => onMode("screen")}
      >
        Screen portfolio
      </button>
    </div>
  );
}
