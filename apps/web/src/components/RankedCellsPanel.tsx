import type { CellScore } from "../services/demo";
import CellTable from "./CellTable";

// The left column in the cell-index altitude: ranked cells + the active drill banner.
export default function RankedCellsPanel({
  loading,
  scores,
  drillCellId,
  onClearDrill,
  onPick,
}: {
  loading: boolean;
  scores: CellScore[];
  drillCellId: string | null;
  onClearDrill: () => void;
  onPick: (cell: CellScore) => void;
}) {
  return (
    <>
      <div className="left-head">
        <div>
          <h2 className="left-title">H3 screening</h2>
          <p className="panel-subtitle">Screen cells, then drill into ticket evidence.</p>
        </div>
      </div>
      {drillCellId && (
        <div className="cell-drill">
          Screening cell <code>{drillCellId.slice(0, 7)}…</code>
          <button type="button" onClick={onClearDrill}>return to screening</button>
        </div>
      )}
      {loading ? (
        <p className="muted">Scoring cells…</p>
      ) : (
        <CellTable scores={scores} activeCell={drillCellId} onPick={onPick} />
      )}
    </>
  );
}
