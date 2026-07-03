import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Plain-English glossary for the "?" jargon chips. A term is defined once here and
// reused wherever it appears, so the copy never drifts.
const GLOSSARY: Record<string, ReactNode> = {
  aoi: "Area of Interest — the polygon (a buffered point or a drawn shape) the conflict analysis runs inside.",
  buffer:
    "A geodesic circle of a set radius (in meters) around a point, computed in the browser by the geokit WASM engine — the AOI for a single spot.",
  h3: "Uber's hexagonal grid. The density heatmap bins tickets into near-uniform hexes so clusters read at a glance.",
  "st-intersects":
    "The spatial test (DuckDB ST_Intersects) that finds facilities whose geometry overlaps the AOI.",
  jurisdiction:
    "The county a point falls in, found with a point-in-polygon test (DuckDB ST_Within).",
  "voltage-class":
    "The facility's transmission voltage band (e.g. 100–161 kV), carried straight from the source data.",
  "conflict-rule":
    "Which facilities count as a conflict: the owners that are 'yours' plus the statuses to exclude. A tunable opinion applied over the fixed facilities.",
  owner:
    "The operator that owns a transmission facility. 'Your network' is the set of owners the conflict rule counts.",
};

interface Props {
  term?: string; // glossary key → looked up in GLOSSARY (renders a "?" chip)
  title?: string; // freeform text (fallback when no term → renders an ⓘ)
  label?: string; // override the trigger glyph
}

// A dependency-free info tooltip: focusable trigger + role="tooltip" popover portaled
// to <body> so its position:fixed resolves against the viewport (never clipped by the
// scrolling rail or a transformed drawer). Opens on hover/focus/click; closes on
// Escape (returns focus), blur, or outside click.
export default function Info({ term, title, label }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  // When Escape returns focus to the trigger, the trigger's onFocus would otherwise
  // reopen the popover; this flag suppresses that one reopen.
  const suppressOpen = useRef(false);

  const body = term ? GLOSSARY[term] ?? null : title ?? null;

  // Position the fixed popover from the trigger rect, clamped to the viewport.
  useLayoutEffect(() => {
    if (!open || !btnRef.current || !popRef.current) return;
    const b = btnRef.current.getBoundingClientRect();
    const el = popRef.current;
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    const m = 8;
    const left = Math.max(m, Math.min(b.left, window.innerWidth - pw - m));
    let top = b.bottom + 6;
    if (top + ph > window.innerHeight - m) top = Math.max(m, b.top - ph - 6); // flip up
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        suppressOpen.current = true;
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!body) return null;

  const openNow = () => {
    if (suppressOpen.current) {
      suppressOpen.current = false; // consume the Escape-driven refocus, stay closed
      return;
    }
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  };

  return (
    <span className="info" ref={wrapRef} onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button
        type="button"
        ref={btnRef}
        className="info-btn"
        aria-label={term ? `What is ${term.replace(/-/g, " ")}?` : "More information"}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={openNow}
        onBlur={closeSoon}
        onClick={() => setOpen((o) => !o)}
      >
        {label ?? (term ? "?" : "ⓘ")}
      </button>
      {open &&
        createPortal(
          // Portal to <body> so position:fixed resolves against the viewport, not a
          // transformed ancestor (the mobile drawer's translateX would otherwise
          // become the containing block and mis-place the popover).
          <span
            id={id}
            role="tooltip"
            className="info-pop"
            ref={popRef}
            onMouseEnter={openNow}
            onMouseLeave={closeSoon}
          >
            {body}
          </span>,
          document.body,
        )}
    </span>
  );
}
