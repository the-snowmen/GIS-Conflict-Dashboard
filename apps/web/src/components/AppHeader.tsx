import type { Stats } from "../services/demo";
import type { Altitude } from "../types";
import Info from "./Info";
import ModeToggle from "./ModeToggle";
import StatChips from "./StatChips";

// The top app bar: rail toggles (desktop), brand block, the Tickets/Cell-index mode toggle,
// the live stat chips (flagged count overlaid from the live rule), and the help button.
export default function AppHeader({
  isMobile,
  leftOpen,
  onToggleLeft,
  rightOpen,
  onToggleRight,
  label,
  altitude,
  onAltitude,
  stats,
  flaggedCount,
  onOpenHelp,
}: {
  isMobile: boolean;
  leftOpen: boolean;
  onToggleLeft: () => void;
  rightOpen: boolean;
  onToggleRight: () => void;
  label: string;
  altitude: Altitude;
  onAltitude: (a: Altitude) => void;
  stats: Stats | null;
  flaggedCount: number;
  onOpenHelp: () => void;
}) {
  return (
    <header className="appbar">
      {!isMobile && (
        <button
          className="rail-toggle"
          onClick={onToggleLeft}
          aria-pressed={leftOpen}
          aria-label={leftOpen ? "Hide detail panel" : "Show detail panel"}
          title={leftOpen ? "Hide detail panel" : "Show detail panel"}
        >
          ▤
        </button>
      )}
      <div className="brand">
        <span className="brand-mark" aria-hidden>◈</span>
        <div className="brand-text">
          <h1>GIS Conflict<span className="h1-rest"> Dashboard</span></h1>
          <p className="brand-sub">
            Find work tickets that conflict with transmission lines
            <Info title="Runs entirely in your browser — no server, and your data never leaves your machine." />
            {label ? ` · ${label}` : ""}
          </p>
        </div>
      </div>
      <ModeToggle altitude={altitude} onAltitude={onAltitude} />
      {stats && <StatChips stats={{ ...stats, conflicts: flaggedCount }} />}
      <button
        className="rail-toggle help-btn"
        onClick={onOpenHelp}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
      >
        ?
      </button>
      {!isMobile && (
        <button
          className="rail-toggle"
          onClick={onToggleRight}
          aria-pressed={rightOpen}
          aria-label={rightOpen ? "Hide tools panel" : "Show tools panel"}
          title={rightOpen ? "Hide tools panel" : "Show tools panel"}
        >
          ⚙
        </button>
      )}
    </header>
  );
}
