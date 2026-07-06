import type { Ref } from "react";
import type { Geometry } from "geojson";
import Info from "./Info";
import { fmtMeters } from "../lib/geometry";
import type { ConflictFacility, TicketInfo } from "../types";

// Ticket detail panel: identity + Recorded-vs-Live conflict pills + the itemized
// "why flagged" dossier (per-facility rows; hover pulses the line, click flies to it).
export default function TicketDetail({
  info,
  panelRef,
  onRecenter,
  onEdit,
  onClose,
  onExportKmz,
  onHoverFacility,
  onLeaveFacility,
  onInspectFacility,
}: {
  info: TicketInfo;
  panelRef: Ref<HTMLElement>;
  onRecenter: () => void;
  onEdit: () => void;
  onClose: () => void;
  onExportKmz: () => void;
  onHoverFacility: (geom: Geometry | null) => void;
  onLeaveFacility: () => void;
  onInspectFacility: (f: ConflictFacility) => void;
}) {
  return (
    <aside className="inspector card" ref={panelRef} tabIndex={-1} aria-label="Ticket detail">
      <button className="tp-back" onClick={onClose}>‹ Back to list</button>
      <div className="tp-head">
        <h2>Ticket detail</h2>
        <div className="tp-actions">
          <button className="mini" title="Re-center on ticket" aria-label="Re-center map on ticket" onClick={onRecenter}>
            ⌖
          </button>
          <button className="mini" title="Edit ticket" onClick={onEdit}>
            ✎
          </button>
          <button className="tp-close" onClick={onClose} aria-label="Close ticket detail">✕</button>
        </div>
      </div>
      <div className="tp-id">{info.ticket_id}</div>
      <div className="tp-row"><span className="muted">Source</span><span>{info.source}</span></div>
      <div className="tp-row"><span className="muted">Status</span><span>{info.status}</span></div>
      <div className="tp-row"><span className="muted">County <Info term="jurisdiction" /></span><span>{info.county ?? "—"}</span></div>
      <div className="tp-row">
        <span className="muted">
          Recorded (intake)
          <Info title="Conflict count captured at intake, using the ticket's recorded radius and a planar (UTM) buffer." />
        </span>
        <span className={`pill ${info.storedCount > 0 ? "conflict" : "clear"}`}>
          {info.storedCount > 0 ? `${info.storedCount} conflict` : "clear"}
        </span>
      </div>
      <div className="tp-row">
        <span className="muted">
          Live · {info.radius} m
          <Info title="Recomputed now at the current radius, a geodesic buffer, and the live conflict rule. It can differ from Recorded when the radius, buffer method, or rule differ — this is expected." />
        </span>
        <span className={`pill ${info.liveCount > 0 ? "conflict" : "clear"}`}>
          {info.liveCount > 0 ? `${info.liveCount} conflict` : "clear"}
        </span>
      </div>
      <p className="tp-note muted">
        Recorded = intake snapshot; Live = recomputed at the current radius. They differ by design.
      </p>
      <div className="tp-export">
        <button className="mini" onClick={onExportKmz} title="Export buffer + conflicts as KMZ (Google Earth)">⤓ KMZ</button>
      </div>
      {info.facilities.length > 0 && (
        <div className="tp-facs">
          <h3>
            Why flagged <span className="muted">· {info.facilities.length} conflicting {info.facilities.length === 1 ? "facility" : "facilities"}, click to inspect</span>
          </h3>
          <p className="tp-facs-why muted">
            Owned by your network, not excluded by status, inside the {info.radius} m AOI.
          </p>
          {info.facilities.map((f, i) => (
            <button
              key={f.id ?? i}
              type="button"
              className="tp-fac"
              title="Click to inspect · hover to locate on map"
              onMouseEnter={() => onHoverFacility(f.geometry ?? null)}
              onMouseLeave={onLeaveFacility}
              onFocus={() => onHoverFacility(f.geometry ?? null)}
              onBlur={onLeaveFacility}
              onClick={() => onInspectFacility(f)}
            >
              <span className="tp-fac-name">
                {f.owner ?? "—"}
                {f.id != null && <span className="tp-fac-id">#{f.id}</span>}
              </span>
              <span className="meta">
                {[f.voltage_class, f.status, f.dist_m != null ? `≈ ${fmtMeters(f.dist_m)}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
