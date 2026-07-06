import type { ConflictRule, FacilityFacets } from "../services/demo";
import type { RulePreset } from "../types";
import Info from "./Info";

// Set equality (order-independent) — used to highlight the active preset. The "\0"
// separator can't appear in owner/status values, so distinct sets never collide.
const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0");

const matchesPreset = (r: ConflictRule, p: RulePreset): boolean =>
  sameSet(r.selfOwners, p.rule.selfOwners) && sameSet(r.excludedStatuses, p.rule.excludedStatuses);

// The tunable conflict rule: one-click presets + owner/status chip toggles. The facilities
// are fixed facts; this rule is the opinion applied over them — changing it re-runs the analysis.
export default function RuleCard({
  facets,
  rule,
  presets,
  onSelectPreset,
  onToggleOwner,
  onToggleExcluded,
}: {
  facets: FacilityFacets | null;
  rule: ConflictRule | null;
  presets: RulePreset[];
  onSelectPreset: (rule: ConflictRule) => void;
  onToggleOwner: (o: string) => void;
  onToggleExcluded: (s: string) => void;
}) {
  if (!facets || !rule) return <p className="muted">Loading rule options…</p>;
  return (
    <section className="card">
      <h2>
        Conflict rule
        <Info title="Which facilities count as a conflict. The facilities are fixed facts; this rule is the tunable opinion applied over them — change it and the analysis re-runs live." />
      </h2>
      {presets.length > 0 && (
        <div className="rule-presets" role="group" aria-label="Conflict rule presets">
          {presets.map((p) => {
            const active = matchesPreset(rule, p);
            return (
              <button
                key={p.name}
                type="button"
                className={`preset${active ? " active" : ""}`}
                aria-pressed={active}
                title={p.hint}
                onClick={() => onSelectPreset(p.rule)}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="rule-lbl muted">Your network — owners that count</div>
      <div className="chip-toggles" role="group" aria-label="Owners that count as your network">
        {facets.owners.map((o) => {
          const on = rule.selfOwners.includes(o);
          return (
            <button
              key={o}
              type="button"
              className={`chip-toggle${on ? " on" : ""}`}
              aria-pressed={on}
              onClick={() => onToggleOwner(o)}
              title={on ? "Counts as your network — click to drop" : "Ignored — click to include"}
            >
              {o}
            </button>
          );
        })}
      </div>
      <div className="rule-lbl muted">Exclude facilities with status</div>
      <div className="chip-toggles" role="group" aria-label="Facility statuses to exclude">
        {facets.statuses.map((s) => {
          const on = rule.excludedStatuses.includes(s);
          return (
            <button
              key={s}
              type="button"
              className={`chip-toggle${on ? " on" : ""}`}
              aria-pressed={on}
              onClick={() => onToggleExcluded(s)}
              title={on ? "Excluded from conflicts — click to include" : "Counts as a conflict — click to exclude"}
            >
              {s}
            </button>
          );
        })}
      </div>
      <p className="muted" style={{ margin: "8px 0 0" }}>
        A conflict = a facility owned by your network, not in an excluded status, inside the AOI.
      </p>
    </section>
  );
}
