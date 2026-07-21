import { bufferLabel } from "../../lib/geometry";
import { ruleSummary } from "../../lib/ruleSummary";
import type { ConflictRule, FacilityFacets } from "../../services/demo";
import type { RulePreset, RunResult, WorkArea } from "../../types";

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0");

// The Summary tab: the decision answer in one sentence, then the key facts of the
// run — jurisdiction, work area, buffer, rule, timestamp — plus how this run
// compares to the ticket's recorded intake evidence.
export default function SummaryTab({
  result,
  area,
  facets,
  presets,
  intakeCount,
  canSaveAsTicket,
  onSaveAsTicket,
  onOpenFacilities,
}: {
  result: RunResult;
  area: WorkArea | null;
  facets: FacilityFacets | null;
  presets: RulePreset[];
  intakeCount: number | null;
  canSaveAsTicket: boolean;
  onSaveAsTicket: () => void;
  onOpenFacilities: () => void;
}) {
  const rule: ConflictRule = result.rule;
  const presetName = presets.find(
    (p) => sameSet(p.rule.selfOwners, rule.selfOwners) && sameSet(p.rule.excludedStatuses, rule.excludedStatuses),
  )?.name;
  const ranTime = new Date(result.ranAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const bufferText = bufferLabel(area, result.radiusM);
  const statusSentence =
    result.conflictCount > 0
      ? `Conflict found — ${result.conflictCount} ${result.conflictCount === 1 ? "facility" : "facilities"} intersect the work area under the active rule.`
      : "Clear — no facilities intersect the work area under the active rule.";

  return (
    <div className="summary">
      <p className={`summary-status ${result.conflictCount > 0 ? "conflict" : "clear"}`}>
        {result.conflictCount > 0 ? "⚠ " : "✓ "}{statusSentence}
      </p>
      <div className="summary-grid">
        <div className="summary-row"><span className="muted">Jurisdiction</span><span>{result.jurisdiction ?? "outside the coverage area"}</span></div>
        <div className="summary-row"><span className="muted">Work area</span><span>{area?.label ?? result.via}</span></div>
        <div className="summary-row"><span className="muted">Buffer</span><span>{bufferText}</span></div>
        <div className="summary-row">
          <span className="muted">Rule</span>
          <span>{presetName ? `${presetName} — ` : ""}{ruleSummary(rule, facets)}</span>
        </div>
        <div className="summary-row"><span className="muted">This run</span><span>{ranTime}</span></div>
        {intakeCount != null && (
          <div className="summary-row">
            <span className="muted">Recorded at intake</span>
            <span>
              {intakeCount > 0 ? `${intakeCount} conflict${intakeCount === 1 ? "" : "s"}` : "clear"}
              {intakeCount !== result.conflictCount && (
                <span className="muted"> — intake used a planar buffer and the recorded radius, so it can differ from this run</span>
              )}
            </span>
          </div>
        )}
      </div>
      <div className="summary-actions">
        {result.conflictCount > 0 && (
          <button type="button" className="btn-inline" onClick={onOpenFacilities}>
            Review {result.conflictCount} facilit{result.conflictCount === 1 ? "y" : "ies"} →
          </button>
        )}
        {canSaveAsTicket && (
          <button type="button" className="btn-inline ghost" onClick={onSaveAsTicket}>＋ Save as ticket</button>
        )}
      </div>
    </div>
  );
}
