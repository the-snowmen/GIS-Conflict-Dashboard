import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { AppMode, EditingState, Mode } from "../types";

type SheetDetent = "collapsed" | "half" | "full";

// Global keyboard shortcuts + the Escape "close the topmost surface" ladder. Pure wiring over
// state and handlers owned by the container; registers/cleans up its own window listeners.
export function useKeyboardShortcuts({
  editing,
  mapMode,
  drawerOpen,
  closeDrawer,
  cancelEditing,
  cancelMapMode,
  isMobile,
  sheetDetent,
  setSheetDetent,
  helpOpen,
  setHelpOpen,
  appMode,
  goMode,
  startPoint,
  startDraw,
  startAddTicket,
}: {
  editing: EditingState | null;
  mapMode: Mode;
  drawerOpen: boolean;
  closeDrawer: () => void;
  cancelEditing: () => void;
  cancelMapMode: () => void;
  isMobile: boolean;
  sheetDetent: SheetDetent;
  setSheetDetent: Dispatch<SetStateAction<SheetDetent>>;
  helpOpen: boolean;
  setHelpOpen: Dispatch<SetStateAction<boolean>>;
  appMode: AppMode;
  goMode: (m: AppMode) => void;
  startPoint: () => void;
  startDraw: () => void;
  startAddTicket: () => void;
}) {
  // Escape closes the topmost transient surface: help > facility drawer > edit form >
  // map-placement crosshair > mobile sheet. The work area itself is deliberate state —
  // it's cleared via its ✕ control, not by Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || helpOpen) return;
      if (drawerOpen) closeDrawer();
      else if (editing) cancelEditing();
      else if (mapMode !== "idle") cancelMapMode();
      else if (isMobile && sheetDetent !== "collapsed") setSheetDetent("collapsed");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeDrawer, editing, mapMode, cancelEditing, cancelMapMode, isMobile, sheetDetent, setSheetDetent, helpOpen]);

  // Global keyboard shortcuts (ignored while typing in a field). "?" toggles the
  // help overlay; while it's open, only Escape (to close) is honored.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") { e.preventDefault(); setHelpOpen((o) => !o); return; }
      if (helpOpen) { if (e.key === "Escape") setHelpOpen(false); return; }
      switch (e.key) {
        case "/":
          e.preventDefault();
          document.querySelector<HTMLInputElement>('input[name="ticket-search"]')?.focus();
          break;
        case "1": goMode("assess"); break;
        case "2": goMode("screen"); break;
        case "b": if (appMode === "assess") startPoint(); break;
        case "d": if (appMode === "assess") startDraw(); break;
        case "n": if (appMode === "assess") startAddTicket(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, setHelpOpen, appMode, goMode, startPoint, startDraw, startAddTicket]);
}
