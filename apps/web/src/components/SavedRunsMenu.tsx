import { useRef, useState } from "react";
import { runsDbAvailable, type AnalysisRun } from "../services/runs";

// The header's saved-runs menu: save the current analysis, reopen/rename/delete
// saved runs, and the portable-project actions (export JSON / open a project file).
// Runs are durable (IndexedDB) when the browser allows it; otherwise the menu says
// so and the JSON project carries the durable path.
export default function SavedRunsMenu({
  runs,
  activeRunId,
  canSave,
  onSave,
  onOpen,
  onRename,
  onDelete,
  onExportProject,
  onImportProject,
}: {
  runs: AnalysisRun[];
  activeRunId: string | null;
  canSave: boolean;
  onSave: () => void;
  onOpen: (run: AnalysisRun) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onExportProject: () => void;
  onImportProject: (file: File) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const projectInputRef = useRef<HTMLInputElement>(null);
  const available = runsDbAvailable();

  const startRename = (run: AnalysisRun) => {
    setEditingId(run.id);
    setEditName(run.name);
  };
  const commitRename = () => {
    const name = editName.trim();
    if (editingId && name) onRename(editingId, name);
    setEditingId(null);
  };

  return (
    <div className="saved-anchor">
      <button
        type="button"
        className={`map-pop-btn${open ? " active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Saved analyses"
        title="Saved analyses"
      >
        ▤ Saved{runs.length > 0 && <span className="saved-count">{runs.length}</span>}
      </button>
      {open && (
        <>
          <button
            type="button"
            className="map-pop-backdrop"
            aria-label="Close saved analyses"
            onClick={() => setOpen(false)}
          />
          <div className="map-pop saved-pop" role="dialog" aria-label="Saved analyses">
            <div className="map-pop-head">
              <h2>Saved analyses</h2>
              <button className="tp-close" onClick={() => setOpen(false)} aria-label="Close saved analyses">✕</button>
            </div>

            <button type="button" className="btn" onClick={onSave} disabled={!canSave}>
              ＋ Save current analysis
            </button>
            {!available && (
              <p className="muted small saved-warn">
                Browser storage is unavailable — saved runs last only this session. Export a
                project file to keep them.
              </p>
            )}

            <div className="saved-list">
              {runs.length === 0 && (
                <p className="muted small">Nothing saved yet. Run an analysis, then save it here.</p>
              )}
              {runs.map((r) => (
                <div key={r.id} className={`saved-row${r.id === activeRunId ? " active" : ""}`}>
                  {editingId === r.id ? (
                    <input
                      className="saved-rename"
                      value={editName}
                      autoFocus
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  ) : (
                    <button type="button" className="saved-open" onClick={() => onOpen(r)} title="Open this analysis">
                      <span className="saved-name">{r.name}</span>
                      <span className="saved-meta">
                        {r.result
                          ? r.result.conflictCount > 0
                            ? `${r.result.conflictCount} conflict${r.result.conflictCount === 1 ? "" : "s"}`
                            : "clear"
                          : "draft"}
                        {" · "}
                        {new Date(r.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                      </span>
                    </button>
                  )}
                  <span className="saved-row-actions">
                    <button type="button" className="mini" onClick={() => startRename(r)} title="Rename" aria-label={`Rename ${r.name}`}>✎</button>
                    <button type="button" className="mini" onClick={() => onDelete(r.id)} title="Delete" aria-label={`Delete ${r.name}`}>✕</button>
                  </span>
                </div>
              ))}
            </div>

            <div className="saved-project">
              <span className="rule-lbl muted">Portable project</span>
              <div className="row">
                <button type="button" className="btn" onClick={onExportProject} disabled={!runs.length}>
                  ⤒ Export JSON
                </button>
                <button type="button" className="btn" onClick={() => projectInputRef.current?.click()}>
                  ⤓ Open file…
                </button>
              </div>
              <input
                ref={projectInputRef}
                className="sr-only" tabIndex={-1} aria-hidden="true"
                type="file" accept=".json"
                onClick={(e) => { e.currentTarget.value = ""; }}
                onChange={(e) => e.target.files?.[0] && onImportProject(e.target.files[0])}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
