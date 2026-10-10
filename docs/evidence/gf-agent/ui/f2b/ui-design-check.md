# F2b UI design check

Scope: `apps/studio` changes from `1133de9f`; reviewed against the design-system rules and current staging.

## Blocking

None found. Source values are real D8 development derivatives or live A3c reads. Intercepted operator
receipts are visibly labelled; they are not officer truth. Draft rows never become registry/map buildings.
No theme, imagery, geometry, mockup values or table execute action was added.

## Design system

- **Non-blocking copy finding:** `apps/studio/src/features/intake/table/ColumnsTable.tsx:36` uses a
  **Needs input** question badge. The [fixed status vocabulary](../../../../design-system/README.md#content-rules)
  uses **Needs review**. Smallest adjustment: change this badge text only, keeping the server question
  and reason unchanged. Left unchanged pending approval, as this skill requires report-first review.

## Checked, no issue

- `Table.module.css`: existing `--ui-*` colour/type/spacing tokens; no new radius, shadow, theme or icon system.
  Panels, banners, buttons, dialogs and tables reuse `@ulpin/ui` and its light surface/shape/focus rules.
- `SourceHeader.tsx`: literal filename, selected sheet/rows, counts, mono hash and copy action; open limitations.
  Record badges are Draft / Needs review. No official claim follows from a mapping or an inferred type.
- `Progress.tsx`, `ColumnsTable.tsx`, `LearnerPanel.tsx`: unavailable jobs, proposals, units, confidence and
  metrics remain Unknown. Published zero calls remain zero. Officer confidence is labelled Officer decision,
  not model confidence. Milliseconds are named; fallback teacher-field semantics are explained.
- `TableImportDialog.tsx`, `AnswerForm.tsx`, `RecipeConfirmation.tsx`, `RecipeReview.tsx`: one primary action
  per current step; target/reason labels are positional; unknown also needs a reason; proposal and approval
  have separate dialogs. Busy/refusal states keep the exact server wording and an appropriate retry path.
- `ColumnsTable.tsx:13`, `AnswerForm.tsx:24`, `LearnerPanel.tsx:35`: named, focusable overflow containers.
  Browser check confirms a 2 px focus outline and ArrowRight horizontal scrolling at CSS 200% zoom.
  This is not a full screen-reader or browser-native zoom certification.
- Screenshots checked: `01`, `04`, `06`, `07`, `09`, `10`, `14`, `15`, `16`, `17`, `19`; no clipping of
  new labels or controls at the normal desktop viewport. The existing global frame is outside this change.

Mechanical scan: original skill remains scoped to frozen `apps/web`; the existing F2c adaptation covers Studio.

- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit **0**, no candidates.
- `node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs staging` — exit **0**, no candidates.
