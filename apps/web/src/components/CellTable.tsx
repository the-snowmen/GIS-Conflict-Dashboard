import { useEffect, useMemo, useRef, useState } from "react";
import type { CellScore } from "../services/demo";

type SortKey = "index" | "ticket_count" | "conflict_rate" | "mean_severity" | "facility_count";

interface Props {
  scores: CellScore[];
  activeCell: string | null;
  onPick: (cell: CellScore) => void;
  cap?: number;
}

const COLS: { key: SortKey; label: string }[] = [
  { key: "index", label: "Index" },
  { key: "ticket_count", label: "Tickets" },
  { key: "conflict_rate", label: "Conflict rate" },
  { key: "mean_severity", label: "Severity" },
  { key: "facility_count", label: "Facilities" },
];

// Ranked scored cells as a sortable table — one row per hex, hotspot rows badged.
// Clicking a row drills into that cell's tickets (same action as a map hex click);
// a pick (from either source) scrolls the row into view and flashes it.
export default function CellTable({ scores, activeCell, onPick, cap = 150 }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("index");
  const [asc, setAsc] = useState(false); // every column reads best highest-first
  const listRef = useRef<HTMLDivElement>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const ranked = [...scores].sort((a, b) => (asc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]));
    const top = ranked.slice(0, cap);
    // Guarantee the drilled cell is present even if it ranks past the cap, so a map
    // hex click always resolves to a row the list can scroll to.
    if (activeCell && !top.some((c) => c.cell_id === activeCell)) {
      const active = ranked.find((c) => c.cell_id === activeCell);
      if (active) top.push(active);
    }
    return top;
  }, [scores, sortKey, asc, cap, activeCell]);

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

  function toggleSort(k: SortKey) {
    if (k === sortKey) setAsc((v) => !v);
    else {
      setSortKey(k);
      setAsc(false);
    }
  }

  if (!scores.length) {
    return <div className="cell-table-empty muted">No cells — tickets haven’t loaded, or all weights are 0.</div>;
  }

  return (
    <div className="cell-table" ref={listRef}>
      <table className="fac-table cell-tbl">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Cell</th>
            {COLS.map((c) => (
              <th key={c.key} aria-sort={sortKey === c.key ? (asc ? "ascending" : "descending") : undefined}>
                <button
                  type="button"
                  className={`th-sort${sortKey === c.key ? " active" : ""}`}
                  onClick={() => toggleSort(c.key)}
                >
                  {c.label}
                  <span aria-hidden="true" className="th-arrow">
                    {sortKey === c.key ? (asc ? "▲" : "▼") : "△"}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((c, i) => (
            <tr
              key={c.cell_id}
              data-cell={c.cell_id}
              className={`cell-tr${activeCell === c.cell_id ? " selected" : ""}${flashId === c.cell_id ? " flash" : ""}`}
              title="Drill into this cell’s tickets"
              onClick={() => onPick(c)}
            >
              <td className="num dim">{i + 1}</td>
              <td>
                <code className="cell-id">{c.cell_id.slice(0, 9)}…</code>
                {c.is_hotspot && (
                  <span className="hot-badge" title="high ticket volume and high conflict rate">hotspot</span>
                )}
              </td>
              <td className="num">{c.index.toFixed(2)}</td>
              <td className="num">{c.ticket_count}</td>
              <td className="num">{Math.round(c.conflict_rate * 100)}%</td>
              <td className="num">{c.mean_severity.toFixed(1)}</td>
              <td className="num">{c.facility_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {scores.length > cap && (
        <p className="fac-hint small dim">Top {cap} of {scores.length} cells — sort to bring others up.</p>
      )}
    </div>
  );
}
