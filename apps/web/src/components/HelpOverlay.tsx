import { useEffect, useRef } from "react";

const SHORTCUTS: [string, string][] = [
  ["/", "Focus the ticket search box"],
  ["1 / 2", "Assess work area / Screen portfolio"],
  ["b", "Place a work-area point"],
  ["d", "Draw a work-area polygon"],
  ["n", "New local ticket"],
  ["Esc", "Cancel placement, close the form, or collapse the sheet"],
  ["?", "Show or hide this help"],
];

// A small modal listing the keyboard shortcuts. Closed by the ✕, the backdrop, or Escape.
export default function HelpOverlay({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <div className="help-backdrop" onClick={onClose}>
      <div
        className="help-card"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-head">
          <h2>Keyboard shortcuts</h2>
          <button ref={closeRef} className="tp-close" onClick={onClose} aria-label="Close help">✕</button>
        </div>
        <dl className="help-list">
          {SHORTCUTS.map(([k, d]) => (
            <div className="help-row" key={k}>
              <dt><kbd>{k}</kbd></dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
