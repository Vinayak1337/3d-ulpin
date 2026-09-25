# UI-01 · Foundation contrast correction, attempt 2

## Assignment and result

Assignment `UI-01`, attempt 2, callback `ulpin-UI-01-attempt-2`; worker `01a0d5d3-c8dd-7472-8ea4-4decef30f0c7` on `local`, `Codex/gpt-6-sol/high` verified from the turn context. This continues the clean `agent/UI-01-design-foundations` branch from attempt-1 result `fea3055813c050a694cc6ed76e97c3b8d470c144`, with original integration base `staging@7d056675c766d81280ac81c69572d2d01d3cde0b`.

The corrected implementation was tested at `e7e533a702ab3fd5b594ab648bca6f908808ac74` and is **ready for independent review of UI-01**. The earlier [attempt-1 report](../report.md) and screenshots are unchanged. No push, merge, deployment, linked data write, provider call or credential edit occurred.

## R1 · Dark actions and control boundaries

The pale enabled actions in the submitted dark screenshot were a theme-switch transition. The text switched immediately to dark-theme light text while `.ui-button` kept its former white background for 150 ms. The first diagnostic browser run measured Add files at **1.58:1 immediately** with five running animations, then **10.54:1 after settling**. Add files, Export, Layers, Fit block, compass, zoom and Checks were enabled; only Focus selected property was disabled without a selection. The test now records actual enabled states and computes text, icon and border contrast against composited CSS backgrounds, including alpha and ancestor surfaces.

The retained Studio `.ui-button` no longer animates its background or border through a palette change. In the final run, Add files measured **10.54:1 immediately**, its icon matched, and it had zero running animations. Every sampled enabled action passed 4.5:1 text and 3:1 icon checks in light and dark. The narrowest tested dark border was Checks at **3.02:1**. Hovered Add files stayed readable; keyboard-focused Export had a visible 2 px outline at **3.87:1**. The final [dark desktop capture](runs/local-dce7a5b0a94e03b1/screenshots/studio-dark-desktop.png) was inspected visually and shows readable active controls.

The expanded light check exposed an independent boundary issue: the compass, zoom and Checks borders were **2.68:1** against the pale map. Their light-theme border now uses the existing muted token and measures **4.41:1**. Source map geometry and interaction behavior were not changed. The final [light desktop capture](runs/local-dce7a5b0a94e03b1/screenshots/studio-light-desktop.png) was also inspected.

## R2 · Phone, keyboard, scaling and motion

The same live D0 route was checked at **390 × 844** in light and dark. The app and document widths remained 390 px, Fit block remained visible, the Noto stack stayed active and local fonts loaded with Google font hosts blocked. The clean [light phone](runs/local-dce7a5b0a94e03b1/screenshots/studio-light-phone.png) and [dark phone](runs/local-dce7a5b0a94e03b1/screenshots/studio-dark-phone.png) captures were inspected. A Hindi test label was rendered and captured separately, then removed before phone and zoom captures: [Hindi label](runs/local-dce7a5b0a94e03b1/screenshots/hindi-label.png).

Keyboard Tab moved focus from Add files to Export, where `:focus-visible` matched and the outline measured 2 px and 3.87:1. At 200% CSS zoom, the brand's measured height doubled from 33.34 to 66.69 px and Fit block remained visible. The [200% capture](runs/local-dce7a5b0a94e03b1/screenshots/studio-light-200-percent.png) was inspected. Under reduced motion, control transition duration was `0s` and spinner animation was `none`. These are focused checks of the current route; the retained frame still places much of the map below the first viewport at 200%, and phone context actions use compact icon presentation. UI-02 owns broader frame reflow and navigation polish.

## Verification and retained failures

`pnpm build`, `pnpm typecheck`, `pnpm lint:icons`, `pnpm test:ui` (**20 passed**) and `git diff --cached --check` exited 0. Final `node scripts/usp/local-isolation.mjs --run` exited 0: **21 of 21** internal commands exited 0, including the expanded UI-01 browser test, three retained D0/D1 browser tests, GF-T15 compatibility and owned-service cleanup. The focused UI browser report has one pass; the retained D0/D1 browser report has three passes. Exact code/source hashes, command exits, screen hashes and measured ratios are in [run-summary.json](run-summary.json). The full [final browser measurements](runs/local-dce7a5b0a94e03b1/screenshots/measurements.json) and raw runner receipt are saved under that run's scope ID.

Two failed diagnostic scopes remain under `runs/`: `local-1611f2e4a09b170c` first exposed the compass boundary, and `local-76aa2679fba8a175` collected all failing light map boundaries plus phone/zoom measurements. Both recorded a nonzero UI browser command and zero-exit owned-service cleanup. Their reports, receipts and available screenshots are retained rather than replacing them with the final pass.

## Qualification boundary

This corrects and verifies UI-01 foundations on the authored local D0 Studio with retained D0/D1 compatibility. It does not qualify the full GF-VIEW gate, an exhaustive accessibility audit of every route, a runtime theme switch, UI-02 frame redesign, real-source accuracy, GPU performance or deployment. No visible scene geometry, record, rights, measurement or official parcel assertion was changed.
