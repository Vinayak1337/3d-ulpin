TASK   E1 — Run from one confirmation to a card            GATE GF1 / M2
WORKS  One confirmation records 1,661 NYC exteriors and cards three listed buildings without another write request.
SEE IT node docs/evidence/gf1/e1/run-runtime.mjs docs/evidence/gf1/e1/new-runtime.json
INPUTS NYC buildings-original.geojson; hydrography.geojson, retained as needs_answer and imported separately as public_land.
GAPS   Retained hydrography cannot draft through the building-only conversion; final machine-inventory checks fail on unrelated CB1 removals.
DESIGN intake-targets.ts and additive SQL hold deterministic readiness, stages and artefacts with transactional target events.
       intake-confirmations.ts and intake-run*.ts use the existing job authority: commit packages, then only listed target jobs.
       intake-run.controller.ts publishes five private routes; retry and opened-first priority retain the same command keys.
       Snapshots, registry, packet and card authorities are unchanged; identity is explicitly not applicable to exteriors.
COMMITS 2046ff12 docs(usp): E1 step 0, what the run must send and as whom
        68addba5 fix(ingestion): a second map file of a bound batch is proposed for its site's area
        726d996a feat(ingestion): intake targets and the rule that says which are ready
        1c3c3968 feat(ingestion): one stored confirmation, and the run that does only what is on it
        26038ecc feat(api): intake targets and confirmations
        38c7dd4f fix(ingestion): preserve the officer's confirmation words
        8ea9a087 fix(ingestion): retry infrastructure request timeouts
        The evidence commit follows this record; see git log staging..HEAD.
CHECKS pnpm typecheck:backend — 0 separately, initially and finally
       Isolated-env named server tests plus intake-run.controller.test.ts — 0, 98 passed
       Isolated-env openapi.ts generation and --check — 0, 310 operations (305 before)
       git diff --check — 0
       Final baseline and control runners — 1 externally / 0 domain child; migrations applied twice without rejection
NEXT   Coordinate the exclusive runtime owner before another box run; give public_land mapping support its own task. E3 can use these routes.

## What was retained or corrected on resume

The existing ledger, stable keys, transactional snapshot storage and job registration were sound and retained. The manifest entry and migration loader call already on disk were kept: the SQL loader requires registration (accepted Step 0). No existing table was changed.

The task wins where the resumed implementation differed: aggregate `intake.targets` events were replaced with one `intake.target` per written row, using a bulk contiguous outbox allocation. The run now checks access binding, confirmation subject/case/expiry and committed package revision; refuses ambiguous citations rather than choosing the first; isolates a refused package from the other named packages; reads the stored card resolver link and verifies that exact revision, including current target, lifecycle and revocation. The identity marker matches D5 exactly. Unlisted recorded targets cannot be prioritized. A final regression fix preserves the officer's acknowledgement verbatim rather than trimming it, so changed input cannot reuse the same key silently. HTTP 408 is classified as an infrastructure timeout for the authority's retry, not a permanent product refusal. The confirmation read includes findings by code from its pinned reviews, or null when those reviews are unavailable. D7's five routes, canonical schemas, published catalogue and HTTP contract checks are added.

Numbers and qualifications are in `result.json`; immutable attempts and their failures are indexed in `attempts.json`. `runtime.json` is the uninterrupted one-press baseline; `controls-runtime.json` separately injects the wrong expected plan-confirmation revision, retries with the same keys, opens that target first and commits hydrography before the third target. Both children pass, including PDF resolver and verification HTTP reads. Neither final outer runner passes whole-machine equality: CB1 removed a different container during each run. All E1 containers were removed by their nonce ownership guard, and volumes/networks were unchanged. Earlier receipts also retain passing whole-machine observations; none substitutes for the failed final safety check.

D6's bound destination and both processor refusals are tested, including real hydrography bytes through the unchanged normalizer with negative reference controls that are never stored. Dropping hydrography in the recorded buildings' case honestly stops at `probed/needs_answer`. `MappingPlanSchema` requires building geometry/key operations (`usp/ingestion.ts:34–42`); `registry.ts` exposes building conversions only and `compileMapping` fixes kind to building (lines 9–14, 70). Making water a building is not an acceptable rehearsal. The smallest prerequisite is public_land target/conversion support in the existing mapping contract and converter; the converter and canonical targets are not owned here. The direct public_land import is used only to measure same-area movement, which left the third selected building carded without re-pinning it.
