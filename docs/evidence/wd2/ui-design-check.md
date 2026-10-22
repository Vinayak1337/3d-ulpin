# WD2 UI design check

Base: `b1a4bd80`. Static review only; no browser, service, runtime or visual qualification.

## Blocking

None.

## Design system

None in the changed lines.

## Checked, no issue

- `apps/studio/src/features/intake/BatchTableSection.tsx:73`: the existing labelled placement button is restored
  for read BOM UTF-16 profiles; no new control, colour, icon, layout or status vocabulary.
- `apps/studio/src/features/intake/table/TablePlacement.tsx:61-66`: the existing button and batch link remain;
  prepared/skipped counts are distinguished from the GeoJSON item's map state.
- `apps/studio/src/features/intake/upload-model.ts:74-76,90-92`: conditional source-ground-outline preparation,
  usable horizontal EPSG and supported geometry replace an unconditional map promise. Evidence remains evidence.
- Content follows [content rules](../../design-system/README.md#content-rules) and
  [honest geometry](../../design-system/README.md#principles). Other officer sentences are unchanged.
- Existing semantic buttons, links, help classes and focus styling are retained. No invented displayed records,
  measurements, identifiers or sample values. Browser keyboard and 200% zoom checks remain unqualified offline.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs b1a4bd80` — exit 0, no candidates.
The scanner covers `apps/web` only (zero changed lines there); Studio changes were read manually above.
