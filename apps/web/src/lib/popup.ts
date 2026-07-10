// Map inspect-popup DOM builder. Values are set via textContent (never innerHTML),
// so arbitrary KMZ property values cannot inject markup/script.

// Field schema per clickable layer -> ordered [label, value] rows for the popup.
export function rowsForLayer(layerId: string, props: Record<string, unknown>): { title: string; rows: [string, string][] } {
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const keep = (rows: [string, string][]) => rows.filter(([, v]) => v !== "");
  switch (layerId) {
    case "facilities-line":
    case "conflict-line":
      return {
        title: "Transmission line",
        rows: keep([
          ["Asset", s(props.asset_ref)],
          ["Type", s(props.asset_type)],
          ["Owner", s(props.owner)],
          ["Nominal kV", s(props.nominal_kv)],
          ["Voltage", s(props.voltage_class)],
          ["Status", s(props.status)],
          ["ID", s(props.id)],
        ]),
      };
    case "hex-fill":
      return { title: "Ticket density", rows: [["Tickets", s(props.count)]] };
    default: // kmz-line / kmz-fill / kmz-point — arbitrary user-supplied properties
      return {
        title: "Imported feature",
        rows: keep(Object.entries(props).map(([k, v]) => [k, s(v)] as [string, string])).slice(0, 12),
      };
  }
}

// Build a popup body as a DOM node.
export function buildPopupNode(layerId: string, props: Record<string, unknown>): HTMLElement {
  const { title, rows } = rowsForLayer(layerId, props);
  const root = document.createElement("div");
  root.className = "ip";
  const head = document.createElement("div");
  head.className = "ip-title";
  head.textContent = title;
  root.appendChild(head);
  for (const [k, v] of rows) {
    const row = document.createElement("div");
    row.className = "ip-row";
    const key = document.createElement("span");
    key.className = "ip-k";
    key.textContent = k;
    const val = document.createElement("span");
    val.className = "ip-v";
    val.textContent = v;
    row.append(key, val);
    root.appendChild(row);
  }
  return root;
}
