import type { ReactNode } from "react";
import type { AppMode } from "../../types";

// The mode-scoped task panel (desktop left column; mobile "Setup" sheet page).
// One job at a time: the assess steps, or the screening controls.
export default function WorkspacePanel({
  mode,
  children,
}: {
  mode: AppMode;
  children: ReactNode;
}) {
  return (
    <aside
      className="workspace"
      aria-label={mode === "assess" ? "Assess work area workspace" : "Screen portfolio workspace"}
    >
      {children}
    </aside>
  );
}
