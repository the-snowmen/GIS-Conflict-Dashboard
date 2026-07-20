import type { RunStatus } from "../../types";

// Step 3 of the assess workspace: the single, visually dominant Run action.
// After a run, a config change turns this into a pulsing "Re-run analysis".
export default function RunButton({
  status,
  canRun,
  stale,
  onRun,
}: {
  status: RunStatus;
  canRun: boolean;
  stale: boolean;
  onRun: () => void;
}) {
  const running = status === "running";
  const label = running ? "Analyzing…" : stale ? "Re-run analysis" : "Run analysis";
  return (
    <section className="ws-step ws-run" aria-label="Step 3: run the analysis">
      <button
        type="button"
        className={`run-btn${stale ? " pulse" : ""}`}
        disabled={!canRun || running}
        onClick={onRun}
        title={canRun ? "Check the work area against the conflict rule" : "Define a work area first"}
      >
        {label}
      </button>
      {stale && (
        <p className="stale-note">
          Settings changed — the results below are from the previous configuration.
        </p>
      )}
      {!canRun && !running && (
        <p className="muted">Checks facilities inside the buffered work area against the active rule.</p>
      )}
    </section>
  );
}
