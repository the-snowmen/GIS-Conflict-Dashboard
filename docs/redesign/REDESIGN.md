# GIS Conflict Dashboard — Redesign Package

**Status:** approved as the design baseline; implementation pending design review.
This document is the tracked design doc for the redesign (work happens on the `dev-kimi`
branch). It defines the experience and information architecture; code changes begin with
Phase A (§10) only after this package is reviewed.

The package below follows the brief (`KIMI_REDESIGN_BRIEF.md`) and is grounded in the current
code: `apps/web/src/{App.tsx,types.ts,styles.css,map.ts}`, `services/{demo,duckdb,geokit,export,overlay}.ts`,
`components/*` (~3,100 LOC TS/TSX total), `data/demo_config.json`.

---

## 1. Critique of the current experience

### 1.1 Desktop

1. **The map is not the workspace; the sidebars are.** The grid is `320px | 1fr | 340px`
   (`styles.css:37-38`) plus a full-width filter row under the app bar. On a 1440px screen the
   map gets ~46% of the width *before* the filter strip eats vertical space. Two permanently
   open rails compete with the canvas the brief calls the "main analytical canvas".

2. **Tools are named after implementation, not outcomes.** The mode toggle says
   `Tickets | H3 screening` (`ModeToggle.tsx`), the tools are tabs `Analyze / Rule / Layers /
   Index` (`App.tsx:974-986`), and the cell card is titled "Conflict-index cells". Four names
   for two concepts ("Tickets" vs "altitude=tickets"; "H3 screening" vs "Cell index" vs
   "Conflict-index cells" vs `Altitude="cells"` in `types.ts`). Nothing says *why* you enter a
   mode.

3. **There is no analysis "run" — analysis is welded to ticket creation.** Clicking
   *Buffer point* or *Draw AOI* and placing geometry immediately (a) fires the conflict SQL and
   (b) opens the **New ticket** form seeded at that spot (`beginCreateAt`, `App.tsx:323-369`).
   A user who only wants to check an area is silently drafted into creating a ticket. Conversely,
   an ad-hoc drawn AOI gets a result pill (`ResultBar`: count + jurisdiction + "Analyzing: …")
   but **no itemized facility evidence** — the per-facility list exists only inside
   `TicketDetail` ("Why flagged"), so ad-hoc areas never show *which* facilities conflict.

4. **Evidence is scattered across three surfaces.** Result count lives in the floating
   `ResultBar` on the map; facility evidence lives in the left-rail `TicketDetail`; rule
   assumptions live in the right-rail Rule tab; provenance ("100 m live (ticket T-…)") is a
   truncated amber string in the result pill. Reviewing one answer means reading four places.

5. **Everything recomputes live, so nothing has provenance.** The radius slider re-runs the
   conflict query on a 120 ms debounce (`App.tsx:393-405`); rule chips re-run everything
   (`App.tsx:409-422`) plus a full per-ticket recount (`App.tsx:426-434`). Results on screen are
   always "current" but never *a result* — there is nothing to name, save, or export coherently.
   Exports exist (`services/export.ts`: GeoJSON + styled KMZ with assumptions baked in) but only
   per-ticket KMZ is wired into the UI (`useExports.ts`); the GeoJSON path is dead code in the UI.
   **No CSV export exists anywhere** (grep-verified), despite the brief's feature list.

6. **H3 screening confronts experts and novices identically.** One card shows the "honesty"
   paragraph, resolution chips, a threshold slider, and (behind one `<details>`) four weight
   sliders + normalization (`CellControls.tsx`, `App.tsx:1012-1036`). No presets; the first thing
   a new user meets is a MAUP caveat. The ranked list (`CellTable.tsx`) is good but shows only
   rate/index/tickets/facilities — no severity, no per-cell metric breakdown on drill.

7. **Drill-down loses its thread.** Picking a cell filters tickets and *switches the whole app
   to tickets mode* (`pickCell`, `App.tsx:489-522`) with a small banner
   `H3 screening → ticket evidence 8a283…`. It works, but the banner is easy to miss and there
   is no path from a drilled ticket into a structured assessment — the ticket click just re-runs
   the old weld (detail panel + edit).

8. **Visual uniformity.** Nearly every surface is a bordered card on `panel-2`
   (`.card`, `.tk-card`, `.tp-fac`, `.cell-row`); section titles are uppercase 11–12 px
   micro-headings (`.right h2`, `.tp-head h2`, `.cell-table-h`); body text is 12 px
   (`.muted`, `.tp-row`); blue `#5b9dff` simultaneously means brand, links, counties,
   your-network facilities, hover, focus, and active selection; conflict red `#ff6b6b` is used
   both for *potential* ticket flags and *confirmed* conflict lines. Key actions are symbol-only
   glyphs: `◎ ✐ ▤ ⚙ ⌖ ✎ ⤓ ⬡ ⤢` (recognizable only via title tooltips).

9. **Layers and legend are buried.** Toggling the density heatmap or importing KMZ requires
   opening the right rail → Layers tab; the legend is a card at the bottom of that tab. Neither
   is reachable from the map they describe.

10. **Empty states don't teach.** First run shows a `WelcomeCallout` that points at H3 screening
    and KMZ import — not at the primary decision (assess a work area). The tickets list empty
    state is "🔍 No tickets match these filters."; the cells empty state is a one-liner. None
    offer a next action.

### 1.2 Mobile

1. **The sheet's mental model is "which desktop rail", not "where am I in the task".** The
   bottom sheet seg-control is `Browse | Tools` (`MobileSheetChrome.tsx`) — i.e. left rail vs
   right rail carried over unchanged (`styles.css:524-533`). The user's task (configure → run → review)
   has no representation; result evidence is only reachable inside Browse → ticket → detail.

2. **Detents don't map to task states.** collapsed/half/full (0/52/90 vh, `useMobileSheet.ts`)
   resize the same content rather than switching between *current task + result count* →
   *controls/summary* → *full table/detail*, so the collapsed state (0 vh) shows nothing at all —
   not even the one-line status the brief asks for.

3. **The header overflows its job.** Brand + mode toggle + four stat chips + help are squeezed
   into a horizontally scrolling app bar (`styles.css:571-573`); the flagged-count `<details>`
   is a workaround for chips that desktop shows permanently.

4. **What works (keep):** the map-first full-bleed canvas, drag-to-resize sheet with pointer
   capture, 44 px coarse-pointer targets, hidden zoom controls on touch, tap-to-expand
   attribution. The *shared-DOM* approach (same asides, CSS repositioning) is the right
   foundation — the redesign keeps one set of components and changes what the sheet *means*.

### 1.3 What to preserve (portfolio assets — do not regress)

- DuckDB-WASM + spatial SQL over GeoParquet (`conflictForAoi`, `liveTicketConflictCounts`,
  `jurisdictionFor`, `facilityCountsByCell`) — set-based, indexed where practical.
- `geokit` — the Rust→WASM module wrapping mature crates (geodesic `buffer_geojson`,
  `h3_index_point`/`h3_cell_boundary_geojson`/`h3_hex_density_geojson`, `kmz_to_geojson`).
- Facts/opinions split of the cell index (`computeCellFacts` once per grain, `scoreCells` pure
  per weight change) — this is what makes live screening cheap, and the redesign leans on it.
- Terra Draw polygon AOI; draggable-point re-analysis; ticket overlay CRUD with baseline/user
  merge (`services/overlay.ts`); rule presets; two-way hover/inspect facility highlighting
  (`useFacilityDetail.ts`, `map.ts` pulse/sticky highlight); keyboard shortcuts + Escape ladder;
  aria-live result announcements; skip link; reduced-motion handling; hand-rolled KMZ/ZIP export
  with assumptions + disclaimer baked in.

---

## 2. User stories & task hierarchy

**Primary decision:** *Does this proposed work area conflict with relevant infrastructure, which
jurisdiction contains it, and what evidence supports the result?*
**Secondary decision:** *Which geographic cells should be reviewed first?*

- **US-1 (Assess).** As an analyst, I define a work area (ticket / point / polygon / coordinates
  / import), set a distance and a conflict rule I understand in one sentence, press one obvious
  **Run analysis**, and get a durable result: conflict/clear status, jurisdiction, and the
  itemized facilities — synchronized with the map — that I can export or save.
- **US-2 (Screen).** As a reviewer, I pick a scoring preset (Balanced, Conflict-heavy, …), scan a
  ranked cell table, drill into a cell to see its component metrics and member tickets, and hand
  any ticket off to a work-area assessment without losing where I came from.
- **US-3 (Persist).** As a returning user, I name and save an analysis, reopen it later in the
  same browser, and carry analyses between machines as a portable JSON project — with no account
  and no backend.

**Task hierarchy (designs serve these, in order):**

- T1 Define area → T2 Configure distance + rule → T3 Run → T4 Review evidence (summary →
  facilities → inspect) → T5 Export / save.
- S1 Choose preset → S2 Scan ranked cells → S3 Drill into cell → S4 Transition to T1 with the
  ticket pre-loaded.
- Secondary: browse/search tickets (feeds T1); create/edit local tickets (feeds T1 and the
  screening facts); layers/legend (context for all).

---

## 3. Revised information architecture

Two modes with outcome names (the in-code `Altitude` union becomes `AppMode = "assess" | "screen"`):

- **Assess work area** — the run-centric workflow (§4 W1–W5).
- **Screen portfolio** — H3 screening (§4 W6–W7).

### 3.1 Desktop shell

```
┌────────────────────────────────────────────────────────────────────┐
│ ◈ GIS Conflict Dashboard   [Assess work area | Screen portfolio]   │
│   Austin, TX · runs in-browser      Saved runs ▾   ⬇ Export  ? Help│
├───────────────────┬────────────────────────────────────────────────┤
│ WORKSPACE (360px) │                                                │
│ mode-scoped task  │                 MAP (flex)                     │
│ panel — one job   │   ┌─ map controls ────────────────┐            │
│ at a time         │   │ ⊕ zoom  ⤢ home  ▤ Layers ◦    │ ← popover  │
│                   │   └────────────────────────────────┘            │
│                   │                                  ┌───────────┐  │
│                   │                                  │ DRAWER    │  │
│                   │                                  │ context   │  │
│                   │                                  │ (380px,   │  │
│                   │                                  │ on demand)│  │
├───────────────────┴────────────────────────────────────────────────┤
│ RESULTS TRAY (resizable: bar 48px / half ~40% / full ~72%)         │
│ 6 conflicts · Travis County · 100 m · Default rule  [stale?] ↕     │
│ Summary | Facilities (6) | Report                      Save  Export│
└────────────────────────────────────────────────────────────────────┘
```

Principles:

- **One left panel, one job.** The right rail is deleted. Workspace = mode-scoped task panel.
- **Results are a first-class surface**, not a floating pill: a resizable bottom tray with three
  detents (header bar always visible after a run). ResultBar.tsx is retired.
- **Detail is a contextual drawer** over the map's right edge (facility inspection, ticket
  detail, cell drill-down). Never permanently open; closes on Escape / mode switch / new run.
- **Layers + legend + import move to a map popover** (`▤ Layers` map control, top-right).
- **Header carries the meta-actions**: mode tabs (center), Saved runs, Export, Help. Stat chips
  leave the header: assess summary stats move to the Summary tab; screening stats to the screen
  workspace header. (The header keeps only a slim "N flagged under current rule" chip in Screen
  mode if space allows — decided in Phase E; not load-bearing.)

### 3.2 Mobile shell (same conceptual model, one component set)

Bottom sheet with three detents whose *contents* follow the workspace/results model:

- **Collapsed (~56 px, not 0):** current task + result status line —
  `Assess · 100 m · Default rule` → after a run: `⚠ 6 conflicts · Travis County`. Tap → half.
- **Half (52 vh):** the workspace steps (configure) or the result **Summary**.
- **Full (92 vh):** facilities table / report / ticket picker / drawer content.
- Sheet seg-control becomes **Setup | Results** (was Browse | Tools) — the same two concepts as
  the desktop workspace/tray, rendered by the same components (`WorkspacePanel`, `ResultsTray`),
  so no duplicate logic: the CSS already re-parents one DOM into the sheet; we keep that and
  change only what the two sheet pages *mean*.

### 3.3 The analysis run (the core conceptual change)

Explicit state machine (`lib/useAnalysisRun.ts`):

```
            area/config change
   ┌──────┐  (valid)   ┌─────────┐  success  ┌───────┐ settings Δ ┌───────┐
   │ DRAFT │──────────▶│ RUNNING │──────────▶│ FRESH │───────────▶│ STALE │
   └──────┘            └─────────┘           └───────┘            └───────┘
                                                ▲   Run again (button pulses) │
                                                └─────────────────────────────┘
```

- **Deliberate recompute decision (assess mode):** the *map preview* of the AOI updates live and
  free (geodesic buffer via geokit is synchronous µs-work; drawing is client-side), but the
  **conflict SQL and jurisdiction query run only on Run**. After a run, any change to area,
  distance, or rule marks results **stale** (badge in tray header + map hint; results remain
  readable). Rationale: (a) a result becomes a *thing* with provenance — required for
  save/export/report coherence; (b) it breaks the analyze↔ticket-create weld; (c) it ends the
  current invisible storm of debounced re-queries. What changes *per control*: distance slider →
  live amber preview + stale; rule preset/chips → facility recolor live (pure paint) + stale;
  area change → new draft (results cleared, since evidence for a different area is misleading).
- **Screen mode stays live.** Facts are fetched once per grain (`computeCellFacts` — one DuckDB
  spatial join); scoring is pure JS (`scoreCells`). Presets/weights/threshold repaint instantly;
  only the resolution chips re-fetch facts. Live is the right call there *because the cost
  structure differs* — and the redesign states that reasoning in the UI copy ("scores update
  live; resolution re-reads the data").

### 3.4 Terminology sweep

| Today (mixed) | Becomes |
|---|---|
| Tickets / "altitude=tickets" | **Assess work area** (`assess`) |
| H3 screening / Cell index / Conflict-index cells / "cells" | **Screen portfolio** (`screen`) |
| Analyze / Rule / Layers / Index tabs | workspace steps + Layers map popover |
| Browse / Tools (mobile) | **Setup / Results** |
| "Conflict analysis" card | **2 · Distance & rule** step |
| Result pill on map | **Results tray** (Summary tab) |
| "Why flagged" | **Conflicting facilities** (Facilities tab) |
| intake vs live "evidence" pills | **Recorded at intake** vs **This run** (kept, plain-language) |

---

## 4. Desktop wireframes

Conventions: `══` primary button, `[x]` selected, `▸` disclosure closed. Panel 360 px; tray
detents bar/half/full; drawer 380 px overlay right.

### W1 — Assess: initial / empty state

```
┌ App bar ───────────────────────────────────────────────────────────┐
│ ◈ GIS Conflict Dashboard  [Assess work area | Screen portfolio]    │
│                            Saved runs ▾   ⬇ Export   ?             │
├───────────────────┬────────────────────────────────────────────────┤
│ 1 · Work area     │                                    [▤ Layers]  │
│ ┌───────────────┐ │                                                │
│ │ ◉ Ticket      │ │    Search or pick a ticket…                    │
│ │ ○ Point       │ │    ┌──────────────────────────┐                │
│ │ ○ Polygon     │ │    │ 🔎 Search id / source…   │                │
│ │ ○ Coordinates │ │    └──────────────────────────┘                │
│ │ ○ Import file │ │         (map: tickets + facilities visible)    │
│ └───────────────┘ │                                                │
│                   │    ┌─ Empty-state card on map (first run) ───┐ │
│ 2 · Distance&rule │    │ Assess a work area                     │ │
│ (disabled until   │    │ Pick a ticket, click a point, or draw  │ │
│  an area exists)  │    │ an area — then Run analysis.           │ │
│                   │    │ [Show me an example]  [Dismiss]        │ │
│ 3 · Run           │    └─────────────────────────────────────────┘ │
│ ══ Run analysis ══ │   (primary btn disabled, title="define an    │
│  (disabled)       │     area first")                               │
├───────────────────┴────────────────────────────────────────────────┤
│ (no tray until first run)                                          │
└────────────────────────────────────────────────────────────────────┘
```

Empty-state behaviors: welcome card names the primary action and offers a one-click example
(runs a pre-picked ticket analysis — replaces today's H3-first welcome). The workspace steps are
a **staged panel, not a wizard**: steps 2–3 stay visible but disabled with reasons; after an area
exists the user can jump back and revise freely.

### W2 — Assess: existing-ticket selection

```
│ 1 · Work area                                    │
│ [Ticket ✓] Point  Polygon  Coordinates  Import   │
│ ┌──────────────────────────────────────────────┐ │
│ │ 🔎 T-1042__________________________________  │ │
│ ├──────────────────────────────────────────────┤ │
│ │ ▸ T-1042   locate · high · new    3 conflicts│ │ ← row click: select
│ │   T-1047   permit · normal · in_review  clear│ │   (fly-to + amber buffer
│ │   T-1051   survey · low · new       1 conflict│ │    preview at current radius)
│ │   …                    Filters (2)  Clear    │ │
│ └──────────────────────────────────────────────┘ │
│ Selected: T-1042 · 30.2672, -97.7431   [✎ edit] [＋ new local ticket] │
│ 2 · Distance & rule … (now enabled)              │
```

- Search + min-conflict + the existing advanced filters (source/workflow/priority/work type)
  fold into this picker (`FilterStrip` leaves the map's top edge — the map gains a full row of
  vertical space).
- `＋ new local ticket` keeps today's create flow (map click → drag marker → form in the drawer);
  `✎ edit` opens the same form for the selected ticket. Ticket CRUD is preserved, relocated.

### W3 — Assess: configuration (area set, not yet run)

```
│ 1 · Work area                                    │
│ ✓ Ticket T-1042 · 30.2672, -97.7431   [Change]   │
├──────────────────────────────────────────────────│
│ 2 · Distance & rule                              │
│ Buffer distance        [ 100 ] m                 │
│ ─────●──────────────  50 · 100 · 250 · 500       │ ← slider + presets + numeric
│                                                   │   input; amber AOI previews
│ Conflict rule                                     │   live on map
│ ┌─────────┐┌───────────────┐┌──────────────┐     │
│ │ Default ││ In-service only││ All operators│     │
│ └─────────┘└───────────────┘└──────────────┘     │
│ ⓘ Counts active and planned facilities owned by  │ ← plain-language summary,
│   Operator Alpha, excluding retired.             │   generated from the rule
│ ▸ Advanced: owners & statuses                    │
├──────────────────────────────────────────────────│
│ 3 · Run                                          │
│ ═══════════ Run analysis ═══════════             │
│ Checks facilities inside a 100 m geodesic buffer │
│ against the rule above.                          │
```

- Advanced disclosure = today's RuleCard chips (owners that count / statuses to exclude),
  unchanged mechanics, restyled. Choosing a preset or toggling a chip updates the summary
  sentence immediately (it's derived from rule state, not from a run).
- Rule summary generator: `"Counts {statuses not excluded} facilities owned by {owners}
  {excluded ? ", excluding " + excluded : ""}."` — one sentence, always visible.

### W4 — Assess: conflict results (tray half-open, Summary tab)

```
│ (workspace unchanged; step 3 now reads:)         │
│ ✓ Ran 2 min ago · results below                  │
├──────────────────────────────────────────────────┴───────┬─────────┤
│ MAP: amber AOI; intersecting facilities thick red;       │         │
│ ticket dot centered; counties faint.                     │ DRAWER  │
│ (conflict-line click → opens Facilities row + drawer)    │ (closed │
├──────────────────────────────────────────────────────────┤  here)  │
│ ⚠ 6 conflicts · Travis County · 100 m · Default   ▲ half ▼ full ✕  │
│ Summary | Facilities (6) | Report        ⟳ Re-run  Save  Export ▾  │
│ ────────────────────────────────────────────────────────────────── │
│ SUMMARY                                                            │
│ ⚠ Conflict found — 6 facilities intersect the 100 m work-area      │
│   buffer under the Default rule.                                   │
│ Jurisdiction   Travis County                                       │
│ Work area      Ticket T-1042 (30.2672, -97.7431)                   │
│ Buffer         100 m (geodesic)                                    │
│ Rule           Default — counts active & planned Operator Alpha    │
│                facilities, excluding retired                       │
│ This run       2:41 PM · recorded intake said 3 (radius/rule Δ ⓘ)  │
│ [＋ Save as ticket]  [Open facilities →]                           │
```

- Header row is the tray in its collapsed **bar** detent — result count + jurisdiction +
  distance + rule always visible even when the tray body is closed.
- If settings change after the run: `● Settings changed — results are from the previous
  configuration` + the **Re-run** button pulses (accent). Results never silently swap.
- Recorded-vs-this-run comparison kept (today's storedCount vs liveCount) with a one-line
  explanation of *why they can differ* (planar intake buffer + old radius vs geodesic now).

### W5 — Assess: facility inspection (Facilities tab + drawer)

```
│ ⚠ 6 conflicts · Travis County · 100 m · Default                    │
│ Summary | Facilities (6) | Report                                  │
│ ──────────────────────────────────────────────────────────────────│
│ 🔎 filter…   Owner ▾   Status ▾            sortable column headers│
│ Facility        Owner          Status     Dist.   Relationship │   │
│ ───────────────────────────────────────────────────────────────│   │
│ ▶ TL-4481 #12   Operator Alpha  active    ≈ 18 m  intersects   │   │ ← selected row
│   TL-4477 #9    Operator Alpha  active    ≈ 41 m  intersects   │   │   (blue fill,
│   TL-4502 #21   Operator Alpha  planned   ≈ 66 m  intersects   │   │   map highlight
│   …                                                            │   │   flies/centers)
├────────────────────────────────────────────────────────────────┴───┤
│ MAP                                          ┌─ DRAWER ──────────┐ │
│                                              │ Facility TL-4481  │ │
│   conflict line #12 lit in steady cream      │ #12 · intersects  │ │
│   (#fff2a8, existing highlight layer)        │ Owner  Op. Alpha  │ │
│                                              │ Type   line · 345kV│ │
│                                              │ Status active     │ │
│                                              │ ≈ 18 m from area  │ │
│                                              │ [Center on map]   │ │
└──────────────────────────────────────────────┴───────────────────┘ │
```

- Two-way sync is mandatory and already half-built: row hover → pulse (`highlightConflictFacility`
  pulse); row click → steady highlight + fly + row selected; map `conflict-line` click → tray
  opens to Facilities, row selected + scrolled into view (new: mirror of `CellTable`'s
  scroll-into-view + flash), drawer opens with the facility's attributes (today's popup content,
  promoted to the drawer).
- "Relationship" column is `intersects` for lines crossing the buffer, `inside` for points —
  derived from geometry type vs AOI (cheap client-side check; labeled as approximate).

### W6 — Screen portfolio: presets-first

```
┌───────────────────┬────────────────────────────────────────────────┐
│ Scoring preset    │  MAP: purple choropleth (existing cells-fill), │
│ ┌───────────────┐ │  hotspot outlines, dimmed below threshold.     │
│ │ ✓ Balanced    │ │                                                │
│ │   activity +  │ │  Click a hex or a row to drill in.             │
│ │   conflict    │ │                                                │
│ │   Conflict-   │ │                                                │
│ │   heavy       │ │                                                │
│ │   Volume-     │ │                                                │
│ │   heavy       │ │                                                │
│ │   Facility-   │ │                                                │
│ │   density     │ │                                                │
│ └───────────────┘ │                                                │
│ Scores update live. ▸ Advanced scoring (grain, weights,           │
│ normalization, highlight threshold)                                │
│ ── ramp ── lower → higher · ⬜ hotspot = volume+rate both high     │
├───────────────────────────────────────────────────────────────────┤
│ 214 cells · preset: Balanced · grain r7                    ▲ ▼ ✕   │
│ Ranked cells (sortable)                                            │
│ #  Cell      Index  Tickets  Conflict rate  Severity  Facilities   │
│ 1  872a82e…  2.41   23       78%            2.1       14  ⚑hotspot │
│ 2  872a107…  2.02   31       64%            1.6       11           │
```

- Preset cards = named `CellWeights` bundles (initial values, tuned in Phase E against the demo
  distribution): **Balanced** = current defaults (demand .3 / rate .4 / severity .2 / infra .1,
  z); **Conflict-heavy** (.1/.6/.2/.1); **Volume-heavy** (.7/.1/.1/.1); **Facility-density**
  (.15/.15/.1/.6). Picking one sets the weights; any manual slider change in Advanced marks the
  preset "Custom".
- The "what is this index" honesty copy shrinks to one line + an Info chip (today's paragraph
  moves into the disclosure, where the MAUP lever lives next to it).

### W7 — Screen: ranked-cell drill-down

```
│ Breadcrumb: Screen portfolio › Cell 872a82e… › 23 tickets   [✕ exit drill] │
│ (workspace collapses to the breadcrumb + a slim metric card)             │
├──────────────────────────────────────────────────────────────┬──────────┤
│ MAP: choropleth dimmed except drilled cell (amber pulse →    │ DRAWER   │
│ steady outline); only this cell's ticket dots shown.         │ Cell …   │
├──────────────────────────────────────────────────────────────┤ metrics: │
│ Tray: member tickets (sortable table)                        │ tickets23│
│ Ticket    Work type  Priority  Conflicts  Jurisdiction       │ rate 78% │
│ T-1042    locate     high      3          Travis             │ sev. 2.1 │
│ T-1055    permit     normal    1          Travis             │ facil.14 │
│ …                                                            │ ──────── │
│ Clicking a ticket row:                                       │ members: │
│   → drawer swaps to ticket summary with one dominant action: │ ticket   │
│     ══ Assess this work area ══  (switches mode, area =     │ list…    │
│     ticket, breadcrumb preserved as a back-path)             │          │
```

- Drill keeps context three ways: the breadcrumb, the dimmed-but-visible choropleth (current
  `drillCellId` behavior kept), and the tray listing member tickets instead of switching the
  whole app to the ticket browser (today's mode-jump is removed).
- "Assess this work area" is the S4→T1 hand-off: mode flips, workspace step 1 is pre-filled with
  the ticket, and the screen drill is restorable via the breadcrumb history (one level deep is
  enough for the demo scale).

---

## 5. Mobile wireframes

Sheet detents (renamed content, same drag mechanics):

### M1 — Collapsed (~56 px): status line

```
┌──────────────────────────────┐
│ ◈ GIS Conflict   [Assess|Screen]│  (stat chips gone; help in sheet)
├──────────────────────────────┤
│                              │
│        MAP (full bleed)      │
│                              │
│ ┌─ sheet (collapsed) ──────┐ │
│ │ ───                      │ │
│ │ ⚠ 6 conflicts · Travis ˄ │ │  ← tap raises to half (Summary)
│ └──────────────────────────┘ │
```

Pre-run it reads `Assess · pick a ticket or tap the map ˄`. In Screen mode: `Screen · 214 cells ·
Balanced ˄`.

### M2 — Half (52 vh): workspace / summary

```
│ ┌─ sheet ──────────────────┐ │
│ │ ───    [ Setup | Results]│ │
│ │ 1 · Work area            │ │
│ │ [Ticket]Point[Polygon]…  │ │
│ │ 2 · Distance & rule      │ │
│ │ 3 · ══ Run analysis ══   │ │
│ └──────────────────────────┘ │
```

Setup page = the same `WorkspacePanel` (steps stack vertically). Results page at half = Summary
tab content only (the decision answer).

### M3 — Full (92 vh): tables, pickers, detail

```
│ ┌─ sheet (full) ───────────┐ │
│ │ ───    [ Setup | Results]│ │
│ │ Facilities (6)      ✕    │ │
│ │ 🔎 filter…               │ │
│ │ ┌──────────────────────┐ │ │
│ │ │TL-4481 Op.Alpha act. │ │ │  rows are 44px; tap = select +
│ │ │≈18 m · intersects   ›│ │ │  drawer content shown *in the
│ │ ├──────────────────────┤ │ │  sheet* (not a floating drawer —
│ │ │TL-4477 …             │ │ │  mobile has no drawer surface)
│ │ └──────────────────────┘ │ │
│ └──────────────────────────┘ │
```

### M4 — Mobile specifics

- Facility/ticket detail and the ticket create/edit form render **inside the full sheet** (same
  `DrawerContent` component, different chassis) — the "no duplicated logic" rule holds: one
  content component, two containers.
- Map click behaviors unchanged (tap ticket → select as area; tap conflict line → open row).
- Run button stays reachable at half detent; after a run the sheet auto-switches to Results and
  collapses to M1's status line (announced via the existing aria-live region).
- 44 px targets already handled by the coarse-pointer block; the tray's desktop drag-resize maps
  to the existing sheet drag.

---

## 6. Component inventory

### 6.1 Existing → disposition

| Current | Disposition |
|---|---|
| `AppHeader` / `ModeToggle` | **Rework** → `Header` + `ModeTabs` (Assess work area / Screen portfolio); drop rail toggles + stat chips; add `SavedRunsMenu`, `ExportMenu`, help. |
| `FilterStrip` | **Merge** into ticket picker inside workspace step 1 (same controls, new home). Map loses the full-width row. |
| `TicketList` | **Rework** → `TicketPicker` rows (select = set area; ✎ edit retained). |
| `TicketDetail` | **Split**: identity/workflow/edit → `DrawerContent` (ticket); "Why flagged" facility list → Facilities tab (single home for evidence). |
| `AnalyzeCard` + `RuleCard` | **Rework** → workspace steps: `AreaStep`, `ConfigStep` (distance + presets + `RuleSummary` + Advanced with existing chips). |
| `ResultBar` | **Retire** → tray header bar carries count/jurisdiction/distance/rule + actions. |
| `MapCanvas` | **Keep**; welcome callout copy rewritten (assess-first, example action). |
| `RankedCellsPanel` + `CellTable` | **Rework** → tray `CellsTable` (add severity column, sortable headers); drill moves to drawer + breadcrumb. |
| `CellControls` | **Keep internals**, re-home inside `AdvancedScoring` disclosure; preset cards sit above it. |
| `LayersCard` + `Legend` | **Move** into `LayersPopover` (map control). |
| `EditForm` | **Keep**, renders in drawer/full-sheet; no longer auto-opened by analysis. |
| `HelpOverlay`, `Info`, `WelcomeCallout`, `StatChips` | **Keep/restyle** (chips re-homed per §3.1). |
| `useMobileSheet` + `MobileSheetChrome` | **Keep mechanics**; seg becomes Setup/Results; collapsed shows status line. |
| `useExports` / `services/export.ts` | **Extend** (wire GeoJSON; add CSV via new `services/csv.ts`; report print). |
| `useKmzImport` | **Extend** to GeoJSON files (`parseKmz` already covers KML/KMZ; GeoJSON = `JSON.parse` + same import path). |
| `useFacilityDetail` | **Keep**; add reverse direction (map click → row select). |
| `map.ts` `MapController` | **Keep**; add: tray-safe padding option on `fitTo`, persistent (non-fading) selected-cell outline, drawer-aware popup suppression. Layer ids unchanged. |

### 6.2 New components / modules

| New | Responsibility · key state · interactions |
|---|---|
| `WorkspacePanel` | Mode-scoped steps container. State: `AppMode`, step validity. Desktop left column; mobile Setup page. |
| `AreaStep` | Source chips (ticket/point/polygon/coordinates/import) + per-source sub-UI. Emits `WorkArea { source, geometry, ticketId?, importName? }`. |
| `TicketPicker` | Search/filters/list (from FilterStrip+TicketList). Row click selects; ✎ opens edit drawer. |
| `CoordinatesForm` | Lat/lon inputs + validation + "drop point" (extends today's Enter-at-center path). |
| `ConfigStep` | Distance slider + numeric + presets (50/100/250/500 m); rule preset cards; `RuleSummary`; Advanced disclosure. |
| `RuleSummary` | One-sentence plain-language rendering of `ConflictRule`. Pure function + tests-worthy. |
| `RunButton` | The single primary action. States: disabled (no area, with reason) / ready / running (spinner) / stale-pulse. |
| `ResultsTray` | Bottom tray, 3 detents, drag-resize (pointer events like `useMobileSheet`), tabs Summary/Facilities/Report (assess) or ranked cells (screen). Header bar = collapsed content. |
| `SummaryTab` | Status sentence, jurisdiction, work area, buffer, rule, run timestamp, recorded-vs-this-run, actions. |
| `FacilitiesTab` | Sortable/filterable table; selection state shared with map (`selectedFacilityId`); row hover pulse; row click → drawer. |
| `ReportTab` | Report preview + name/notes + export buttons (§8 formats). |
| `Drawer` + `DrawerContent` | Right-edge contextual panel (facility / ticket / cell). Escape closes; focus-trapped; returns focus to trigger. |
| `CellsTable` | Ranked sortable cells (from CellTable + severity col). |
| `CellDrillDrawer` | Component metrics + member tickets + "Assess this work area". |
| `Breadcrumb` | `Screen portfolio › Cell 872a… › 23 tickets`; one-level history restore. |
| `PresetCards` | Scoring presets (Balanced/Conflict-heavy/Volume-heavy/Facility-density) → `CellWeights`. |
| `LayersPopover` | Map-anchored control: layer toggles, import, legend. |
| `SavedRunsMenu` | Header dropdown: list/rename/delete/open runs; "Save current". |
| `StaleBadge` | Tray-header indicator + re-run pulse. |
| `EmptyState` | Instructional empty states with a primary action. |
| `Icon` | Inline SVG set (point, polygon, layers, download, save, help, close, locate, edit, search, chevron, warning) replacing symbol-only glyphs; keeps `title`/aria-labels. |
| `lib/useAnalysisRun.ts` | The DRAFT→RUNNING→FRESH→STALE machine (§3.3); owns `lastResult`, staleness diffing (area/rule/distance vs run snapshot). |
| `services/runs.ts` | IndexedDB store (§8). |
| `services/project.ts` | Portable JSON project export/import (§8). |
| `services/csv.ts` | Facilities table → CSV (RFC-4180 quoting, dated filename via existing `exportName`). |
| `lib/captureMap.ts` | Map snapshot PNG for the report (§11 risk R3). |

No new runtime dependencies. No router (mode is state, as today). DuckDB-WASM, geokit, MapLibre,
Terra Draw untouched.

---

## 7. `AnalysisRun` data model

```ts
// services/runs.ts — the durable, savable unit of the redesign.
// Everything needed to re-open the exact state of a run: inputs + result snapshot.
interface AnalysisRun {
  id: string;                    // "run_" + base36 (same idiom as nextTicketId)
  name: string;                  // user-editable; default "Ticket T-1042 · 100 m · Mar 14"
  notes: string;                 // free text, shown in Report
  createdAt: string;             // ISO 8601
  updatedAt: string;             // bumped on rename, re-run, re-save

  area: {
    source: "ticket" | "point" | "polygon" | "coordinates" | "import";
    ticketId?: string;           // when source === "ticket"
    importName?: string;         // file + feature label when source === "import"
    geometry: Geometry;          // the ORIGINAL area (Point or Polygon), EPSG:4326
  };

  buffer: { radiusM: number };   // meters (unit fixed; field kept explicit for future units)

  rule: ConflictRule;            // { selfOwners: string[]; excludedStatuses: string[] }
  rulePresetName?: string;       // "Default" | "In-service only" | "All operators" | undefined = custom

  layers: {                      // view context worth restoring
    hexOn: boolean;
    importedOverlay?: { name: string; features: FeatureCollection }; // small; metadata + geometry
  };

  result: {                      // snapshot taken at run completion (what the tray showed)
    ranAt: string;
    aoiGeometry: Geometry;       // the buffered AOI actually analyzed (buffered point or raw polygon)
    conflictCount: number;
    jurisdiction: string | null;
    facilities: ConflictFacility[]; // full evidence rows incl. geometry + dist_m (small: demo AOIs
                                    // intersect tens of features, a few KB of GeoJSON)
  } | null;                      // null = saved as a draft (configured, not run)
}
```

Notes:

- `result.facilities` embeds evidence deliberately: a reopened run shows its tray **without
  touching DuckDB**, and the report/exports work offline of the parquet assets. Re-running after
  reopen recomputes from live data (and can diff counts — surfaced as "data changed since saved").
- `ScreenConfig` (optional, same store, phase F stretch): `{ id, name, weights: CellWeights,
  res: number, threshold: number }` — saved custom scoring presets. Built-in presets ship in code.
- Ticket overlay records (`services/overlay.ts`) stay in localStorage and are **referenced, not
  duplicated**: `area.ticketId` may point at a user ticket; the portable project export embeds the
  overlay tickets it references (§8.2).

---

## 8. Persistence model

### 8.1 IndexedDB (durable, backend-free)

- One DB, `gcd`, version 1; object store `runs` (`keyPath: "id"`, index `updatedAt`); optional
  store `screens`. Hand-rolled promise wrapper (~120 lines) in the spirit of the existing
  hand-rolled ZIP in `export.ts` — no `idb` dependency.
- API: `listRuns() · getRun(id) · putRun(run) · deleteRun(id) · renameRun(id, name, notes)`.
- Failure posture mirrors `overlay.ts`: every call wrapped; quota/private-mode failure →
  console.warn + a non-blocking "saving unavailable in this browser session" notice; the app
  remains fully functional session-only. Portable JSON (below) is the durable fallback.
- localStorage stays for what it already does well: UI prefs (`gcd.*Open`, welcome flag) and the
  ticket overlay (`gcd.tickets.overlay.v2`). No migration.

### 8.2 Portable project (JSON file)

`gis-conflict_project_2026-07-19.json`:

```jsonc
{
  "format": "gis-conflict-project",
  "version": 1,
  "exportedAt": "2026-07-19T04:00:00Z",
  "region": "Austin, TX",              // demo_config label
  "runs": [ /* AnalysisRun[] */ ],
  "ticketOverlay": { "added": [], "edited": {}, "deleted": [] },  // referenced user tickets
  "screenConfigs": [ /* optional ScreenConfig[] */ ]
}
```

- Export: header Export menu → "Project (JSON)" — serializes all runs + the overlay.
- Import: Saved runs menu → "Open project file…" — validates `format`/`version`, merges by `id`
  (incoming wins on `updatedAt`, per-record; never deletes existing runs silently — conflicts
  listed in a confirm dialog), then refreshes the runs list.
- Version field enables future migrations; unknown versions are rejected with a clear message.

### 8.3 Report & export formats (per run)

| Format | How | Status |
|---|---|---|
| PDF | Report tab → "Print / Save as PDF" — dedicated print stylesheet (`@media print` renders only the report, map snapshot embedded). Zero deps. | new |
| CSV | `services/csv.ts` over the Facilities tab rows (id, asset_ref, owner, status, type, kV, ≈distance, relationship) | new |
| GeoJSON | existing `conflictsToGeoJson` (AOI + facilities + assumptions), now wired to UI | existing, unwired today |
| KMZ | existing `conflictsToKmz` / `ticketConflictToKmz` (styled, legend, disclaimer) | existing |
| JSON | project file (§8.2) | new |

Report contents (per brief): name + notes, work-area source, map snapshot, buffer, rule +
assumptions sentence, run timestamp, jurisdiction, conflict summary, full facility table,
data-source attribution (EIA / Census / synthetic tickets — reusing the existing disclaimer text
in `export.ts`).

---

## 9. Visual-design specification

### 9.1 Typography (base size up from 12 → 14)

| Role | Spec |
|---|---|
| Title (panel headers, drawer title) | 15 px / 650 / sentence case |
| Section label | 13 px / 600 / `text` — **no uppercase micro-headings** (uppercase only for 11 px table column headers, kept for tabular scanning) |
| Body | 14 px / 400 / 1.45 |
| Metadata / captions | 12 px / 400 / `muted` |
| Numeric (counts, table cells) | `font-variant-numeric: tabular-nums` |

Font stack unchanged (system UI). Line-length caps: summary sentence ≤ 68 ch.

### 9.2 Spacing & shape

- 4 px base grid; panel padding 16 px; section gap 20 px; control gap 8 px.
- Control height 36 px desktop / ≥44 px coarse pointer (existing block extended to tray tabs).
- Radius: 10 px panels / 8 px controls / 999 px chips. Tray top corners 14 px (mirrors mobile sheet).
- **Fewer boxes:** cards-in-cards removed; sections separated by 1 px `line` dividers + spacing.
  Table rows separated by hairlines, not bordered tiles. One bordered surface per region max.

### 9.3 Color roles (dark theme retained)

| Role | Token | Used for |
|---|---|---|
| Action / selection | `--accent` `#5b9dff` | primary buttons, links, selected rows/chips/tabs, focus ring — **only** |
| Confirmed conflict | `--conflict` `#ff5252` | conflict lines/facilities in a run result, conflict status pill |
| Potential flag | `--flag` `#ff9f43` | ticket dots with intake/live conflicts (no longer red — separates *potential* from *confirmed*) |
| Clear / OK | `--ok` `#3ecf8e` | clear pill, clear ticket dots stay teal `--teal #22d3c5` (existing non-color size/ring cue kept for colorblind safety) |
| AOI / work area | `--aoi` `#ffd166` | buffer/polygon preview + fill, selected-cell outline |
| Surfaces | `--bg #0f1420`, `--panel #171e2e`, `--panel-2 #1f2940`, `--line #2b3552` (unchanged) | |
| Text | `--text #e6ebf5`, `--muted #9aa7c2` (unchanged) | |
| Selected evidence | `--evidence #fff2a8` | steady facility highlight (existing) |

Counties leave the blue family: `#7d8aa8` hairline fill 0.04. Facility base `#8b96b5`; your-network
`#c3d2e8` + width bump (recolor stays rule-driven via existing `setRuleStyle`); **conflicting**
facilities override to `--conflict` (the run's answer owns red).

### 9.4 Map symbology

| Feature | Style |
|---|---|
| Basemap | CARTO dark (unchanged) |
| Counties | `#7d8aa8` 1 px @ 0.45, fill 0.04 |
| Facilities (other) | `#8b96b5` 1.4 |
| Facilities (your network) | `#c3d2e8` 2.2 |
| Conflicting facilities (run result) | `#ff5252` 3.5 (existing `conflict-line`, recolored) |
| Selected facility | `#fff2a8` 6 px steady / pulse on row hover (existing layers) |
| Ticket clear | teal `#22d3c5` small dot |
| Ticket flagged | amber-orange `#ff9f43` larger dot + ring (size+ring non-color cue retained) |
| AOI | `#ffd166` fill 0.18 + 2 px outline (unchanged); dashed while *previewing*, solid once run |
| Cells choropleth | purple ramp `#2a1a4a→#7b3fa0→#e668d8` (unchanged family); hotspot outline `#f0a6ff` 2.5 px (moves off AOI-amber to avoid collision); drilled cell outline `--aoi` |
| Imported overlay | `#c08bff` purple (unchanged), selected feature `--aoi` |

### 9.5 States, motion, a11y

- Stale results: `StaleBadge` (amber dot + "Settings changed") + `RunButton` pulse (1.6 s accent
  ring loop, disabled under `prefers-reduced-motion`).
- Tray/drawer transitions: 180 ms ease transform+opacity; disabled under reduced motion (extend
  the existing media query).
- Skeleton rows in tray while RUNNING; the aria-live region announces run start + completion
  ("Analysis complete: 6 conflicts in Travis County").
- Focus: visible 2 px accent outline everywhere (kept); drawer focus-trapped, Escape ladder
  extended (drawer → tray → sheet → help); all glyph buttons get SVG icon + accessible name +
  tooltip.
- Empty states (§4 W1 pattern): one sentence + one primary action. Facility table empty:
  "No facilities intersect this area under the current rule — the area is clear."

---

## 10. Implementation plan (independently reviewable phases)

Each phase is a separate reviewable diff, keeps `npm run build` (tsc + vite) green, runs
`bash scripts/scrub.sh`, and manually verifies the listed checks in `npm run dev`. `geokit` and
the data pipeline are untouched throughout (cargo tests unaffected). `AGENTS.md` is updated in any
phase that changes behavior it describes (commands, layout, gotchas).

- **Phase A — Shell & mode rename.** `types.ts` (`AppMode`), `Header`/`ModeTabs`, delete right
  rail + filter row from the grid, `WorkspacePanel`/`ResultsTray`/`Drawer` scaffolds, `LayersPopover`
  (re-home LayersCard+Legend+import), retire `ResultBar` (tray header bar shows existing conflict
  state). No analysis-flow change yet. *Verify:* modes switch; layers/legend/import work from the
  popover; map resizes correctly on tray detents; keyboard `[`/`]` shortcuts remapped.
- **Phase B — Assess workspace & the explicit run.** `lib/useAnalysisRun.ts`, `AreaStep`
  (ticket picker from FilterStrip+TicketList; point; polygon; `CoordinatesForm`; import incl.
  GeoJSON), `ConfigStep` (distance presets + numeric; rule preset cards; `RuleSummary`; Advanced =
  RuleCard chips), `RunButton`, live AOI preview (dashed amber), staleness. **Cut the weld:**
  analysis no longer opens `EditForm`; "Save as ticket" becomes a post-run action. *Verify:* run
  from all five sources; slider/rule changes mark stale without firing SQL (watch DuckDB traffic);
  preview updates instantly; re-run refreshes.
- **Phase C — Results tray: Summary + Facilities.** `SummaryTab`, `FacilitiesTab` (sort/filter),
  two-way map↔row sync (extend `useFacilityDetail`; map conflict-line click selects row + scrolls
  + opens drawer), `Drawer` with facility content, jurisdiction row, recorded-vs-this-run.
  *Verify:* both sync directions; sort/filter; empty state; Escape ladder; focus return.
- **Phase D — Report & exports.** `ReportTab`, `services/csv.ts`, wire existing GeoJSON/KMZ,
  print stylesheet + `lib/captureMap.ts` snapshot. *Verify:* print-to-PDF layout (Chrome/Firefox/
  Safari), CSV opens in Excel/Sheets, KMZ in Google Earth, snapshot non-blank (CARTO CORS —
  R3), attribution present.
- **Phase E — Screen portfolio.** `PresetCards`, `AdvancedScoring` (re-home CellControls + MAUP
  copy), tray `CellsTable` (+severity, sortable headers), `CellDrillDrawer`, `Breadcrumb`,
  "Assess this work area" hand-off, remove the drill mode-jump. *Verify:* presets map to the
  specified weights; "Custom" on manual change; drill keeps choropleth context; hand-off
  pre-fills Assess step 1; r6⇄r8 refetch works.
- **Phase F — Persistence.** `services/runs.ts` (IndexedDB), `SavedRunsMenu`, save dialog
  (name/notes), reopen-restores-everything (area, buffer, rule, layers, result snapshot),
  `services/project.ts` JSON export/import with merge dialog. *Verify:* save/reopen/rename/delete;
  reload persistence; JSON round-trip across profiles; private-mode degradation notice.
- **Phase G — Mobile parity & visual system.** Setup/Results sheet pages, collapsed status line,
  drawer-content-in-sheet, typography/spacing/color tokens, `Icon` set, empty states, a11y +
  reduced-motion pass, 44 px audit, docs/screenshot refresh. *Verify:* phone + desktop matrix,
  keyboard walkthrough, `prefers-reduced-motion`, final `scrub.sh` + AGENTS.md update.

Phase order is dependency-safe (A→G), but C/D, E, and F are separable workstreams after B.

---

## 11. Risks, tradeoffs, user-test items

- **R1 — Explicit run changes a beloved behavior.** Today's slider-live recompute feels magical.
  Mitigation: instant dashed preview + stale badge + pulsing re-run keeps the loop tight while
  buying provenance. *User-test:* do first-time users find and understand Run? Do returning users
  feel slowed down? Fallback if hated: "auto re-run" toggle in step 3 (machine supports both).
- **R2 — Tray vs. list density.** Moving tickets from a 320 px always-on rail into a picker and
  results into a tray reduces passive browsing. Accepted: browsing is a means to T1, not the job.
  *User-test:* ticket-first users locating a known ticket by id (search-first picker should win).
- **R3 — Map snapshot may be blank or tainted.** `canvas.toDataURL` needs a fresh render
  (`map.once("render")` after `triggerRepaint`) and CORS-clean raster tiles (CARTO serves
  `Access-Control-Allow-Origin: *`; verify in Phase D). Fallbacks: `preserveDrawingBuffer: true`
  (minor perf cost) or ship report without the image and note it.
- **R4 — Print-PDF fidelity** is lower than a jsPDF build; accepted for zero dependencies and
  because the report is tabular. *User-test:* is the printed report "attachable" to real work?
- **R5 — Hand-rolled IndexedDB wrapper.** Small but new failure surface (quota, Safari private
  mode). Mitigated by the overlay.ts-style try/catch posture + JSON project as the durable
  fallback. Store size is trivial (runs are KBs).
- **R6 — Two-altitudes-in-one-tray complexity.** The tray hosts assess tabs *and* the ranked
  cells table. Keep the tray's contract dumb ("mode decides tabs") to avoid a mega-component;
  watch prop drilling — if it bites, split `AssessTray`/`ScreenTray` behind the same shell.
- **R7 — "Relationship: intersects/inside" is approximate** (client-side geometry-type
  heuristic). Label it `≈` like distances; never claim topological precision beyond what
  `ST_Intersects` already answered.
- **R8 — Scope creep into a ticket manager.** The redesign deliberately keeps ticket CRUD
  minimal (existing overlay) — no assignment, comments, or statuses beyond what exists.
- **Honesty/docs guardrails (unchanged):** no PostGIS-parity claims; geokit described as a
  Rust→WASM module wrapping mature crates; screening stays labeled an index (MAUP-sensitive);
  exports keep the synthetic-data disclaimer. `scripts/scrub.sh` runs per phase.

*User-test before/early in implementation (priority order):* mode names ("Assess work area" /
"Screen portfolio" vs alternatives); Run-button discoverability + staleness comprehension;
preset naming for screening; tray-vs-rail for facilities; whether the saved-run concept matches
how users expect "Save" to behave.

---

## Status & next steps

- This package is the design baseline for the redesign, developed on the `dev-kimi` branch.
- Next: design review of the critique (§1), IA (§3), wireframes (§4–5), data/persistence models
  (§7–8), and phase plan (§10). On sign-off, implementation proceeds phase-by-phase per §10,
  each phase an independently reviewable diff.
- Open user-test items to settle before/during early phases are listed in §11 (mode names,
  Run-button discoverability and staleness, preset naming, tray-vs-rail, save semantics).
