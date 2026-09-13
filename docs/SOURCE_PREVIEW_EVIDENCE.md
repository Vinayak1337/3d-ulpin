# Source file previews

Verified locally on 13 September 2026 against the production build.

The shared read-only dialog is available from source-list Preview buttons,
the inspector's Original file section, evidence bindings, contributing sources
in findings, and the plan-reference toolbar. Existing downloads and calibration
remain available. PDF.js renders PDFs locally, native image rendering handles
PNG, and Papa Parse reads CSV originals into tables. JSON is formatted as text.
No external document-viewing service receives source files.

## Verification

- `pnpm typecheck` and the final `pnpm build` passed.
- Playwright CLI opened real stored level CSV, control CSV, spatial JSON, PNG,
  and PDF sources. U03's missing r1 lower limit remained blank, and original
  CSV text retained `U03,,6`.
- The downloaded level CSV matched `fixtures/c001/levels-r1.csv` byte for byte.
- Source-list, Original file, unit evidence-binding, and overlap-finding links
  opened the shared dialog. The finding retained its original evidence revision.
- Escape closed the dialog and restored focus to the opener. The final dialog
  initially focuses its close button. Its native modal behavior keeps the
  background unavailable to keyboard interaction.
- PDF zoom changed to 125% and Fit restored 100%. A 390 × 844 viewport was
  captured and visually inspected. The sample PDF has one page; multiple-page
  navigation retains the existing PDF.js page selector but was not separately
  exercised with a multi-page fixture in this check.
- A browser-intercepted HTTP 503 displayed an error with download/reopen
  recovery guidance. Removing the interception and reopening loaded the table.
  The intentional 503 produced the expected browser network error.
- Before/after API responses for the guided walkthrough matched exactly for
  case, units, sources, model and history. All five service health flags passed.

Local screenshots and the downloaded verification file are under the ignored
`output/playwright/source-preview-*` paths. The final mobile capture includes
zoom controls. These checks were browser interactions, not added test specs;
the existing full model-generation regression suite was not rerun for this
read-only UI change.

## Display limits

CSV tables show up to 500 data records, 50 columns, and 2,000 characters per
cell. Text previews show up to 200,000 characters. The interface discloses these
limits; original downloads remain complete. File contents are rendered as text,
not interpreted as HTML, formulas, or executable code.
