import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { Altitude, EditingState, TicketInfo } from "../types";

type SheetDetent = "collapsed" | "half" | "full";

// Global keyboard shortcuts + the Escape "close the topmost surface" ladder. Pure wiring over
// state and handlers owned by the container; registers/cleans up its own window listeners.
export function useKeyboardShortcuts({
  editing,
  ticketInfo,
  cancelEditing,
  clearAoi,
  isMobile,
  sheetDetent,
  setSheetDetent,
  helpOpen,
  setHelpOpen,
  altitude,
  goAltitude,
  setBufferMode,
  setDrawMode,
  startAddTicket,
  setLeftOpen,
  setRightOpen,
}: {
  editing: EditingState | null;
  ticketInfo: TicketInfo | null;
  cancelEditing: () => void;
  clearAoi: () => void;
  isMobile: boolean;
  sheetDetent: SheetDetent;
  setSheetDetent: Dispatch<SetStateAction<SheetDetent>>;
  helpOpen: boolean;
  setHelpOpen: Dispatch<SetStateAction<boolean>>;
  altitude: Altitude;
  goAltitude: (a: Altitude) => void;
  setBufferMode: () => void;
  setDrawMode: () => void;
  startAddTicket: () => void;
  setLeftOpen: Dispatch<SetStateAction<boolean>>;
  setRightOpen: Dispatch<SetStateAction<boolean>>;
}) {
  // Escape closes the topmost transient surface (edit form > detail panel > mobile rail).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || helpOpen) return;
      if (editing) cancelEditing();
      else if (ticketInfo) clearAoi();
      else if (isMobile && sheetDetent !== "collapsed") setSheetDetent("collapsed");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, ticketInfo, cancelEditing, clearAoi, isMobile, sheetDetent, setSheetDetent, helpOpen]);

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
        case "1": goAltitude("tickets"); break;
        case "2": goAltitude("cells"); break;
        case "[": setLeftOpen((o) => !o); break;
        case "]": setRightOpen((o) => !o); break;
        case "b": if (altitude === "tickets") setBufferMode(); break;
        case "d": if (altitude === "tickets") setDrawMode(); break;
        case "n": if (altitude === "tickets") startAddTicket(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, setHelpOpen, altitude, goAltitude, setBufferMode, setDrawMode, startAddTicket, setLeftOpen, setRightOpen]);
}
