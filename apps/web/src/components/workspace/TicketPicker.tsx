import type { MergedTicket } from "../../services/demo";
import type { useTicketFilters } from "../../lib/useTicketFilters";

const CAP = 200;

// The ticket picker inside the work-area step: search + filters + a scrollable
// list. Selecting a row defines the work area (it no longer opens a detail panel).
export default function TicketPicker({
  filters,
  total,
  loading,
  selectedId,
  onSelect,
  onEdit,
  onNew,
}: {
  filters: ReturnType<typeof useTicketFilters>;
  total: number;
  loading: boolean;
  selectedId: string | null;
  onSelect: (t: MergedTicket) => void;
  onEdit: (t: MergedTicket) => void;
  onNew: () => void;
}) {
  const {
    tq, setTq,
    fSource, setFSource,
    fWorkflowStatus, setFWorkflowStatus,
    fPriority, setFPriority,
    fWorkType, setFWorkType,
    fMinConflicts, setFMinConflicts,
    sourceOptions, workflowStatusOptions, filteredTickets,
  } = filters;
  const active = [fSource, fWorkflowStatus, fPriority, fWorkType].filter(Boolean).length;
  const clearAll = () => {
    setFSource(""); setFWorkflowStatus(""); setFPriority(""); setFWorkType(""); setFMinConflicts(0);
  };

  return (
    <div className="picker">
      <div className="picker-bar">
        <input
          className="ti fs-search"
          name="ticket-search"
          aria-label="Search tickets by id or source"
          placeholder="Search id / source…"
          value={tq}
          onChange={(e) => setTq(e.target.value)}
        />
        <select
          name="min-conflicts" aria-label="Filter by minimum conflicts"
          value={fMinConflicts} onChange={(e) => setFMinConflicts(Number(e.target.value))}
        >
          <option value={0}>any conflicts</option>
          <option value={1}>≥ 1 conflict</option>
          <option value={2}>≥ 2 conflicts</option>
          <option value={3}>≥ 3 conflicts</option>
          <option value={5}>≥ 5 conflicts</option>
        </select>
        <button type="button" className="mini" title="Create a browser-local scenario ticket" onClick={onNew}>
          ＋ New
        </button>
      </div>
      <details className="picker-advanced">
        <summary>Filters{active ? ` (${active})` : ""}</summary>
        <div className="filter-advanced">
          <select aria-label="Filter by source" value={fSource} onChange={(e) => setFSource(e.target.value)}>
            <option value="">all sources</option>
            {sourceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select aria-label="Filter by workflow status" value={fWorkflowStatus} onChange={(e) => setFWorkflowStatus(e.target.value)}>
            <option value="">all workflow states</option>
            {workflowStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select aria-label="Filter by priority" value={fPriority} onChange={(e) => setFPriority(e.target.value)}>
            <option value="">all priorities</option><option value="high">high</option><option value="normal">normal</option><option value="low">low</option>
          </select>
          <select aria-label="Filter by work type" value={fWorkType} onChange={(e) => setFWorkType(e.target.value)}>
            <option value="">all work types</option><option value="locate">locate</option><option value="design">design</option><option value="survey">survey</option><option value="permit">permit</option>
          </select>
          {(active > 0 || fMinConflicts > 0) && (
            <button type="button" className="filter-clear" onClick={clearAll}>Clear all</button>
          )}
        </div>
      </details>
      <p className="picker-count muted">
        {filteredTickets.length === total
          ? `${total.toLocaleString()} tickets`
          : `${filteredTickets.length.toLocaleString()} of ${total.toLocaleString()} tickets`}
      </p>
      <div className="picker-list">
        {filteredTickets.slice(0, CAP).map((t) => (
          <div key={t.ticket_id} className={`tk-card${selectedId === t.ticket_id ? " selected" : ""}`}>
            <button
              className="tk-main"
              aria-label={`Use ticket ${t.ticket_id}, ${t.work_type} work, ${t.priority} priority, ${
                t.conflict_count > 0
                  ? `${t.conflict_count} potential conflict${t.conflict_count === 1 ? "" : "s"}`
                  : "no conflict"
              } as the work area`}
              onClick={() => onSelect(t)}
            >
              <span className="tk-id">
                {t.ticket_id}
                {t.origin === "user" && <span className="tag">user</span>}
              </span>
              <span className="meta">{t.work_type} · {t.priority} · {t.workflow_status}</span>
            </button>
            <span className="tk-foot">
              <span className={`pill ${t.conflict_count > 0 ? "conflict" : "clear"}`}>
                {t.conflict_count > 0 ? `${t.conflict_count} conflict` : "clear"}
              </span>
              <button
                className="mini"
                aria-label={`Edit ticket ${t.ticket_id}`}
                title={`Edit ticket ${t.ticket_id}`}
                onClick={() => onEdit(t)}
              >
                ✎
              </button>
            </span>
          </div>
        ))}
        {filteredTickets.length === 0 && (
          loading ? (
            <div className="empty">Loading tickets…</div>
          ) : (
            <div className="empty">
              <span aria-hidden>🔍</span>
              No tickets match these filters.
              <button type="button" className="btn-inline ghost" onClick={clearAll}>Clear filters</button>
            </div>
          )
        )}
        {filteredTickets.length > CAP && (
          <p className="muted dock-more">Showing {CAP} of {filteredTickets.length.toLocaleString()} — narrow with search.</p>
        )}
      </div>
    </div>
  );
}
