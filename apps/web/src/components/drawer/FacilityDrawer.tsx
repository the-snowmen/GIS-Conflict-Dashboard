import { fmtMeters } from "../../lib/geometry";
import type { ConflictFacility } from "../../types";

// The contextual drawer: detailed attributes of one conflicting facility. Desktop:
// floats over the map's right edge; mobile: flows in-sheet at the top of the
// facilities evidence (inSheet). Opened by a Facilities-row click or a conflict-line
// map click; closed by ✕ / Escape / the next run.
export default function FacilityDrawer({
  facility,
  onCenter,
  onClose,
  inSheet = false,
}: {
  facility: ConflictFacility;
  onCenter: (f: ConflictFacility) => void;
  onClose: () => void;
  inSheet?: boolean;
}) {
  const name = facility.asset_ref ?? facility.owner ?? "Facility";
  const typeBits = [facility.asset_type, facility.nominal_kv != null ? `${facility.nominal_kv} kV` : null, facility.voltage_class]
    .filter(Boolean)
    .join(" · ");
  // Geometry-type heuristic, labeled approximate like distances: a point facility
  // lies inside the AOI; a line crosses into it.
  const relationship = facility.geometry?.type === "Point" ? "inside the area" : "intersects the area";
  return (
    <aside className={`drawer${inSheet ? " in-sheet" : ""}`} role="dialog" aria-label={`Facility ${name}`}>
      <div className="drawer-head">
        <h2>{name}{facility.id != null && <span className="drawer-id">#{facility.id}</span>}</h2>
        <button className="tp-close" onClick={onClose} aria-label="Close facility detail">✕</button>
      </div>
      <div className="drawer-rel">≈ {relationship}</div>
      <div className="drawer-rows">
        <div className="tp-row"><span className="muted">Owner</span><span>{facility.owner ?? "—"}</span></div>
        {typeBits && <div className="tp-row"><span className="muted">Type</span><span>{typeBits}</span></div>}
        <div className="tp-row"><span className="muted">Status</span><span>{facility.status ?? "—"}</span></div>
        {facility.dist_m != null && (
          <div className="tp-row"><span className="muted">Distance</span><span>≈ {fmtMeters(facility.dist_m)} from area</span></div>
        )}
      </div>
      <div className="drawer-actions">
        <button className="btn-inline ghost" onClick={() => onCenter(facility)}>⌖ Center on map</button>
      </div>
    </aside>
  );
}
