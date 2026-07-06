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
        <h2 className="left-title">Ranked cells</h2>
      </div>
      {drillCellId && (
        <div className="cell-drill">
          Drilled into cell <code>{drillCellId.slice(0, 7)}…</code>
          <button type="button" onClick={onClearDrill}>clear</button>
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
