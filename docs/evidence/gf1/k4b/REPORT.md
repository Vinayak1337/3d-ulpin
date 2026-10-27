TASK
K4b — source-stated floor and unit without geometry, canonical children and P3 wiring; GF1 / GF-T15.
`E:/Projects/ulpin-wt/k1`, branch `task/k4b-source-spaces`, base `0476489be0bbf36331c5c8880e97ae1d9d359c4d`.
Started 2026-10-10 15:37:03 +05:30. Offline implementation and protocol evidence only; no runtime gate pass.

WORKS
- K4a is accepted by the SQL provenance verifier; no K4b SQL, migration or competing registry authority was added.
- `POST /api/v1/buildings/{buildingId}/source-spaces` records one literal floor and space in existing histories.
  Strict request, matching UUID header/key, configured officer, reason, current canonical digest and original/page/region
  checks; exact replay, changed-key/stale refusals, duplicate floor-space literal 409 and same-source floor reuse.
- Children have real command-allocated UUIDs, positive revision/history, exact same-site parent links, `footprint: []`,
  unknown placement, no geometry/bounds/height/area/use/parcel, empty rights, `test_only`, `synthetic: false`.
- Officer-entered literals/citations project into canonical levels/spaces; no-child output stays unchanged.
  Source children do not derive the schedule or count. Only an exact already-reviewed caption can link a schedule row.
  Tower's G+41/G+42 alternatives/conflict remain unchanged; the recorded literal caption is not a resolved floor token.
- An explicit source-only space selection can capture original-only evidence without pretending extraction succeeded.
  Ordinary site/document snapshots stay extraction-gated. P3 uses the existing review, generator, assignment, audit,
  outbox, replay and snapshot protocol; canonical `proposedCode` reads the exact assigned code including check symbols.
- Source-only P3 requires no anchor and `L?`. Explicit `?` structure/space kinds avoid inferring classification/use;
  `U` still means utility, never unknown. Numeric locator sequences are local display ordinals, not source unit numbers.

SEE IT
- `result.json`, `api-check-final.json`, `visual-evidence.json`, `k4c-source-space-request.json` in this directory.
- K4c housekeeping removed seven intermediate JSON files and the duplicate `refresh-pins.py`; final receipts,
  crop scripts and this historical report are retained. Contract refresh now uses `scripts/api/refresh-contract.ts`.
- External visual evidence: `E:/BhuAayam-data/task-data/k4b/whole-page-offline.png`, `unit-cited-region.png`,
  `level-caption.png`; paths, original binding, regions, pixels, bytes and SHA-256 are in `result.json`.
- `packages/server/src/modules/officer/source-spaces.test.ts`: recording invariants and refusals.
- `packages/server/src/modules/registry/canonical-source-spaces.test.ts`: children, unchanged conflict and no-child output.
- `packages/server/src/modules/usp/source-stated-identity.test.ts`: actual protocol functions, memory SQL only,
  original-backed snapshot → review → random P3 assignment → canonical/resolver read-back, rollback/stale/privacy guards.
- API inventory: 294 operations / 331 schemas. New route is implemented-native, NOT runtime-verified.

INPUTS
Tower 3 `6f95d04e-2067-4ac8-a3c2-6cc21ea46325`, retained site `ed4bc3ae-1b02-412e-a5cc-02accf693a1b`.
Retained original `E:/BhuAayam-data/datasets/rera-storeys/haryana-2831/haryana-2831-tower3-plan1.pdf`:
source `5293cd72-2377-4deb-a51c-c76d11ccb429`, revision 1, 1,655,334 bytes,
SHA-256 `2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865`.
Page 1 displayed frame: 2586 × 1695 pt, top-left origin, no rotation.
The visually checked target is literal `UNIT-3B`, cited region `[206.88,254.25,1241.28,559.35]`.
The separately checked caption is literal `2ND FLOOR PLAN`, region `[850,875,1020,910]`.
Native text search returned neither literal; these are visual officer-transcription candidates, not OCR/evaluation truth.
Whole-page product rendering refused `DOCUMENT_PAGES_RENDER_PROFILE_UNSUPPORTED` because width exceeds the unchanged
2000-point frame bound. One materially different bounded offline visual render succeeded; no product bound changed.
The cited region also contains `UNIT-3A`; it is citation context, NOT a reviewed UNIT-3B-only boundary or component set.
K2/K3b/K4a evidence and retained Magnolia/NYC sources supplied regression controls; no held-out family was read.

GAPS
No demo query/write/migration/start/stop, live registry child, P3 issuance, snapshot capture or card was performed.
A later card can summarize the reviewed source label, exact record revision, citations and assigned application code;
it cannot claim unit boundaries/components, floor ordinal F02, geometry, measured quantities/heights, inferred use,
parcel ULPIN, rights/ownership, legal unit scope, current sanction/as-built status or analytical qualification.
The existing card projection explicitly marks geometry/measurements/render unavailable and rights not assessed.
Unit-only inclusion review is still required: the broad cited crop includes a sibling label and is not card-ready.
The new space has no committed `documentCitations` region binding. Existing PDF packet authority therefore returns
`blocked_required_context / committed_region_binding_unavailable`; a narrow reviewed binding path is a later guard,
not a reason to open generic geometry admission. Plain literal citations and a P3 code alone cannot generate that card.
The generic site snapshot remains deliberately refused for unextracted staged originals; K4c must select the exact space.
Actual `AREA-…` site frames remain unsupported for CityJSON; roof admission stays deferred and no prism is created.
A source-only identity cannot acquire a guessed use or known level through correction; richer evidence needs a separate
reviewed admission/promotion design. Production authentication and superseding officer decisions remain separate work.
Strict API checking still exits 1 on four historical receipt-byte hashes; they were not rewritten or repinned.
GF1 / GF-T15 / P7 are not claimed complete; offline SQL protocol doubles are not real PostgreSQL/runtime evidence.

DESIGN
Separate strict officer command and discriminator `source-stated-space/1`; no change to `registry.ts`, generic
edit/review/commit validation or analytic geometry gates. Existing metadata locks serialize floor/space creation and
reuse existing parent revision/package lineage. P3 allocation remains only in the existing generator and assign path.
Canonical dependencies include recorded children; source revision/hash and child versions are rechecked before return.
Source-only snapshots are limited to explicit recorded-space selections, current same-site floor/building hierarchy
and package-pinned originals. They preserve original authority/privacy without authorizing extraction/conversion.
No candidate/schedule ID becomes a registry identity. Unknown classification gets display-only `?`, not a guessed token.
The locator `NO-ANCHOR / ?01 / L? / ?001` is a technical control example, not an issued identity or source unit number.

COMMITS
- `f1e2d91d` chore(db): allow K4a in the authored SQL verifier
- `9bb55b20` feat(registry): record a source-stated floor and unit without geometry
- `4a953fc9` feat(canonical): recorded floors and spaces in the building record
- `3f23c925` feat(identity): P3 code on a source-only space, exposed as proposedCode
- `e6d85365` fix(identity): preserve unknown source-only locator classifications
- Final documentation commit: `docs(identity): K4b evidence, crops and the K4c request` (see Git).
All worker commits carry the required co-author. Nothing pushed, merged or rebased.

CHECKS
Backend typecheck 0; 40 focused new/existing tests pass; OpenAPI/client regeneration 0; API-client and Studio typechecks 0;
SQL provenance verifier 0; new-line/function style and diff checks pass. No Studio UI source was changed.
Untouched LF archive at `e6d85365`: strict API check 1; diagnostic continuation identifies only the four historical
`runtime receipt changed` failures. This is not a passing checker; no normalization or historical repin occurred.
The earlier `3f23c925` external strict archive is retained; K4c removed its intermediate Git receipt as requested.
Final K4b evidence/docs commit has no separate production changes.
Recovery: new test comparison moved before canonical digest repinning; published-schema test then needed regeneration;
P3 control expected `STALE_REVISION`, not a nonexistent CONFLICT code; test typing corrected. Final controls pass.
Read-only H26 review found that `U` means utility; replaced the control's guessed classification with explicit `?`
and bounded assign/refusal tests. The old intermediate checkpoint is retained, not represented as the final design.
No product mutation was attempted or repeated. Whole-page render refusal was diagnosed before the bounded fallback.

NEXT
K4c only after lead review/integration and explicit runtime/officer approval. Use existing private request helpers;
never print credentials, reset/reseed/start with `--create`, reuse candidate IDs, invent values or repeat successful writes.
1. Migration-if-needed: K4b adds none. Verify accepted K4a manifest/loader state; use only its registered forward step
   if authorized and genuinely missing. Refresh owned native API code without disturbing preserved volumes/services.
2. GET `/api/v1/buildings/6f95d04e-2067-4ac8-a3c2-6cc21ea46325/canonical`; compare the exact current digest and unchanged
   G+41/G+42 conflict. Inspect the retained whole page/crops and officer-approve the literal scope before recording.
   If the digest differs, stop and review changed dependencies; the saved request is not permission to bypass staleness.
3. POST `/api/v1/buildings/6f95d04e-2067-4ac8-a3c2-6cc21ea46325/source-spaces`, JSON exactly as below and in the request
   file, with `Idempotency-Key: d8bff499-c8b3-4b72-993c-9942039961cb`; no query fields. Save the receipt once.
4. POST `/api/v1/usp/snapshots` with `{scopeId:'ed4bc3ae-1b02-412e-a5cc-02accf693a1b',selection:{kind:'targets',
   pins:[{ref:{namespace:'registry_record',id:receipt.spaceId},revision:receipt.spaceRevision}]}}`.
   Use the verified Tower site, the returned real space UUID and revision; no guessed parent or candidate ID.
5. POST `/api/v1/usp/identity/reviews`: operation assign; exact returned snapshot.scope; recordIds [receipt.spaceId];
   expectedVersions {[receipt.spaceId]: 1}; officer reason; evidence exactly
   `{sourceId:'5293cd72-2377-4deb-a51c-c76d11ccb429',revision:1,
   locator:'page 1; region pt [206.88,254.25,1241.28,559.35]; literal UNIT-3B'}`;
   location `{anchorState:'not_supplied',parcels:[],locator:{structureKind:'?',structureNumber:1,levels:['L?'],
   spaceKind:'?',spaceNumber:1}}`. Confirm local display ordinals from the returned registry identifiers before review.
6. POST `/api/v1/usp/identity/assign`: exact snapshot.scope, expectedManifestId=snapshot.id, returned reviewId,
   a fresh command requestKey, recordId=receipt.spaceId and expectedRecordVersion=1. Save the assignment receipt once.
7. GET the canonical building; assert exact assigned code/check symbol on that space, absent geometry and unknown
   dimensions, no parcel/rights inference, unchanged conflict. POST `/api/v1/usp/identity/resolve` with assignment.snapshot
   and the assigned identifier; read back `NO-ANCHOR`, `L?` and unknown kinds. Never use the location as an identity.
Only then separately implement/review the source-only committed-region binding guard and UNIT-3B-only packet/card
scope. Current PDF planning is blocked without that binding; do not generate a card from the broad crop blindly.

Exact K4c source-space body (draft for the cited unchanged digest, not executed):
```json
{
  "requestKey": "d8bff499-c8b3-4b72-993c-9942039961cb",
  "expectedCanonicalRevision": "d42ba09ec8a11411d11ca2cff2a794304824509c80b926181990575d81555981",
  "level": {
    "label": "2ND FLOOR PLAN",
    "evidence": {
      "sourceId": "5293cd72-2377-4deb-a51c-c76d11ccb429",
      "sourceRevision": 1, "page": 1, "region": [850, 875, 1020, 910], "literal": "2ND FLOOR PLAN"
    }
  },
  "space": {
    "label": "UNIT-3B",
    "evidence": {
      "sourceId": "5293cd72-2377-4deb-a51c-c76d11ccb429",
      "sourceRevision": 1, "page": 1,
      "region": [206.88, 254.25, 1241.28, 559.35], "literal": "UNIT-3B"
    }
  },
  "reason": "Officer-cited UNIT-3B / 2ND FLOOR PLAN; source labels only, no geometry or rights; keep G+41/G+42."
}
```
