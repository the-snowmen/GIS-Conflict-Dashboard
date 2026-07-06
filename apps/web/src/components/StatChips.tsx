import type { Stats } from "../services/demo";

function Chip({ n, l, tone, title }: { n: number; l: string; tone?: "danger"; title?: string }) {
  return (
    <div className={`chip${tone ? ` chip-${tone}` : ""}`} title={title}>
      <span className="chip-n">{n.toLocaleString()}</span>
      <span className="chip-l">{l}</span>
    </div>
  );
}

// The four live summary counters in the top bar.
export default function StatChips({ stats }: { stats: Stats }) {
  return (
    <div className="chips">
      <Chip n={stats.facilities} l="facilities" title="Transmission features in the region (dataset total — not the impacted count)" />
      <Chip n={stats.tickets} l="tickets" title="Work points (synthetic sample)" />
      <Chip n={stats.conflicts} l="flagged" tone={stats.conflicts > 0 ? "danger" : undefined} title="Tickets with ≥1 conflicting facility" />
      <Chip n={stats.counties.length} l="counties" title="Counties covered" />
    </div>
  );
}
