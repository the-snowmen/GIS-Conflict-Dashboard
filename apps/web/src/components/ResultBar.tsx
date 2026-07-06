import type { ConflictInfo } from "../types";

// The floating AOI-outcome bar (conflict count + jurisdiction + provenance + actions).
export default function ResultBar({
  conflict,
  canSaveAsTicket,
  onRecenter,
  onExportKmz,
  onSaveAsTicket,
}: {
  conflict: ConflictInfo;
  canSaveAsTicket: boolean;
  onRecenter: () => void;
  onExportKmz: () => void;
  onSaveAsTicket: () => void;
}) {
  return (
    <div className="result">
      {conflict.count > 0 ? (
        <span>⚠ <strong>{conflict.count}</strong> facility conflict{conflict.count > 1 ? "s" : ""}</span>
      ) : (
        <span>✓ <strong>no</strong> conflicts</span>
      )}
      <span className="muted">· {conflict.jurisdiction ?? "outside the coverage area"} · {conflict.via}</span>
      <span className="result-actions">
        <button className="btn-inline ghost" onClick={onRecenter} title="Re-center the map on this area">⌖ Locate</button>
        <button className="btn-inline ghost" onClick={onExportKmz} title="Download buffer + conflicting facilities as KMZ (Google Earth)">⤓ KMZ</button>
        {canSaveAsTicket && (
          <button className="btn-inline" onClick={onSaveAsTicket}>＋ Save as ticket</button>
        )}
      </span>
    </div>
  );
}
