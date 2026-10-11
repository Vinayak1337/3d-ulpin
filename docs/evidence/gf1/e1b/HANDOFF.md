TASK   E1b — Intake facts for batch screens            GATE GF1
WORKS  A batch read names its item's layout and the package pins an officer can confirm without fetching features.
SEE IT node docs/evidence/gf1/e1b/run-runtime.mjs docs/evidence/gf1/e1b/recheck.json
INPUTS NYC buildings-original.geojson; retained hydrography.geojson at needs_answer; buildings before review.
GAPS   Canonical Python API check is blocked by historical receipt line endings outside the owned paths.
DESIGN contracts/usp/intake.ts adds plan and package summaries; intake-ledger.ts validates the stored projection.
       intake-targets.ts groups case/package readiness once and projects package/review facts with JSON operators.
       The copied E1 HTTP harness proves item/manifest parity, page-independent pins, confirmation and final counts.
COMMITS 3e2c0931 feat(api): an intake item states its layout and package
        74506e0b feat(api): the targets page lists the packages a confirmation names
        Evidence commit follows this report; see git log.
CHECKS pnpm typecheck:backend — 0; pnpm studio:typecheck — 0
       Isolated-env intake-ledger, intake-targets, intake-draft, intake-run and intake-run.controller tests — 0
       openapi.ts generation and --check — 0; 310 operations and 351 named schemas before and after
       refresh-contract.ts against the branch base — 0; git diff --check — 0
       E1b run-runtime.mjs runtime.json — 0; one real journey; only the nonce-owned container removed
       PYTHONDONTWRITEBYTECODE=1 python scripts/api/check.py — 1; read-only index-byte comparison — 0
       node docs/evidence/gf1/fx2/refresh.mjs --refresh — 1; refusal described below
NEXT   Integrate after review; coordinate the additive contracts with both batch screens.
       Refresh the three historical receipts' working line endings through the shared-seam owner, then rerun check.py.

## Step 0 — stored shapes and readers

- The only SQL writer of `plan_ref` is `writeIntakeDraftTx` in `intake-ledger.ts`.
  Its caller `intake-draft-worker.ts:transition` creates either null, or
  `{ recipeId, recipeRevision, recipeState, origin }`, optionally adding `{ packageId }`.
  `recipeId` and positive `recipeRevision` come from the validated mapping receipt; its states are
  `proposed | approved | executed` (`MappingReceiptSchema`, `ingestion.ts:52`, and service authoring).
  Proposed/approved transitions have no package; executed/read transitions carry the execution package's UUID.
  `origin()` returns `memory | teacher | officer`; null is used only when the whole reference is null.
  The published contract additionally accepts explicit origin/package nulls, as requested.
- `intake-draft-worker.ts:fail` spreads the existing projection, preserving its reference.
  `intake-draft.ts:queueIntakeDraftTx` also preserves `item.plan_ref` on a needs-answer refusal.
  `saveIntakeCardTx` (formerly line 103) only tests reference nullness to preserve item state; it does not write it.
  Registration and archive/sheet child insertion omit the column, so its initial value is null.
  The table constraint accepts any JSON object; no other database/application writer or tabular-path writer was found.
  Unknown shapes therefore publish null through `safeParse`, without throwing or looking up a recipe/package.
  The item tests cover all concrete states/origins, missing package, explicit origin null and unrecognized shapes.
- `intakeItem` is the row-to-wire view. `IntakeService.one` uses it for register, item read and pin responses;
  `IntakeService.manifest` maps it and parses `IntakeManifestSchema`, which embeds `IntakeItemSchema`.
  `ingestion.controller.ts` publishes those three item responses and the manifest response.
  Those are all production consumers found by the schema/view search, besides contract/catalogue registration.
  No current `apps/studio/src/features/intake/**` code parses an intake manifest or `IntakeItemSchema` strictly.
  Its table stream parses its separate event contract. `events.ts:appendIntakeItemTx` selects its own event fields;
  neither that event nor any Studio code was changed.
- `listIntakeTargets` retains its target pagination/filter semantics and case access check.
  One grouped query now supplies the existing case counts plus every package's eight readiness counts and anchor.
  Its sole target creator anchors a package's targets to the drafting item. One metadata statement then reads
  only JSON scalar package fields and review findings by code; it never returns package bodies/features.
  The current-review equality matches `packageDifference`; the findings aggregate follows `findingCountsTx`.
  The first 100 ordered packages are present even on empty/filtered pages; more packages set the truncation flag.
  A protocol test feeds an actual returned entry's three pins unchanged to `packageDifference`, which accepts them.

## Evidence and qualifications

`result.json` holds the measurements and check exits; `runtime.json` retains the full run object, compacted only.
All new fact assertions use HTTP. SQL remains in the inherited harness only for setup, dispatcher/job observation
and existing E1 command/card invariants. No intake-item/target table read supplies the item plan or confirmation pins.
The inherited `overlapIncluded` receipt field names the first chosen HTTP target, not proof of overlap participation.

FX2 refused `Unexpected index bytes: packages/server/src/modules/usp/ingestion/events.ts` before changing any file.
The canonical API checker then refused `API-DOC: runtime receipt changed`. Three historical receipt files have
CRLF working bytes while both their LF/index bytes match their recorded hashes (paths in `result.json`).
A single read-only comparison substituted those proven-identical index bytes for those three receipt reads and
ran the unchanged checker: all remaining manifests, pins, schemas and links pass. No historical file/pin was edited.
