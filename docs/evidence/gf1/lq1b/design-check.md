# LQ1b design check

## Blocking
None found in the question, approval and Change UI. Real source facts are read from the published profile/recipe; no required choice is preselected. No height, destination, kind or identifier is guessed.

## Design system
- The existing shared frame still overflows at 200% zoom. The owned layout section does not: client and scroll widths both 670 px (`control-final.json`). Its controls and summary remain readable by wrapping and vertical scrolling. No frame redesign in this task.
- **Live map drawing is not qualified.** The area page reports 1,661 accepted buildings and mounts one canvas, but `f69aac34c60fa796/area.png` shows a blank scene. A canvas and accepted counts do not prove drawing. Area/scene files are read-only here.

## Checked, no issue
- `QuestionFields.tsx`, `LayoutAnswer.tsx`, `LayoutQuestion.tsx`: existing `ul-field`, `ul-input`, Button/Banner/Skeleton and Batch token layout. Explicit accessible names match the visible questions; no new colours, fonts, icons, theme or sample facts.
- Officer's kind and literal identifier start empty. Optional name/height start “Not stated.” Unsupported kinds remain visible, disabled, with supported explanations. Profile-ineligible identifiers have qualified reasons rather than invented diagnoses.
- One selected layout inspector. One primary layout action: Use this layout, or Approve layout beside secondary Change. Approved/executed layouts are read-only.
- Request uncertainty locks the choices and retains the body/key. Choice-specific refusals have `role=alert`; general refusals are not recast as field errors.
- Controlled keyboard evidence: primary action focus is reachable and has a 2 px outline. Native labelled selects and textarea retain keyboard interaction. At CSS zoom 2 the owning section has no horizontal overflow.
- Token contrast against white: ink 15.42:1, muted help 5.60:1, primary action 8.75:1. Calculated from existing `packages/ui/src/styles/tokens.css`, not a new palette.
- Original retention, private reads, unknown heights and candidate/review boundaries remain unchanged. U8 changes only the thrown inspection path.

## Evidence
Controlled, not live gate evidence: `control-final.json`; screenshots under `E:/BhuAayam-data/task-data/lq1b/controls-6f9b3aedb8b7ccdd/` (`question.png`, `question-200.png`, `change.png`). Live question/area/cards/parks screenshots under `E:/BhuAayam-data/task-data/lq1b/f69aac34c60fa796/`.

Mechanical scans:
- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs 9d745eb5`: exit 0, no candidates; original skill targets frozen web (0 lines).
- `node docs/evidence/gf1/e3a/studio-design-scan.mjs 9d745eb5`: exit 0, same rules retargeted to Studio; 984 added lines, no candidates.

No redesign performed after this report.
