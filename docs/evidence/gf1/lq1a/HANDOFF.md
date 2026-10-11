# LQ1a — batch follows layouts and carries recording/cards

Branch: `task/lq1a-batch-follows-to-cards`, worktree `E:/Projects/ulpin-wt/a2`.
Merged `staging` once as the task requested; no later merges, rebases or push.

## Delivered

- `LayoutQuestion.tsx` reads the item's published recipe, selects its greatest revision, displays literal
  fields, absent name/height, stored area name/new-existing status, and the item's proposal origin. Extra
  plan/destination members are named. Approve uses that displayed revision; 409 reloads and explains the
  change. Approved/executed receipts are read-only. No author request exists in product code.
- `IntakeTray.tsx` follows stored `plan.packageId` through targets-page `areaId`, or says “Package prepared”.
  Empty reason/action cells no longer imply an unknown reason or an action. Dialog words say batch.
- `BatchPage.tsx` mounts `IntakeRunPanel({ caseId })` in `section#intake-run-panel`, below the tray and the
  single selected layout. Targets summary cache is shared with the run panel, not a competing reader.
- `run/model.ts`, `Confirm.tsx`, `Packages.tsx` permit reviewed noncommitted zero-count packages and empty
  card selection with nonblank acknowledgement. Exact zero-selection/package sentences are tested.
- `useBatchStream.ts` reuses the run URL/frame helpers and table deduplication. Resync refetches once and
  reconnects at the head. Errors close and retry from head on a five-second tick. Only two consecutive
  failed reconnects show the banner; success resets the streak. Quiet unfinished reads remain bounded.

## Live stop — not a completed gate

`runtime-second.json` / `runtime.json`: unchanged NYC buildings original, 1,103,282 bytes, SHA-256
`107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e`. Studio retained and enrolled it
(201 each), showed 1,662 retained features and “File checked” 849 ms after the add press, then the exact
closed officer-question sentence. No page errors.

The **declared helper only** sent the unchanged E1b author body over HTTP (201, proposed revision 1,
identifier `doitt_id`, unchanged geometry, **no height**). Destination suggestions came from inspection
SQL in this helper, as E1b does; the product never reads that SQL. Its captured request is compared
exactly with the evaluated E1b function in `layout-model.test.ts`.

**Rule (a) fired:** `service.ts:202-228` saves the authored receipt and emits `recipe.changed`, but does not
queue the draft worker. The earlier no-layout draft job already succeeded. After 6.5 seconds the item
still had `plan: null`, `probed / needs_answer`; recipe history held revision 1. The manifest reads stored
`plan_ref` only (`intake-ledger.ts:19-34`). No event-payload or alternate-read workaround was made.

A second external gap is real: **one open page attempts two simultaneous event connections**, one for
tray/layout and one for the run panel. `events.ts:14,108-112` permits one per case, so one returns
429 `INGESTION_STREAM_LIMIT`: “The bounded local event reader allowance is occupied.” There is no
parent subscription seam in the existing run hook without touching unowned `run/**`. Two are left,
as instructed. A needs-answer item intentionally stops quiet polling; lost live notifications matter.

No live approval, package/area walk, first-100 confirmation, card timings, last-row priority, PDF,
verification or confirmation persistence is claimed. 1,661 accepted is E1b's expected result, not an
observed accepted count here. No second difficult real input or live zero-building confirmation is qualified.
Both owned nonce stacks were removed; only their own containers were checked/removed.

## Controlled checks and design

`control-qualified.json`: a separate browser context with all API calls intercepted. It uses the captured
live recipe, explicit lifecycle controls and E3b's captured package pins. No controlled write reaches a
server. It proves 409 read-back followed by revision-2 approval, approved/executed read-only, prepared
package then correct area link, and `targets: []` with package pins and typed words. It is **not live proof**.
The zero-count projection is a deliberate eligibility control, not a claimed real zero-building package.

`design-check.md`: Tab/Enter, 2 px focus, contrast 5.60:1 minimum, 200% panel readability and screenshots.
Shared frame header overflow at 200% remains outside owned paths. Original skill scan and Studio-retargeted
same-rule scan both exit 0. `attempts.json` explains the browser harness's host-name-helper fault and its
bounded control-only diagnosis; the product was not changed to hide that harness fault.

Case suggestions use **only the first work-queue page**. `SourceCaseFields` has no search, but accepts an
exact typed case ID outside that list, or lets an officer create a new case. The table helper is unchanged.
Targets packages are limited by the published first summary (at most 100); no area is guessed for omissions.

## Checks and next

- `pnpm studio:typecheck`: 0.
- `pnpm studio:test`: 0; **402 Studio**, 2 API client, 7 UI, 44 scene tests.
  Merged baseline was 389 pass / 1 fail; historic E3a fixture predates nullable `plan`. Tests adapt that
  added projection explicitly without rewriting old evidence, and validate this walk's raw new response.
- `git diff --check`: 0. Strict owned diff reviewed; no table/backend/contract/client/area/scene/web edits.

First fix the authored-layout publication/requeue and the event-reader collision in separately authorized
work. Then rehearse UI approval → package/area → first 100 cards, priority, PDF/verification and reload.
LQ1b owns the actual officer question. These UI portions are ready for review; GF1/GF5 remain partial.

Reproduce isolated UI controls with a **new** receipt path:
`node --import tsx docs/evidence/gf1/lq1a/run-controls.ts docs/evidence/gf1/lq1a/control-new.json`

Reproduce the blocked live walk on a nonce-owned disposable stack with two **new** receipt paths:
`node docs/evidence/gf1/lq1a/run-runtime.mjs docs/evidence/gf1/lq1a/runtime-new.json docs/evidence/gf1/lq1a/controls-new.json`
