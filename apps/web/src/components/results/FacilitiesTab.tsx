import { useEffect, useMemo, useRef, useState } from "react";
import { fmtMeters } from "../../lib/geometry";
import { facilityName, facilityRelation } from "../../lib/facilities";
import type { RunResult } from "../../types";

// The Facilities tab: the itemized evidence — every conflicting facility as a
// sortable, filterable row. Row hover pulses the map line; row click (or a map
// click) opens the drawer and keeps the two selections in lockstep. Selection is
// the facility's index in result.facilities (stable within a run).
interface Props {
  result: RunResult;
  selected: number | null;
  onSelect: (idx: number | null) => void;
  onHover: (idx: number | null) => void;
}

type SortKey = "name" | "owner" | "status" | "relation" | "dist";

export default function FacilitiesTab({ result, selected, onSelect, onHover }: Props) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("dist");
  const [asc, setAsc] = useState(true);

  // The table rows carry their source index so sorting/filtering never loses the
  // map-sync handle. result.facilities arrives nearest-first.
  const rows = useMemo(
    () =>
      result.facilities.map((f, idx) => ({
        idx,
        f,
        name: facilityName(f),
        owner: f.owner ?? "—",
        status: f.status ?? "unknown",
        relation: facilityRelation(f),
        dist: f.dist_m ?? null,
      })),
    [result],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? rows.filter((r) => `${r.name} ${r.owner} ${r.status} ${r.f.id ?? ""}`.toLowerCase().includes(q))
      : rows;
    return [...base].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "dist") cmp = (a.dist ?? Infinity) - (b.dist ?? Infinity);
      else cmp = a[sortKey].localeCompare(b[sortKey]);
      return asc ? cmp : -cmp;
    });
  }, [rows, query, sortKey, asc]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setAsc((v) => !v);
    else {
      setSortKey(k);
      setAsc(true);
    }
  }

  function sortTh(k: SortKey, label: string) {
    const active = sortKey === k;
    return (
      <th aria-sort={active ? (asc ? "ascending" : "descending") : undefined}>
        <button type="button" className={`th-sort${active ? " active" : ""}`} onClick={() => toggleSort(k)}>
          {label}
          <span aria-hidden="true" className="th-arrow">{active ? (asc ? "▲" : "▼") : "△"}</span>
        </button>
      </th>
    );
  }

  // A map click selects a row — reveal it even when it sits outside the scrollport.
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  useEffect(() => {
    if (selected == null) return;
    rowRefs.current.get(selected)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // A run that found nothing is a clear verdict, not a blank table — say so, and
  // point at the two honest follow-ups (widen the distance, broaden the rule).
  if (rows.length === 0) {
    return (
      <div className="empty fac-clear">
        <span aria-hidden="true">✓</span>
        <p>No facilities intersect this area under the current rule — the area is clear.</p>
        <p className="dim">
          To double-check, widen the distance or broaden the conflict rule, then re-run the analysis.
        </p>
      </div>
    );
  }

  return (
    <div className="facilities-tab">
      <div className="fac-filter">
        <input
          type="search"
          placeholder={`Filter ${rows.length} facilit${rows.length === 1 ? "y" : "ies"}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter facilities"
        />
        {query && (
          <span className="fac-filter-count">
            {filtered.length} of {rows.length}
          </span>
        )}
      </div>
      <div className="fac-scroll">
        <table className="fac-table">
          <thead>
            <tr>
              {sortTh("name", "Facility")}
              {sortTh("owner", "Owner")}
              {sortTh("status", "Status")}
              {sortTh("relation", "Relation")}
              {sortTh("dist", "Distance")}
              <th><span className="sr-only">Inspect</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.idx}
                ref={(el) => {
                  if (el) rowRefs.current.set(r.idx, el);
                  else rowRefs.current.delete(r.idx);
                }}
                className={r.idx === selected ? "selected" : undefined}
                aria-selected={r.idx === selected}
                onMouseEnter={() => onHover(r.idx)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onSelect(r.idx)}
              >
                <td>
                  <span className="fac-name">{r.name}</span>
                  {r.f.id != null && <span className="fac-id">#{r.f.id}</span>}
                </td>
                <td>{r.owner}</td>
                <td>
                  <span className={`pill pill-${r.status.toLowerCase()}`}>{r.status}</span>
                </td>
                <td>{r.relation}</td>
                <td className="num">{r.dist != null ? `≈ ${fmtMeters(r.dist)}` : "—"}</td>
                <td>
                  <button
                    type="button"
                    className="btn-inline ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(r.idx);
                    }}
                  >
                    Inspect
                  </button>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={6} className="fac-empty">No facilities match “{query}”.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="fac-hint small dim">
        Distance is screening-grade (≈, from the area anchor) · hover a row to flash its line · click
        to inspect.
      </p>
    </div>
  );
}
