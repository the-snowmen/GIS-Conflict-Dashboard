// First-run callout floated over the map (dismissed flag persisted by the caller).
export default function WelcomeCallout({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="welcome">
      <span>
        Start with <strong>H3 screening</strong> to find priority work clusters, then drill into ticket
        evidence — or import a <strong>KMZ / KML AOI</strong>.
      </span>
      <button className="welcome-x" aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
