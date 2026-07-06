import type { ConflictInfo, EditingState } from "../types";

// Create/edit ticket form. Status is auto-derived from the live conflict count; the
// point is moved by dragging the map marker (the caller wires that up).
export default function EditForm({
  editing,
  sourceOptions,
  radius,
  conflict,
  onChangeSource,
  onSave,
  onDelete,
  onCancel,
}: {
  editing: EditingState;
  sourceOptions: string[];
  radius: number;
  conflict: ConflictInfo | null;
  onChangeSource: (value: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="card edit-card">
      <div className="tp-head">
        <h2>{editing.mode === "create" ? "New ticket" : "Edit ticket"}</h2>
        <button className="tp-close" onClick={onCancel} aria-label="Cancel">✕</button>
      </div>
      <label className="fld">
        Source
        <input
          list="src-list"
          value={editing.source}
          onChange={(e) => onChangeSource(e.target.value)}
          placeholder="e.g. field_survey"
        />
      </label>
      <datalist id="src-list">
        {sourceOptions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className="fld">
        Status <span className="auto-tag">auto</span>
        <div className={`derived ${conflict && conflict.count > 0 ? "conflict" : "clear"}`}>
          {conflict
            ? `${conflict.count} conflicting ${conflict.count === 1 ? "facility" : "facilities"} at ${radius} m → ${conflict.count > 0 ? "potential_conflict" : "no_conflict"}`
            : "analyzing conflicts…"}
        </div>
      </div>
      <div className="fld-coords muted">
        Point: {editing.lat.toFixed(5)}, {editing.lon.toFixed(5)} · drag the marker to move
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn active" onClick={onSave} disabled={!editing.source}>
          Save
        </button>
        {editing.mode === "edit" && (
          <button className="btn danger" onClick={onDelete}>Delete</button>
        )}
      </div>
    </section>
  );
}
