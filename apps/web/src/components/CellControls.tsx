import { useId } from "react";
import type { CellWeights } from "../services/demo";

interface Props {
  weights: CellWeights;
  onWeights: (patch: Partial<CellWeights>) => void;
  res: number;
  onRes: (res: number) => void;
  threshold: number;
  onThreshold: (t: number) => void;
}

// One 0..1 weight slider.
function WeightRow({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const id = useId();
  return (
    <div className="cell-w">
      <label htmlFor={id}>
        {label} <b>{value.toFixed(2)}</b>
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        aria-valuetext={value.toFixed(2)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

const RES = [6, 7, 8];

export default function CellControls({ weights, onWeights, res, onRes, threshold, onThreshold }: Props) {
  return (
    <div className="cell-controls">
      <div className="rule-lbl muted">Grain (resolution) — the MAUP lever</div>
      <div className="chip-toggles" role="group" aria-label="H3 resolution">
        {RES.map((r) => (
          <button
            key={r}
            type="button"
            className={`chip-toggle${res === r ? " on" : ""}`}
            aria-pressed={res === r}
            onClick={() => onRes(r)}
            title={r === 6 ? "coarse" : r === 7 ? "medium" : "fine"}
          >
            r{r}
          </button>
        ))}
      </div>

      <details className="cell-advanced">
        <summary>Advanced scoring controls</summary>
        <div className="rule-lbl muted">Weights (what makes a cell “hot”)</div>
        <WeightRow label="Ticket volume" value={weights.demand} onChange={(demand) => onWeights({ demand })} />
        <WeightRow label="Conflict rate" value={weights.rate} onChange={(rate) => onWeights({ rate })} />
        <WeightRow label="Mean severity" value={weights.severity} onChange={(severity) => onWeights({ severity })} />
        <WeightRow label="Facility density" value={weights.infra} onChange={(infra) => onWeights({ infra })} />
        <div className="rule-lbl muted">Normalization</div>
        <div className="chip-toggles" role="group" aria-label="Normalization method">
          {(["z", "minmax"] as const).map((n) => (
            <button key={n} type="button" className={`chip-toggle${weights.norm === n ? " on" : ""}`} aria-pressed={weights.norm === n} onClick={() => onWeights({ norm: n })} title={n === "z" ? "z-score (robust to scale)" : "min-max (0..1 per feature)"}>
              {n === "z" ? "z-score" : "min-max"}
            </button>
          ))}
        </div>
      </details>

      <div className="rule-lbl muted">
        Highlight cells scoring ≥ <b>{threshold.toFixed(2)}</b>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={threshold}
        aria-label="Score threshold"
        aria-valuetext={threshold.toFixed(2)}
        onChange={(e) => onThreshold(Number(e.target.value))}
        style={{ width: "100%" }}
      />
    </div>
  );
}
