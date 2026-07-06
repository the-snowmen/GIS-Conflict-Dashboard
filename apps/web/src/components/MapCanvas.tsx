import type { Ref } from "react";
import type { ConflictInfo, Phase } from "../types";
import WelcomeCallout from "./WelcomeCallout";
import ResultBar from "./ResultBar";

// The map viewport: the MapLibre container (its ref is owned by the caller, which attaches
// the MapController on mount), the first-run welcome callout, the AOI result bar, and the
// boot/error overlay.
export default function MapCanvas({
  mapRef,
  phase,
  err,
  conflict,
  showWelcome,
  onDismissWelcome,
  canSaveAsTicket,
  onRecenter,
  onExportKmz,
  onSaveAsTicket,
}: {
  mapRef: Ref<HTMLDivElement>;
  phase: Phase;
  err: string;
  conflict: ConflictInfo | null;
  showWelcome: boolean;
  onDismissWelcome: () => void;
  canSaveAsTicket: boolean;
  onRecenter: () => void;
  onExportKmz: () => void;
  onSaveAsTicket: () => void;
}) {
  return (
    <main className="map-wrap" id="main-map">
      <div id="map" ref={mapRef} />
      {showWelcome && <WelcomeCallout onDismiss={onDismissWelcome} />}
      {conflict && (
        <ResultBar
          conflict={conflict}
          canSaveAsTicket={canSaveAsTicket}
          onRecenter={onRecenter}
          onExportKmz={onExportKmz}
          onSaveAsTicket={onSaveAsTicket}
        />
      )}
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
