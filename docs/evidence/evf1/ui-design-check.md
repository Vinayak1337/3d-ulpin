# EVF1 UI design check

## Blocking
None.

## Design system
None. Only `apps/studio/src/features/intake/evidence/model.ts::coverageWords` changes presentation:
it appends the current source's server-provided failure state, code and explanatory words.

## Checked, no issue
- `model.ts:48-55`: counts still distinguish unknown from zero; failure is not absence or closed coverage.
- `evidence.test.tsx:225-236`: the published schema accepts the failed read; the other source stays closed.
- No JSX structure, CSS, tokens, colour, theme, sample values, focus or zoom behaviour changed.
- Mechanical scanner targets legacy `apps/web`; manual review above covers the actual Studio words change.
- Rules: [design system](../../design-system/README.md), fixed states and record-derived values in `AGENTS.md`.

`node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging`: exit 0, no candidates.
Studio evidence/confirmation tests: exit 0, 17 pass. No live browser or visual qualification is claimed.
