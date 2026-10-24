# LQ2 UI design check

## Blocking

None in the owned Studio diff. No sample records, inferred publisher, destination or height, theme switch, literal palette, or changes to the protected references.

## Design system

- The shared frame still makes the full document wider at 200% zoom (outside this task). The owned upload dialog wraps its long filename and progress/refusal text; its two recovery actions remain readable. See `controls-a4c8a3980c344ee6/stopped-200.png` under the external evidence root. No frame change was made.
- Area drawing is **not qualified**: software WebGL is on, but the canonical response did not arrive within 60 seconds and the scene has no tiles. This is a runtime gap, not a request to redesign the area screen.

## Checked, no issue

- `QuestionFields.tsx`: native labelled field selector, file-order choices, published whole-number eligibility, required refusal words. Required kind/identifier remain empty initially; name/height remain unstated.
- `IntakeDropDialog.tsx` and `useRetainBatch.ts`: one primary submission; real hashing/receipt progress; Waiting for later files; secondary Try again/Cancel upload; native browser leave question. Help is visible before submission. No new CSS or visual language.
- `IntakeTray.tsx`: published counts retain unknown versus zero and the stored reason remains verbatim.
- `run/Packages.tsx`: refused review replaces package detail, rather than repeating counts or suggesting a remedy. Unreviewed and refused remain separate. Confirmation rejects either a refusal or a missing review pin.
- Keyboard-controlled retry focus reports a **3 px** outline. At 200% the owned dialog's filename, refusal and recovery controls remain readable. Native selectors retain their labels. Screenshots are outside Git.
- Reused UI token contrast against white: ink 15.42:1, muted help 5.60:1, primary 8.75:1 (same unchanged shared tokens as LQ1b). No new colour/font declarations.

## Scans

- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs` — exit 0; 0 added web lines, no candidates.
- `node docs/evidence/gf1/e3a/studio-design-scan.mjs` — exit 0; same rules applied to Studio, no candidates. Final scan output is recorded in `checks.json`.

References: [design principles](../../../design-system/README.md), [components](../../../design-system/components.md), [surfaces](../../../design-system/surfaces-and-layout.md). Report only; no design-polish edits followed it.
