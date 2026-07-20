import { CELL_PRESETS, matchingPreset } from "../../lib/cellPresets";
import type { CellWeights } from "../../services/demo";

// The scoring-preset cards: the front door to portfolio screening — pick a stance
// first, tune behind Advanced scoring later. The selection is derived from the
// live weights: matching a preset checks its card, anything else shows "Custom".
export default function PresetCards({
  weights,
  onSelect,
}: {
  weights: CellWeights;
  onSelect: (w: CellWeights) => void;
}) {
  const active = matchingPreset(weights);
  return (
    <div className="preset-cards" role="radiogroup" aria-label="Scoring preset">
      {CELL_PRESETS.map((p) => (
        <button
          key={p.name}
          type="button"
          role="radio"
          aria-checked={active?.name === p.name}
          className={`preset-card${active?.name === p.name ? " active" : ""}`}
          onClick={() => onSelect(p.weights)}
        >
          <span className="preset-name">{p.name}</span>
          <span className="preset-blurb">{p.blurb}</span>
        </button>
      ))}
      {!active && (
        <span className="preset-custom" title="Weights were changed in Advanced scoring">
          Custom
        </span>
      )}
    </div>
  );
}
