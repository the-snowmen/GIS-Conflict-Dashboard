import Info from "../Info";
import { ruleSummary } from "../../lib/ruleSummary";
import type { ConflictRule, FacilityFacets } from "../../services/demo";
import type { RulePreset } from "../../types";

// Set equality (order-independent) — used to highlight the active preset. The "\0"
// separator can't appear in owner/status values, so distinct sets never collide.
const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0");

const matchesPreset = (r: ConflictRule, p: RulePreset): boolean =>
  sameSet(r.selfOwners, p.rule.selfOwners) && sameSet(r.excludedStatuses, p.rule.excludedStatuses);

const DISTANCE_PRESETS = [50, 100, 250, 500];

// Step 2 of the assess workspace: buffer distance + the conflict rule. The distance
// previews live on the map; the rule shows a plain-language summary; owner/status
// chip editing stays behind the Advanced disclosure.
export default function ConfigStep({
  disabled,
  radius,
  onRadius,
  rule,
  facets,
  presets,
  onSelectPreset,
  onToggleOwner,
  onToggleExcluded,
}: {
  disabled: boolean;
  radius: number;
  onRadius: (n: number) => void;
  rule: ConflictRule | null;
  facets: FacilityFacets | null;
  presets: RulePreset[];
  onSelectPreset: (rule: ConflictRule) => void;
  onToggleOwner: (o: string) => void;
  onToggleExcluded: (s: string) => void;
}) {
  return (
    <section className={`ws-step${disabled ? " ws-disabled" : ""}`} aria-label="Step 2: distance and conflict rule">
      <header className="ws-step-head">
        <span className="ws-num" aria-hidden>2</span>
        <h2>Distance &amp; rule</h2>
      </header>
      {disabled ? (
        <p className="muted">Define a work area first.</p>
      ) : !rule || !facets ? (
        <p className="muted">Loading rule options…</p>
      ) : (
        <>
          <label className="ws-lbl" htmlFor="radius">
            Buffer distance <Info term="buffer" />
          </label>
          <div className="dist-row">
            <input
              id="radius"
              type="range" min={25} max={500} step={25} value={radius}
              onChange={(e) => onRadius(Number(e.target.value))}
              aria-valuetext={`${radius} meters`}
            />
            <span className="dist-num">
              <input
                type="number" min={25} max={500} step={25} value={radius}
                aria-label="Buffer distance in meters"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) onRadius(Math.max(25, Math.min(500, n)));
                }}
              />
              m
            </span>
          </div>
          <div className="chip-toggles" role="group" aria-label="Distance presets">
            {DISTANCE_PRESETS.map((d) => (
              <button
                key={d}
                type="button"
                className={`chip-toggle${radius === d ? " on" : ""}`}
                aria-pressed={radius === d}
                onClick={() => onRadius(d)}
              >
                {d} m
              </button>
            ))}
          </div>

          <div className="ws-lbl">
            Conflict rule <Info title="Which facilities count as a conflict. The facilities are fixed facts; this rule is the tunable opinion applied over them — change it after a run and the results are marked out of date until you re-run." />
          </div>
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
          <p className="rule-summary">{ruleSummary(rule, facets)}</p>

          <details className="cell-advanced">
            <summary>Advanced: owners &amp; statuses</summary>
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
          </details>
        </>
      )}
    </section>
  );
}
