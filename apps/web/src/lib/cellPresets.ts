// Named scoring presets for portfolio screening: one-click CellWeights bundles.
// The active preset is derived by matching the live weights (any manual slider
// change in Advanced scoring falls out of every preset → "Custom").
import { DEFAULT_CELL_WEIGHTS, type CellWeights } from "../services/demo";

export interface CellPreset {
  name: string;
  blurb: string;
  weights: CellWeights;
}

export const CELL_PRESETS: CellPreset[] = [
  {
    name: "Balanced",
    blurb: "Activity + conflict rate, severity and density in support",
    weights: DEFAULT_CELL_WEIGHTS,
  },
  {
    name: "Conflict-heavy",
    blurb: "Cells where work keeps hitting infrastructure",
    weights: { demand: 0.1, rate: 0.6, severity: 0.2, infra: 0.1, norm: "z" },
  },
  {
    name: "Volume-heavy",
    blurb: "Where the work is, whatever it hits",
    weights: { demand: 0.7, rate: 0.1, severity: 0.1, infra: 0.1, norm: "z" },
  },
  {
    name: "Facility-density",
    blurb: "Crowded corridors — most infrastructure per cell",
    weights: { demand: 0.15, rate: 0.15, severity: 0.1, infra: 0.6, norm: "z" },
  },
];

// The preset whose weights exactly match the live ones (else null → "Custom").
export function matchingPreset(w: CellWeights): CellPreset | null {
  return (
    CELL_PRESETS.find(
      (p) =>
        p.weights.demand === w.demand &&
        p.weights.rate === w.rate &&
        p.weights.severity === w.severity &&
        p.weights.infra === w.infra &&
        p.weights.norm === w.norm,
    ) ?? null
  );
}
