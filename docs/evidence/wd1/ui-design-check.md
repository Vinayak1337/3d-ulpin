# WD1 UI design check (apps/studio, by hand)

The repository scan `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs ee99e231` covers `apps/web`
only; it printed "0 added line(s) in apps/web. No candidates." and exited 0. The `apps/studio` changes were
reviewed by hand against `docs/design-system/README.md`, as PL1 did.

Changed UI files: `apps/studio/src/features/intake/PlaceOnMapDialog.tsx`,
`apps/studio/src/features/intake/table/TablePage.tsx`, `apps/studio/src/features/intake/upload-model.ts` (forecast
words shown by `IntakeDropDialog`).

## Blocking

None. No invented data, no banned provenance label, no theme switch. Every number in the new forecast words comes
from a contract limit (`DOCUMENT_LIMITS`, `CITYJSON_LIMITS`, `GLTF_LIMITS`, `CITYGML_LIMITS`), never a literal.

## Design system

None. The changes are words only:

- `PlaceOnMapDialog.tsx`: the started text stays in the same `<p role="status">` with the same single primary
  Close button; no new element, class or token.
- `TablePage.tsx`: the help stays one `Banner tone="info"`, moved into an exported `TableStepNotice` so its words
  can be tested; no new token, colour, radius or layout.
- `upload-model.ts`: forecast strings only; the drop dialog renders them in the existing row.

## Checked, no issue

- Sentence case, units always shown (MiB, GiB, pages).
- No status word outside the fixed list: placement words in `batch-model.ts` are unchanged; "On the map" stays
  reserved for an item's own placement.
- No value repeated in two places on one screen: the table's line names the GeoJSON file and points to that
  file's own line instead of repeating its map state.
- Unknown is not turned into 0: a feature whose position could not be measured gets its own count and words.
- Keyboard, focus and zoom unchanged: no interactive element was added or removed.
