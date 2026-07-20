import { useEffect, useState, type KeyboardEvent } from "react";
import type { CellScore, FacilityFacets, MergedTicket } from "../services/demo";
import type { AppMode, RulePreset, RunResult, RunStatus, WorkArea } from "../types";
import CellTable from "./CellTable";
import CellTicketsTable from "./screen/CellTicketsTable";
import SummaryTab from "./results/SummaryTab";
import FacilitiesTab from "./results/FacilitiesTab";
import ReportTab from "./results/ReportTab";
import FacilityDrawer from "./drawer/FacilityDrawer";

type Detent = "bar" | "half" | "full";
type Tab = "summary" | "facilities" | "report";

// The bottom results surface. Assess mode: a status bar (the run verdict + actions)
// over tabbed evidence (Summary / Facilities), with bar → half → full detents so
// the evidence can take over the screen without hiding the map permanently.
// Screen mode: the ranked cells table — the cells list IS the screening result.
export default function ResultsTray({
  mode,
  status,
  result,
  stale,
  area,
  facets,
  presets,
  intakeCount,
  canSaveAsTicket,
  onRecenter,
  onSaveAsTicket,
  selectedFacility,
  onSelectFacility,
  onHoverFacility,
  onCenterFacility,
  cellsLoading,
  cellRes,
  cellPresetName,
  scores,
  activeCell,
  onPickCell,
  drillCell,
  memberTickets,
  countyNames,
  onExitDrill,
  onLocateTicket,
  onAssessTicket,
  isMobile = false,
  region,
  mapShot,
  reportName,
  reportNotes,
  onReportName,
  onReportNotes,
}: {
  mode: AppMode;
  status: RunStatus;
  result: RunResult | null;
  stale: boolean;
  area: WorkArea | null;
  facets: FacilityFacets | null;
  presets: RulePreset[];
  intakeCount: number | null;
  canSaveAsTicket: boolean;
  onRecenter: () => void;
  onSaveAsTicket: () => void;
  selectedFacility: number | null;
  onSelectFacility: (idx: number | null) => void;
  onHoverFacility: (idx: number | null) => void;
  onCenterFacility: (idx: number) => void;
  cellsLoading: boolean;
  cellRes: number;
  cellPresetName: string;
  scores: CellScore[];
  activeCell: string | null;
  onPickCell: (cell: CellScore) => void;
  drillCell: CellScore | null;
  memberTickets: MergedTicket[];
  countyNames: Map<string, string> | null;
  onExitDrill: () => void;
  onLocateTicket: (t: MergedTicket) => void;
  onAssessTicket: (t: MergedTicket) => void;
  isMobile?: boolean;
  region: string;
  mapShot: string | null;
  reportName: string;
  reportNotes: string;
  onReportName: (v: string) => void;
  onReportNotes: (v: string) => void;
}) {
  const [detent, setDetent] = useState<Detent>("half");
  const [tab, setTab] = useState<Tab>("summary");

  // Every new run re-opens the tray on the summary — the verdict first, evidence
  // one tab away. Selecting a facility (row or map) jumps to the facilities tab.
  useEffect(() => {
    if (result) {
      setDetent("half");
      setTab("summary");
    }
  }, [result]);
  useEffect(() => {
    if (selectedFacility != null) {
      setTab("facilities");
      setDetent((d) => (d === "bar" ? "half" : d));
    }
  }, [selectedFacility]);

  if (mode === "screen") {
    return (
      <div className="tray screen" aria-label={drillCell ? "Cell member tickets" : "Ranked cells"}>
        <div className="tray-bar">
          {drillCell ? (
            <>
              <button className="btn-inline ghost" onClick={onExitDrill}>‹ Ranked cells</button>
              <span className="tray-title">
                Cell {drillCell.cell_id.slice(0, 9)}… · {drillCell.ticket_count} ticket{drillCell.ticket_count === 1 ? "" : "s"}
              </span>
              <span className="muted tray-hint">Row click locates a ticket · Assess opens it as a work area.</span>
            </>
          ) : (
            <>
              <span className="tray-title">
                {cellsLoading
                  ? "Scoring cells…"
                  : `${scores.length.toLocaleString()} priority cells · ${cellPresetName} · grain r${cellRes}`}
              </span>
              <span className="muted tray-hint">Click a row or a hex to drill into its tickets.</span>
            </>
          )}
        </div>
        <div className="tray-body cells">
          {drillCell ? (
            <CellTicketsTable
              tickets={memberTickets}
              countyNames={countyNames}
              onLocate={onLocateTicket}
              onAssess={onAssessTicket}
            />
          ) : cellsLoading ? (
            <p className="muted tray-loading">Aggregating tickets into H3 cells…</p>
          ) : (
            <CellTable scores={scores} activeCell={activeCell} onPick={onPickCell} />
          )}
        </div>
      </div>
    );
  }

  if (!result && status !== "running") return null;
  const conflicts = result?.conflictCount ?? 0;
  return (
    <div className={`tray assess detent-${detent}`} aria-label="Analysis results">
      <div
        className="tray-bar"
        {...(isMobile
          ? {}
          : {
              role: "button",
              tabIndex: 0,
              "aria-expanded": detent !== "bar",
              "aria-label": detent === "bar" ? "Expand results" : "Collapse results",
              onClick: () => setDetent((d) => (d === "bar" ? "half" : "bar")),
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setDetent((d) => (d === "bar" ? "half" : "bar"));
                }
              },
            })}
      >
        {status === "running" || !result ? (
          <span className="tray-status">Analyzing…</span>
        ) : (
          <>
            <span className={`tray-status ${conflicts > 0 ? "conflict" : "clear"}`}>
              {conflicts > 0 ? (
                <>⚠ <strong>{conflicts}</strong> facility conflict{conflicts === 1 ? "" : "s"}</>
              ) : (
                <>✓ <strong>no</strong> conflicts</>
              )}
            </span>
            <span className="muted">· {result.jurisdiction ?? "outside the coverage area"}</span>
            <span className="tray-via">{result.via}</span>
            {stale && (
              <span className="stale-badge" title="Settings changed after this run — re-run to refresh">
                Settings changed
              </span>
            )}
          </>
        )}
        <span className="tray-tabs" role="tablist" aria-label="Result views" onClick={(e) => e.stopPropagation()}>
          <button
            role="tab"
            aria-selected={tab === "summary"}
            className={`tray-tab${tab === "summary" ? " active" : ""}`}
            onClick={() => {
              setTab("summary");
              setDetent((d) => (d === "bar" ? "half" : d));
            }}
          >
            Summary
          </button>
          <button
            role="tab"
            aria-selected={tab === "facilities"}
            className={`tray-tab${tab === "facilities" ? " active" : ""}`}
            onClick={() => {
              setTab("facilities");
              setDetent((d) => (d === "bar" ? "half" : d));
            }}
            disabled={!result}
          >
            Facilities{result ? ` (${conflicts})` : ""}
          </button>
          <button
            role="tab"
            aria-selected={tab === "report"}
            className={`tray-tab${tab === "report" ? " active" : ""}`}
            onClick={() => {
              setTab("report");
              setDetent((d) => (d === "bar" ? "half" : d));
            }}
            disabled={!result}
          >
            Report
          </button>
        </span>
        <span className="tray-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn-inline ghost"
            onClick={onRecenter}
            disabled={!result}
            title="Re-center the map on the analyzed area"
          >
            ⌖ Locate
          </button>
          {canSaveAsTicket && (
            <button className="btn-inline" onClick={onSaveAsTicket}>＋ Save as ticket</button>
          )}
          {!isMobile && (
            <button
              className="btn-inline ghost tray-detent"
              onClick={() => setDetent((d) => (d === "full" ? "half" : "full"))}
              title={detent === "full" ? "Shrink results" : "Expand results"}
              aria-label={detent === "full" ? "Shrink results" : "Expand results"}
            >
              {detent === "full" ? "▾" : "▴"}
            </button>
          )}
        </span>
      </div>
      {(isMobile || detent !== "bar") && (result || status === "running") && (
        <div className="tray-body" role="tabpanel">
          {!result ? (
            // First run of an area: skeleton rows stand in for the incoming evidence.
            <div className="sk-wrap" aria-hidden="true">
              <div className="sk-line sk-w60" />
              <div className="sk-row" />
              <div className="sk-row" />
              <div className="sk-row" />
            </div>
          ) : tab === "summary" ? (
            <SummaryTab
              result={result}
              area={area}
              facets={facets}
              presets={presets}
              intakeCount={intakeCount}
              canSaveAsTicket={canSaveAsTicket}
              onSaveAsTicket={onSaveAsTicket}
              onOpenFacilities={() => setTab("facilities")}
            />
          ) : tab === "facilities" ? (
            <>
              {isMobile && selectedFacility != null && result.facilities[selectedFacility] && (
                <FacilityDrawer
                  inSheet
                  facility={result.facilities[selectedFacility]}
                  onCenter={() => onCenterFacility(selectedFacility)}
                  onClose={() => onSelectFacility(null)}
                />
              )}
              <FacilitiesTab
                result={result}
                selected={selectedFacility}
                onSelect={onSelectFacility}
                onHover={onHoverFacility}
              />
            </>
          ) : (
            <ReportTab
              result={result}
              area={area}
              facets={facets}
              presets={presets}
              region={region}
              mapShot={mapShot}
              name={reportName}
              notes={reportNotes}
              onName={onReportName}
              onNotes={onReportNotes}
            />
          )}
        </div>
      )}
    </div>
  );
}
