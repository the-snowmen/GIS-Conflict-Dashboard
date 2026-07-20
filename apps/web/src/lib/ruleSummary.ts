import type { ConflictRule, FacilityFacets } from "../services/demo";

const humanList = (xs: string[]): string =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

// One plain-language sentence describing the active conflict rule, e.g.
// "Counts active and planned facilities owned by Operator Alpha, excluding retired."
export function ruleSummary(rule: ConflictRule, facets: FacilityFacets | null): string {
  if (rule.selfOwners.length === 0) return "Counts nothing — no owners are selected.";
  const owners = humanList(rule.selfOwners);
  const counted = facets ? facets.statuses.filter((s) => !rule.excludedStatuses.includes(s)) : [];
  const countedPart = counted.length ? `${humanList(counted)} facilities` : "facilities";
  const exclPart = rule.excludedStatuses.length ? `, excluding ${humanList(rule.excludedStatuses)}` : "";
  return `Counts ${countedPart} owned by ${owners}${exclPart}.`;
}
