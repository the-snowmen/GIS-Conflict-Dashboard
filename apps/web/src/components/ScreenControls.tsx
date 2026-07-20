import Info from "./Info";
import CellControls from "./CellControls";
import PresetCards from "./screen/PresetCards";
import type { CellScore, CellWeights } from "../services/demo";

// The screen-portfolio workspace. Undrilled: preset cards first (the stance),
// advanced scoring (grain/weights/normalization/threshold + the honesty copy)
// behind a disclosure. Drilled: the workspace collapses to the breadcrumb and a
// slim metric card for the selected cell — the choropleth stays visible behind it.
export default function ScreenControls({
  weights,
  onWeights,
  res,
  onRes,
  threshold,
  onThreshold,
  drill,
  onExitDrill,
}: {
  weights: CellWeights;
  onWeights: (p: Partial<CellWeights>) => void;
  res: number;
  onRes: (r: number) => void;
  threshold: number;
  onThreshold: (t: number) => void;
  drill: CellScore | null;
  onExitDrill: () => void;
}) {
  if (drill) {
    return (
      <section className="ws-step" aria-label="Selected cell">
        <nav className="crumb" aria-label="Breadcrumb">
          <button type="button" className="crumb-back" onClick={onExitDrill}>
            Screen portfolio
          </button>
          <span className="crumb-sep" aria-hidden>›</span>
          <span className="crumb-here">
            Cell {drill.cell_id.slice(0, 7)}… · {drill.ticket_count} ticket{drill.ticket_count === 1 ? "" : "s"}
          </span>
          <button type="button" className="crumb-exit" onClick={onExitDrill} aria-label="Exit drill">
            ✕
          </button>
        </nav>
        <div className="drill-card">
          <div className="drill-card-head">
            <strong>Index {drill.index.toFixed(2)}</strong>
            {drill.is_hotspot && <span className="hot-badge">hotspot</span>}
          </div>
          <dl className="drill-metrics">
            <div><dt>Tickets</dt><dd>{drill.ticket_count}</dd></div>
            <div><dt>Conflict rate</dt><dd>{Math.round(drill.conflict_rate * 100)}%</dd></div>
            <div><dt>Mean severity</dt><dd>{drill.mean_severity.toFixed(1)}</dd></div>
            <div><dt>Facilities</dt><dd>{drill.facility_count}</dd></div>
          </dl>
          <p className="muted small">
            Member tickets are in the results tray. “Assess” on a ticket opens it as a work area
            without losing this cell.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="ws-step" aria-label="Screening controls">
      <header className="ws-step-head">
        <span className="ws-num" aria-hidden>●</span>
        <h2>Screen portfolio</h2>
      </header>
      <p className="muted cell-honesty">
        A tunable screening <b>index</b> over H3 <Info term="h3" /> hexes ranks which cells to
        review first. Pick a stance — scores update live.
      </p>
      <PresetCards weights={weights} onSelect={(w) => onWeights(w)} />
      <details className="adv-scoring">
        <summary>Advanced scoring — grain, weights, normalization, threshold</summary>
        <p className="muted small adv-note">
          The index weights ticket volume, conflict rate, mean severity, and facility density. It
          is a screening index, not a severity measurement, and inherits every ticket caveat
          (synthetic sample). Scores shift with the weights <em>and</em> the grain (MAUP) — try
          r6 ⇄ r8.
        </p>
        <CellControls
          weights={weights}
          onWeights={onWeights}
          res={res}
          onRes={onRes}
          threshold={threshold}
          onThreshold={onThreshold}
        />
      </details>
      <div className="cell-legend">
        <div className="cell-ramp" aria-hidden />
        <div className="cell-ramp-labels"><span>lower</span><span>higher index</span></div>
        <div className="cell-legend-note">
          <i className="hot-swatch" aria-hidden /> hotspot — high ticket volume and conflict rate.
          Click a hex or a row to drill into its tickets.
        </div>
      </div>
    </section>
  );
}
