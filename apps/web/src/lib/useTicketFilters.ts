import { useMemo, useState } from "react";
import type { MergedTicket } from "../services/demo";

// The ticket search/filter state (query + source/status/min-conflicts) plus the derived
// option lists and the filtered, date-sorted list. `viewTickets` (the live-rule-adjusted
// set) is supplied by the caller; the option lists derive from the full merged `tickets`.
export function useTicketFilters(viewTickets: MergedTicket[], tickets: MergedTicket[]) {
  const [tq, setTq] = useState("");
  const [fSource, setFSource] = useState("");
  const [fWorkflowStatus, setFWorkflowStatus] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fWorkType, setFWorkType] = useState("");
  const [fMinConflicts, setFMinConflicts] = useState(0);

  const sourceOptions = useMemo(
    () => [...new Set(tickets.map((t) => t.source).filter(Boolean))].sort(),
    [tickets],
  );
  const workflowStatusOptions = useMemo(
    () => [...new Set(tickets.map((t) => t.workflow_status).filter(Boolean))].sort(),
    [tickets],
  );
  const filteredTickets = useMemo(() => {
    const query = tq.trim().toLowerCase();
    return viewTickets
      .filter((t) => {
        if (query && !`${t.ticket_id} ${t.source}`.toLowerCase().includes(query)) return false;
        if (fSource && t.source !== fSource) return false;
        if (fWorkflowStatus && t.workflow_status !== fWorkflowStatus) return false;
        if (fPriority && t.priority !== fPriority) return false;
        if (fWorkType && t.work_type !== fWorkType) return false;
        if (fMinConflicts && t.conflict_count < fMinConflicts) return false;
        return true;
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  }, [viewTickets, tq, fSource, fWorkflowStatus, fPriority, fWorkType, fMinConflicts]);

  return {
    tq,
    setTq,
    fSource,
    setFSource,
    fWorkflowStatus,
    setFWorkflowStatus,
    fPriority,
    setFPriority,
    fWorkType,
    setFWorkType,
    fMinConflicts,
    setFMinConflicts,
    sourceOptions,
    workflowStatusOptions,
    filteredTickets,
  };
}
