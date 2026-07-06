import type { PointerEvent as ReactPointerEvent } from "react";

// The phone-only bottom-sheet chrome: the drag handle + the Browse/Tools segmented control.
export default function MobileSheetChrome({
  detent,
  tab,
  onGrabDown,
  onGrabMove,
  onGrabUp,
  onHandleClick,
  onSelectTab,
}: {
  detent: "collapsed" | "half" | "full";
  tab: "browse" | "tools";
  onGrabDown: (e: ReactPointerEvent) => void;
  onGrabMove: (e: ReactPointerEvent) => void;
  onGrabUp: (e: ReactPointerEvent) => void;
  onHandleClick: () => void;
  onSelectTab: (tab: "browse" | "tools") => void;
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
      <div className="sheet-seg" role="group" aria-label="Panel content">
        <button
          type="button"
          className={`seg-btn${tab === "browse" ? " active" : ""}`}
          aria-pressed={tab === "browse"}
          onClick={() => onSelectTab("browse")}
        >
          Browse
        </button>
        <button
          type="button"
          className={`seg-btn${tab === "tools" ? " active" : ""}`}
          aria-pressed={tab === "tools"}
          onClick={() => onSelectTab("tools")}
        >
          Tools
        </button>
      </div>
    </div>
  );
}
