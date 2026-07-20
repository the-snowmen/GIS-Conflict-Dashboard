import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type SheetDetent = "collapsed" | "half" | "full";
// The two sheet pages — the same workspace/results split as the desktop layout.
type SheetTab = "setup" | "results";

const DETENT_VH: Record<SheetDetent, number> = { collapsed: 0, half: 52, full: 90 };
const DETENT_ORDER = ["collapsed", "half", "full"] as const;

// The mobile (phone) bottom-sheet: detent (collapsed/half/full) + pointer-drag resize.
// Self-contained; the caller reads `sheetDetent`/`sheetTab`/`sheetH` for the root layout
// and renders the chrome, wiring the returned handlers to it.
export function useMobileSheet() {
  const [sheetTab, setSheetTab] = useState<SheetTab>("setup");
  const [sheetDetent, setSheetDetent] = useState<SheetDetent>("half");
  const [sheetDragVh, setSheetDragVh] = useState<number | null>(null);
  const sheetDragRef = useRef<{ startY: number; startVh: number } | null>(null);
  const sheetMovedRef = useRef(false);

  const sheetH = sheetDragVh ?? DETENT_VH[sheetDetent];

  const cycleSheet = () =>
    setSheetDetent((d) => DETENT_ORDER[(DETENT_ORDER.indexOf(d) + 1) % DETENT_ORDER.length]);

  const onGrabDown = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    sheetDragRef.current = { startY: e.clientY, startVh: DETENT_VH[sheetDetent] };
    sheetMovedRef.current = false;
  };
  const onGrabMove = (e: ReactPointerEvent) => {
    const d = sheetDragRef.current;
    if (!d) return;
    const deltaVh = ((d.startY - e.clientY) / window.innerHeight) * 100;
    if (Math.abs(deltaVh) > 1) sheetMovedRef.current = true;
    setSheetDragVh(Math.max(0, Math.min(94, d.startVh + deltaVh)));
  };
  const onGrabUp = () => {
    if (!sheetDragRef.current) return;
    const cur = sheetDragVh ?? DETENT_VH[sheetDetent];
    const nearest = DETENT_ORDER.reduce((a, b) =>
      Math.abs(DETENT_VH[b] - cur) < Math.abs(DETENT_VH[a] - cur) ? b : a,
    );
    sheetDragRef.current = null;
    setSheetDragVh(null);
    setSheetDetent(nearest);
  };

  // Tap the handle: swallow the tap that concluded a drag, else cycle detents.
  const onHandleClick = () => {
    if (sheetMovedRef.current) {
      sheetMovedRef.current = false;
      return;
    }
    cycleSheet();
  };

  // Switch sheet content; raise from collapsed so the new content is visible.
  const selectTab = (tab: SheetTab) => {
    setSheetTab(tab);
    if (sheetDetent === "collapsed") setSheetDetent("half");
  };

  return {
    sheetTab,
    sheetDetent,
    setSheetDetent,
    sheetH,
    onGrabDown,
    onGrabMove,
    onGrabUp,
    onHandleClick,
    selectTab,
  };
}
