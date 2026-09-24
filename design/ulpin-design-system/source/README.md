3D ULPIN is a land-records product that gives every flat, basement, shared stair, air-rights volume and utility corridor a 3D identity backed by evidence. This system dresses three surfaces with one set of tokens: the **Public Portal** (citizens), the **Officer Studio** (land-record and GIS reviewers) and the **Admin Console** (supervisors). It sits on the UX4G 3.1 government design system foundations: the Portal uses UX4G components themed with these tokens, and the Studio adds the map, 3D and record components UX4G does not have.

## Principles

- **Evidence first.** Every fact on screen can open its source: the page, table row, drawing region or survey point. Pair a value with an `EvidenceChip` wherever it came from a document.
- **The map is the canvas.** In the Studio, the 3D or 2D map owns the centre of the screen. Rails, toolbar and inspector float beside it; they never push it below the fold.
- **One inspector.** A selection opens exactly one right-hand inspector. Never repeat the same finding, count or photo in two places on one screen.
- **Honest geometry.** Measured, documented, estimated and illustrative geometry always look different (see *Map and 3D*). A photoreal building never implies a surveyed boundary.
- **Unknown is not zero.** Show missing heights, levels, depths and shares as *Unknown* with the hatch pattern, never as blank, 0 or a low score.
- **Don't over-page.** Import and export are dialogs; parcel, utility, photos and history are inspector tabs; findings live in the bottom tray; workspace tools are modes of one canvas.
- **Calm and municipal.** Neutral surfaces, one forest-green accent, colour only where it carries meaning.

## Content fundamentals

- Write for an officer at work or a citizen checking a record: plain words, active voice, specific numbers. "U03 begins at 2.8 m; the plan says 3.0 m." not "An inconsistency was detected."
- Sentence case everywhere: buttons, tabs, headings, labels. No all-caps labels, no exclamation marks, no emoji.
- A button says exactly what happens: **Record reviewed details**, **Apply this level evidence**, **Assign proposed 3D ULPIN**, **Request evidence**. One label per intent across the product.
- Units always shown: `m`, `m²`, `m³`. Heights always name their vertical reference ("233.8 m · site datum SD-1"); say mean sea level only when the source states that datum, and never relabel a GNSS or local height. Areas and volumes to 2 decimals in tables, 1 in labels. Indian digit grouping for rupees and large counts: ₹12,40,000; 1,23,456 parcels.
- Dates as 24 Sep 2026; times 24-hour, 14:10. Relative time ("2 min ago") only in activity feeds, with the exact time on hover.
- Identifiers in `id-code` (mono), never broken across lines, always with a copy action. The project code `P3-7Q4M2R8T6V0W3X5Y9ZAB-R4` is labelled **3D ULPIN (proposed)**; a separate display-only **Location** line (`MH2507A1B3C4D5 / S01 / F07 / R003`) says where the space is; the state's code is **Parcel ULPIN**. Never label a system ID official or issued.
- Status words are fixed: *Draft*, *Needs evidence*, *Needs review*, *Reviewed*, *Recorded*, *Assigned*, *Retired*, *Cancelled*, *Unknown*, *Not assessed*, *Not comparable*, *Test fixture*. Don't invent synonyms.
- Errors say what happened and what to do: "The CRS is missing from parcels.shp. Choose the coordinate system to continue." No "Oops", no apologies.
- Portal copy ships in English and Hindi. Set Devanagari with `body-devanagari`; never shrink it to fit.

## Visual foundations

**Colour.** Build on `bg`, `surface` and `surface-subtle`; text is `ink`, `ink-soft` or `ink-muted` (every text token passes 4.5:1 on those three grounds in both themes). `primary` is the only accent: primary actions, active navigation, selection, links. Text on a primary fill is `on-primary`, never literal white. Status text uses `success`, `warning`, `danger`, `info` on `surface` or their `-soft` fills; each status always carries an icon and a word. Red means a blocking finding and nothing else; amber means needs review or evidence. Map colours (`map-*`, `rights-*`, `mark-*`, `seq-*`, `utility-*`) are for geometry and charts only, never for UI text.

**Type.** Noto Sans for everything, Noto Sans Display only for the Portal home heading, Noto Sans Mono for codes and coordinates. Studio screens use the *Studio* styles (`studio-body` 15px); the Portal uses the UX4G *Portal* scale (`portal-body` 16px, never smaller for running text). Use tabular figures for any column of numbers. One `studio-title` per screen.

**Spacing and layout.** 4px grid (`space-1` to `space-8` inside screens; `space-10` to `space-16` only between Portal page sections). Studio panels sit 16px apart (`space-4`) on `bg`, padded 16px. Controls are `control-height` (40px) in the Studio and `touch-height` (44px) in the Portal; every hit area is at least 44px.

**Shape.** Shape lock: `radius-8` for controls, `radius-12` for panels, cards and floating map controls, `radius-16` for dialogs, sheets and the Property Card, `radius-pill` for status badges, filter chips and segmented controls, `radius-4` for tags and map labels. Nothing else.

**Borders and elevation.** Panels are `surface` with a 1px `border-strong` outline and `shadow-card`. Floating map controls use `shadow-floating`; dialogs use `shadow-overlay`. Hairlines between rows are `divider`; input and checkbox borders are `line-control` so controls stay visible (3:1). Don't stack a border, a shadow and a tinted fill on the same element.

**Focus.** Every focusable element shows a solid 2px `focus` outline with a 3px offset; on map controls where an outline clips, use the `focus-ring` shadow. Never remove focus styles.

**Motion.** UI transitions are 120 to 200 ms, ease-out, opacity and transform only. Camera moves on the map are 600 ms and can always be interrupted. No looping or decorative animation; import progress is the only live motion. Under `prefers-reduced-motion`, camera moves cut and panels fade.

**States.** Loading uses skeletons shaped like the final layout (a map loads with a grey ground plane and the parcel outline first). Empty states say what is missing and give one action. Stale data shows a `warning` banner with **Refresh**. Offline or snapshot data shows the snapshot date in the header.

**Density.** Studio and Admin are compact (dense tables with 36px rows, 13px cells). The Portal is comfortable (44px controls, 16px text, one column on phones).

## Iconography

Use **Phosphor Regular** only, at 20px in the Studio and 24px in the Portal, 16px inside dense table cells. The icons in `assets/Icons` are copied from Phosphor (MIT). When a UX4G component ships Material Icons, swap in the Phosphor equivalent so one family runs through the product. Icons inherit `currentColor`; status icons take their status colour. An icon is never the only label for an action: icon-only buttons in the map toolbar carry a tooltip and an `aria-label`.

There is no logo. Set the product name as a wordmark in Noto Sans 700: **3D ULPIN**, followed by the surface name in `studio-label` (Studio, Portal, Admin). Don't draw an emblem or seal; the Portal header has a labelled slot for the department's own mark.

## Accessibility

Target GIGW 3.0 and WCAG 2.1 AA on every surface. Every map view has a list or table equivalent (spaces list, findings list, levels table) so nothing needs a mouse on a 3D canvas. Keyboard: Tab through rails, the toolbar and the inspector; arrow keys move the level rail; `Esc` clears the selection; `/` opens search. The Portal carries the UX4G accessibility bar (text size, contrast, language) on every page.

## Reconciled with the finale handoffs (24 Sep 2026)

The repository copy lives in `docs/design-system/` with the app's `--ui-*` token names. There: the Studio nav is **Batches · Map · Register**; the left rail opens on demand and is closed by default; fonts are self-hosted (this preview loads them from Google Fonts only for display); the UX4G bundle is not installed in the Studio; impact screening exports a **screening report**, never a notice; revision chains read **Chain consistent**; the finale QR opens a **local demonstration link**; the Portal and Admin Console are full-product scope.
