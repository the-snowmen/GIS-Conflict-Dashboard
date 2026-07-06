import { useEffect, useMemo, useRef, useState } from "react";
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
// Clicking a row drills into that cell's tickets (same action as a map hex click);
// a pick (from either source) scrolls the row into view and flashes it.
export default function CellTable({ scores, activeCell, onPick, cap = 150 }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("index");
  const listRef = useRef<HTMLDivElement>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const ranked = [...scores].sort((a, b) => b[sortKey] - a[sortKey]);
    const top = ranked.slice(0, cap);
    // Guarantee the drilled cell is present even if it ranks past the cap, so a map
    // hex click always resolves to a row the list can scroll to.
    if (activeCell && !top.some((c) => c.cell_id === activeCell)) {
      const active = ranked.find((c) => c.cell_id === activeCell);
      if (active) top.push(active);
    }
    return top;
  }, [scores, sortKey, cap, activeCell]);

  // On pick (map hex or list row), bring the active row into view and flash it.
  useEffect(() => {
    if (!activeCell) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-cell="${activeCell}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "nearest" }); // instant jump; the flash carries the attention cue
    setFlashId(activeCell);
    const t = window.setTimeout(() => setFlashId(null), 950);
    return () => window.clearTimeout(t);
  }, [activeCell]);

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
      <div className="cell-rank-list" ref={listRef}>
        {sorted.map((c) => (
          <button
            key={c.cell_id}
            data-cell={c.cell_id}
            type="button"
            className={`cell-row${c.is_hotspot ? " hot" : ""}${activeCell === c.cell_id ? " active" : ""}${flashId === c.cell_id ? " flash" : ""}`}
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
