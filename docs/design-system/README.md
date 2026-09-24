# 3D ULPIN design system

The visual and content rules for every 3D ULPIN screen. It is the repository copy of the team's design system (published privately on claude.ai, version 4), reconciled on 24 September 2026 with the finale handoffs. Agents cannot open private claude.ai pages, so this folder is what they build from.

**Authority.** [H99](../usp-agent-handoffs/99-ui-ux-and-integration.md) owns routes, selection, caches, feature slots and the V1–V8 acceptance shots. This folder owns tokens, components, map styling and copy. Where they disagree, H99's "Z" addendum settles it. The retired `docs/v2-design/` pack (removed by CLEANUP-01, in Git history) is historical input; its forest green and layout sizes live on here.

| File | Use it for |
| --- | --- |
| [tokens.css](tokens.css) | Every colour, size and layer value, in the app's existing `--ui-*` names, light and dark |
| [tokens.json](tokens.json) | The same values with usage notes, for tools and generators |
| [fonts.css](fonts.css) | Self-hosted Noto Sans, Noto Sans Devanagari and Noto Sans Mono |
| [map-and-3d.md](map-and-3d.md) | How the scene looks: base scene, Colour by, honest geometry, floors, underground |
| [surfaces-and-layout.md](surfaces-and-layout.md) | Studio frame, panels, breakpoints; Portal and Admin for full_product |
| [ux4g-alignment.md](ux4g-alignment.md) | How UX4G 3.1 and GIGW 3.0 apply, and what not to install |
| [components.md](components.md) | The 23 components: anatomy, states, content and who supplies the data |
| [reference/components.css](reference/components.css) | Reference CSS for those components (read, then port) |
| [ui-brief.md](ui-brief.md) | Screens, specimen data, flows and states, and mockup prompts |

## Principles

- **Evidence first.** Every fact on screen can open its source: page, table row, drawing region or survey point.
- **The map is the canvas.** In the Studio the scene owns the centre; panels open beside or over it on demand.
- **One inspector.** A selection opens exactly one inspector. Never repeat the same finding, count or photo in two places on one screen.
- **Honest geometry.** Measured, documented, estimated and illustrative geometry always look different. A photoreal mesh never implies a surveyed boundary.
- **Unknown is not zero.** Missing heights, levels, depths and shares show as *Unknown* with the hatch, never blank, 0 or a low score.
- **Nothing official by accident.** Project codes are "proposed"; screening is not clearance; a chain is "consistent", not "verified", unless a signed head verifies.
- **Calm and municipal.** Neutral surfaces, one forest-green accent, colour only where it carries meaning.

## Content rules

- Plain words, active voice, specific numbers: "U03 begins at 2.8 m; the plan says 3.0 m." Not "An inconsistency was detected."
- Sentence case everywhere. No all-caps labels, exclamation marks or emoji.
- A button says exactly what happens: **Record reviewed details**, **Assign proposed 3D ULPIN**, **Request evidence**, **Export screening report**. One label per intent across the product.
- **Units always shown:** `m`, `m²`, `m³`. Heights always name their vertical reference: "233.8 m · site datum SD-1". Write "m above mean sea level" only when the source states that datum; never relabel a GNSS or local height.
- Areas and volumes to 2 decimals in tables, 1 in labels. Indian digit grouping for rupees and large counts: ₹12,40,000; 1,23,456 parcels. Area in m² first; sq ft in brackets only when the source used it.
- Dates as 24 Sep 2026; times 24-hour in IST, 14:10. Relative time only in activity feeds, with the exact time on hover.
- **Identifiers** are mono, never broken across lines, always copyable:
  - the proposed project code `P3-7Q4M2R8T6V0W3X5Y9ZAB-R4`, labelled **3D ULPIN (proposed)**;
  - the separate **Location** line `MH2507A1B3C4D5 / S01 / F07 / R003`, display only (H26 Z1);
  - the state's parcel code, labelled **Parcel ULPIN**, with its anchor state.
- Fixed status words: *Draft*, *Needs evidence*, *Needs review*, *Reviewed*, *Recorded*, *Assigned*, *Retired*, *Cancelled*, *Unknown*, *Not assessed*, *Not comparable*, *Test fixture*. No synonyms.
- Errors say what happened and what to do: "parcels.shp has no CRS. Choose the coordinate system to continue." No "Oops", no apologies.
- Portal copy ships in English and Hindi; Studio labels are English with Hindi-ready layouts (text expansion up to 30 %).

## Visual foundations

**Colour.** Build on `--ui-background`, `--ui-surface` and `--ui-surface-subtle`; text is `--ui-ink`, `--ui-ink-soft` or `--ui-muted` (4.5:1 on all three grounds in both themes). `--ui-primary` is the only accent: primary actions, active navigation, selection, links. Text on a primary fill uses `--ui-on-primary`. Status text uses success, warning, danger and info on surface or their soft fills, always with an icon and a word. Red means a blocking finding and nothing else; amber means needs review or evidence. Map colours (`--ui-map-*`, `--ui-rights-*`, `--ui-mark-*`, `--ui-seq-*`, `--ui-utility-*`) are for geometry and charts only, never UI text.

**Type.** Noto Sans for everything; Noto Sans Mono for codes, coordinates and measurements; Noto Sans Display only for the Portal home heading. Studio body 15 px (`--ui-text-md`), metadata at least 12 px; Portal body 16 px. Tabular figures for columns of numbers. One title per screen. Devanagari uses line-height 1.8 and is never shrunk to fit.

**Spacing.** 4 px grid: `--ui-space-1` to `--ui-space-8` inside screens; 40–64 px only between Portal page sections. Studio panels sit 16 px apart and are padded 16 px. Controls are 40 px in the Studio, 44 px in the Portal; every hit area is at least 44 px.

**Shape lock.** 8 px controls, 12 px panels, cards and floating map controls, 16 px dialogs, sheets and the Property Card, pill for status badges, chips and segmented controls, 4 px for tags and map labels. Nothing else.

**Borders and elevation.** Panels: surface, 1 px `--ui-border-strong`, `--ui-shadow-card`. Floating map controls: `--ui-shadow-floating`. Dialogs: `--ui-shadow-overlay`. Inputs and checkboxes use `--ui-line-control` (3:1). Never stack a border, a shadow and a tinted fill on one element.

**Focus.** 2 px `--ui-focus` outline, 3 px offset; `--ui-focus-ring` on map controls where an outline clips. Never removed.

**Motion.** UI transitions 120–200 ms, ease-out, opacity and transform only. Camera moves 600 ms and always interruptible. Import progress is the only live motion. Under reduced motion, camera moves cut and panels fade.

**Density.** Studio is compact (36 px table rows, 13 px cells). Portal is comfortable (44 px controls, 16 px text, one column on phones).

## Icons and wordmark

Phosphor Regular only (MIT, already an app dependency), through one `Icon` wrapper: 20 px in the Studio, 24 px in the Portal, 16 px in dense cells. Screens rebuilt for the finale move off `lucide-react`; never mix both sets on one screen. Icons inherit `currentColor`. Icon-only buttons carry a tooltip and `aria-label`.

No logo: the wordmark is **3D ULPIN** in Noto Sans 700 followed by the surface name. Never draw a government emblem, seal or signature; the Portal header has an empty slot for a department's own mark.

## Accessibility

GIGW 3.0 and WCAG 2.1 AA on every surface. Every map view has a list or table equivalent (spaces list, findings list, levels table). Keyboard: Tab through panels, toolbar and inspector; arrow keys move the level rail; `Esc` clears the selection; `/` opens search. Test 200 % zoom, reduced motion, contrast in both themes, and screen-reader announcements coalesced rather than one per stream event.
