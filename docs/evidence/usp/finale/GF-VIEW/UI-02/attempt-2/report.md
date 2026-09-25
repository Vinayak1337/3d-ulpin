# UI-02 attempt 2 — Studio frame review corrections

**Result:** Code and guarded local integration passed. Independent milestone review remains with the lead.

**Worker:** `01a0d5d3-c8dd-7472-8ea4-4decef30f0c7` on `local`; agent.product `Codex`, delegated agent.model `gpt-6-sol`, delegated agent.effort `xhigh` (as specified by the attempt 2 delegation). Callback: `ulpin-UI-02-attempt-2`.

**Base:** `ad71e514cba205eec4dc44fb982efa1e9800378e` (attempt 1 result). Original integration base: `c597d5252518b336d1cafc8852db21bdfcea13db`. **Final code commit:** `300447b0cbe74e81d20f0c16b88601c5ab476660` on `agent/UI-02-studio-frame`. The guarded receipt's `codeSha` matches this commit. No merge, push, deployment, service activation, credential, backend, schema or protected dataset change was made.

## Corrections

- **UI02-R1:** The header says “Status unavailable” because AreaContext provides no authoritative snapshot identity or time. Sources now distinguishes loading, failure and a verified empty list while retaining available package rows when the dossier request fails. The browser test holds a dossier response, confirms the loading state, returns HTTP 503, and confirms the error and package rows remain visible.
- **UI02-R2:** Header, scope, toolbar and panel actions now have at least 44 × 44 CSS pixel hit areas. Metadata in the frame uses at least 12px text. Controls, floating groups and sheets use the specified 8/12/16px shape tokens. At 1440, 900, 620 and 390 CSS pixel widths, plus a 720 CSS pixel viewport representing a 1440px display at 200% browser zoom, measured targets had minimum side 44px, zero document horizontal overflow and successful center hit tests. See `runs/local-9fa59b410f9593d8/screenshots/measurements.json`.
- **UI02-R3:** On a phone the panel takes foreground precedence over the inspector, the hidden inspector and map controls become inert, focus enters the sheet, and the scope retains a visible “Back to map” action. The test resizes with both panel and inspector open, exercises slash search, Escape order, source and export dialogs, Spaces selection, Back to map, and runtime ID/camera/selection continuity. The empty map import action is inert behind a panel too.
- **UI02-R4:** Layer appearance and Source & reference/Evidence coverage summary text use the surface theme's ink token. Effective foreground to composited background contrast measured 10.05:1 in light and 10.54:1 in dark on the sampled summaries. Fresh settled screenshots for both themes and responsive widths are in the final run's `screenshots/` folder.

## Verification

| Command or artifact | Result |
| --- | --- |
| `pnpm --filter @ulpin/web exec tsc --noEmit` | Exit 0 after the main code change. |
| `pnpm --filter @ulpin/web build` | Exit 0 on final code commit; existing GeoTIFF dynamic dependency warning only. |
| `node scripts/usp/local-isolation.mjs --run` | Exit 0, `USP isolated live: PASS`, scope `local-9fa59b410f9593d8`. All 22 recorded guard commands, including migrations, D0/D1 replay, UI-01, UI-02, D0/D1 journeys, GF-T15 and owned service cleanup, exited 0. |
| UI-02 browser report | 1 expected, 0 skipped, 0 unexpected, 0 flaky; page errors `[]`. |
| Receipt SHA-256 | `a7ef41c4077cb216bc3bf9c3b18e7bb665e41476ff515f96cd420a8cb1c0a7e2` |
| UI-02 browser report SHA-256 | `862259adb08a21b39cf12474c6d87909cae1dfbb18614810066b8675c153306c` |
| Measurements SHA-256 | `3e8cc66561834e8c3c0f1002d3a03d710d57d8acf722b77ae214e6ee214fe331` |

The passing [guard receipt](runs/local-9fa59b410f9593d8/runner-receipt.json), [browser report](runs/local-9fa59b410f9593d8/browser-report.json) and [measurements](runs/local-9fa59b410f9593d8/screenshots/measurements.json) are pinned under this attempt. Earlier attempt 2 run folders preserve failed browser histories. One run on the final commit (`local-9dd7f34cb1330892`) passed UI-01 and UI-02 but timed out in the existing D0 journeys while waiting 15 seconds for the scene-ready flag; the unchanged commit passed those journeys on the following run. This timing variability remains a local browser test limitation.

The runtime evidence uses synthetic D0 and one retained real D1 exterior in the isolated local engineering environment. It does not qualify global D1 placement, interiors, analytical volume, real-source accuracy, GPU performance or deployment.
