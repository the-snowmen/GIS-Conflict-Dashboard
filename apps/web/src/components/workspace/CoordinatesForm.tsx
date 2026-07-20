import { useState } from "react";

// Lat/lon entry for the work-area step (keyboard-friendly path to placing a point).
export default function CoordinatesForm({
  onSubmit,
}: {
  onSubmit: (lng: number, lat: number) => void;
}) {
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const latN = Number(lat);
  const lonN = Number(lon);
  const valid =
    lat.trim() !== "" && lon.trim() !== "" &&
    Number.isFinite(latN) && Number.isFinite(lonN) &&
    latN >= -90 && latN <= 90 && lonN >= -180 && lonN <= 180;

  return (
    <form
      className="coord-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(lonN, latN);
      }}
    >
      <label className="fld">
        Latitude
        <input
          inputMode="decimal"
          placeholder="30.2672"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          aria-invalid={lat.trim() !== "" && !(Number.isFinite(latN) && latN >= -90 && latN <= 90)}
        />
      </label>
      <label className="fld">
        Longitude
        <input
          inputMode="decimal"
          placeholder="-97.7431"
          value={lon}
          onChange={(e) => setLon(e.target.value)}
          aria-invalid={lon.trim() !== "" && !(Number.isFinite(lonN) && lonN >= -180 && lonN <= 180)}
        />
      </label>
      <button className="btn" type="submit" disabled={!valid} title={valid ? "Place the work point here" : "Enter a valid latitude and longitude"}>
        Set point
      </button>
    </form>
  );
}
