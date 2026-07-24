import { useState, type RefObject } from "react";
import type { MergedTicket } from "../../services/demo";
import type { Mode, WorkArea } from "../../types";
import type { useTicketFilters } from "../../lib/useTicketFilters";
import TicketPicker from "./TicketPicker";
import CoordinatesForm from "./CoordinatesForm";

type Source = "ticket" | "point" | "polygon" | "coordinates" | "import";

const SOURCES: { id: Source; label: string; hint: string }[] = [
  { id: "ticket", label: "Ticket", hint: "Search and pick an existing work ticket" },
  { id: "point", label: "Point", hint: "Click a spot on the map" },
  { id: "polygon", label: "Polygon", hint: "Outline an area on the map" },
  { id: "coordinates", label: "Coordinates", hint: "Enter a latitude and longitude" },
  { id: "import", label: "Import", hint: "Use a feature from a KML, KMZ, or GeoJSON file" },
];

// Step 1 of the assess workspace: define the work area. A compact source switch
// with a contextual sub-UI per source — not a wizard; earlier choices stay revisable.
export default function AreaStep({
  area,
  mapMode,
  filters,
  ticketsTotal,
  ticketsLoading,
  drillCellId,
  importName,
  importInputRef,
  onAreaClear,
  onStartPoint,
  onStartDraw,
  onCoordinates,
  onImportFile,
  onSelectTicket,
  onEditTicket,
  onNewTicket,
  onExitDrill,
}: {
  area: WorkArea | null;
  mapMode: Mode;
  filters: ReturnType<typeof useTicketFilters>;
  ticketsTotal: number;
  /** DuckDB is still booting / loading the Parquet — the list is empty for that
   *  reason, not because the filters excluded everything. */
  ticketsLoading: boolean;
  drillCellId: string | null;
  importName: string | null;
  importInputRef: RefObject<HTMLInputElement>;
  onAreaClear: () => void;
  onStartPoint: () => void;
  onStartDraw: () => void;
  onCoordinates: (lng: number, lat: number) => void;
  onImportFile: (f: File) => void;
  onSelectTicket: (t: MergedTicket) => void;
  onEditTicket: (t: MergedTicket) => void;
  onNewTicket: () => void;
  onExitDrill: () => void;
}) {
  const [src, setSrc] = useState<Source>("ticket");

  const choose = (s: Source) => {
    setSrc(s);
    if (s === "point") onStartPoint();
    else if (s === "polygon") onStartDraw();
  };

  return (
    <section className="ws-step" aria-label="Step 1: work area">
      <header className="ws-step-head">
        <span className="ws-num" aria-hidden>1</span>
        <h2>Work area</h2>
      </header>

      {drillCellId && (
        <div className="cell-drill">
          Screen portfolio → ticket evidence <code>{drillCellId.slice(0, 7)}…</code>
          <button type="button" onClick={onExitDrill}>return to screening</button>
        </div>
      )}

      {area ? (
        <div className="ws-area-summary">
          <div className="ws-area-main">
            <strong>{area.label}</strong>
            {(() => {
              // Point/coordinate labels already carry the coordinates — skip the
              // detail line rather than repeat them directly underneath. Only for
              // points: a non-point label could contain its type word by accident
              // (e.g. an imported feature named "Untitled Polygon").
              const detail =
                area.geometry.type === "Point"
                  ? `${area.geometry.coordinates[1].toFixed(5)}, ${area.geometry.coordinates[0].toFixed(5)}`
                  : area.geometry.type;
              const dup = area.geometry.type === "Point" && area.label.includes(detail);
              return dup ? null : <span className="muted">{detail}</span>;
            })()}
          </div>
          <div className="ws-area-actions">
            <button type="button" className="btn-inline ghost" onClick={onAreaClear}>Change</button>
          </div>
        </div>
      ) : (
        <>
          <div className="src-chips" role="group" aria-label="Work area source">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`src-chip${src === s.id ? " on" : ""}`}
                aria-pressed={src === s.id}
                title={s.hint}
                onClick={() => choose(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>

          {src === "ticket" && (
            <TicketPicker
              filters={filters}
              total={ticketsTotal}
              loading={ticketsLoading}
              selectedId={null}
              onSelect={onSelectTicket}
              onEdit={onEditTicket}
              onNew={onNewTicket}
            />
          )}
          {src === "point" && (
            <p className="muted place-hint">
              {mapMode === "point"
                ? "Crosshair active — click the map to place the work point (Esc to cancel). Enter drops one at the map center."
                : "Click the map to place the work point."}
            </p>
          )}
          {src === "polygon" && (
            <p className="muted place-hint">
              {mapMode === "draw"
                ? "Click to add vertices; double-click to finish the area (Esc to cancel)."
                : "Outline the work area on the map."}
            </p>
          )}
          {src === "coordinates" && <CoordinatesForm onSubmit={onCoordinates} />}
          {src === "import" && (
            <div className="import-box">
              <button className="btn" onClick={() => importInputRef.current?.click()}>
                ⤓ Import KML / KMZ / GeoJSON
              </button>
              <input
                ref={importInputRef}
                className="sr-only" tabIndex={-1} aria-hidden="true"
                type="file" accept=".kmz,.kml,.geojson,.json"
                onClick={(e) => { e.currentTarget.value = ""; }}
                onChange={(e) => e.target.files?.[0] && onImportFile(e.target.files[0])}
              />
              {importName ? (
                <p className="muted">{importName} — click a feature on the map to use it as the work area.</p>
              ) : (
                <p className="muted">Imported features appear on the map; click one to use it as the work area.</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
