# 3D ULPIN UI and UX brief

Which screens exist, what goes on each, how the map looks and where every feature lives. Repository copy of the team's UI brief, reconciled on 24 September 2026 with the finale handoffs ([H99](../usp-agent-handoffs/99-ui-ux-and-integration.md) Z, [H97](../usp-agent-handoffs/97-review-findings-and-alignment.md)). Use it with the [design system](README.md) to make mockups (for example in Claude Design) and to check built screens.

## Rules for every mockup

- Desktop artboards at 1440 × 900 for the Studio; one 390 × 844 phone view for S1, S5 and P4L. Portal screens (full_product) at 1440 × 900 plus 390 × 844.
- Use only design-system tokens and components. Forest green is the one accent; colour appears on the map only when a Colour by mode is on.
- Use the specimen data below on every screen with identical values. Never invent another building, code or number.
- Label demonstration data "Fictional demonstration" in the scope strip. Never draw a government seal, emblem, signature or a real officer's name.
- The project code is "3D ULPIN (proposed)"; the state's code is "Parcel ULPIN". Nothing is "official", "issued", "approved", "cleared" or "verified" unless the handoffs allow it.
- Honest states: estimates hatched and labelled, unknowns as *Unknown*, test fixtures labelled, seeded cases labelled.
- No hero illustrations, stock photos, KPI confetti, emoji or gradient backgrounds.

## Specimen data (use exactly)

| Item | Value |
| --- | --- |
| Area | Lake View (fictional demonstration): 214 parcels, 22 buildings, 186 spaces |
| Building | Lake View Residence, 12 Lake View Road; ground plus 8 floors, stilt parking at ground, basements B1 and B2; 55 units; tenure: apartment declaration |
| Parcel ULPIN | MH2507A1B3C4D5 (illustrative); anchor state *Reviewed* |
| Vertical reference | Site datum SD-1 (local benchmark on the gate pillar) |
| Levels | Ground 212.4 m · SD-1; G floor 212.8; 3.0 m storeys; F7 233.8 to 236.8; roof 239.8; B1 209.1; B2 205.8 (estimated) |
| Unit | Flat 704 on F7 |
| 3D ULPIN (proposed) | `P3-7Q4M2R8T6V0W3X5Y9ZAB-R4` |
| Location (display only) | `MH2507A1B3C4D5 / S01 / F07 / R003` |
| Areas | Carpet 69.30 m² from plan components; 72.00 m² declared in the sale deed: +2.70 m² (3.9 %); review threshold 2 % |
| Share | 1.84 % undivided share; declaration population complete (55 of 55 units); total 99.50 % (0.50 % unexplained) |
| Finding | Flat 101 / Flat 201: 6.4 m³ overlap. Flat 101 top 218.90 m, Flat 201 bottom 218.70 m, 0.20 m × 32.0 m² |
| Deviation (seeded test case) | Sanctioned ground plus 8; observed enclosed rooftop structure of 118 m² from 239.8 to 242.8 m; stair cabin and water tank excluded by rule |
| Utility | Water main DN300 under the service lane, 0.9 to 1.2 m deep (source), quality B, tolerance not stated |
| Corridor | Metro corridor 14.4 to 18.4 m below the lane (test fixture) |
| Revision | r3, chain consistent (unsigned) |
| People | Officer R. Iyer, supervisor A. Deshmukh (both fictional) |

## Surfaces and users

| Surface | Release | Users | What they come to do | Feel |
| --- | --- | --- | --- | --- |
| Officer Studio | finale_v1 | Land-record officer; GIS and survey specialist | Import evidence, inspect floor by floor, resolve findings, record revisions, assign proposed codes, make Property Cards, screen underground impact | Map-first workbench; compact 15 px text; dense but calm |
| Public Portal | full_product | Flat owner or buyer; utility engineer | Look up a released record, verify a card, request a correction, track it | UX4G government service; 16 px; bilingual; phone-first |
| Admin Console | full_product | Supervisor | Coverage, backlog, AI quality, audit, users | Summary first; tables and charts |

## Screen count

33 screens in the full product: 7 Portal, 19 Studio, 7 Admin. **The finale builds 15:** Studio S1–S14 plus P4L, the local-demonstration mode of P4.

| Surface | Finale | Full product later | Total |
| --- | --- | --- | --- |
| Officer Studio | 14 (S1–S14) | 5 (S15–S19) | 19 |
| Public Portal | P4 in local mode only (P4L) | 7 (P1–P7, P4 public mode) | 7 |
| Admin Console | none; counts live on Batches | 7 | 7 |

Dialogs, inspector tabs and the tray are parts of these screens. Empty, loading and error states are variants (see States).

```mermaid
flowchart LR
    subgraph Studio
        S1[Batches] --> S2[Add files]
        S2 --> S3[Live import]
        S3 --> S4[Area map]
        S4 --> S5[Building and floors]
        S1 --> S9[Workspace review]
        S9 --> S10[Check and record]
        S10 --> S11[Assign proposed code]
        S5 --> S12[Register]
        S12 --> S14[Property Card]
    end
    S14 -. local QR .-> P4L[Verify card, local link]
```

## Screen inventory

| ID | Screen | Route (H99) | Purpose | Key components | Release |
| --- | --- | --- | --- | --- | --- |
| S1 | Batches | `/studio/work` | Work items with stage and exact next action; at most three counts; Add files | StudioHeader, Badge, ReadinessMeter | finale |
| S2 | Add files | `/studio/add-files` | Drop files, detected profiles, mapping questions | ImportStream, Field | finale |
| S3 | Live import on map | `/studio/imports/:importPackageId` | Map fills in as results are saved | MapStyle, ImportStream | finale |
| S4 | Area map | `/studio/areas/:areaId` | Whole area, search, select a building | MapToolbar, Legend, Inspector | finale |
| S5 | Building and floors | same, with `feature` and `record` | Isolate a floor, colour by rights, select Flat 704 | LevelRail, Legend, Inspector | finale |
| S6 | Underground and impact screening | same, underground mode | Below-ground view, draw a trench, see what lies below | MapToolbar, DigColumn, StrataSection | finale |
| S7 | Evidence viewer | same, `panel=evidence` | Source region beside the 3D space it supports | EvidenceChip, Inspector | finale |
| S8 | Findings review | same, findings tray | Findings list, overlap in Volumes, resolve with evidence | FindingCard, Legend | finale |
| S9 | Workspace: review details | `/studio/properties/:buildingId/workspace` | Plan with AI room candidates, level register, one decision at a time | EvidenceChip, Field, Badge | finale |
| S10 | Workspace: check and record | same, check stage | Topology, carpet area, shares, change summary, Record | FindingCard, CarpetAreaCheck, ShareLedger | finale |
| S11 | Assign proposed 3D ULPIN | dialog over S10 or S12 | Code preview, location line, anchor, readiness, confirm | UlpinCode, ReadinessMeter | finale |
| S12 | Property register | `/studio/properties/:buildingId/register` | Model, floors and units, shares, documents, checks, history | ShareLedger, RevisionTimeline | finale |
| S13 | Deviation check | register or map comparison panel | Sanctioned against observed, seeded case labelled | MapStyle, FindingCard | finale |
| S14 | Property Card | register, card preview | Preview, scope, redaction, local QR, export PDF | PropertyCard | finale |
| P4L | Verify card (local demonstration link) | loopback resolver (H10) | Same-device check of the card's exact revision | UlpinCode, Badge, RevisionTimeline | finale |
| S15 | Unit page | later | Full page for one space | Inspector, CarpetAreaCheck | full product |
| S16 | Revision compare | later | Two revisions side by side | RevisionTimeline | full product |
| S17 | Air-rights envelope | later | Remaining permissible floor area above a building | StrataSection, Legend | full product |
| S18 | Command palette | later | Search codes, addresses, findings, actions | Field | full product |
| S19 | Split, merge or boundary adjustment | later | Retire codes and assign successors with lineage | UlpinCode | full product |
| P1–P7 | Portal: home, results, record, verify, request, my requests, sign in | `/public/*` | Released lookup and citizen requests | PortalHeader, UX4G components | full product |
| A1–A7 | Admin: overview, imports, coverage, AI quality, audit, users, settings | later | Supervisor views | Tables, charts | full product |

## How the map should look

A quiet, light-grey model city where only the thing you are asking about has colour: an architect's massing model with a land-records layer on top, not a game or a satellite view.

| Zone | Position and size | Contents |
| --- | --- | --- |
| Top bar | Full width, 56 px | Wordmark, Batches · Map · Register, search, area switcher, Live or Snapshot, theme, user |
| Scope strip | Top of the map column, 36 px | Area, source classification, revision, "Fictional demonstration", Add files |
| Left panel | 308 px, closed by default | One of Layers, Spaces, Sources, Checks, opened on demand |
| Canvas | Remaining width | The 3D or 2D scene |
| Map toolbar | Floating, top-left | Select, measure, area, section, impact screening, underground; 3D/2D; Model/Volumes; reset |
| Level rail | Floating, right edge | Roof to B2 with "m · SD-1" once at the top; ground line between G and B1 |
| Legend | Floating, bottom-left | Active Colour by legend plus evidence and record keys |
| Readout | Bottom edge | Coordinates, height, frames, scale bar, north |
| Inspector | 360 px right | The one selected thing, with tabs |
| Tray | Bottom, 172 px, collapsible | Import stream or findings list |

**Default look.** Light grey ground, pale roads, soft green public land, pale blue water; parcels as thin grey outlines with their ULPIN at the centroid; grey massing with a thin line at every floor slab and soft south-west shadow; no textures or imagery by default (an orthophoto layer can be switched on); one selected building in forest green with a white halo, everything else at 35 %. Dark theme: the same scene on a deep blue-grey ground, selection in mint green.

**What changes on interaction.**
1. Select a building: the camera eases to an oblique view (600 ms), the inspector opens, the level rail appears.
2. Pick a floor on the rail: upper floors become ghost outlines; Colour by Rights turns units blue (exclusive), green (shared) and orange (public) with labels.
3. Select Flat 704: green selection with halo; the inspector shows code, location, areas, share and evidence.
4. Underground: ground turns 35 % transparent, a depth ruler appears, basements and the water main become selectable. The water main shows a quality B badge and "tolerance not stated"; no sleeve.
5. Impact screening: draw a line in the lane; the vertical column highlights and DigColumn lists what lies below.
6. A finding: the view switches to Volumes; the two flats are outlined; the overlap is a small red hatched slab labelled "6.4 m³ overlap".

**The map must never:** colour every building by default or show two Colour by modes at once; show estimated or illustrative geometry as measured; show a green or clear state where no utility survey exists; convert a utility quality letter into a buffer; lose selection or camera when switching 2D/3D, Model/Volumes or theme.

## Where each feature lives

| Feature | Screens | UI element | What the user sees and does | Release |
| --- | --- | --- | --- | --- |
| Proposed 3D ULPIN | S11, then S5, S12, S14, P4L | UlpinCode, assign dialog | A reviewed space shows **Assign proposed 3D ULPIN**; the dialog shows the code, location line, anchor state and readiness | finale |
| Drafts and lineage | S9, inspector History | UlpinCode states | Drafts have no code ("Code assigned after review"); retired codes list successors | finale (split/merge UI later) |
| Undivided shares | S12 Shares, S10 | ShareLedger | Units with shares; footer flags "Total 99.50 %, expected 100 %"; tenure regime in the header | finale |
| Carpet-area check | S10, S8 | CarpetAreaCheck | Component arithmetic against the deed; over threshold becomes *Needs review* | finale |
| Sanctioned vs observed | S13, S8 | Split compare, FindingCard | Seeded extra rooftop structure highlighted with area and height; "not a legal determination" | finale |
| Building extraction | S4 layer, S13 | "AI candidates" layer | Dashed outlines over the orthophoto; accept or reject each | finale |
| Floor segmentation | S9 | Plan overlay | Rooms and walls outlined on the scanned plan; confirm one at a time | finale |
| Vertical delineation | S9 to S10, S5 | Level register, LevelRail | Reviewed polygons plus levels become unit prisms, floor by floor | finale |
| Topology validation | S8, S10 | FindingCard, checks list | Overlap, partition, stack, anchoring; deterministic order: blocking, severity, size | finale |
| Readiness per task | S1, S11 | ReadinessMeter | Six dimensions for a named task; unknown hatched; no single score | finale |
| Evidence links | Everywhere, S7 | EvidenceChip, evidence viewer | Every value opens its page, row or region beside the 3D space | finale |
| Constrained intake agent | S2, S3 | ImportStream, mapping rows | Only uncertain mappings ask; **Proposed**, **Reused mapping** or **Manual**; provider down shows "Map manually" | finale |
| Progressive map | S3 | Tray stream, live badge | Buildings appear as chunks are saved; the camera never jumps | finale |
| Impact screening | S6 | DigColumn, trench tool | Every band below with depth and quality; **Export screening report**; "not a clearance" | finale |
| Utilities and quality | S6, Utilities mode | Tubes with quality badges | Sleeve only with a stated tolerance; "No survey" hatched | finale |
| Corridors | S6, StrataSection | Corridor volume | Metro corridor fixture labelled, burdening two parcels | finale (fixture) |
| Revision chain | S12 History, P4L | RevisionTimeline | "Chain consistent"; each revision shows its hash and the previous one | finale |
| Property Card | S14, P4L | PropertyCard | Scope and redaction, export PDF; QR opens the local demonstration link | finale |
| Standard exports | S12 Export menu | Menu | CityJSON 2.0 plus sidecar; LADM mapping report; CityGML 3.0 as a stretch conversion; 3D Tiles display only; GeoPackage "Planned" | finale (partial) |
| Offline rehearsal | Scope strip, workspace dialog | Badge | "Replayed from rehearsal 22 Nov" on replayed model answers | finale |
| Air-rights envelope | S17 | Dashed envelope | Remaining permissible floor area, "not a right" | full product |
| NAKSHA-style oblique and LiDAR intake | S2 | Source profile | Appears only when a real sample has been qualified; otherwise "Planned" | full product |
| Gati Shakti layer export | S12 Export menu | Menu item "Planned" | GeoPackage of utility and corridor volumes | full product |
| Schema learner | A4 | Metrics table | Learner vs recipe reuse vs model mapping on held-out layouts | full product |
| Public requests | P5, P6, S1 | UX4G stepper and tracker | Citizen request becomes a Batches item | full product |
| Hindi and accessibility | All | Language switch, accessibility bar | English / हिन्दी, text size, contrast | Portal: full product; Studio: Hindi-ready |

## Key flows

**Hero demo (six minutes, H24).**

```mermaid
flowchart TD
    A[S1 Batches] --> B[S2 Add files: agent mapping]
    B --> C[S3 Live import: map fills in]
    C --> D[S9 Workspace: AI rooms on plan]
    D --> E[S10 Check and record: carpet, shares]
    E --> F[S8 Findings: 6.4 m³ overlap]
    F --> G[S5 Building and floors: Flat 704]
    G --> H[S11 Assign proposed 3D ULPIN]
    H --> I[S13 Deviation: seeded case]
    I --> J[S6 Underground: impact screening]
    J --> K[S14 Property Card]
    K --> L[P4L Verify on the same device]
```

Each arrow is one click or one confirmed decision; the officer never retypes data.

**Engineer screens a trench (Studio, read-only role).** S4: search "Lake View Road service lane" → S6: Underground on, draw a 12 m trench → DigColumn: water main 0.9 to 1.2 m (quality B, tolerance not stated), unknown band 1.2 to 3.0 m, metro corridor fixture from 14.4 m → **Export screening report**, which says it is not a clearance and lists unknown bands.

**Citizen checks a flat (full product).** P1 search "Flat 704 Lake View" → P2 pick the match → P3 released facts and card download → P4 verify by QR ("Valid, revision r3" or "Superseded" with a link) → P5 request a correction → P6 track it.

## Screen specs: Studio map screens

All share the map layout above; only panels, canvas state and inspector change.

**S4 Area map.** Oblique view of the Lake View area, 22 grey buildings, parcels outlined, roads and a small lake; Lake View Residence selected in green. Left panel closed. Inspector: address, Parcel ULPIN, ground plus 8 with stilt and B1–B2, 55 units, readiness "Assign proposed 3D ULPIN: 4 of 6 ready", 2 open findings, **Open register** and **Explore floors**. Legend hidden because no colour mode is on.

**S3 Live import on map.** As S4 while an import runs: about half the buildings present, the rest fading in (200 ms) without moving the camera. Tray: ImportStream with parcels.gpkg saved; unit_inventory.xlsx 1 mapping to review; levels.csv 2 lower limits missing; plan_F7.pdf 62 %. Scope strip: "Importing Lake View bundle · 186 spaces saved", **Pause**, **Cancel**.

**S5 Building and floors.** Lake View Residence close up; level rail with F7 selected and "m · SD-1" at the top; upper floors as ghosts; F7 units coloured by Rights with labels (Flat 701–706, Stair S1, Lift L1, Corridor). Legend: Rights (exclusive 42, shared 9, public 3, unknown 4) plus evidence and record keys. Inspector: Flat 704 with code, location line, level limits, carpet 69.30 vs declared 72.00 with evidence chips, share 1.84 %, parking "covered stilt, allotted by association: Needs evidence"; footer **Review area** and **Open in 3D**. A small StrataSection sits under the facts.

**S6 Underground and impact screening.** Ground at 35 %, depth ruler 0–20 m, B1 and B2 under the building, the water main as a blue tube with a "B · tolerance not stated" badge, the metro corridor deeper and labelled "Test fixture". The drawn trench is a dashed rectangle with a highlighted column. Colour by Utilities with a hatched "No survey" entry. Inspector: DigColumn with **Export screening report** and **Request survey**.

**S7 Evidence viewer.** 960 px overlay over the dimmed map: left, the sanctioned plan PDF page 3 with the Flat 704 region outlined and its dimension text highlighted; right, the 3D space on a small canvas. Header: source, page, revision r2, received date, hash; **Open original**, page arrows. Footer: the facts this region supports and **Link to another space**.

**S8 Findings review.** Tray: 2 blocking, 3 needs review, ordered blocking first, then severity, then size; filter chips Blocking, Needs review, Info, Not assessed. Canvas in Volumes: Flat 101 and Flat 201 outlined, overlap slab in red hatch labelled "6.4 m³ overlap". Inspector: FindingCard with the arithmetic, two source chips, **Request evidence** and **Apply level evidence** (enabled when levels-r2 arrives).

**S13 Deviation check.** Split canvas with synced cameras: left "Sanctioned" (ground plus 8 envelope from the approved plan), right "Observed" (drone-derived massing) with the enclosed rooftop structure in red hatch labelled "118 m² · 239.8 to 242.8 m". A "Seeded test case" badge sits over the right pane. Inspector: storeys sanctioned 9 vs observed 10, height 27.0 vs 30.0 m, setback *Not comparable* (roofprint only), source chips (sanctioned plan, drone survey 12 Sep 2026 with checkpoint RMSE, extraction model and its held-out IoU), **Create finding**. Caption: "Observed from drone survey; not a legal determination."

## Screen specs: workflow and record screens

**S1 Batches.** Header row: "Batches", search, filters (Stage, Area, Assigned to me), primary **Add files**. Eight rows: property, area, stage badge (Add files, Review details, Check and record, Recorded), exact next action ("Review 1 mapping", "Resolve 6.4 m³ overlap", "Assign codes for 12 units"), compact readiness "4 of 6", updated time. Right column (320 px): at most three counts (2 imports running, 5 findings need review, 12 units ready). Empty: "No batches yet. Add files to start."

**S2 Add files.** 960 px dialog, steps Drop files → Check what we found → Confirm. Step 2 table: file, detected profile (GeoPackage, Excel inventory, CSV levels, PDF plan), CRS (or "CRS unverified" with **Choose**), rows or pages, status. One inline question: "carpet_sqft looks like carpet area in ft². Convert to m² with ft²→m²?" with Yes, No, Choose field. Mappings say **Proposed**, **Reused mapping** or **Manual**. When the provider is unavailable a banner reads "Automatic mapping unavailable. Map manually or save for later." Primary **Start import**; secondary **Save and continue later**.

**S9 Workspace: review details.** Stage bar: Add files · **Review details** · Check and record. Centre: scanned F7 plan with AI room and wall candidates in dashed primary, OCR labels and dimensions; the Flat 704 boundary highlighted. Right panel (400 px): "1 of 6 to review", the candidate with confidence and source chip, **Accept**, **Adjust**, **Reject**; below it the level register (level kind, lower, upper, source, state) with B2 *Estimated* and the stilt level marked. Left strip: document thumbnails; Tools (Measure, Calibrate, Compare).

**S10 Workspace: check and record.** Left: the drafted building in Volumes. Right: checks grouped Blocking, Needs review, Not assessed, Passed: exclusive overlap (1), partition completeness (1 unexplained 3.2 m³ void on F8), stack consistency (passed), carpet area (Flat 704, 3.9 %), shares (99.50 %), anchoring (passed). Change summary: 55 units, 11 levels (B2, B1, G as stilt parking, F1 to F8), 4 shared spaces, what changed since r2. **Record reviewed details** is disabled while a blocking finding is open, with the reason beneath.

**S11 Assign proposed 3D ULPIN.** 760 px dialog, "Assign proposed 3D ULPIN for Flat 704". UlpinCode large: the code `P3-7Q4M2R8T6V0W3X5Y9ZAB-R4` (shown after assignment; before it, "A random code is generated on confirm"), and the location line with segment explanations (parcel, structure S01, level F07, residential 003). Anchor state *Reviewed*. ReadinessMeter "Assign proposed 3D ULPIN" 6 of 6. Lineage "New space; no predecessors". Note: "Proposed project code. The state's ULPIN is unchanged." Primary **Assign code**; afterwards a toast "Assigned P3-7Q4M…-R4" with **Make Property Card**.

**S12 Property register.** Identity header once: Lake View Residence, address, Parcel ULPIN, status badges, **Back to map**, **Export** (CityJSON 2.0 plus sidecar, LADM mapping report; CityGML 3.0 and GeoPackage marked Planned), **Property Card**. Body: left 55 % model with level rail; right 45 % floors and units table (level, unit, code, carpet m², share %, rights, status). Tabs: Shares (99.50 % flag), Documents, Checks, History ("Chain consistent").

**S14 Property Card.** Left: A4 preview for Flat 704. Right: scope (this unit, this floor, whole building), audience (public, owner, officer), redaction toggles (party names off for public), QR target "Local demonstration link", **Export PDF**. Card footer: "Technical record, not a title document", revision r3, hash, "Chain consistent".

**P4L Verify card (local demonstration link).** Opens on the same device. One-line result: success "Valid: revision r3" (variants: warning "Superseded by r4" with a link; danger "Retired: merged into …"). Summary: code, location, level, carpet area, assignment date, revision hash; RevisionTimeline collapsed to the last three entries with "Chain consistent". Footer label: "Local demonstration link. Public verification is planned."

## States every screen needs

Mock up the default state of each finale screen, then these variants for S4, S5, S12 and P4L at least.

| State | When | Treatment | Example copy |
| --- | --- | --- | --- |
| Empty | No data yet | One line on what is missing and one action | "No floors recorded for this building. Add a plan or level schedule." |
| Loading | Fetching records or tiles | Skeleton in the final layout; ground and parcel outlines first | none |
| Progressive | Import running | Saved objects appear; tray shows progress per file | "186 spaces saved · plan_F7.pdf 62 %" |
| Unknown | No evidence | *Unknown* with hatch and a request action | "Parking: Unknown · Request evidence" |
| Estimated | Derived, not measured | Hatch, dashed chip, "est." | "B2 205.8 m est." |
| Not assessed | A check could not run | Grey hatch with the reason; never "no conflict" | "Overlap not assessed: open shell on Flat 305" |
| Not comparable | Different definitions or datums | Neutral badge with the reason | "Carpet area not comparable: deed uses built-up area" |
| Stale | Newer evidence exists | Warning banner with the action | "levels-r2.csv is newer than this model. Rebuild to apply." |
| Blocked | Action not allowed yet | Disabled button with the reason beneath | "Blocked: 1 finding needs review" |
| Error | Import or check failed | Inline danger message with the fix; originals kept | "parcels.shp has no CRS. Choose the coordinate system to continue." |
| CRS unverified | Coordinates look plausible but the zone or datum is not proven | Warning with **Choose** and a control-point check | "CRS not verified. UTM zone and datum must be confirmed." |
| Snapshot | Working from saved data | Header badge instead of Live | "Snapshot 24 Sep, 14:10" |
| Replayed | Offline rehearsal profile | Neutral badge on replayed answers | "Replayed from rehearsal 22 Nov" |
| Restricted | Role cannot see a field | "Restricted" with the role needed | "Owner names: Restricted (officer role)" |
| Test fixture / seeded | Authored case | Neutral badge on the object and in the legend | "Metro corridor · Test fixture" |
| No 3D | WebGL unavailable or a phone | 2D plan plus the spaces list, same selection | "3D view unavailable on this device. Showing the plan." |

## Prompts for mockups

Paste one batch at a time with the design system attached and this brief shared; review each batch before the next. Batch 1 sets the look.

**Batch 1: the map (S4, S5, S5 dark)**

```text
Using the 3D ULPIN Design System and the 3D ULPIN UI and UX brief, design three 1440x900 Officer Studio artboards: S4 Area map, S5 Building and floors, and S5 in the dark theme. Follow "How the map should look": 56px top bar with Batches · Map · Register, 36px scope strip, left panel closed, canvas, floating toolbar top-left, level rail on the right edge with "m · SD-1" at the top, legend bottom-left, 360px inspector. Calm grey massing; only the selection is forest green; on S5 the F7 units are coloured by Rights (blue exclusive, green shared, orange public) with labels. Use the specimen data exactly: Flat 704, 3D ULPIN (proposed) P3-7Q4M2R8T6V0W3X5Y9ZAB-R4, Location MH2507A1B3C4D5 / S01 / F07 / R003, F7 233.8 to 236.8 m · SD-1, carpet 69.30 vs 72.00 m2. "Fictional demonstration" in the scope strip. No seals, stock images, gradients or emoji.
```

**Batch 2: live import, underground, findings (S3, S6, S8)**

```text
Same style. S3 Live import on map (half the area present, ImportStream in the tray). S6 Underground and impact screening (ground at 35%, depth ruler, water main tube with a "B · tolerance not stated" badge and no sleeve, metro corridor labelled Test fixture, DigColumn in the inspector with Export screening report and the line "Screening only. Not a clearance or dig permission."). S8 Findings review (Volumes, Flat 101 / Flat 201 overlap as a red hatched slab labelled 6.4 m3 overlap, FindingCard with arithmetic, findings ordered blocking then severity then size).
```

**Batch 3: workflow (S1, S2, S9, S10, S11)**

```text
S1 Batches (8 rows with stage badge, exact next action, compact readiness; at most three counts on the right). S2 Add files at "Check what we found" (inline ft2 question; mappings marked Proposed, Reused mapping or Manual; one file with "CRS unverified"). S9 Workspace review details (scanned F7 plan with AI room candidates, one decision at a time, level register with stilt and B2 estimated). S10 Check and record (groups Blocking / Needs review / Not assessed / Passed; Record disabled with reason). S11 Assign proposed 3D ULPIN dialog (code, location line with segment notes, anchor state, readiness 6 of 6, "The state's ULPIN is unchanged").
```

**Batch 4: records and evidence (S7, S12, S13, S14, P4L)**

```text
S7 Evidence viewer (plan page with the Flat 704 region beside the 3D space). S12 Property register (identity header once, model with level rail, units table, tabs with the 99.50% share flag and "Chain consistent", Export menu with CityJSON 2.0 plus sidecar and LADM report; CityGML 3.0 and GeoPackage marked Planned). S13 Deviation check (sanctioned vs observed, "Seeded test case" badge, 118 m2 at 239.8 to 242.8 m, setback Not comparable). S14 Property Card (A4 card, local QR, scope and redaction). P4L Verify card on the same device labelled "Local demonstration link".
```

**Batch 5 (full product): Portal and Admin**

```text
Public Portal with UX4G patterns themed by the design system: P1 Home and search, P3 Public property record, P4 Verify Property Card, each at 1440x900 and 390x844, with the accessibility bar, English / हिन्दी switch and an empty department-mark slot. Admin A1 overview at 1440x900: four stat tiles that link to lists, one line chart and one bar chart with one axis each, coverage and AI quality tables with sample sizes. Released data only; no owner names.
```

## Sources

- Finale handoffs: [H99](../usp-agent-handoffs/99-ui-ux-and-integration.md), [H26](../usp-agent-handoffs/26-identifiers-and-standard-exchange.md), [H17](../usp-agent-handoffs/17-infrastructure-impact-screening.md), [H10](../usp-agent-handoffs/10-scoped-evidence-packets.md), [H27](../usp-agent-handoffs/27-domain-ai-and-cadastral-checks.md), [H97](../usp-agent-handoffs/97-review-findings-and-alignment.md).
- Retired v2 design pack, kept in [Git history](https://github.com/Vinayak1337/3d-ulpin/blob/7472730980fd3d79e7364b5cac3e6c7ebff7dd3d/docs/v2-design/README.md) (forest green, rail and tray sizes).
- [UX4G web design system](https://github.com/ux4g-negd/web_design_system) (MIT) and [Phosphor Icons](https://github.com/phosphor-icons/core) (MIT).
