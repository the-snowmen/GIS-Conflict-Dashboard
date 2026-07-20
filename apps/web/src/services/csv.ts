// CSV export of a run's facility evidence: one row per conflicting facility, with
// the screening-grade distance. CRLF rows + a UTF-8 BOM so Excel opens it cleanly.
import type { ConflictFacility } from "../types";
import { facilityRelation } from "../lib/facilities";

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function facilitiesToCsv(facilities: ConflictFacility[]): string {
  const header = [
    "id", "asset_ref", "owner", "asset_type", "voltage_class", "nominal_kv",
    "status", "relation", "dist_m",
  ];
  const rows = facilities.map((f) => [
    f.id ?? "",
    f.asset_ref ?? "",
    f.owner ?? "",
    f.asset_type ?? "",
    f.voltage_class ?? "",
    f.nominal_kv ?? "",
    f.status ?? "",
    facilityRelation(f),
    f.dist_m != null ? Math.round(f.dist_m) : "",
  ]);
  const body = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  // BOM prefix so spreadsheet apps detect UTF-8.
  return "\uFEFF" + body + "\r\n";
}