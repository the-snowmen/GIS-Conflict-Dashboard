// First-run callout floated over the map (dismissed flag persisted by the caller).
// Points at the primary task — assess a work area — with a one-click example.
export default function WelcomeCallout({
  onDismiss,
  onExample,
}: {
  onDismiss: () => void;
  onExample: () => void;
}) {
  return (
    <div className="welcome">
      <span>
        <strong>Assess a work area:</strong> pick a ticket or place a point, set a distance,
        then <strong>Run analysis</strong>. Or switch to <strong>Screen portfolio</strong> to find
        the cells worth reviewing first.
        <button type="button" className="welcome-example" onClick={onExample}>
          Show me an example
        </button>
      </span>
      <button className="welcome-x" aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
