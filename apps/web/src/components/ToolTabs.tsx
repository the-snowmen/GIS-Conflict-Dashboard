import { useRef } from "react";
import type { ReactNode } from "react";

// A mode-scoped tab strip for the right tools column. One panel visible at a
// time (progressive disclosure), with an accessible ARIA tablist + roving
// tabindex + arrow-key navigation. The active panel content is passed as children.
export default function ToolTabs({
  tabs,
  active,
  onSelect,
  children,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const move = (id: string) => {
    onSelect(id);
    // focus the newly-selected tab (roving tabindex) after the click/keypress
    listRef.current?.querySelector<HTMLButtonElement>(`#tab-${id}`)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    if (i < 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(tabs[(i + 1) % tabs.length].id);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(tabs[(i - 1 + tabs.length) % tabs.length].id);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(tabs[0].id);
    } else if (e.key === "End") {
      e.preventDefault();
      move(tabs[tabs.length - 1].id);
    }
  };

  return (
    <div className="tooltabs">
      <div className="tablist" role="tablist" aria-label="Tools" ref={listRef} onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            className={`tab${active === t.id ? " active" : ""}`}
            onClick={() => onSelect(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`}>
        {children}
      </div>
    </div>
  );
}
