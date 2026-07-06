// The full-width search + filter row above the map (tickets mode). Filters only —
// the New/Export actions live in the ticket-list header, not here.
export default function FilterStrip({
  query,
  onQuery,
  source,
  onSource,
  sourceOptions,
  status,
  onStatus,
  statusOptions,
  minConflicts,
  onMinConflicts,
}: {
  query: string;
  onQuery: (v: string) => void;
  source: string;
  onSource: (v: string) => void;
  sourceOptions: string[];
  status: string;
  onStatus: (v: string) => void;
  statusOptions: string[];
  minConflicts: number;
  onMinConflicts: (v: number) => void;
}) {
  return (
    <div className="filter-strip">
      <input
        className="ti fs-search"
        name="ticket-search"
        aria-label="Search tickets by id or source"
        placeholder="Search id / source…"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <select name="source-filter" aria-label="Filter by source" value={source} onChange={(e) => onSource(e.target.value)}>
        <option value="">all sources</option>
        {sourceOptions.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <select name="status-filter" aria-label="Filter by status" value={status} onChange={(e) => onStatus(e.target.value)}>
        <option value="">all statuses</option>
        {statusOptions.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <select name="min-conflicts" aria-label="Filter by minimum conflicts" value={minConflicts} onChange={(e) => onMinConflicts(Number(e.target.value))}>
        <option value={0}>any conflicts</option>
        <option value={1}>≥ 1 conflict</option>
        <option value={2}>≥ 2 conflicts</option>
        <option value={3}>≥ 3 conflicts</option>
        <option value={5}>≥ 5 conflicts</option>
      </select>
    </div>
  );
}
