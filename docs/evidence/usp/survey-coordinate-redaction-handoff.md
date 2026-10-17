# SURVEY-REDACTION-01 — decimal boundary correction

4 October 2026. Code `6d1f4eacdf8673ec9a50af80eeae951f1e64829e`, branch `task/desktop-survey-coordinate-redaction`, exclusive `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`, base `5bed68976f3fc4de677a7b5969ed099b1865c4c3` (also the staging head reconciled before implementation). Prior survey branch/checkpoint `task/desktop-survey-report-context@ad1926a7d7870cfc17c78a8ace6b312f664d9982` and source branch `task/desktop-survey-control-source@d31a0178b86f6d606e7d2e340b63c5d43a12c688` remain intact. Staging was read only.

Supplied current-turn permissions are `never`/`danger-full-access`. Assignment requested GPT-6.1 Sol/xhigh/default-standard; actual turn model/effort/tier are unexposed and no speed override is claimed.

## Diagnosis, correction and privacy scope

The old phone matcher starts at a coordinate's fractional digits, crosses whitespace and consumes the next coordinate's integer digits (for example the literal `503428.861 4312740.801`). It then reports a phone-shaped substring inside two distinct decimal tokens. Reuse [the accepted source/inspection history](survey-report-context-handoff.md); no discovery or acquisition was repeated.

Only shared `packages/server/src/modules/usp/ingest/redact.ts`, targeted `tests/decimal-redaction.test.ts`, and affected `tests/survey-report-context.test.ts` changed. The three existing numeric phone/identifier matchers now classify their candidate before masking. A candidate is preserved only when it is exactly two digit groups separated by whitespace, starts inside a complete decimal token's fraction and ends inside the next complete decimal token's integer portion, with bounded numeric-token boundaries. The same general guard covers VID and Aadhaar-shaped joins; no report name/hash/sample/field allowlist, report-wide exception, replacement original or post-redaction restoration exists.

**Rejected approach:** a blanket exclusion of every fractional start could expose a whole phone/identifier-shaped fraction. The final guard retains masking for those, complete phone-shaped integer tokens (including decimal suffixes), bare/formatted/punctuated phone numbers, malformed/ambiguous contexts and personal labels. Existing PAN/email/obfuscated-email, labelled/structured personal-field, JSON numeric/exponential and historical-view protection remains. High-precision identifier-shaped fractions and unsupported ambiguous formatting may still be masked conservatively; this is not general personal-data detection qualification.

## One retained-source before/after comparison

The unchanged [research source manifest](survey-control-source/manifest.json) retains origin/version/licence/foreign `test_only` geography and unknown working-frame/date/correspondence limitations. The current native TEXT helper ran with the same injected pure line callback, applying its actual shared redactor and native part/unit hashes/locators; PID also ran through the existing bounded service adapter and controlled authority/stream envelopes. No external/native process or live accepted-job enrollment occurred.

| Source | Before typed / unparsed | After typed / unparsed | After cited spans | Response bytes |
|---|---:|---:|---:|---:|
| PID, original 6,458 bytes / SHA `6a185639d8775640a5103136f536b345bc886560a5baef0ef19a5d529740aff2` | 11 / 6 | 17 / 0 | 471 | 146,666 |
| NVA, original 44,314 bytes / SHA `dfcd0e1fa9030dcdd0b8d9990cf257fe1e8154e73dbd1ff23d1f39c6747e8a0e` | 105 / 61 | 166 / 0 | 3,453 | 984,881 |

Every typed original row line compares exactly with the unchanged TXT parent. PID data lines 83–99 and NVA 338–503 retain their ordinals, IDs, signs, literal zeros and unavailable markers. NVA retains 164 enabled rows plus the two `Turned Off` rows; reported withholding and statistics remain quoted source fields. Both tables now have `table.status=complete` within the existing 1 MiB-minus-envelope cap, but response `state=needs_input` and all frame/epoch/object/comparison/accuracy/learning guards remain unchanged. Genuine masked/missing rows and missing headers/terminators still return cited incomplete populations.

## Checks and reader impact

- Baseline unchanged-source comparison: `tsx --tsconfig apps/api/tsconfig.json --test --test-name-pattern 'real PID|real NVA' tests/survey-report-context.test.ts` — exit **0**, **2 passed**.
- Final targeted suite: `tsx --tsconfig apps/api/tsconfig.json --test tests/decimal-redaction.test.ts tests/survey-report-context.test.ts` — exit **0**, **8 passed**, **0 skipped**.
- Existing privacy regressions only: `tsx --tsconfig apps/api/tsconfig.json --test --test-name-pattern '09 private identifiers|Verhoeff arithmetic' tests/ai-extraction/grounding.test.ts scripts/usp/gf/FND-06-controls.test.ts` — exit **0**, **2 passed**. No provider/model tests executed.
- `pnpm.cmd typecheck:backend` — exit **0**, server and API. Staged whitespace check — exit **0**.

`documentReaderSha` includes this shared file. Observed physical worktree recipe changes from `b6c4edba37018a5aa0d190b75b51b904c3f2998531b25a82f069353ad25834f0` to `9507e158e375b9606ec5fddf8c18ef89452e62c7ed558cf679ec3a3c4a36cee8`. Shared redactor physical SHA is `86c36008b22bbae11f13c22c8e5ef45e5a26330d1e17666f808aa6fac264f96e`; physical line endings can affect this code-byte recipe, so the lead must recalculate it after integration. `REDACTION_VERSION` retains its existing policy label; code identity changes naturally. Existing results bound to the old recipe become stale under current authority, including recently refreshed reference jobs. No historical reader/input/result pins, jobs, references or reviews were rewritten, and no unrelated job was refreshed. Lead owns any subsequent explicitly scoped fresh extraction/reference lifecycle and catalogue observation update.

Private evidence root `E:/BhuAayam-data/task-data/desktop-survey-coordinate-redaction-20261004` retains `before.json`/NVA baseline, `final-after.json`/NVA output receipts, final/existing test logs, final backend typecheck log and `receipt.json` with actual commands/exits, code physical/Git blob pins, source hashes, recipe observations and rejected approach. Prior source/inspection receipts and originals remain untouched; TXT/ZIP/deposit JSON hashes match the retained manifest. All task-started tests/typechecks exited. No live service, source acquisition, model/provider/GPU/native processing, ML/frozen-source change, history mutation, push or deployment occurred. One standing user-authorized completion callback returns these commits and recipe impact to lead `01a0ed8a-4383-79c3-a0ae-35c1e969ef66`; no polls or schedules.
