# Screens: layout and bindings

Each screen as the reference mockup lays it out. It is a design reference, not a production specification ([why](README.md#reference-only-not-production-ui)): sizes and arrangements are the mockup's starting point, and the plan and design-system tokens govern. Sizes are at 1440 × 900 unless stated. `Name` in code font is a definition in [view-model.schema.json](view-model.schema.json); a path such as `space.area.declared` is a field. Quoted text is the mockup's copy; production copy follows the design system and H99 Z4. Nothing here is sample data: where the mockup showed a value, this file names the field it came from.

Read the [README](README.md) first for the frame, interaction model and states shared by every map screen.

## GF2 — frame, intake, map and workspace

Built by [UI-01 to UI-04](../../../usp-agent-handoffs/29-agent-task-cards.md#gf2--prove-spaces).

### Frame (UI-01, UI-02)

- **Top bar** (`StudioHeader`, 56 px): wordmark "3D ULPIN" + surface name; nav **Batches · Map · Register** (active item follows the page); area switcher showing `scope.areaLabel`; status pill "Live" or "Snapshot <time>" from `scope.status`; language menu; More menu of *Planned* screens; theme toggle (Light/Dark, stored per viewer); initials and name from `scope.principal`.
- **Scope strip** (36 px, map page only): the panel switch (Layers, Spaces, Sources, Checks as ghost buttons, the open one soft and `aria-pressed`), a 1 px divider, `scope.areaLabel` in 600 weight, then either `scope.revisionLabel` or the import progress from `intake.saved`, then a neutral badge with `scope.classification`, then any record badges (replayed, read-only role), the selection crumbs, a flexible gap and **Add files** (disabled while importing or for read-only roles).
- **Left panel** (308 px, closed by default, one at a time, header with title and **Close**). Sections are separated by a divider and a muted label:
  - *Layers*: Base (what the base shows); Imagery toggles bound to `area.layers` (orthophoto; AI candidates, which also turns the orthophoto on); **Colour by** radio group "one at a time" with None, Rights, Utilities (and further modes only when their data exists); when AI candidates are on, a list of `area.aiCandidates` each with its confidence badge and **Accept** / **Reject**, then *Accepted*/*Rejected* with **Undo**, a "n of m decided" caption and the extraction model's evidence chip.
  - *Spaces*: the spaces of the current level (`building.spaces` filtered by `selection.levelId`) with a rights swatch, label and rights word; clicking selects the space. Caption with the building's space count. Other levels: "Pick a level on the rail to list its spaces."
  - *Sources*: `building.documents` as EvidenceChips; model answers with "From the live model, <date>" or the replayed badge, and mapping state badges.
  - *Checks*: `checks` for the current building and revision with the check version; rows that have a finding open it; *Not assessed* rows hatched.
- **Map toolbar** (`MapToolbar`, top-left): Select, Measure, Area, Section, Impact screening, Underground; 3D/2D; Model/Volumes; reset camera. Findings mode forces Volumes.
- **Level rail** (`LevelRail`, right edge, building and level modes): `frame.vertical.label` once at the top; each of `building.levels` in `order` with its lower elevation; a ground line between the last above-ground and first below-ground level; estimated values end in "est."; unknown shows "?" with the hatch. Clicking a level enters level mode.
- **Legend** (`Legend`, bottom-left, only when a Colour by is on or in findings mode): one section for the active mode with a row per category present in the data and its count, unknown rows hatched, plus the evidence and record keys.

### S1 Batches — `/studio/work`

- Page up to 1600 px, 24 px padding, grid `minmax(0,1fr) 300px`, 24 px gap.
- Main column: title "Batches"; 240 px search box (filters label and next action); ghost filter buttons Stage, Area, Assigned to me; primary **Add files**. Then one card with a row per `batches[]`: grid `minmax(0,1.4fr) 150px minmax(0,1.2fr) 120px 56px` — `label` (600) over `areaLabel · fileCount files`; stage badge (Add files neutral, Review details info, Check and record warning, Recorded success); `nextAction.label` in primary 600 with an arrow, the whole row opening `nextAction.target`; compact readiness (six 8 px cells, filled per ready dimension, hatched per unknown, "n of 6"); `updatedAt` as time, right-aligned.
- Right column (top padding 56): up to three `counts[]` as cards (28 px display figure over a muted label); each opens its list.
- Empty: "No batches yet. Add files to start." with **Add files**. No match: "No batches match." Loading: eight skeleton rows.
- Phone (390 × 844): counts as three small tiles, rows stacked (label and stage badge, then next action), "Editing is available on desktop."

### S2 Add files — dialog, `/studio/add-files`

- 960 px dialog. Header "Add files". Stepper: Drop files → Check what we found → Confirm (done steps ticked, current step filled primary).
- *Check what we found*: DataTable over `intake.files` — File (mono `name`), Detected (`profile.label`, or *Unknown* / *Planned*), CRS (`crs.value`, or warning badge "CRS unverified" with **Choose**; "—" when not spatial), Contents (`contents.count` + `contents.unit`, numeric), Mapping badge (*Proposed* info, *Reused mapping* success, *Manual* neutral).
- One inline question at a time from `files[].questions[]`, on an info-soft band: "<field> looks like <concept> in <from>. Convert to <to>?" with **Yes**, **No**, **Choose field**; once answered it shows a *Reviewed* badge with the outcome.
- Provider down (`intake.provider = unavailable`): proposed mappings show *Manual* and a warning band "Automatic mapping unavailable. Map manually or save for later." with **Map manually**.
- A muted line lists profiles that are *Planned* rather than hiding them.
- Beneath the table, a "Needs input" list shows parked objects with the exact missing item and what it unlocks, and a "Kept as evidence" list shows files rejected for 3D with the reason ([H30](../../../usp-agent-handoffs/30-reference-scene-and-incomplete-data.md) E). Questions never exceed five per batch.
- Footer: **Save and continue later** (ghost), **Start import** (primary).

### S3 Live import on map — `/studio/imports/:importPackageId`

- S4 layout while `intake.step = importing`: buildings appear as their chunk is saved (`BuildingSummary.saved`), no inspector, no camera movement.
- Scope strip shows "Importing · <saved> saved".
- Tray: `ImportStream` titled with the batch label and meta from `intake.saved`, one row per file with state (saved, attention with its detail and action, running with a progress bar, failed with its fix), plus **Pause** and **Cancel**. When everything is saved the tray closes after a short pause.

### S4 Area map — `/studio/areas/:areaId`

- Frame as above; left panel closed; no legend (no Colour by).
- Scene in area mode over `area.buildings` and `area.parcels`.
- Inspector: building variant (see README) with readiness for "Assign proposed 3D ULPIN".

### S5 Building and floors — same route with `feature` and `record`

- Building mode shows the level rail; level mode ghosts upper levels and colours the chosen level's spaces by Rights with labels; Legend "Rights" with a row per rights value present and its count, *Unknown* hatched.
- Inspector: space variant. Evidence chips open S7. **Review area** opens the carpet-area finding.
- A compact `StrataSection` may sit under the facts.
- No 3D: the level's plan sheet (from the plan evidence) and the spaces list side by side, same selection.
- Phone: full-bleed scene, horizontal level chips with the vertical reference first, a bottom sheet with the space's label, status, code, location and three facts, and "View only on phone. Review on desktop."

### S9 Workspace: review details — `/studio/properties/:buildingId/workspace`

- Stage bar (pill segmented nav): Add files · **Review details** · Check and record, then the building and level label.
- Grid `84px minmax(0,1fr) 400px`, 16 px gaps.
- Left strip: page thumbnails of the plan evidence (current page outlined primary), then Measure, Calibrate, Compare icon buttons with tooltips.
- Centre: the plan page with `Candidate` outlines in dashed primary; the current candidate filled at 16 % and solid; decided ones solid at reduced opacity; OCR dimensions under the active label.
- Right: a panel "<n> of <total> to review" with an *AI candidate* badge; the candidate's label, confidence badge, evidence chip and "<dimensions> · from OCR"; **Accept**, **Adjust**, **Reject**. When none remain: "All candidates reviewed" with **Continue to checks**. Below: "Level register" table (`building.levels`: label, lower, upper, status) captioned with the vertical reference.

### S10 Workspace: check and record — same route, check stage

- Grid `minmax(0,1fr) 400px`. Left: the drafted building in Volumes with a Model/Volumes control. Right:
  - "Checks" panel with the check version, grouped *Blocking*, *Needs review*, *Not assessed* (hatched), *Passed*, each group with a count badge; rows show name and detail; blocking rows have **Open in 3D** / **Open** into findings mode.
  - "Changes since <previous revision>" panel: counts of spaces, levels and shared spaces from the draft, and the level list; footer **Record reviewed details**, disabled with "Blocked: <n> blocking findings open" while any blocking finding is open.

### S11 Assign proposed 3D ULPIN — 760 px dialog over S5, S10 or S12

- Title "Assign proposed 3D ULPIN · <space label>".
- Subtle panel: `UlpinCode` in draft state with the location line and its segment legend, then "A random code is generated on confirm".
- Two columns: `ReadinessMeter` for "Assign proposed 3D ULPIN"; Parcel ULPIN (mono) with its anchor state badge, lineage from `code.lineage` ("New space · no predecessors" when empty), and "The state's ULPIN is unchanged."
- Footer: **Cancel**, **Assign code** (primary, shield icon). Then the assignment toast (README).

## GF3 — underground, evidence, findings, register and deviation

Built by [UI-05](../../../usp-agent-handoffs/29-agent-task-cards.md#ui-05--register-evidence-deviation-and-underground-screens).

### S6 Underground and impact screening

- Map in underground mode (README). Colour by Utilities; Legend lists each utility kind present with count, corridors or other volumes with their provenance badge, and a hatched "No survey".
- Inspector: `DigColumn` over `underground.bands` with the depth range; bands without a survey render "Unknown · no utility survey"; **Export screening report** and **Request survey**; "Screening only. Not a clearance or dig permission."

### S7 Evidence viewer — `panel=evidence`

- 960 px dialog over the dimmed map. Header: source label, then revision badge, received date and hash (mono, muted), **Open original**.
- Body: `minmax(0,1.25fr) minmax(0,1fr)`: left the source preview chosen by locator kind with the linked region outlined and its text highlighted; right a still of the 3D space taken from the current camera, with a primary pill naming the space and level.
- Footer: "Supports" and chips for the facts this region backs, **Close**, **Link to another space**.

### S8 Findings review

- Findings mode. Tray: `findings` in order (blocking, severity, size), each a row `120px minmax(0,1fr)` with the severity badge and title; the selected row soft primary. Filter chips Blocking, Needs review, Info, Not assessed.
- Legend "Findings" with counts per severity.
- Inspector: `FindingCard` with severity, check version, title, calculation lines, evidence chips and allowed actions (for example **Request evidence**, **Apply level evidence** enabled only when the newer evidence exists).

### S12 Property register — `/studio/properties/:buildingId/register`

- Identity header once (surface, bottom divider): title `building.label` with status and provenance badges; muted line with address, Parcel ULPIN (mono) and tenure regime. Actions: **Back to map**, **Deviation check** (toggles S13), **Export** menu from `building.exports` (planned items disabled with a *Planned* badge), **Property Card** (primary; disabled with "Blocked: assign a proposed code first" or "Blocked: read-only role").
- Stale or error banner under the header when present.
- Body `minmax(0,55fr) minmax(0,45fr)`: left the model with the level rail (clicking a level isolates it); right tabs **Units · Shares · Documents · Checks · History** (Documents is H99's `tab=evidence`):
  - Units: DataTable of spaces — Level, Unit (600), Code (mono or "After review"), computed area m², share %, Status; unknown numbers as *Unknown*; a "<n> more units" footer when paged.
  - Shares: `ShareLedger` with regime, basis, population declared of total, rows and a footer flag when `total` differs from `expected`.
  - Documents: `building.documents` as chips with their locators.
  - Checks: `checks` rows with badges.
  - History: `RevisionTimeline` over `revisions` with the chain state.
- Empty Units: "No floors recorded for this building. Add a plan or level schedule." with **Add files**.

### S13 Deviation check — register comparison panel

- Model pane in deviation mode with pill labels `deviation.sanctionedLabel` (left) and `deviation.observedLabel` (right) and the seeded or fixture badge only when `deviation.provenance` says so; caption "Observed from <observed source>; not a legal determination."
- Right panel "Sanctioned against observed" with *Needs review*: table over `deviation.rows` (measure, sanctioned, observed; differences in danger 600; non-comparable rows show *Not comparable* and the reason); exclusions as help text; evidence chips; **Create finding**.

## GF4 — card and verification

Built by [PACK-01](../../../usp-agent-handoffs/29-agent-task-cards.md#pack-01--property-card-and-local-qr) with UI.

### S14 Property Card — 960 px dialog from the inspector, toast or register

- Grid `minmax(0,1fr) 260px`. Left: `PropertyCard` preview — `card.title`, code, location line, revision, hash, chain state, facts, QR labelled for the local link, footer "Technical record, not a title document".
- Right: Scope segmented (Unit, Floor, Building); Audience segmented (Public, Owner, Officer); Party names toggle (forced off for Public); "QR opens: Local demonstration link".
- Footer: **Close**, **Open local link** (goes to P4L), **Export PDF**.

### P4L Verify card — local link on the same device

- Own header: wordmark "Verify", **Back to Studio**. Column max 560 px.
- Note: "Local demonstration link. Public verification is planned."
- Result band from `verify.state`: success "Valid: revision <r>", warning "Superseded by <r>" with **Open current**, danger "Retired: merged into <code>".
- Card: title, `UlpinCode` (copyable) with location, facts (level with vertical reference, area, assigned date, revision hash).
- `RevisionTimeline` of the last three revisions with the chain state.
- States: Loading skeleton; not found "No card found for this link" with the reason and **Back to Studio**; resolver unavailable "Could not check this card" with the fix and **Try again**.

## Full product (planned; not finale work)

Mocked so the finale does not block them. Build only under their full_product gates.

### Studio S15–S19

- **S15 Unit page**: identity header with crumbs, status and provenance badges, **Open in 3D**, **Property Card**; grid `1fr 1fr 360px`: Identity (`UlpinCode` with legend) and Facts; `CarpetAreaCheck` (components, deductions, declared with evidence, threshold) and `StrataSection`; Evidence chips and `RevisionTimeline`.
- **S16 Revision compare**: title with chain badge; table `200px 1fr 1fr` of two revisions; changed rows warning-soft; "Only changed rows are highlighted…".
- **S17 Air-rights envelope**: model with a dashed, hatched envelope labelled "illustrative"; panel with *Provisional*, built summary, remaining floor area *Unknown* until a development-control rule is linked, "…not a right."; **Create envelope** disabled.
- **S18 Command palette**: 640 px dialog 96 px from the top; query line with Esc; groups Codes, Spaces, Findings, Actions; first result highlighted.
- **S19 Split, merge or boundary adjustment**: 760 px dialog; "Retired on confirm" cards → successor card with dashed primary border and draft code; share and lineage; footer blocked reason and **Retire and assign successor** disabled until the deed and declaration exist.

### Portal P1–P7 (FP-PUBLIC)

Portal header with accessibility bar, English / हिन्दी, empty department-mark slot (never an emblem), **Sign in**. Content max 1200 px, 40 px / 32 px padding on desktop, 20 px / 16 px on phone; every heading has its Hindi line beneath in Noto Sans Devanagari.

- **P1 Home**: `7fr 5fr`: left "Find a property record" (display size), Hindi line, one Field "3D ULPIN, parcel ULPIN or address" with **Search**, then "What this record shows" note; right three task links (Verify a Property Card, Request a correction, Track my request) with Hindi sublines. Phone: search sticky at the top.
- **P2 Results**: crumbs, heading, search, "<n> released record(s)", result cards (title, status, code, one muted line, "Open record →"), a note when siblings are not released; a view-only scene on desktop.
- **P3 Record**: crumbs, title, code, Parcel ULPIN; note "Released details only. Owner names and documents are not public."; `7fr 5fr`: view-only scene (420 px) and `StrataSection` | released facts and **Download Property Card**. Phone: facts first, a still of the scene with **Open 3D**.
- **P4 Verify**: as P4L without the local note; footer "Something wrong? Request a correction with your evidence."
- **P5 Request a correction**: stepper Record → Details and evidence → Review and send; radio "What is wrong?", Field "What should it be?", evidence drop zone ("Your document is seen only by the officer reviewing it."), **Back** / **Continue**; side card with the record and "Your name is not shown on public pages."
- **P6 My requests**: request card with status and a vertical tracker (Sent, Received, Under review, Answer), note that an answer does not decide ownership; side **Add evidence**.
- **P7 Sign in**: mobile number with one-time code; "Only needed to request or track a correction…"; "Why we ask".

### Admin A1–A7

`StudioHeader` with surface "Admin" and nav Overview · Imports · Coverage · AI quality · Users · Audit · Settings; page up to 1600 px; title row with the snapshot status. Every number links to its list.

- **A1 Overview**: four stat tiles (open findings with blocking sub-count, spaces awaiting review, imports running, proposed codes assigned this week); a line chart of spaces recorded per day (30 days) and a bar chart of findings by check type, one axis each; coverage by block and AI quality tables (results *Not assessed* until a held-out test runs); chain health line.
- **A2 Imports**: running imports table and a per-file table (profile, CRS, mapping, result); "Originals are kept unchanged. A failed file never removes saved results."
- **A3 Coverage**: by block and by building; buildings without levels as *Unknown* "Massing only"; "Ready means ready for the named task, not a single score. Unknown is counted, never hidden."
- **A4 AI quality**: models with measure, result and sample; schema learner *Planned*; replayed answers excluded.
- **A5 Audit**: events table and `RevisionTimeline`; "Revisions are hashed and chained; they are not signed."
- **A6 Users**: people table and a role-permission matrix.
- **A7 Settings**: Checks (review threshold, order, version), Records (vertical reference, code label, QR mode, public verification *Planned*), Portal (languages, public fields), Model answers (offline rehearsal, provider-down behaviour). All values come from configuration records.
