import type { FeatureCollection } from "geojson";
import { facilitiesToCsv } from "../../services/csv";
import {
  conflictsToGeoJson,
  conflictsToKmz,
  downloadBytes,
  downloadText,
  exportName,
  KMZ_MIME,
  type ExportAssumptions,
} from "../../services/export";
import type { FacilityFacets } from "../../services/demo";
import type { RulePreset, RunResult, WorkArea } from "../../types";
import ReportBody from "./ReportBody";

// The Report tab: name + notes for the record, the export actions (print-to-PDF,
// CSV, GeoJSON, KMZ), and a live preview of the exact document that prints.
export default function ReportTab({
  result,
  area,
  facets,
  presets,
  region,
  mapShot,
  name,
  notes,
  onName,
  onNotes,
}: {
  result: RunResult;
  area: WorkArea | null;
  facets: FacilityFacets | null;
  presets: RulePreset[];
  region: string;
  mapShot: string | null;
  name: string;
  notes: string;
  onName: (v: string) => void;
  onNotes: (v: string) => void;
}) {
  const assumptions: ExportAssumptions = {
    selfOwners: result.rule.selfOwners,
    excludedStatuses: result.rule.excludedStatuses,
    via: result.via,
    label: region,
  };

  // The run's facilities back as a FeatureCollection for the GeoJSON/KMZ builders.
  const facilitiesFC = (): FeatureCollection => ({
    type: "FeatureCollection",
    features: result.facilities
      .filter((f) => f.geometry)
      .map((f) => ({
        type: "Feature",
        geometry: f.geometry!,
        properties: {
          id: f.id,
          asset_ref: f.asset_ref,
          owner: f.owner,
          asset_type: f.asset_type,
          voltage_class: f.voltage_class,
          nominal_kv: f.nominal_kv,
          status: f.status,
          dist_m: f.dist_m != null ? Math.round(f.dist_m) : undefined,
        },
      })),
  });

  const exportCsv = () =>
    downloadText(exportName("facilities", "csv"), "text/csv", facilitiesToCsv(result.facilities));
  const exportGeoJson = () =>
    downloadText(
      exportName("analysis", "geojson"),
      "application/geo+json",
      JSON.stringify(conflictsToGeoJson(result.aoiGeometry, facilitiesFC(), assumptions), null, 2),
    );
  const exportKmz = () =>
    downloadBytes(
      exportName("analysis", "kmz"),
      KMZ_MIME,
      conflictsToKmz(result.aoiGeometry, facilitiesFC(), assumptions),
    );

  return (
    <div className="report-tab">
      <div className="report-side">
        <label className="fld">
          Analysis name
          <input
            type="text"
            value={name}
            placeholder={`${area?.label ?? "Work area"} assessment`}
            onChange={(e) => onName(e.target.value)}
          />
        </label>
        <label className="fld">
          Notes
          <textarea
            rows={3}
            value={notes}
            placeholder="Context for the reviewer — site visit, crew, follow-ups…"
            onChange={(e) => onNotes(e.target.value)}
          />
        </label>
        <div className="report-exports">
          <span className="ws-lbl">Export</span>
          <div className="report-export-row">
            <button type="button" className="btn-inline" onClick={() => window.print()}>
              ⎙ Print / PDF
            </button>
            <button type="button" className="btn-inline ghost" onClick={exportCsv}>CSV</button>
            <button type="button" className="btn-inline ghost" onClick={exportGeoJson}>GeoJSON</button>
            <button type="button" className="btn-inline ghost" onClick={exportKmz}>KMZ</button>
          </div>
          <p className="small dim">
            PDF uses the browser print dialog — the printed document matches this preview.
            GeoJSON/KMZ carry the rule assumptions with the geometry.
          </p>
        </div>
      </div>
      <div className="report-view">
        <ReportBody
          result={result}
          area={area}
          facets={facets}
          presets={presets}
          region={region}
          mapShot={mapShot}
          name={name}
          notes={notes}
        />
      </div>
    </div>
  );
}
