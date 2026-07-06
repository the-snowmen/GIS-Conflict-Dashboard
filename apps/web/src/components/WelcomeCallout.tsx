// First-run callout floated over the map (dismissed flag persisted by the caller).
export default function WelcomeCallout({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="welcome">
      <span>
        Find work tickets that conflict with transmission lines — <strong>click a ticket below</strong> to
        start, or drop a <strong>Buffer point</strong>.
      </span>
      <button className="welcome-x" aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
