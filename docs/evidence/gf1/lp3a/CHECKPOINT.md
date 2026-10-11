# LP3a checkpoint — independent import/parts delivered; automatic intake blocked

Branch: `task/lp3a-large-file-to-packages`. Base: `92b4d921`.
Do not recreate the branch, merge, rebase or push. The lead integrates.

## Whole and proved

- Step 0: `7968dffa`; whole Niagara/Halifax pure-reader measurements and code-path audit.
- P7: `32a7cd10`, with the `a49182f9` receipt-key correction.
  Server seal writes `inspection.streamedMapReceipt` only after exact EOF, original hash/size and
  ordered manifest/count checks. Do **not** call this `streamedMapOriginal`: intake-context treats
  every `*Original` member as another protected original and rejects an unregistered authority.
  Large eligibility additionally requires the exact source ID/revision/bytes/upload hash and degree reference.
  The owned receipt writer refuses projected large GeoJSON with 422 `STREAMING_SOURCE_CRS`:
  “The large GeoJSON reader supports longitude/latitude CRS84 only; its declared system is unsupported.”
  This refusal is at seal, not evidence of an HTTP Niagara walk.
- P3/P4: `9b2b1e90`; bounded accumulator/cuts and `ingestProvedAreaPart` reuse extracted normalization
  and persistence from `ingestArea`. Original collection metadata, including CRS, is retained in the receipt.
  Raw bytes are checked against the existing raw slot's hash, strictly parsed with the same reader and
  paired with its decoded Feature before import. LP2 global ranges survive normalization/quarantine.
- Independent P5 and draft admission: `a3bcf108`.
  `draftIntakePartTx` proves sealed raw/mapping/key closure and observed records, excludes both duplicate
  positions, enforces eight unfinished drafts under admission locks, imports the package, publishes one
  `usp_intake_parts` row and creates its targets in the same transaction. Parts update counts; large
  `plan.packageId` stays null. Target package summaries and confirmation membership accept published parts
  as the additive second association. No review/commit authority changed.
- Latest PostgreSQL proof: `parts-checkpoint-final.json`. 1,661 accepted NYC features match bounded ingest;
  quarantine index 1322 matches; one original source, one intake part, 1,661 preparing targets; package listed
  from its part despite null plan; replay writes zero SQL. Only allocated identifiers/times are excluded,
  including height evidence source IDs. Original bytes/hash unchanged. All nonce-owned boxes removed.
- Backend typecheck passes. 268 named ingestion/area/intake-run/packet tests plus four range tests pass.
  API generation, pin refresh, generator check, Python API check and diff check pass.
- DA6 whole-file pure reader/cutter: 48,686 records, 43,263,076 bytes, 487 count-based raw parts,
  25 cuts, 6.033 seconds, peak RSS 435,232 KiB. No topology/approval/import claim.

## Not whole / not built

No orchestration worker, new job registration or automatic reader/profile/mapping chain exists yet.
No new automatic route was activated. No package queue refill, held-target projection of duplicate positions,
partial-reader failure holding, restart/replay walk or three-card HTTP walk is claimed.
The safe internal door waits for sealed raw/profile/mapping; it does not draft incremental prefixes.
Pressure admission is proved, not a dispatcher/refill integration proof.
The declared serialized-input ceiling is 20 MiB; cuts use a conservative Python ensure_ascii/number-spelling
upper envelope, not a Python formatter or reserialized original hash.

## Owned-path stop rule (c): exact outside changes needed

1. **Upload never enrolls intake:** `packages/server/src/modules/usp/ingestion/large-original.ts:265-274`
   (v1) and `:436-444` (v2) publish the original and return/clean up without registering/probing an item.
   This file is outside the owned list. Smallest functional hook: after retained publication, enroll a
   durable, stable-key intake/probe operation for `fresh.source_id`; its worker invokes the existing
   `IntakeService.register(caseId, {sourceId, requestKey})`. Prefer transactional job enrollment plus
   restart recovery, rather than an untracked post-commit call. Without this, no request after finalize
   cannot be met. Do not hide it by having the harness send a register request.
2. **Incremental readiness, if required:** `intake-targets.ts:92-99` uses package review alone.
   Only `countsTx` is owned. Incremental drafts require a file gate in `prepareIntakeTargetsTx` before
   readiness is projected, plus exact duplicate/reader-failure holds. The sealed-only door needs no
   premature readiness exception, but held-target UI for records excluded from packages remains undecided.
3. **Reader fingerprint inventory:** `streaming-vector.ts:22-33` does not include new
   `streamed-map-receipt.ts` in `readerFiles`. Add it so later seal-policy edits invalidate old job pins.
   `streaming-vector.ts` is not owned. Current changed worker/contracts are pinned, but transitive helper
   changes must not silently escape the reader fingerprint.
4. **Profile CRS projection:** `streamed-profile-worker.ts:65,95` reads GIS metadata only for manual
   sources, not the large sealed receipt. It is outside scope. Proved import already supplies actual
   retained collection metadata to the existing normalizer, so this does not block the independent door.

## Next three steps

1. Lead reviews/imports the completed commits and assigns the finalize enrollment hook/fingerprint seam
   (and readiness seam if incremental packages are wanted). Regenerate pins after integration.
2. Build the owned large branch in `intake-draft.ts`, durable orchestration and part workers, register them
   in `jobs.ts`/`processing.ts`, use the base `intakeDestination` unchanged, follow approval automatically,
   store deterministic cuts/counts and refill up to eight unfinished drafts. Persist duplicate/failure holds.
   Bounded and streamed fingerprints differ; wait for this file's own answer, never bridge by guess.
3. Walk the **DA6 CRS84 original** over HTTP only, then Niagara up to `STREAMING_SOURCE_CRS`, with own
   disposable resources. Record three verified range-backed cards and restart during drafting.
   CR1/DA6 are read-only on `staging`; do not merge them here.

## Evidence commands

- `node docs/evidence/gf1/lp3a/check.mjs` — checks saved proof, not a new runtime gate.
- `node docs/evidence/gf1/lp3a/run-equivalence.mjs <new-receipt.json>` — isolated PostgreSQL internal proof.
- Preload for tests: `NODE_OPTIONS=--require=./scripts/platform/isolated-env.cjs ULPIN_PROFILE=demo REPO_DATA=false`
  with `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test <files>`.

No background command or owned container remains running. No credentials, original datasets or other checkouts changed.
