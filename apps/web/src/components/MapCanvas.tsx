import type { Ref } from "react";
import type { Phase } from "../types";
import WelcomeCallout from "./WelcomeCallout";

// The map viewport: the MapLibre container (its ref is owned by the caller, which
// attaches the MapController on mount), the first-run welcome callout, and the
// boot/error overlay. Results live in the tray below the map, not over it.
export default function MapCanvas({
  mapRef,
  phase,
  err,
  showWelcome,
  onDismissWelcome,
  onExample,
}: {
  mapRef: Ref<HTMLDivElement>;
  phase: Phase;
  err: string;
  showWelcome: boolean;
  onDismissWelcome: () => void;
  onExample: () => void;
}) {
  return (
    <main className="map-wrap" id="main-map">
      <div id="map" ref={mapRef} />
      {showWelcome && <WelcomeCallout onDismiss={onDismissWelcome} onExample={onExample} />}
      {phase !== "ready" && (
        <div className="loading">
          <div className="box">
            <div className="spinner" />
            {phase === "loading" ? "Booting DuckDB-WASM + loading GeoParquet…" : `Error: ${err}`}
          </div>
        </div>
      )}
    </main>
  );
}
