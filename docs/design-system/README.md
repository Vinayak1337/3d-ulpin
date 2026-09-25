# 3D ULPIN design system

**Frontend replacement:** Rebuild affected legacy screens from this design language as their existing plan cards are implemented, then remove the superseded UI. This is progressive work within the plan, not a separate redesign phase. Preserve shared runtime/data contracts and saved-link compatibility; mockup data/code must not be copied. See the [delivery policy](../usp-agent-handoffs/current-delivery-policy.md).

**Current delivery:** [User scope policy](../usp-agent-handoffs/current-delivery-policy.md) governs: official-source data only; desktop-first/light-only; no theme switch or reserved space. Mobile and alternate-theme examples below are future guidance, not current acceptance requirements. Retain reusable tokens and layout seams.

The visual and content rules for every 3D ULPIN screen: the design language agents build in. It is the repository copy of the team's design system (the private claude.ai Design System artifact and its Claude Design project), kept in sync with it and reconciled with the finale handoffs. Agents cannot open private claude.ai pages, so this folder is what they build from; [Sync with the team design system](#sync-with-the-team-design-system) records what was compared and what differs on purpose.

**Authority.** [H99](../usp-agent-handoffs/99-ui-ux-and-integration.md) owns routes, selection, caches, feature slots and the V1–V8 acceptance shots. This folder owns tokens, components, map styling and copy. Where they disagree, H99's "Z" addendum settles it. The retired `docs/v2-design/` pack (removed by CLEANUP-01, in Git history) is historical input; its forest green and layout sizes live on here.

| File | Use it for |
| --- | --- |
| [tokens.css](tokens.css) | Every colour, size and layer value, in the app's existing `--ui-*` names, light and dark |
| [tokens.json](tokens.json) | The same values with usage notes, for tools and generators |
| [fonts.css](fonts.css) | Self-hosted Noto Sans, Noto Sans Devanagari and Noto Sans Mono |
| [map-and-3d.md](map-and-3d.md) | How the scene looks: base scene, Colour by, honest geometry, floors, underground |
| [surfaces-and-layout.md](surfaces-and-layout.md) | Studio frame, panels, breakpoints; Portal and Admin for full_product |
| [ux4g-alignment.md](ux4g-alignment.md) | How UX4G 3.1 and GIGW 3.0 apply, and what not to install |
| [components.md](components.md) | The 32 components: anatomy, classes, states, content and who supplies the data |
| [reference/components.css](reference/components.css) | Reference CSS for those components and the type styles (read, then port) |
| [ui-brief.md](ui-brief.md) | Screens, where each feature lives, flows and states |
| [mockups/officer-studio/](mockups/officer-studio/README.md) | **Reference only, not production UI.** A description of the team's interactive mockup: frame, interactions, per-screen layout and the [view model schema](mockups/officer-studio/view-model.schema.json). Take ideas for look and behaviour from it; production requirements come from the plan. Never copy its data or code |

## Principles

- **Evidence first.** Every fact on screen can open its source: page, table row, drawing region or survey point.
- **The map is the canvas.** In the Studio the scene owns the centre; panels open beside or over it on demand.
- **One inspector.** A selection opens exactly one inspector. Never repeat the same finding, count or photo in two places on one screen.
- **Honest geometry.** Measured, documented, estimated and illustrative geometry always look different. A photoreal mesh never implies a surveyed boundary.
- **Unknown is not zero.** Missing heights, levels, depths and shares show as *Unknown* with the hatch, never blank, 0 or a low score.
- **Nothing official by accident.** Project codes are "proposed"; screening is not clearance; a chain is "consistent", not "verified", unless a signed head verifies.
- **Don't over-page.** Import and export are dialogs; parcel, utility, photos and history are inspector tabs; findings live in the tray; workspace tools are modes of one canvas.
- **Calm and municipal.** Neutral surfaces, one forest-green accent, colour only where it carries meaning.

## Content rules

- Plain words, active voice, specific numbers: "U03 begins at 2.8 m; the plan says 3.0 m." Not "An inconsistency was detected."
- Sentence case everywhere. No all-caps labels, exclamation marks or emoji.
- A button says exactly what happens: **Record reviewed details**, **Assign proposed 3D ULPIN**, **Request evidence**, **Export screening report**. One label per intent across the product.
- **Units always shown:** `m`, `m²`, `m³`. Heights always name their vertical reference: "<elevation> m · <named reference>". Write "m above mean sea level" only when the source states that datum; never relabel a GNSS or local height.
- Areas and volumes to 2 decimals in tables, 1 in labels. Indian digit grouping for rupees and large counts: ₹12,40,000; 1,23,456 parcels. Area in m² first; sq ft in brackets only when the source used it.
- Dates as 24 Sep 2026; times 24-hour in IST, 14:10. Relative time ("2 min ago") only in activity feeds, with the exact time on hover.
- **Identifiers** are mono, never broken across lines, always copyable:
  - the proposed project code (format in [H26](../usp-agent-handoffs/26-identifiers-and-standard-exchange.md)), labelled **3D ULPIN (proposed)**;
  - the separate **Location** line (parcel / structure / level / space segments), display only (H26 Z1);
  - the state's parcel code, labelled **Parcel ULPIN**, with its anchor state.
- Fixed status words: *Draft*, *Needs evidence*, *Needs review*, *Reviewed*, *Recorded*, *Assigned*, *Retired*, *Cancelled*, *Unknown*, *Not assessed*, *Not comparable*, *Test fixture* (an authored deviation shows *Seeded test case*). No synonyms. Never label data "fictional", "demo" or "demonstration data"; provenance comes from the record ([AGENTS.md](../../AGENTS.md)).
- Errors say what happened and what to do: "parcels.shp has no CRS. Choose the coordinate system to continue." No "Oops", no apologies.
- Portal copy ships in English and Hindi; Studio labels are English with Hindi-ready layouts (text expansion up to 30 %).

## Visual foundations

**Colour.** Build on `--ui-background`, `--ui-surface` and `--ui-surface-subtle`; text is `--ui-ink`, `--ui-ink-soft` or `--ui-muted` (4.5:1 on all three grounds in the delivered light theme). `--ui-primary` is the only accent: primary actions, active navigation, selection, links. Text on a primary fill uses `--ui-on-primary`, never literal white. Hairlines between rows are `--ui-divider`. Status text uses success, warning, danger and info on surface or their soft fills, always with an icon and a word. Red means a blocking finding and nothing else; amber means needs review or evidence. Map colours (`--ui-map-*`, `--ui-rights-*`, `--ui-mark-*`, `--ui-seq-*`, `--ui-utility-*`) are for geometry and charts only, never UI text.

**Type.** Noto Sans for everything; Noto Sans Mono for codes, coordinates and measurements; Noto Sans Display only for the Portal home heading. Studio body 15 px (`--ui-text-md`), metadata at least 12 px; Portal body 16 px, never smaller for running text. Tabular figures for columns of numbers. One `studio-title` per screen. Devanagari uses line-height 1.8 and is never shrunk to fit.

| Style | Size / line height, weight | Token | Use |
| --- | --- | --- | --- |
| `studio-title` | 22/30, 650, −0.01em | `--ui-text-xl` | The one screen title |
| `studio-heading` | 17/24, 600 | `--ui-text-lg` | Panel and dialog titles |
| `studio-body` | 15/22, 400 | `--ui-text-md` | Studio running text |
| `studio-body-sm` | 13/19, 400 | `--ui-text-sm` | Table cells, secondary text |
| `studio-label` | 12/16, 500, +0.01em | `--ui-text-xs` | Labels, captions, legend |
| `portal-display` | 40/52, 600, Display | `--ui-portal-display` | Portal home heading only |
| `portal-h1` / `h2` / `h3` | 32/36, 24/28, 20/24, 600 | `--ui-portal-h1…h3` | Portal headings |
| `portal-body` / `body-sm` | 16/24, 14/20, 400 | `--ui-portal-body`, `-body-sm` | Portal text |
| `portal-label` | 14/18, 500 | | Portal form labels |
| `body-devanagari` | 16, line height 1.8 | `--ui-devanagari-line-height` | Hindi text |
| `id-code` | 13/18 mono, 500, +0.02em | `--ui-text-sm` | Codes and hashes |
| `data-num` | 13/18 mono, 400 | `--ui-text-sm` | Coordinates, measurements |

**Spacing.** 4 px grid: `--ui-space-1` to `--ui-space-8` inside screens; `--ui-space-10` to `--ui-space-16` (40–64 px) only between Portal page sections. Studio panels sit 16 px apart and are padded 16 px. Controls are 40 px in the Studio, 44 px in the Portal; every hit area is at least 44 px.

**Shape lock.** 8 px controls, 12 px panels, cards and floating map controls, 16 px dialogs, sheets and the Property Card, pill for status badges, chips and segmented controls, 4 px for tags and map labels. Nothing else.

**Borders and elevation.** Panels: surface, 1 px `--ui-border-strong`, `--ui-shadow-card`. Floating map controls: `--ui-shadow-floating`. Dialogs: `--ui-shadow-overlay`. Inputs and checkboxes use `--ui-line-control` (3:1). Never stack a border, a shadow and a tinted fill on one element.

**Focus.** 2 px `--ui-focus` outline, 3 px offset; `--ui-focus-ring` on map controls where an outline clips. Never removed.

**Motion.** UI transitions 120–200 ms, ease-out, opacity and transform only. Camera moves 600 ms and always interruptible. Import progress is the only live motion. Under reduced motion, camera moves cut and panels fade.

**States.** Loading uses skeletons shaped like the final layout (a map loads with the ground and parcel outlines first). Empty states say what is missing and give one action. Stale data shows a warning banner naming the newer source and the action. Snapshot data shows the snapshot date and time in the header instead of Live. The full list is in the [UI brief](ui-brief.md#states-every-screen-needs).

**Density.** Studio and Admin are compact (36 px table rows, 13 px cells). Portal is comfortable (44 px controls, 16 px text, one column on phones).

## Building in the design language

- **Tokens.** Use `--ui-*` custom properties only; never a literal colour, radius, font or shadow. The design system writes the same tokens without the prefix (`--primary` is `--ui-primary`; `bg` is `--ui-background`, `ink-muted` is `--ui-muted`, `rail-right` is `--ui-right-rail-width`, `tray-height` is `--ui-bottom-tray-height`, `sky-band` and `soil-*` are `--ui-map-sky-band` and `--ui-map-soil-*`). [tokens.json](tokens.json) lists every mapping.
- **Class vocabulary.** The reference CSS uses a small `ul-` vocabulary: layout helpers `ul-row` (wrapping flex row, 8 px gap), `ul-stack` (grid, 12 px gap), `ul-pad`, `ul-grow`, `ul-muted`, `ul-mono`, `ul-num`, `ul-caption`, `ul-help`; `ul-float` for floating map chrome; `ul-calc` for arithmetic; component blocks such as `ul-panel`, `ul-table`, `ul-dl`, `ul-tabs`, `ul-btn`, `ul-badge`, `ul-evid` (EvidenceChip). Flat map scenes use the `m-*` classes (see MapCanvas in [components.md](components.md)). Port the anatomy into the owning feature's CSS with `--ui-*` tokens; do not add a component library.
- **Composition.** A Studio screen is panels floating on the background 16 px apart around one canvas, one inspector and at most one tray; one primary button per view; status words only from the fixed list; every sourced value with an EvidenceChip. The [reference mockups](mockups/officer-studio/README.md) show these pieces assembled (reference only, not production UI).

## Icons and wordmark

Phosphor Regular only (MIT, already an app dependency), through one `Icon` wrapper: 20 px in the Studio, 24 px in the Portal, 16 px in dense cells. Screens rebuilt for the finale move off `lucide-react`; never mix both sets on one screen. When a UX4G Portal component ships Material Icons, swap in the Phosphor equivalent. Icons inherit `currentColor`; status icons take their status colour. An icon is never the only label: icon-only buttons carry a tooltip and `aria-label`.

The design system's set of 30 icons, and what each means:

| Icon | Use |
| --- | --- |
| magnifying-glass | Search |
| stack | Layers, underground, area switcher |
| cube / map-trifold | 3D and 2D view |
| building / buildings | Building, block |
| crosshair | Select tool, calibrate |
| ruler | Measure, estimated values |
| selection-background | Measure area, copy code |
| scissors | Section cut |
| shovel | Impact screening trench |
| intersect | Overlap finding, compare |
| eye / eye-slash | Show, hide, restricted |
| warning-octagon | Blocking |
| warning | Needs review, needs evidence |
| check-circle | Recorded, passed |
| info | Information |
| shield-check | Assign proposed code, chain consistent |
| clock-counter-clockwise | Provisional, history, replayed |
| git-commit | Revision |
| file-text / file-arrow-up | Document evidence, add files |
| list-checks | Table row evidence, checks |
| tray | Batches |
| qr-code | Property Card QR |
| download-simple | Export |
| arrow-counter-clockwise | Reset camera |
| translate | Language switch |
| caret-down | Menus |

No logo: the wordmark is **3D ULPIN** in Noto Sans 700 followed by the surface name. Never draw a government emblem, seal or signature; the Portal header has an empty slot for a department's own mark.

## Accessibility

GIGW 3.0 and WCAG 2.1 AA on every surface. Every map view has a list or table equivalent (spaces list, findings list, levels table). Keyboard: Tab through panels, toolbar and inspector; arrow keys move the level rail; `Esc` clears the selection; `/` opens search. The Portal carries the UX4G accessibility bar (text size, contrast, language) on every page. Test 200 % zoom, reduced motion, contrast in the delivered light theme, and screen-reader announcements coalesced rather than one per stream event.

## Sync with the team design system

The team's design system is the private claude.ai Design System artifact, mirrored into a Claude Design project for mockups. This folder carries the same design language in the app's names.

**Last compared: 25 September 2026**, against artifact version `1790272512-603e`, the version the Claude Design project was built from.

| Part | State |
| --- | --- |
| Colour, map, rights, mark, ramp, utility, layout, z-index and opacity tokens, light and dark | Same values |
| Spacing, radius, shadow and control sizes | Same values; most already exist in `apps/web/features/officer/shared/tokens.css` |
| Type scale | Same sizes, line heights and weights |
| Component CSS (`ul-*`, `m-*`) | Same rules; the remote font import is removed |
| Components | Same 32, including the nine added in Claude Design |
| Voice, content, map, layout and UX4G rules | Same rules, plus the plan decisions below |

**What differs on purpose:**
- Token names carry the `--ui-` prefix.
- Fonts are self-hosted; there are no Google Fonts requests.
- The plan's decisions are written in: Batches · Map · Register, the on-demand left panel, screening reports, "Chain consistent", the local demonstration link, and full-product scope for the Portal and Admin.
- There is no sample data. The team copy uses one worked example; this folder uses placeholders and binds screens to records.

**To re-sync:** compare against the team copy's tokens, component CSS, brand book and guidelines. Carry over any change in values or rules. Keep the differences listed above, and update the date and version here.
