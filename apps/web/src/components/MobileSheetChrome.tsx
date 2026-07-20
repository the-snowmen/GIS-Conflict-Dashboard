import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

// The phone-only bottom-sheet chrome: the drag handle, the collapsed-state status
// line (current task + result count), and the Setup | Results segmented control —
// the same workspace/results split as the desktop layout.
export default function MobileSheetChrome({
  detent,
  tab,
  statusLine,
  onGrabDown,
  onGrabMove,
  onGrabUp,
  onHandleClick,
  onSelectTab,
}: {
  detent: "collapsed" | "half" | "full";
  tab: "setup" | "results";
  statusLine: ReactNode;
  onGrabDown: (e: ReactPointerEvent) => void;
  onGrabMove: (e: ReactPointerEvent) => void;
  onGrabUp: (e: ReactPointerEvent) => void;
  onHandleClick: () => void;
  onSelectTab: (tab: "setup" | "results") => void;
}) {
  return (
    <div className="sheet-chrome">
      <div
        className="sheet-grab"
        onPointerDown={onGrabDown}
        onPointerMove={onGrabMove}
        onPointerUp={onGrabUp}
        onPointerCancel={onGrabUp}
      >
        <button
          className="sheet-handle"
          onClick={onHandleClick}
          aria-label={`Panel size: ${detent}. Activate to resize.`}
        />
      </div>
      {detent === "collapsed" && (
        <button type="button" className="sheet-status" onClick={onHandleClick}>
          {statusLine}
        </button>
      )}
      {detent !== "collapsed" && (
        <div className="sheet-seg" role="group" aria-label="Panel content">
          <button
            type="button"
            className={`seg-btn${tab === "setup" ? " active" : ""}`}
            aria-pressed={tab === "setup"}
            onClick={() => onSelectTab("setup")}
          >
            Setup
          </button>
          <button
            type="button"
            className={`seg-btn${tab === "results" ? " active" : ""}`}
            aria-pressed={tab === "results"}
            onClick={() => onSelectTab("results")}
          >
            Results
          </button>
        </div>
      )}
    </div>
  );
}
