# design-sync notes: 3D ULPIN Design System

- **Source of truth is the claude.ai Design System artifact** (https://claude.ai/artifact/NT5SUib34sRbARRLmmSjq5, version 1790272512-603e, synced 25 Sep 2026), not the Studio app in `apps/web`. The user asked for a new design built from the artifact, not a copy of the current UI. Never pull components or `--ui-*` tokens from `apps/web`.
- `source/` holds verbatim copies of the artifact: `tokens.json`, `bundle.css` (component CSS), `README.md` (brand book), `guidelines/`, the 30 Phosphor icons (`icons/`, fetched one at a time by asset id; batch `paths` reads of asset ids fail) and the original HTML previews (`components/`) for reference.
- `scripts/build.mjs` compiles `tokens.json` into `dist/tokens.css` using the artifact's rules (`:root, [data-theme="light"]`; dark in `[data-theme="dark"]` with aliases redeclared; other families on `:root`; a class per type style). It also generates `src/icons.data.ts` and emits `dist/ulpin.css`, the flat file the converter ingests, with the Google Fonts `@import` hoisted first.
- The React components in `src/components/` render the artifact's own `ul-*` markup and classes; they don't restyle anything. Keep new components on that vocabulary.
- `brand/` (uploaded as `guidelines/brand/`; the converter keeps the package-relative path) = brand book + the artifact's 3 guideline files + the "3D ULPIN UI & UX Brief" Claude Doc (https://claude.ai/code/artifact/92e0c4a7-dd3d-4deb-9fd7-706625ac88f9), converted to markdown, + the icons README. `guidelinesGlob` is pinned to `brand/*.md` because the default also matches `docs/*.md` (component docs).
- Package lives outside the pnpm workspace (`design/` is not in `pnpm-workspace.yaml`) and uses npm, so it never touches the app's lockfile.
- Fonts are Noto Sans / Display / Mono from Google Fonts (remote `@import`, `[FONT_REMOTE]`); no font files ship.
- The artifact's ReadinessMeter preview title said "Ready to issue 3D ULPIN", which conflicts with its own rule against "issued". Previews use "Assign proposed 3D ULPIN", as in the brief.
- Playwright 1.63.0 in `.ds-sync` matches the cached chromium-1243.
- Card modes: `column` for Icon, DescriptionList, Tabs, MapCanvas, MapToolbar, Inspector, PortalHeader and StudioHeader (GRID_OVERFLOW).

## Known render warns
- None after the column overrides.

## Re-sync risks
- The artifact is edited live on claude.ai. When it changes, re-download `project/tokens.json`, `project/components/bundle.css`, READMEs and guidelines into `source/`, and re-convert the brief doc into `brand/40-ui-and-ux-brief.md`. Nothing refreshes them automatically.
- New or renamed `ul-*` classes in `bundle.css` need matching component changes. Previews and grades are tied to today's markup.
- The brief markdown is a one-time conversion of the doc's XML. Tables and code blocks were checked; the two mermaid diagrams keep their source text.
