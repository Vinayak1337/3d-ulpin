# UI-01 · Design foundations

## Assignment and result

Assignment `UI-01`, attempt 1, callback `ulpin-UI-01-attempt-1`; worker `01a0d5d3-c8dd-7472-8ea4-4decef30f0c7` on `local`, `Codex/gpt-6-sol/high` verified from the turn context. Branch `agent/UI-01-design-foundations` started from exact local `staging@7d056675c766d81280ac81c69572d2d01d3cde0b` after a successful remote fetch. The older remote tracking head was not used as the base.

Implementation was tested at `693b224dbb5fa1a43c77e10d8b2c69c4309722f1`. **Ready for independent review of UI-01.** No push, merge, deployment, linked data write, provider call or credential edit occurred. The full GF-VIEW release gate is not qualified by this foundation task.

## Implemented

- Merged all 97 reference `--ui-*` names and values from `docs/design-system/tokens.css` into the runtime officer token scope, including map geometry, rights, finding marks, readiness, utilities and the opt-in dark palette. Existing controls and sizes remain available. Shared inputs, buttons, panels and badges now use surface, text and control-line tokens. The active Studio root no longer overrides the reference colors or font stack with its older green values.
- Registered local Noto Sans, Noto Sans Devanagari and Noto Sans Mono variable WOFF2 faces once in global CSS. The active Studio uses the Noto stack. The files and their SIL OFL notices are under `apps/web/public/fonts/`. No `fonts.googleapis.com`, `fonts.gstatic.com` or `next/font/google` reference exists under `apps/web`.
- Extended the existing single Phosphor `Icon` wrapper with Studio 20 px, dense 16 px and Portal 24 px contexts; explicit caller sizes still work. `pnpm lint:icons` warns on newly introduced `lucide-react` imports relative to the branch base without flagging unchanged legacy imports.
- Added a scoped dark compatibility layer for the retained Studio chrome. The source map geometry is left in its source colors. UI-02 still owns the frame and its existing 70 px header override.

## Font provenance

Official release ZIPs: [Noto Sans v2.015](https://github.com/notofonts/latin-greek-cyrillic/releases/tag/NotoSans-v2.015), [Noto Sans Devanagari v2.007](https://github.com/notofonts/devanagari/releases/tag/NotoSansDevanagari-v2.007), [Noto Sans Mono v2.014](https://github.com/notofonts/latin-greek-cyrillic/releases/tag/NotoSansMono-v2.014). Each source was the release's `googlefonts` variable TTF. Conversion used fontTools 4.60.2 with Brotli 1.2.0 to WOFF2; both axes (`wght` 100–900 and `wdth` 62.5–100) were preserved. The source TTF SHA-256 values, in that order, were `bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d`, `14ec4af41f27482216d1c2229f417ff9b1425e1babb014e57d1d40d03229853e`, and `2cb2adb378a8f574213e23df697050b83c54c27df465a2015552740b2769a081`. Output and OFL file hashes are in [run-summary.json](run-summary.json).

## Verification

`pnpm typecheck`, `pnpm build`, `pnpm lint:icons` and `git diff --check` exited 0. The final `node scripts/usp/local-isolation.mjs --run` exited 0: all 21 internal commands exited 0, including UI-01 browser checks, retained D0/D1 browser journeys, GF-T15 compatibility and owned service cleanup. The raw runner receipt SHA-256, exact code commit, command exits, source hashes and screenshot hashes are in [run-summary.json](run-summary.json).

The UI browser check ran against the isolated production Studio with the authored D0 fixture. It blocked Google font endpoints, observed only same-origin font requests, loaded all three registered faces, and rendered a Hindi test label. It measured reference text pairs at 4.5:1 or better, control lines at 3:1 or better, and visible Studio header, map mode, selector and status text at 4.5:1 or better in both themes. These are focused UI-01 checks, not an exhaustive accessibility audit of every route.

Fresh captures from that run were visually inspected: [light Studio](screenshots/studio-light-desktop.png), [dark Studio](screenshots/studio-dark-desktop.png), and [Hindi label](screenshots/hindi-label.png). The browser waited for the shared scene to report ready before the Studio captures. Disabled controls remain dimmed by the retained component behavior.

The first live check exposed a legacy Studio muted-color override; the next visual review exposed light text on white legacy chrome in dark mode. A stricter visible-control assertion then exposed a selected map mode text regression. These were corrected before the final pass. Each failed run exited through the isolated runner's owned-service cleanup.

## Qualification boundary

This qualifies UI-01 foundations on the local authored D0 Studio and retains the D0/D1 flows. UI-02 frame alignment, remaining route-by-route dark styling, Portal typography, full GF-VIEW review, real-source accuracy, GPU performance and deployment remain pending. No application identifier or scene color was promoted to an official parcel, rights or measurement claim by this work.
