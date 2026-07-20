import type { CSSProperties } from "react";

// The map legend — a collapsible key of every styled layer. Collapse state is owned
// by the caller (persisted across reloads).
export default function Legend({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <section className="card">
      <button className="panel-head" onClick={onToggle}>
        <h2>Legend</h2>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="legend">
          <LegendItem c="#c3d2e8" t="Our transmission (eligible)" kind="line" />
          <LegendItem c="#8b96b5" t="Other-owner transmission" kind="line" />
          <LegendItem c="#22d3c5" t="Ticket — no conflict (dot)" kind="point" />
          <LegendItem c="#ff9f43" t="Ticket — potential conflict (dot)" kind="point" />
          <LegendItem c="#ffd166" t="Active AOI" kind="polygon" />
          <LegendItem c="#ff5252" t="Conflicting facility" kind="line" />
          <LegendItem c="#c08bff" t="Imported KMZ / KML" kind="line" />
        </div>
      )}
    </section>
  );
}

function LegendItem({ c, t, kind }: { c: string; t: string; kind: "point" | "line" | "polygon" | "tri" }) {
  return (
    <div className="item">
      <span className={`glyph glyph-${kind}`} style={{ "--c": c } as CSSProperties} />
      {t}
    </div>
  );
}
