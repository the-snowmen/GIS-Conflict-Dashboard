import { useMemo, useState } from "react";
import type { CellScore } from "../services/demo";

type SortKey = "index" | "ticket_count" | "conflict_rate" | "facility_count";

interface Props {
  scores: CellScore[];
  activeCell: string | null;
  onPick: (cell: CellScore) => void;
  cap?: number;
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: "index", label: "Index" },
  { key: "ticket_count", label: "Tickets" },
  { key: "conflict_rate", label: "Conflict rate" },
  { key: "facility_count", label: "Facilities" },
];

// Ranked list of scored cells — one focusable row per hex, hotspot rows badged.
// Clicking a row drills into that cell's tickets (same action as a map hex click).
export default function CellTable({ scores, activeCell, onPick, cap = 150 }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("index");

  const sorted = useMemo(
    () => [...scores].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, cap),
    [scores, sortKey, cap],
  );

  if (!scores.length) {
    return <div className="cell-table-empty muted">No cells — tickets haven’t loaded, or all weights are 0.</div>;
  }

  return (
    <div className="cell-table">
      <div className="cell-rank-bar">
        <span className="cell-table-h">Ranked cells ({scores.length})</span>
        <label className="cell-sort">
          Sort
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="cell-rank-list">
        {sorted.map((c) => (
          <button
            key={c.cell_id}
            type="button"
            className={`cell-row${c.is_hotspot ? " hot" : ""}${activeCell === c.cell_id ? " active" : ""}`}
            title="Drill into this cell’s tickets"
            onClick={() => onPick(c)}
          >
            <span className="cell-row-idx">
              {c.is_hotspot && <span className="hot-badge" title="high ticket volume and high conflict rate">hot</span>}
              {c.index.toFixed(2)}
            </span>
            <span className="cell-row-stats">
              <span><em>tk</em> {c.ticket_count}</span>
              <span><em>conf</em> {Math.round(c.conflict_rate * 100)}%</span>
              <span><em>fac</em> {c.facility_count}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
