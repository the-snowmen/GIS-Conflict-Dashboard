import type { ReactNode } from "react";
import Info from "./Info";
import ModeTabs from "./ModeTabs";
import type { AppMode } from "../types";

// The top app bar: brand block, the Assess/Screen mode tabs (centered), and the
// meta-actions on the right (saved analyses, help).
export default function Header({
  label,
  mode,
  onMode,
  onOpenHelp,
  savedRuns,
}: {
  label: string;
  mode: AppMode;
  onMode: (m: AppMode) => void;
  onOpenHelp: () => void;
  savedRuns?: ReactNode;
}) {
  return (
    <header className="appbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>◈</span>
        <div className="brand-text">
          <h1>GIS Conflict<span className="h1-rest"> Dashboard</span></h1>
          <p className="brand-sub">
            Assess work areas against infrastructure
            <Info title="Runs entirely in your browser — no server, and your data never leaves your machine." />
            {label ? ` · ${label}` : ""}
          </p>
        </div>
      </div>
      <ModeTabs mode={mode} onMode={onMode} />
      {savedRuns}
      <button
        className="rail-toggle help-btn"
        onClick={onOpenHelp}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
      >
        ?
      </button>
    </header>
  );
}
