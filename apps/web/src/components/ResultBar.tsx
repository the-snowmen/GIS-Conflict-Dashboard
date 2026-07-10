import type { ConflictInfo } from "../types";

// The floating AOI-outcome bar (conflict count + jurisdiction + provenance + actions).
export default function ResultBar({
  conflict,
  canSaveAsTicket,
  onRecenter,
  onSaveAsTicket,
}: {
  conflict: ConflictInfo;
  canSaveAsTicket: boolean;
  onRecenter: () => void;
  onSaveAsTicket: () => void;
}) {
  return (
    <div className="result">
      {conflict.count > 0 ? (
        <span>⚠ <strong>{conflict.count}</strong> facility conflict{conflict.count > 1 ? "s" : ""}</span>
      ) : (
        <span>✓ <strong>no</strong> conflicts</span>
      )}
      <span className="muted">· {conflict.jurisdiction ?? "outside the coverage area"}</span>
      <span className="result-via">Analyzing: {conflict.via}</span>
      <span className="result-actions">
        <button className="btn-inline ghost" onClick={onRecenter} title="Re-center the map on this area">⌖ Locate</button>
        {canSaveAsTicket && (
          <button className="btn-inline" onClick={onSaveAsTicket}>＋ Save as ticket</button>
        )}
      </span>
    </div>
  );
}
