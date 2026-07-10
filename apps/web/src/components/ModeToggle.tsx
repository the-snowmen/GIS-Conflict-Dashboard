import type { Altitude } from "../types";

// Top-level app mode: Tickets vs the H3 Cell-index. Lives in the app bar; switching
// re-scopes the whole app (map layers, left column, right tools).
export default function ModeToggle({
  altitude,
  onAltitude,
}: {
  altitude: Altitude;
  onAltitude: (a: Altitude) => void;
}) {
  return (
    <div className="mode-seg" role="group" aria-label="Map mode">
      <button
        type="button"
        className={`mode-btn ${altitude === "tickets" ? "active" : ""}`}
        aria-pressed={altitude === "tickets"}
        onClick={() => onAltitude("tickets")}
      >
        Tickets
      </button>
      <button
        type="button"
        className={`mode-btn ${altitude === "cells" ? "active" : ""}`}
        aria-pressed={altitude === "cells"}
        onClick={() => onAltitude("cells")}
      >
        H3 screening
      </button>
    </div>
  );
}
