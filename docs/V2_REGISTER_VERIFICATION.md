# V2 Register verification

Date: 15 September 2026. Branch: `feat/v2-officer-redesign`.

The Register is a new presentation composition under `features/v2/register`, using the existing dossier, resolver, source, register-export and investigation APIs. It does not wrap the legacy workbench, fabricate model geometry or add record authority. The interactive plan and sectional view use recorded polygons and levels; the section explicitly labels its horizontal arrangement as schematic.

## Observed browser journeys

These checks used an isolated Playwright CLI Chromium session (`v2-register`) against the local application. The original A/B registry observations and real Bronx source observations were not changed by these checks.

| Journey | Observed result |
| --- | --- |
| Register start | Search, actual block buildings, browser-session recents, scoped saved cases and preparation drafts loaded. Case/draft summary scope is stated on screen. |
| Real source identifier | `353927` opened canonical building `7ca4fba1-6c6a-44aa-89c8-d17b97bf159f`. Back to Block selected that same building among the saved 62; Open register returned to the same canonical ID. |
| Exterior-only building | Bronx building 353927 displayed its observed footprint and height, with floors and units explicitly not supplied. Floors & Units provided the preparation action rather than invented rooms. |
| Fresh V2 workspace integration | Independently opened newly recorded synthetic B `f29b8566-fe5f-4a46-85d0-8754a6fccf3e` in area `e4eea7b8-f1f0-4ea0-bd82-29e0c2a740a3` on the production preview. Exact room `5143128b-05e0-4f1d-b7cd-e2be16c9509e` selected; 16 m², 48 m³ and 0–3 m matched the saved workspace result. Read-only verification. |
| Detailed record | `3DU-4CC6J5WEQ99HY9BWKRJ67J6P1A:S002` resolved to B and selected exact room `a8f6efbb-1d4b-41ee-b168-d78a50e5f3db`. `record=` is validated against the dossier. |
| Floors & Units | B retained one ground floor and one synthetic room, 16 m², 48 m³ and 0–3 m. Plan selection, room details and the section used those saved records. |
| Evidence | B's upper reference opened native CSV row 2, showing `upper: 3`, `unit: m`, `BM-SYNTHETIC-UI-ONLY`, its named area frame and SHA-256. The original download link remained available. |
| Issues | The then-current B check narrowed four findings to one geometric finding. Detail retained method and uncertainty; no severity rating was invented where the source has none. Later backend input changes made that check stale, which correctly replaced the results with an explicit needs-updating state. SVG preview supports recorded polygon, line and point findings. |
| History | The Reviews filter showed five retained source-fact decisions and excluded source-receipt events. Revision values remain visible. |
| Export | The UI downloaded `property-register.json` containing three actual B register records. Download SHA-256: `e7363a221820db8133cc14e45e382329f873d2517b74563bb0ef2b811d4b42d7`. Export timestamps make this a verification of this download, not a stable future hash. |
| Unknown identifier | An absent test identifier returned “Not present in loaded data,” without a national-identity validity claim. |
| Wrong context | B with the Bronx `area=` was rejected as a non-member by the Register, whose Back to Block returned to B's recorded synthetic area. An unrelated `record=` was ignored. The shell owner fixed the matching header issue. An independent development recheck of `areaId=Bronx` returned the same validated synthetic owner and exact room in both header and Register links; final production recheck is recorded below. |

## Synthetic investigation performed through the UI

Only this new case was mutated:

- Building C: `022597b5-41ed-495b-8318-6ccb0452b58b`.
- Area: `8c61a45e-3ae9-4c7c-95f2-78918f23582a`, explicitly named “Synthetic officer UI test · not a real survey”.
- Case: `26cd8466-7140-4971-a3aa-0032fd58cf4f`.
- Reference: `SYNTHETIC-V2-REGISTER-C-20260915`.

The UI opened the case with C's four current findings, added one evidence request, and received the expected server refusal when attempting review with that request open. The response retained source revision `eb71c699-5ea2-4eea-a1b7-4c7cfb87c8f0` with exact `featureId: C`. The source selector was corrected during verification to submit the selected feature/document-part locator; source-ID-only evidence had correctly been rejected by the server.

After the response, the UI completed `NEEDS_EVIDENCE → READY_FOR_REVIEW → REVIEWED → CLOSED → OPEN`, each with an explicit reason. Reload retained the same case at revision 7, with the response and prior close/review decisions intact. It remains **OPEN after the intentional reopen test**. Every test note states its synthetic scope. No geometry, official identity or legal decision was issued.

## Layout and accessibility checks

Recorded viewport dimensions and document dimensions matched, with no document-level horizontal overflow:

| CSS viewport | Result |
| --- | --- |
| 1920 × 1080 | Bronx overview; full property identity, source and missing-interior states. |
| 1440 × 900 | Exact B unit deep link, selected plan and unit details. |
| 1366 × 768 | Start, overview, section, source evidence, issues and investigation. |
| 1093 × 614 | Reduced viewport equivalent to approximately 125% of 1366 × 768; internal panel scrolling remains available. |
| 390 × 844 | Compact header, horizontally scrollable tabs, stacked plan/records and actions within the viewport. |

The headless browser's `Meta+Equal` shortcut did not alter `innerWidth`, `devicePixelRatio` or visual-viewport scale. Native 125% browser zoom is therefore **not claimed**. The reduced viewport is a responsive-layout check only. SVG units support keyboard activation; forms have labels, validation, guarded submissions and visible rejection messages. Export and evidence dialogs use the shared focus-managed dialog.

## Checks and evidence

`pnpm typecheck` passed after Register integration. Development verification encountered expected HTTP 409 validation failures and Fast Refresh errors while concurrent source files were being edited; these are not counted as a clean production console result.

## Final production pass

A fresh isolated session (`v2-register-final`) verified the coordinated production build at `http://127.0.0.1:3002` on 15 September 2026, 05:58–06:02 IST. It included the extracted reusable Register tabs and validated shared navigation. No records were mutated in this pass.

- Fresh V2 B's exact room deep link selected the saved 16 m² / 48 m³ / 0–3 m record. Its native CSV row showed the named `BM-SYNTHETIC-V2-ONLY` benchmark and original source hash.
- The original image decoded at 1200 × 900 pixels, and Chromium rendered both retained PDF pages in the evidence preview. These files visibly identify themselves as synthetic software-test material.
- With new V2 B, a Bronx `areaId=` and an unrelated old-B `record=` were rejected. Header Block, Back to Block and Workspace all used B's correct owner area, omitted the wrong record and kept the exact canonical building. The Register stayed on Overview with no selected unit.
- The real Bronx property loaded its observed footprint and retained exterior-only state.
- The test C case reopened at the same ID and retained its earlier close decision. It remains OPEN at revision 7 after the intentional reopen test.
- Measured final document widths matched the 1366, 1440, 1920, 1093 and 390 pixel viewports. The 1093 × 614 capture remains an **equivalent viewport**, not native 125% zoom.
- No application console errors occurred in the fresh session. Chromium reported repeated unused-preload warnings for two local Next CSS chunks (`75052d63031d20c9.css` and `1fca00ebaef56d9f.css`); these were warnings, not failed source loads. The final coordinated `pnpm test:v2` run passed 22 tests, and type checking and the production build passed.

Selected final screenshots are copied into the repository under `docs/evidence/v2/register/` (10 PNGs, 1,301,433 bytes):

| Screen | Evidence |
| --- | --- |
| Start, 1366 × 768 | [Final start](evidence/v2/register/final-start-1366.png) |
| Fresh V2 B selected room, 1440 × 900 | [Unit register](evidence/v2/register/final-v2-b-room-1440.png) |
| Recorded section | [Section](evidence/v2/register/final-v2-b-section-1440.png) |
| Native CSV evidence | [CSV row and source hash](evidence/v2/register/final-v2-b-csv-evidence-1440.png) |
| Original image | [Image evidence](evidence/v2/register/final-v2-b-image-evidence-1440.png) |
| Two-page PDF | [PDF preview](evidence/v2/register/final-v2-b-pdf-evidence-1440.png) |
| Real Bronx property, 1920 × 1080 | [Observed property](evidence/v2/register/final-bronx-overview-1920.png) |
| Reopened synthetic investigation | [Case and decisions](evidence/v2/register/final-c-investigation-reopened-1366.png) |
| Mobile, 390 × 844 | [Mobile](evidence/v2/register/final-v2-b-mobile-390.png) |
| 125% equivalent viewport only | [1093 × 614 layout](evidence/v2/register/final-v2-b-125-equivalent-1093.png) |

Earlier development captures remain in `output/playwright/v2-register/`, including the actual closed-case state before reopening. The verification sessions were closed after completion. History displays the events available in the dossier, not an invented complete system audit. Unsupported preview formats retain an unavailable-preview state and the original download action. Source groups use filename/profile hints; they are browsing categories, not a certified document classification.
