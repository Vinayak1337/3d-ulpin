# Components

**Current delivery:** [User scope policy](../usp-agent-handoffs/current-delivery-policy.md) governs: official-source data only; desktop-first/light-only; no theme switch or reserved space. Mobile and alternate-theme examples below are future guidance, not current acceptance requirements. Retain reusable tokens and layout seams.

Thirty-two components, the same set as the team's design system in Claude Design, each with its reference CSS classes in [reference/components.css](reference/components.css). The first twenty-three come from the design system artifact; Panel, DataTable, DescriptionList, Tabs, Toggle, Icon, Wordmark, MapCanvas and MapPatterns were added in Claude Design and are used throughout the [reference mockups](mockups/officer-studio/README.md). "Data from" names the producer handoff whose contract feeds it. UI owns the component; the producer owns the data. Port a component into the owning feature's CSS with `--ui-*` tokens; do not add a component library.

## Identity and records

### UlpinCode
Shows identity in mono, copyable, never broken across lines.
- **Line 1, the code:** the `P3` project code labelled **3D ULPIN (proposed)**. It carries no meaning, so show no segment tooltips on it.
- **Line 2, the location:** the parcel / structure / level / space segments labelled **Location**, muted, display only. Segment tooltips live here (parcel anchor, structure, level, space). `MULTI(2)` or `NO-ANCHOR` when the anchor is not a single reviewed parcel.
- **States:** *Assigned* (solid), *Draft* (no code yet: "Code assigned after review"), *Retired* (struck through, with successor links), *Cancelled* (struck through, with the reason).
- Always show the **Parcel ULPIN** separately with its anchor state. Never call anything official.
- **Data from:** H26 (FND).

### PropertyCard
One-page card for a space: code and location line, level and limits with the vertical reference, carpet area with its component basis, share (or "not applicable: co-operative society tenure"), rights and shared spaces, evidence list, revision, chain state and the QR.
- Printable A4 and PDF. Only released fields; no personal data.
- Footer: "Technical record, not a title document", revision and hash, "Chain consistent" (or signed and verified only when a signed head verifies).
- The finale QR opens the **local demonstration link** on the same device.
- **Data from:** H10 (PACK), H26.

### RevisionTimeline
History of one record: each revision says what changed, from which evidence, by whom and when (IST), with its hash and the previous one.
- Top badge **Chain consistent** when every link matches; a break shows a danger badge at the first bad link. **Unsigned** is shown as neutral, not as a failure.
- Dates show their role (execution, registration, mutation) and a pending mutation says so.
- **Data from:** H15 (HISTORY), H10.

### ShareLedger
Undivided-share table for one building: unit code, carpet area, share and the declaration's basis (value or area).
- Footer totals shares. A complete population not totalling 100 % gets a danger badge with the exact difference; a partial population says "Not assessed: incomplete population".
- Tenure regime shown in the header; co-operative societies show "not applicable".
- Flags `general_common` spaces with fewer than two beneficiaries; limited common areas may have one.
- **Data from:** H16 (RIGHTS).

### CarpetAreaCheck
Carpet area from components against the declared figure.
- Shows the arithmetic by component class: net usable plus internal partitions; external walls, service shafts, exclusive balcony or verandah and exclusive open terrace excluded (RERA section 2(k)).
- Over the frozen tolerance: *Needs review* finding. Different definition or revision: *Not comparable*. Missing component: *Not assessed*.
- **Data from:** H27 (DOMAIN).

### ReadinessMeter
Readiness of one record for one named task, in six dimensions: evidence, geometry, association, consistency, review, freshness.
- Always names the task. Unknown dimensions are hatched and block an all-clear. No overall score.
- **Data from:** H11 (READY).

## Evidence and findings

### EvidenceChip
Link from a value to its exact source: document or dataset, locator (page, row, clause, feature), revision.
- Click opens the evidence viewer beside the 3D space. Dashed outline marks an estimate; the amber variant marks a missing source and doubles as **Request evidence**.
- **Data from:** H10, H11.

### FindingCard
One reproducible finding: severity, participants, the measured relationship with its arithmetic, sources, next actions.
- Title states the result with its number ("<space> / <space>: <volume> m³ overlap"). Severity is a badge with icon.
- Arithmetic in the calculation block so an officer can check it by hand. *Not assessed* shows the reason and never reads as "no conflict".
- Actions: **Open in 3D**, **Request evidence**, **Mark resolved** only when new evidence is applied.
- **Data from:** H12 (FIND), H27.

### ImportStream
Live list of an import: one row per file with what was detected, what was mapped (**Proposed**, **Reused mapping**, **Manual**) and what needs a decision.
- Rows change as chunks are saved; the map updates without moving the camera.
- Only rows needing a person show an action ("Review 1 mapping"). Provider unavailable shows "Map manually".
- A file that cannot be read names the missing reader or the rejected reference; never fails silently.
- **Data from:** H14 (INGEST).

### DigColumn (impact screening)
Screening result for a drawn trench or volume: every recorded space, corridor and utility in the column, top to bottom, with depth range and quality, then anything within the configured distance.
- Header: "Screening only. Not a clearance or dig permission."
- Unsurveyed bands are dashed *Unknown* rows. Utilities show the APWA swatch, size, quality letter and "tolerance not stated" unless the source gives one. Test fixtures are labelled.
- Action: **Export screening report**. Never "safe to dig", never a notice.
- **Data from:** H17 (IMPACT).

## Map

### MapStyle
Reference look of the base scene: neutral ground, roads, parcel lines, grey massing, one green selection with halo, estimated geometry hatched, a finding as its own red solid, a utility tube with its quality badge. Rules in [map-and-3d.md](map-and-3d.md).

### MapToolbar
Floating tool cluster at the top-left of the canvas: Select, Measure distance, Measure area, Section, Impact screening, Underground; then 2D/3D, Model/Volumes, Reset camera. Icon-only tools carry tooltip and `aria-label`; the active tool uses `aria-pressed`. One row. Tools hidden when the role cannot use them.

### LayerPanel
Layers view of the on-demand left panel: Colour by on top (None, Rights, Readiness, Findings, Utilities; one at a time), then groups: Context, Cadastre, Below ground, Evidence, AI candidates. Toggles use `role="switch"`. A layer with no data shows "No data" and stays toggleable.

### Legend
Bottom-left legend for the active Colour by mode plus the always-on evidence (fill) and record (outline) keys, drawn with pattern and line style. Unknown always has its own hatched entry. Counts per entry.

### LevelRail
Vertical level picker on the right edge of the canvas: rooftop structures, terrace, floors, mezzanines, ground, stilt, lower ground, basements, in source order.
- Vertical reference named once at the top ("m · <named reference>"); each level shows its lower elevation; estimated limits end in "est."; unknown shows "?" with the hatch.
- Ground line shows the benchmark height. Click isolates; shift-click keeps upper levels as ghosts; arrow keys move.
- **Data from:** H22 level kinds, H27 level register.

### StrataSection
Schematic vertical section of one parcel: airspace, levels, ground line, basements, utilities and corridors, each with elevation and reference. Selected space in primary; below ground in soil tones; test fixtures labelled. Used in the inspector and on the card.

### SegmentedControl
Pill of 2–4 exclusive view options (2D/3D, Model/Volumes, Plan/Oblique/Section). Changes the view only, never data, selection or camera target. The selected segment is a primary fill with on-primary text. `aria-pressed` on each.

### MapCanvas
The map canvas frame (`ul-canvas`): `--ui-map-ground` fill, 12 px radius, clipped. The scene is the child; floating chrome sits in absolutely positioned overlays: MapToolbar top-left, LevelRail right edge, Legend bottom-left, a mono coordinate readout on the bottom edge. Only the thing being asked about has colour; everything else is neutral massing at context opacity.
- Flat (SVG or 2D) scene classes: `m-ground`, `m-road`, `m-public`, `m-water`, `m-water-line`, `m-parcel`, `m-bldg`, `m-ctx` (context opacity), `m-halo` + `m-sel` (selection), `m-est` (hatched estimate), `m-crit` (finding solid), `m-sleeve`, `m-label`, `m-code`. In the Cesium scene the same tokens drive materials ([map-and-3d.md](map-and-3d.md)).

### MapPatterns
The two map fill patterns, defined once per scene: `hatch` (estimated geometry: 45° muted hatch over `--ui-map-building`, used by `m-est`) and `crit` (a finding solid: `--ui-mark-critical` with a halo-coloured hatch). Unknown uses the same hatch over `--ui-readiness-unknown`.

## Frame and controls

### Wordmark
**3D ULPIN** in Noto Sans 700 followed by the surface name (Studio, Portal, Admin, Property Card) in `studio-label`. No logo; never an emblem or seal.

### Panel
The standard container (`ul-panel`, with `__head`, `__title`, `__body`, `__foot`) for Studio rails, inspector sections, checks and dialog bodies: surface fill, 1 px `--ui-border-strong`, 12 px radius, `--ui-shadow-card`.
- Head: title in `studio-heading` with a badge, caption or icon on the right.
- Body padded 16 px; flush content (Tabs, a DataTable) runs edge to edge under the head.
- Footer on `--ui-surface-subtle` with at most one primary and one secondary action.
- Panels float on the background 16 px apart. Never stack a border, a shadow and a tinted fill on one element.

### DataTable
Dense Studio table (`ul-table`): 13 px cells, 36 px rows, `--ui-surface-subtle` header row, `--ui-divider` hairlines, bold totals footer.
- Numbers right-aligned (`ul-r`) with tabular figures; areas and volumes to 2 decimals. Codes and hashes in mono.
- Units in the column header ("Carpet m²"). A muted "<n> more" row stands in for truncated rows. Unknown cells say *Unknown*, never blank.

### DescriptionList
Label and value rows (`ul-dl`): muted label on the left (40 %), value on the right. Used for inspector facts, check results and the Property Card.
- Every sourced value carries an inline EvidenceChip; unknown values say *Unknown* with a request action. Mono values use `ul-mono`.
- Units always shown; heights name their vertical reference.

### Tabs
Underlined tab row (`ul-tabs`, `ul-tab`) for inspector and register sections. Inspector: **Overview · Rights · Evidence · Checks · History**. Register: **Units · Shares · Documents · Checks · History** (Documents answers `tab=evidence`). The selected tab is primary with a 2 px underline; sentence case. Parcel, utility, photos and history are tabs, not pages.

### Toggle
A 36 × 20 switch (`ul-toggle`, `role="switch"`) for layer visibility and Property Card redaction. Always beside a visible text label in the same row (`ul-layer` with `ul-grow`), with the same text as `aria-label`. Primary fill when on; `--ui-surface-subtle` with a `--ui-line-control` outline when off.

### Icon
One wrapper over Phosphor Regular (`ul-ico`, `ul-ico--sm`): 20 px in the Studio, 16 px in dense cells, chips and small buttons, 24 px in the Portal. Inherits `currentColor`: `--ui-ink-soft` in toolbars, `--ui-muted` in chips, the status colour in badges. Never the only label for an action. The set and what each icon means are in the [README](README.md#icons-and-wordmark).

### StudioHeader
56 px top bar: wordmark, **Batches · Map · Register**, search (`/`), area switcher, Live or "Snapshot <date>, <time>", user. Active section uses `aria-current="page"`. One navigation row; the scope strip under it is context.

### Inspector
Single right-hand panel for the selection (360 px, 400 px with evidence preview): identity header (name, UlpinCode, status, Parcel ULPIN), tabs **Overview · Rights · Evidence · Checks · History**, footer with at most one primary and one secondary action. Every sourced value carries an EvidenceChip; unknown values say *Unknown* with a request action.

### Button
Primary (`ul-btn--primary`, one per view), secondary (default), soft (`ul-btn--soft`, repeated positive actions in lists), ghost (`ul-btn--ghost`, tertiary actions in toolbars), danger (`ul-btn--danger`, always followed by a confirmation). 40 px in the Studio; Portal buttons add `ul-btn--lg` (44 px). Optional leading Phosphor icon. Labels 1–3 words, sentence case, never wrapped. Disabled buttons explain why beneath or in a tooltip.

### Badge
Icon plus fixed status word; colour never carries meaning alone. Success: reviewed, recorded, assigned, passed. Warning: needs review, needs evidence, stale. Danger: blocking and failures only. Info: counts. Neutral: draft, unknown, not assessed, test fixture.

### Field
Label above, helper below, error below that; no placeholder as label. Units in the label ("Lower limit (m, <named reference>)"). Errors name the problem and the fix and set `aria-invalid`. Portal forms use the UX4G input components themed with these tokens; the anatomy is the same.

### PortalHeader (FP-PUBLIC)
UX4G accessibility bar (text size, contrast, language), then header with an empty dashed department-mark slot, wordmark, **English / हिन्दी** (both scripts) and **Sign in**. Built from the UX4G Accessibility Bar and Navbar themed with these tokens. Never a seal or emblem.
