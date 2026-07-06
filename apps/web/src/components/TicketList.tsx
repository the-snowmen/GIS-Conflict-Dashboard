import type { MergedTicket } from "../services/demo";

const CAP = 200;

// The scrollable list of ticket cards. Click a card to fly + open its detail;
// the ✎ opens the edit form. Caller passes the already-filtered list.
export default function TicketList({
  tickets,
  onSelect,
  onEdit,
}: {
  tickets: MergedTicket[];
  onSelect: (t: MergedTicket, trigger: HTMLElement) => void;
  onEdit: (t: MergedTicket) => void;
}) {
  return (
    <div className="dock-list">
      {tickets.slice(0, CAP).map((t) => (
        <div key={t.ticket_id} className="tk-card">
          <button
            className="tk-main"
            aria-label={`Ticket ${t.ticket_id}, source ${t.source || "none"}, ${
              t.conflict_count > 0
                ? `${t.conflict_count} potential conflict${t.conflict_count === 1 ? "" : "s"}`
                : "no conflict"
            }`}
            onClick={(e) => onSelect(t, e.currentTarget)}
          >
            <span className="tk-id">
              {t.ticket_id}
              {t.origin === "user" && <span className="tag">user</span>}
            </span>
            <span className="meta">{t.source}</span>
          </button>
          <span className="tk-foot">
            <span className={`pill ${t.conflict_count > 0 ? "conflict" : "clear"}`}>
              {t.conflict_count > 0 ? `${t.conflict_count} conflict` : "clear"}
            </span>
            <button className="mini" title="Edit ticket" onClick={() => onEdit(t)}>✎</button>
          </span>
        </div>
      ))}
      {tickets.length === 0 && (
        <div className="empty">
          <span aria-hidden>🔍</span>
          No tickets match these filters.
        </div>
      )}
      {tickets.length > CAP && (
        <p className="muted dock-more">Showing {CAP} of {tickets.length.toLocaleString()}.</p>
      )}
    </div>
  );
}
