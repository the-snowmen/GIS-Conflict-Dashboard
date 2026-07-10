// The full-width search + filter row above the map (tickets mode). Filters only —
// the New/Export actions live in the ticket-list header, not here. Advanced filters
// are deliberately tucked away until needed so the map retains more vertical room.
import { useState } from "react";

export default function FilterStrip({
  query,
  onQuery,
  source,
  onSource,
  sourceOptions,
  workflowStatus,
  onWorkflowStatus,
  workflowStatusOptions,
  priority,
  onPriority,
  workType,
  onWorkType,
  minConflicts,
  onMinConflicts,
}: {
  query: string;
  onQuery: (v: string) => void;
  source: string;
  onSource: (v: string) => void;
  sourceOptions: string[];
  workflowStatus: string;
  onWorkflowStatus: (v: string) => void;
  workflowStatusOptions: string[];
  priority: string;
  onPriority: (v: string) => void;
  workType: string;
  onWorkType: (v: string) => void;
  minConflicts: number;
  onMinConflicts: (v: number) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const active = [source, workflowStatus, priority, workType].filter(Boolean).length;
  const clearAll = () => {
    onSource(""); onWorkflowStatus(""); onPriority(""); onWorkType(""); onMinConflicts(0);
  };
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
      <select name="min-conflicts" aria-label="Filter by minimum conflicts" value={minConflicts} onChange={(e) => onMinConflicts(Number(e.target.value))}>
        <option value={0}>any conflicts</option>
        <option value={1}>≥ 1 conflict</option>
        <option value={2}>≥ 2 conflicts</option>
        <option value={3}>≥ 3 conflicts</option>
        <option value={5}>≥ 5 conflicts</option>
      </select>
      <button type="button" className={`filter-more${advancedOpen ? " active" : ""}`} onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen}>
        Filters{active ? ` (${active})` : ""}
      </button>
      {(active > 0 || minConflicts > 0) && <button type="button" className="filter-clear" onClick={clearAll}>Clear</button>}
      {advancedOpen && (
        <div className="filter-advanced">
          <select name="source-filter" aria-label="Filter by source" value={source} onChange={(e) => onSource(e.target.value)}>
            <option value="">all sources</option>
            {sourceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select name="workflow-status-filter" aria-label="Filter by workflow status" value={workflowStatus} onChange={(e) => onWorkflowStatus(e.target.value)}>
            <option value="">all workflow states</option>
            {workflowStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select name="priority-filter" aria-label="Filter by priority" value={priority} onChange={(e) => onPriority(e.target.value)}>
            <option value="">all priorities</option><option value="high">high</option><option value="normal">normal</option><option value="low">low</option>
          </select>
          <select name="work-type-filter" aria-label="Filter by work type" value={workType} onChange={(e) => onWorkType(e.target.value)}>
            <option value="">all work types</option><option value="locate">locate</option><option value="design">design</option><option value="survey">survey</option><option value="permit">permit</option>
          </select>
        </div>
      )}
    </div>
  );
}
