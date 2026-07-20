# GIS Conflict Dashboard — Redesign Brief for Kimi

## Purpose

Review and redesign the existing GIS Conflict Dashboard as a serious portfolio-quality GIS application.
The goal is to make the interface substantially easier to understand and use without discarding the
technical capabilities that distinguish the project.

This is not a request to replace the application with a smaller Leaflet/Turf prototype. Treat the
existing architecture and capabilities as product assets, then redesign the experience around a clear
user workflow.

## Repository context

The dashboard is a fully client-side application with no backend.

Its primary technologies are:

- React, TypeScript, Vite, and MapLibre GL
- DuckDB-WASM with its spatial extension for SQL over static GeoParquet data
- `geokit`, a Rust-to-WASM module wrapping mature Rust crates for geodesic buffering, H3 analysis,
  KML/KMZ parsing, projections, and geometry operations
- Terra Draw for map drawing

The application currently supports:

- Ticket search and filtering
- Existing-ticket inspection and locally created tickets
- Point-buffer and polygon-AOI conflict analysis
- Live conflict-rule presets and owner/status configuration
- Jurisdiction lookup
- Map-linked conflict evidence
- H3 conflict screening with configurable weights, resolution, normalization, and thresholds
- Ranked-cell drill-down
- KMZ import and export
- CSV export
- Desktop and mobile layouts
- Collapsible panels, keyboard shortcuts, and accessibility features

Public-domain infrastructure and jurisdiction data are used. Ticket and AOI records are synthetic.

## Product problem

The application has strong analytical capabilities, but the experience still presents too many tools
at once. It often feels organized around implementation features rather than the user's decision.

The main decision is:

> Does this proposed work area conflict with relevant infrastructure, which jurisdiction contains it,
> and what evidence supports the result?

A second, higher-level decision is:

> Which geographic cells should be reviewed first based on ticket activity, conflict rate, severity,
> and facility density?

The redesign should make those two jobs immediately understandable.

## Required product direction

Preserve the existing engine and analytical capabilities. Redesign the application around an explicit
**analysis run** rather than a collection of independent tools.

Rename the top-level modes using outcome-oriented language:

- **Assess work area** instead of **Tickets**
- **Screen portfolio** instead of **Cell index**

These labels may be refined if you find stronger user-facing language, but they should communicate why
someone enters each mode rather than the underlying implementation.

## Proposed information architecture

### Desktop

Use a map-dominant workspace with one primary task panel and contextual results:

```text
┌──────────────────────────────────────────────────────────────────┐
│ GIS Conflict Dashboard   Assess work area | Screen portfolio     │
│ Project / Saved runs                         Save   Export   Help │
├───────────────────┬──────────────────────────────────────────────┤
│ WORKSPACE         │                                              │
│                   │                    MAP                       │
│ 1  Area           │                                              │
│ 2  Distance       │                                              │
│ 3  Conflict rule  │                                              │
│                   │                                              │
│ [ Run analysis ]  │                                              │
├───────────────────┴──────────────────────────────────────────────┤
│ RESULTS  6 conflicts   Summary | Facilities | Jurisdiction       │
│ Name              Owner          Status      Distance     Inspect │
└──────────────────────────────────────────────────────────────────┘
```

The exact layout can change, but the following principles should remain:

- Keep the map visually dominant.
- Present one obvious primary action.
- Avoid two permanently open sidebars competing with the map.
- Put layers in a compact map popover or contextual control.
- Open results in a resizable bottom tray or similarly strong evidence surface.
- Show detailed feature information in a contextual drawer.
- Synchronize map selection and result-table selection in both directions.

### Mobile

Retain the map-first bottom-sheet pattern, but make sheet contents follow the same workspace/results
model as desktop:

- Collapsed sheet: current task and result count
- Half sheet: workflow controls or result summary
- Full sheet: complete form, result table, or detail view
- Avoid duplicating desktop and mobile application logic

## Assess-work-area workflow

Build a clear sequence with progressive disclosure.

### 1. Define the work area

Support:

- Select an existing ticket
- Click a point on the map
- Draw a polygon
- Enter coordinates
- Import KML, KMZ, or GeoJSON where supported

Do not force these into a long wizard. A compact stepper or staged workspace is appropriate as long as
users can revise earlier choices easily.

### 2. Configure the analysis

Include:

- Buffer distance and units
- Useful distance presets
- A visible map preview of the resulting AOI
- A named conflict-rule preset
- An advanced disclosure for owner/status rule editing
- A plain-language summary of the active rule

Example rule summary:

> Count active and planned facilities owned by Operator Alpha.

### 3. Run the analysis

Provide one visually dominant **Run analysis** action. If settings change after an analysis, communicate
that the displayed results are out of date. Decide deliberately whether individual changes should
recompute automatically or wait for another run.

### 4. Review the evidence

Provide at least three result views:

#### Summary

- Conflict/clear status
- Number of conflicting facilities
- Jurisdiction
- Buffer distance
- Active rule
- Concise plain-language finding

#### Facilities

A sortable, filterable table containing useful fields such as:

- Facility identifier/name
- Owner/operator
- Status
- Conflict relationship
- Approximate distance
- Inspect/locate action

Clicking a row must highlight and locate the feature on the map. Clicking a map feature must select and
reveal the corresponding row.

#### Report

Prepare a report/export view containing:

- Analysis name and optional notes
- Work-area source
- Map image or map-ready representation
- Buffer distance
- Conflict rule and assumptions
- Analysis timestamp
- Jurisdiction
- Conflict summary
- Full facility evidence
- Data-source attribution

Desired exports include PDF, CSV, GeoJSON, and KMZ where appropriate.

## Screen-portfolio workflow

Keep H3 screening as a major feature, but simplify its initial presentation.

Start with understandable scoring presets such as:

- Balanced
- Conflict-heavy
- Volume-heavy
- Facility-density

Put the following controls behind an **Advanced scoring** disclosure:

- H3 resolution
- Individual weights
- Normalization method
- Highlight threshold

The results surface should show ranked cells in a sortable table. Selecting a cell should:

- Highlight and locate the cell on the map
- Show its component metrics
- Reveal its member tickets
- Allow transition into work-area assessment without losing context

Use a breadcrumb or equivalent context indicator, for example:

```text
Screen portfolio > Selected cell > 9 tickets
```

## Persistence

Add a durable saved-analysis concept using IndexedDB while retaining the backend-free architecture.

A saved analysis should include:

- Name and notes
- Work-area geometry and source
- Imported overlay metadata as appropriate
- Buffer distance and units
- Conflict rule
- Selected layers
- Result summary and relevant identifiers
- Created and updated timestamps

Also consider a portable JSON project format that can be exported and reopened locally.

Do not introduce a backend solely to implement this redesign.

## Visual-design direction

The existing dark, map-focused identity can remain, but improve hierarchy and reduce visual uniformity.

Explore the following:

- Increase normal working text to approximately 14px where space permits.
- Use fewer bordered cards and nested containers.
- Reserve blue for actions and selection.
- Reserve red for confirmed conflict states.
- Improve contrast between the basemap, facilities, tickets, AOIs, and selected evidence.
- Reduce uppercase micro-headings.
- Establish clearer title, section, body, and metadata typography.
- Replace ambiguous symbol-only controls with recognizable icons, accessible names, and tooltips.
- Make empty states instructional and action-oriented.
- Preserve visible keyboard focus and reduced-motion behavior.
- Maintain comfortable touch targets on mobile.

Avoid decorative animation that slows the workflow. Small transitions that clarify state or spatial
relationships are acceptable.

## Technical constraints

Do not propose replacing the application with nested Turf.js scans or a no-build collection of CDN
scripts.

The redesign should:

- Retain React, TypeScript, Vite, MapLibre, DuckDB-WASM, and `geokit` unless a specific, demonstrated
  problem justifies a scoped change.
- Continue to be deployable as a static site.
- Continue to work without a backend.
- Preserve H3 screening.
- Preserve SQL/GeoParquet-based querying.
- Preserve geodesic buffering and jurisdiction/conflict analysis.
- Remain usable with the existing public-domain and synthetic demo data.
- Avoid claims of exact parity with unrelated GIS systems unless verified by fixtures.
- Keep expensive spatial operations indexed or set-based where practical.

## Important correction to the earlier design proposal

The `geokit` package should be described as a Rust-to-WASM module wrapping mature crates, not as a
custom geometry engine. DuckDB-WASM and `geokit` are intentional parts of the project's portfolio value.
The goal is to make their capabilities feel simple to the user, not remove them from the implementation.

Similarly, “CDN scripts,” “single index.html,” “open directly from disk,” and “fully offline” should not
be treated as interchangeable promises. A bundled static application with locally hosted assets is a
valid and often more reproducible offline-capable design.

## Requested deliverables

Please return a concrete redesign package containing:

1. A concise critique of the current desktop and mobile experiences.
2. Primary user stories and the task hierarchy you are designing for.
3. A revised information architecture.
4. Desktop wireframes for:
   - Initial/empty state
   - Existing-ticket selection
   - Work-area configuration
   - Conflict results
   - Facility inspection
   - Portfolio screening
   - Ranked-cell drill-down
5. Mobile wireframes for the main workflow states.
6. A component inventory with state and interaction notes.
7. A proposed `AnalysisRun` data model.
8. A persistence model for IndexedDB and portable project export.
9. A visual-design specification covering typography, spacing, colors, states, and map symbology.
10. An implementation plan broken into independently reviewable phases.
11. Risks, tradeoffs, and anything that should be user-tested before implementation.

Where possible, show concrete layouts and interaction behavior rather than only describing design
principles. Do not generate a replacement codebase until the proposed experience and information
architecture have been reviewed.

## Success criteria

The redesign succeeds when:

- A new user can identify the primary action within a few seconds.
- A work-area analysis has an obvious beginning, configuration step, and result.
- Conflict evidence is reviewable without hunting through panels.
- Map and tabular evidence remain synchronized.
- H3 screening is understandable before advanced controls are exposed.
- The map retains enough space to function as the main analytical canvas.
- Desktop and mobile share the same conceptual workflow.
- Analyses can be saved, reopened, and exported.
- The project retains its distinctive browser-based GIS architecture.

