// Portable project: every saved run + the referenced ticket overlay as one JSON
// file, so analyses move between machines with no account and no backend.
// Import validates the envelope and merges per-record (incoming wins on updatedAt;
// nothing local is ever deleted by an import).
import { downloadText, exportName } from "./export";
import { loadOverlay, mergeOverlay, type Overlay } from "./overlay";
import { putRun, type AnalysisRun } from "./runs";

export const PROJECT_FORMAT = "gis-conflict-project";
export const PROJECT_VERSION = 1;

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  exportedAt: string;
  region: string;
  runs: AnalysisRun[];
  ticketOverlay: Partial<Overlay>;
}

export function exportProject(runs: AnalysisRun[], region: string): void {
  const overlay = loadOverlay();
  const project: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    exportedAt: new Date().toISOString(),
    region,
    runs,
    // Persist without the local schema-version field; it re-validates on merge.
    ticketOverlay: { added: overlay.added, edited: overlay.edited, deleted: overlay.deleted },
  };
  downloadText(exportName("project", "json"), "application/json", JSON.stringify(project, null, 2));
}

/** Parse + validate a project file. Throws with a user-readable message on any problem. */
export function parseProject(text: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const p = raw as Partial<ProjectFile>;
  if (p?.format !== PROJECT_FORMAT) throw new Error("That file isn't a GIS Conflict project.");
  if (p.version !== PROJECT_VERSION) {
    throw new Error(`Project version ${String(p.version)} isn't supported (this app reads version ${PROJECT_VERSION}).`);
  }
  if (!Array.isArray(p.runs)) throw new Error("The project file has no runs list.");
  // Light per-run sanity: a run must at least carry its id and area geometry.
  for (const r of p.runs) {
    if (!r?.id || !r.area?.geometry) throw new Error("The project file contains a malformed run.");
  }
  return p as ProjectFile;
}

export interface MergeSummary {
  runsAdded: number;
  runsUpdated: number;
  tickets: { added: number; edited: number; deleted: number };
}

/**
 * Merge an imported project into local state: runs by id (incoming wins when its
 * updatedAt is newer; same id + older incoming = skipped), ticket overlay merged
 * additively. Existing local runs are never deleted.
 */
export async function mergeProject(project: ProjectFile, localRuns: AnalysisRun[]): Promise<MergeSummary> {
  const byId = new Map(localRuns.map((r) => [r.id, r]));
  let runsAdded = 0;
  let runsUpdated = 0;
  for (const incoming of project.runs) {
    const local = byId.get(incoming.id);
    if (local && local.updatedAt >= incoming.updatedAt) continue;
    if (await putRun(incoming)) {
      if (local) runsUpdated++;
      else runsAdded++;
    }
  }
  const tickets = mergeOverlay(project.ticketOverlay ?? {});
  return { runsAdded, runsUpdated, tickets };
}
