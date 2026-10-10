# H9 — ui-design-check

Base: `616f630a`. Reviewed the full Studio diff and before/after screenshots at 1440 and 200%.

## Blocking

None. Record values come from reads; nullable and absent fields stay distinct. No storing request was sent.

## Design system

- `features/intake/table/ColumnsTable.tsx:43` (unchanged, outside ownership): at 200%, the existing wide table
  scrolls internally. The teacher sentence wraps and is readable when scrolled to Question. No page overflow.
- `features/register/registry.ts` (existing export layout): both before and after PDFs have a second page with
  only the footer. Not caused by the code label change. Smallest follow-up: keep the footer with the notes.
- Project code wording follows this task's decision and H8's screen rule, not the older design-system wording.

Rules: [content and accessibility](../../../design-system/README.md#content-rules).

## Checked, no issue

- `api/ledger.ts` / `register/RegisterPage.tsx`: history names and actors are read-specific, not guessed.
  Source-feature entries state no actor; null registry actors say Actor not recorded. Dates have no stray dot.
- `batches/CasePage.tsx` / `caseEntry.ts`: one table opens its page; five remain five officer-selectable links.
  Names and retention dates come from case sources; missing metadata uses the listed ID and Unknown date.
- `intake/table/model.ts`: size refusal states that the teacher was not asked; no file-handling advice.
- `register/buildingColumns.ts` / `RequestsPage.tsx`: no Open requests column before a served answer.
  A mocked empty answer draws the column and zeroes; the real unavailable read never becomes zero.
- `register/registry.ts`: existing PDF styling retained; absent building code fact omitted in PDF and workbook.
- No new CSS, colours, fonts, icons, inspector, primary action or keyboard handler. Existing links remain links.
- History, cases and Buildings fit at 200%; the table uses its existing scroll container.
- No global sideways scrolling in any captured screen. No sample values are displayed.

## Scans

- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs 616f630a`: exit 0; 0 apps/web added lines.
- Same scan with only the path selector changed to apps/studio, run from the OS temp directory:
  exit 0; 263 added lines; no candidates. Skill source untouched.
- `node docs/evidence/gf5/h9/verify.mjs`: exit 0; 280 Studio sources valid UTF-8, no U+FFFD or lone high byte;
  no added Studio line over 120 characters.

No design change is proposed by this report.
