## How to build with the 3D ULPIN design system

**Setup.** No provider or wrapper is needed. `styles.css` loads the Noto Sans fonts, the tokens (CSS custom properties on `:root`) and the component classes, and styles `body` itself: `bg` background, `ink` text, 15px Studio body, tabular figures. For the dark theme, set `data-theme="dark"` on `<html>`. Every token has a dark value, so components need no changes.

**Styling idiom: tokens plus a small `ul-` class vocabulary. Never invent colours, radii or fonts.**
- Colour: `var(--bg)`, `var(--surface)`, `var(--surface-subtle)`, `var(--ink)`, `var(--ink-soft)`, `var(--ink-muted)`, `var(--divider)`, `var(--border-strong)`, and `var(--primary)` (forest green, the only accent) with `var(--primary-soft)` and `var(--on-primary)`. Status colours are `var(--success|warning|danger|info)` plus `-soft`. Map and chart colours (`--map-*`, `--rights-*`, `--mark-*`, `--seq-*`, `--utility-*`, `--soil-*`, `--sky-band`) are for geometry only, never UI text.
- Spacing is `var(--space-1…16)` on a 4px grid. Radius is `var(--radius-4|8|12|16|pill)`: 8 for controls, 12 for panels and floating map controls, 16 for dialogs and the Property Card. Shadows are `var(--shadow-card|floating|overlay)`. Sizes are `var(--header-studio)` (56px), `var(--rail-left)` (308px), `var(--rail-right)` (360px), `var(--tray-height)` (172px), `var(--control-height)` (40px) and `var(--touch-height)` (44px).
- Type classes: `studio-title` (one per screen), `studio-heading`, `studio-body`, `studio-body-sm` and `studio-label`. The Portal uses `portal-display`, `portal-h1`, `portal-h2`, `portal-h3`, `portal-body` and `portal-label`. Codes use `id-code`; coordinates and measurements use `data-num`.
- Layout helpers: `ul-row` (wrapping flex row, 8px gap), `ul-stack` (grid, 12px gap), `ul-pad`, `ul-muted`, `ul-mono`, `ul-num`, `ul-caption` and `ul-help`. The floating surface for map chrome is `ul-float`.
- SVG map scenes use `m-ground`, `m-road`, `m-public`, `m-water`, `m-parcel`, `m-bldg`, `m-ctx` (context at 35 %), `m-halo` with `m-sel` (the selection), `m-est` (hatched estimate), `m-label` and `m-code`. Put `<MapPatterns />` inside the `<svg>`.

**Where the truth lives.** Read `styles.css` and its imports before styling layout glue. Read `guidelines/brand/`: `00-brand-book.md` (voice, status words, units, identifiers), `10-map-and-3d.md` (Colour by, evidence and record channels, level rail), `20-surfaces-and-layout.md` (Studio grid, Portal, Admin), `40-ui-and-ux-brief.md` (screen inventory S1–S19, P1–P7 and A1; **specimen data to use exactly**; honest states) and `50-icons.md`. Each component's `.prompt.md` has its rules and an example.

**Content rules the components assume.** Sentence case, with no emoji and no all-caps labels. Label the code "3D ULPIN (proposed)" and never call it official or issued. Heights name their datum ("233.8 m · SD-1"). Show unknown as *Unknown* with a hatch, never 0 or blank. Status words come from `Badge`'s `status` list only. Give each screen one primary `Button`.

```jsx
<div style={{ display: 'grid', gridTemplateColumns: '1fr var(--rail-right)', gap: 'var(--space-4)', padding: 'var(--space-4)' }}>
  <MapCanvas height={620} overlays={<div style={{ position: 'absolute', top: 16, left: 16 }}><MapToolbar /></div>}>
    <svg viewBox="0 0 800 620" width="100%" height="100%"><MapPatterns /><rect className="m-ground" width="800" height="620" /></svg>
  </MapCanvas>
  <Inspector title="Flat 704" status="Needs review" code="P3-7Q4M2R8T6V0W3X5Y9ZAB-R4"
    location="MH2507A1B3C4D5 / S01 / F07 / R003"
    facts={[{ label: 'Carpet area', value: <>69.30 m² <EvidenceChip source="Plan F7" locator="p.3" href="#" /></> }]}
    primaryAction={{ label: 'Review area' }} />
</div>
```
