import { bufferLabel, fmtMeters } from "../../lib/geometry";
import { facilityName, facilityRelation, statusLabel } from "../../lib/facilities";
import { ruleSummary } from "../../lib/ruleSummary";
import { DISCLAIMER } from "../../services/export";
import type { FacilityFacets } from "../../services/demo";
import type { RulePreset, RunResult, WorkArea } from "../../types";

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0");

// The report document: everything a reviewer needs to trust (and re-run) the
// analysis — finding, configuration, map, itemized evidence, attribution. Rendered
// on screen inside the Report tab (.report-view, dark) and into the print area
// (.print-report, light) for PDF export. Pure markup; the two contexts style it.
export default function ReportBody({
  result,
  area,
  facets,
  presets,
  region,
  mapShot,
  name,
  notes,
}: {
  result: RunResult;
  area: WorkArea | null;
  facets: FacilityFacets | null;
  presets: RulePreset[];
  region: string;
  mapShot: string | null;
  name: string;
  notes: string;
}) {
  const rule = result.rule;
  const presetName = presets.find(
    (p) => sameSet(p.rule.selfOwners, rule.selfOwners) && sameSet(p.rule.excludedStatuses, rule.excludedStatuses),
  )?.name;
  const ranAt = new Date(result.ranAt);
  const title = name.trim() || `${area?.label ?? "Work area"} assessment`;
  // Shared with the Summary tab (bufferLabel in lib/geometry.ts) so the two views of
  // one run cannot disagree about what was buffered.
  const bufferText = bufferLabel(area, result.radiusM);
  const finding =
    result.conflictCount > 0
      ? `Conflict found — ${result.conflictCount} ${result.conflictCount === 1 ? "facility" : "facilities"} intersect the work area under the active rule.`
      : "Clear — no facilities intersect the work area under the active rule.";
  const sourceKind =
    area?.source === "ticket" ? "Existing ticket"
    : area?.source === "polygon" ? "Drawn polygon"
    : area?.source === "import" ? "Imported file"
    : area?.source === "coordinates" ? "Entered coordinates"
    : "Map point";

  return (
    <article className="rb">
      <header className="rb-head">
        <h2 className="rb-title">{title}</h2>
        <p className="rb-sub">
          Work-area conflict assessment · {region} · {ranAt.toLocaleString()}
        </p>
      </header>

      <p className={`rb-finding ${result.conflictCount > 0 ? "conflict" : "clear"}`}>{finding}</p>

      {mapShot && (
        <figure className="rb-map">
          <img src={mapShot} alt="Map of the analyzed work area and conflicting facilities" />
          <figcaption>Map at analysis time — work area, AOI, and conflicting facilities.</figcaption>
        </figure>
      )}

      <section className="rb-section">
        <h3>Configuration</h3>
        <dl className="rb-facts">
          <div><dt>Work area</dt><dd>{area?.label ?? result.via} ({sourceKind})</dd></div>
          <div><dt>Buffer</dt><dd>{bufferText}</dd></div>
          <div>
            <dt>Conflict rule</dt>
            <dd>
              {presetName ? `${presetName} — ` : ""}{ruleSummary(rule, facets)}
              <span className="rb-assump">
                Counts owners: {rule.selfOwners.join(", ") || "(none)"} · excludes statuses:{" "}
                {rule.excludedStatuses.map(statusLabel).join(", ") || "(none)"}
              </span>
            </dd>
          </div>
          <div><dt>Jurisdiction</dt><dd>{result.jurisdiction ?? "Outside the coverage area"}</dd></div>
        </dl>
      </section>

      <section className="rb-section">
        <h3>Conflicting facilities ({result.conflictCount})</h3>
        {result.facilities.length ? (
          <table className="rb-table">
            <thead>
              <tr><th>#</th><th>Facility</th><th>Owner</th><th>Status</th><th>Relation</th><th>Distance</th></tr>
            </thead>
            <tbody>
              {result.facilities.map((f, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{facilityName(f)}{f.id != null ? ` #${f.id}` : ""}</td>
                  <td>{f.owner ?? "—"}</td>
                  <td>{f.status ? statusLabel(f.status) : "—"}</td>
                  <td>{facilityRelation(f)}</td>
                  <td>{f.dist_m != null ? `≈ ${fmtMeters(f.dist_m)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="rb-none">No conflicting facilities under the active rule.</p>
        )}
      </section>

      {notes.trim() && (
        <section className="rb-section">
          <h3>Notes</h3>
          <p className="rb-notes">{notes}</p>
        </section>
      )}

      <footer className="rb-foot">
        <p>{DISCLAIMER}</p>
        <p>
          Basemap © OpenStreetMap contributors © CARTO · Infrastructure: US EIA transmission
          lines · Jurisdictions: US Census counties · Work tickets and AOIs are synthetic demo
          records. Distances are screening-grade (≈, from the area anchor); the buffer is geodesic.
        </p>
      </footer>
    </article>
  );
}
