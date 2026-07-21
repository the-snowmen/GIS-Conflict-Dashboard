import { useCallback, useEffect, useRef, useState } from "react";
import Info from "./Info";
import Legend from "./Legend";

// Focusable candidates inside the popover; the tabIndex >= 0 filter drops the hidden
// file input (tabIndex -1) so focus never parks on it.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

// The map-anchored layers popover: layer toggles, overlay import, and the legend,
// one click from the map they describe (replacing the old right-rail Layers tab).
export default function LayersPopover({
  hexOn,
  onToggleHex,
  kmzName,
  onImportKmz,
  onClearKmz,
  legendOpen,
  onToggleLegend,
}: {
  hexOn: boolean;
  onToggleHex: () => void;
  kmzName: string | null;
  onImportKmz: (file: File) => void;
  onClearKmz: () => void;
  legendOpen: boolean;
  onToggleLegend: () => void;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Every close path routes through here so focus lands back on the trigger instead of
  // at the top of the document.
  const close = useCallback(() => {
    setOpen(false);
    btnRef.current?.focus();
  }, []);

  // Move focus in on open and wrap Tab inside the panel: the backdrop makes the rest of
  // the page unclickable, so letting Tab walk out of it strands focus. Escape follows a
  // ladder — a tooltip inside the panel takes it first, the help overlay above takes it
  // instead, and only in between does it close the panel.
  useEffect(() => {
    if (!open) return;
    const focusables = () =>
      Array.from(popRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.tabIndex >= 0,
      );
    focusables()[0]?.focus();
    // A surface that declares itself modal (the help overlay) renders above this panel.
    // A declared modal outranks a popover, so while one is up both Escape and Tab are
    // its business, not ours.
    const modalAbove = () =>
      Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(
        (el) => !popRef.current?.contains(el),
      );
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Tab") return;
      if (modalAbove()) return;
      if (e.key === "Escape") {
        // Escape belongs to this panel or to a tooltip inside it — never to the surfaces
        // behind the backdrop, so stop it here either way.
        e.stopPropagation();
        // An Info tooltip in the panel already consumed the key (it marks the event with
        // preventDefault from the capture phase); that dismissal is the whole action.
        if (e.defaultPrevented) return;
        close();
        return;
      }
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      const cur = document.activeElement;
      // Guard both directions: clicking non-focusable panel content (the heading, the
      // imported-layer text) leaves activeElement on <body>, and an unguarded Tab from
      // there walks straight out of the panel.
      const outside = !popRef.current?.contains(cur);
      if (e.shiftKey && (cur === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (cur === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`map-pop-btn${open ? " active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Layers, import, and legend"
        title="Layers, import, and legend"
      >
        ▤ Layers
      </button>
      {open && (
        <>
          <button
            type="button"
            className="map-pop-backdrop"
            aria-label="Close layers"
            onClick={close}
          />
          {/* No aria-modal: the panel keeps focus in and dims the map, but it leaves the
              rest of the page exposed to assistive tech, and its "?" tooltips portal to
              <body> outside this subtree. Claiming modality would hide the very glossary
              text the chips point at with aria-describedby. */}
          <div
            className="map-pop"
            ref={popRef}
            role="dialog"
            aria-label="Layers, import, and legend"
          >
            <div className="map-pop-head">
              <h2>Layers</h2>
              <button className="tp-close" onClick={close} aria-label="Close layers">✕</button>
            </div>
            <label className="layer-toggle">
              <input type="checkbox" checked={hexOn} onChange={onToggleHex} />
              <span>
                Ticket density heatmap <Info term="h3" />
                <span className="muted layer-toggle-sub">Ticket clusters binned into H3 hexes.</span>
              </span>
            </label>
            <button className="btn" onClick={() => inputRef.current?.click()}>
              ⤓ Import KML / KMZ / GeoJSON
            </button>
            <input
              ref={inputRef}
              className="sr-only" tabIndex={-1} aria-hidden="true"
              type="file" accept=".kmz,.kml,.geojson,.json"
              onClick={(e) => { e.currentTarget.value = ""; }}
              onChange={(e) => e.target.files?.[0] && onImportKmz(e.target.files[0])}
            />
            {kmzName && (
              <div className="kmz-loaded">
                <span className="muted">{kmzName} · click a feature on the map to use it as the work area</span>
                <button className="mini" onClick={onClearKmz} title="Remove the imported layer">✕ Remove</button>
              </div>
            )}
            <Legend open={legendOpen} onToggle={onToggleLegend} />
          </div>
        </>
      )}
    </>
  );
}
