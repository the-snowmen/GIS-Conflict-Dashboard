import { useMemo, useState } from "react";
import type { MergedTicket } from "../../services/demo";

type SortKey = "ticket" | "type" | "priority" | "conflicts" | "county";

const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

// The drilled cell's member tickets (screen tray). Row click locates the ticket on
// the map; "Assess" hands it to the work-area flow with the drill preserved.
export default function CellTicketsTable({
  tickets,
  countyNames,
  onLocate,
  onAssess,
}: {
  tickets: MergedTicket[];
  countyNames: Map<string, string> | null;
  onLocate: (t: MergedTicket) => void;
  onAssess: (t: MergedTicket) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("conflicts");
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    const countyOf = (t: MergedTicket) =>
      t.county_geoid ? (countyNames?.get(t.county_geoid) ?? t.county_geoid) : "—";
    const val = (t: MergedTicket): string | number => {
      switch (sortKey) {
        case "ticket": return t.ticket_id;
        case "type": return t.work_type;
        case "priority": return PRIORITY_RANK[t.priority] ?? 3;
        case "conflicts": return t.conflict_count;
        case "county": return countyOf(t);
      }
    };
    return [...tickets]
      .map((t) => ({ t, county: countyOf(t) }))
      .sort((a, b) => {
        const va = val(a.t);
        const vb = val(b.t);
        const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
        return asc ? cmp : -cmp;
      });
  }, [tickets, countyNames, sortKey, asc]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setAsc((v) => !v);
    else {
      setSortKey(k);
      setAsc(k === "ticket" || k === "type" || k === "county");
    }
  }

  function th(k: SortKey, label: string) {
    const active = sortKey === k;
    return (
      <th aria-sort={active ? (asc ? "ascending" : "descending") : undefined}>
        <button type="button" className={`th-sort${active ? " active" : ""}`} onClick={() => toggleSort(k)}>
          {label}
          <span aria-hidden="true" className="th-arrow">{active ? (asc ? "▲" : "▼") : "△"}</span>
        </button>
      </th>
    );
  }

  return (
    <div className="cell-tickets">
      <table className="fac-table">
        <thead>
          <tr>
            {th("ticket", "Ticket")}
            {th("type", "Work type")}
            {th("priority", "Priority")}
            {th("conflicts", "Conflicts")}
            {th("county", "Jurisdiction")}
            <th><span className="sr-only">Assess</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ t, county }) => (
            <tr key={t.ticket_id} onClick={() => onLocate(t)} title="Locate on the map">
              <td>
                <span className="fac-name">{t.ticket_id}</span>
                {t.origin === "user" && <span className="fac-id">local</span>}
              </td>
              <td>{t.work_type}</td>
              <td>{t.priority}</td>
              <td className="num">
                {t.conflict_count > 0 ? (
                  <span className="pill conflict">{t.conflict_count}</span>
                ) : (
                  <span className="pill clear">0</span>
                )}
              </td>
              <td>{county}</td>
              <td>
                <button
                  type="button"
                  className="btn-inline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAssess(t);
                  }}
                  title="Open this ticket as a work area (the cell stays restorable)"
                >
                  Assess →
                </button>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={6} className="fac-empty">No member tickets in this cell.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
