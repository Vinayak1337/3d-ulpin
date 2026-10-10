# K2 return — 10 October 2026

## TASK

K2 from actual `staging@59689fee`, branch `task/k2-demo-import`, worktree `E:/Projects/ulpin-wt/k1`.
Deliver source-only demo buildings through existing APIs, preserving K1 citations, unknowns and safeguards.
Partial runtime delivery, **not** a complete GF-BACKEND/GF-DATA/GF-SCENE gate pass. See [result.json](result.json).

## WORKS

- Tower 3 is committed: building `6f95d04e-2067-4ac8-a3c2-6cc21ea46325`, GMDA area
  `ed4bc3ae-1b02-412e-a5cc-02accf693a1b`. Four unchanged PDFs retained. `G+41` and `G+42` remain separately
  cited alternatives; headline count/label stay null/conflicting. Footprint, placement, base, height and detailed
  levels remain unknown. “Reviewed” is local source-only acceptance, not analytical/statutory approval.
- Bihar Magnolia is committed: building `e8777ffc-9409-4129-bacf-f680160d8795`, area
  `e5742536-cedd-455b-b59d-c8172875c6f2`. Its layout is attached; local frame remains unplaced. No villa/unit
  schedule, footprint, elevation, height, rights or parcel assertion was inferred.
- GMDA sectors `63 A` / `59` are existing administrative-unit memberships with separately cited ENU candidate
  boundary context. Zero physical features created by that package. Native FIDs are citation feature IDs, not
  administrative/parcel codes; native `Area=0` is not a measured area. Two road proposals retain unknown widths.
- Existing English/layout OCR paths and new private scratch are validated through `demo-config`; doctor reports
  Hindi unavailable. No credentials, runner, model assets, originals, deadlines or supervision were changed.
- Demo remains healthy/running. Only owned API/dispatcher were restarted, finishing at **04:19:14**, **04:22:28**
  and **04:49:56 IST**. Containers/volumes preserved. Served backend code was `c90a8a3e` at the third restart;
  later changes are evidence plus a launcher-only file/directory-kind check, not API runtime code.

## SEE IT

```sh
curl http://127.0.0.1:3194/api/v1/buildings/6f95d04e-2067-4ac8-a3c2-6cc21ea46325/canonical
curl http://127.0.0.1:3194/api/v1/buildings/e8777ffc-9409-4129-bacf-f680160d8795/canonical
curl http://127.0.0.1:3194/api/v1/areas/ed4bc3ae-1b02-412e-a5cc-02accf693a1b/canonical
```

Responses: [Tower](tower3-canonical.json), [Magnolia](magnolia-canonical.json),
[sector context](gmda-context-area-canonical.json). Current quoted ETags/exact-current reads return 200;
unsupported historical revision 404; genuine cross-site read 403. Unknown-footprint buildings yield no scene
footprints; they are not placed at the area anchor. The frame is an area frame, not a building-position assertion.

## INPUTS

Assigned development/demo sources only; no holdout family opened or teacher called. Tower original site plan
SHA `26c2d3101bfe676c8ac66f129439e066b603a555b3c55a35ba509befb707fad9`; Magnolia layout
SHA `f8a55dc251facb1d0442e9a306db218356082f5d34a2c5071e9b0db64abb60b3`; GMDA native sectors
SHA `733d8e9404290a0f0bc0d2889dd1a72d68b9cb8a3c06d9b13943fd3d5870bff8`.
Nine assigned original inputs are unchanged: [integrity evidence](original-integrity.json). Six newly bound
originals (four Tower PDFs, one Magnolia PDF, one sector JSON) were downloaded through the product and hash-checked.
Source permission remains unconfirmed and classification `test_only`; no acquisition/catalogue changes were needed.
NYC stays foreign development data in its separate area.

## GAPS

- Whole-page OCR: `OCR_UNSUPPORTED_PDF_PAGE_FRAME` (2585 × 3390 points; supported side <=2000). One bounded
  supported-region comparison failed `OCR_UNEXPECTED_WORKER_ERROR`, worker exit 1 after 18.407 s, peak private
  bytes 461,058,048, no deadline/memory termination. **No result lines.** Underlying exception is unknown because
  the accepted bridge cleans attempt traces. See [bounded comparison](ocr-comparison.md); no further retry/sweep.
- Hindi trained data absent; nothing downloaded. Earlier native jobs made stale by multi-source case revision
  changes are recorded as stale, never claimed accepted extracted facts.
- Geometry-bearing review/prepare still returns `USP_GEOMETRY_PAYLOAD_UNQUALIFIED` before persisting review.
  The later commit `STALE_REVISION` is consequential; no independent revision defect/regression was asserted.
  [Live unchanged-package checks](geometry-safeguards.json), [diagnosis](admission-diagnosis.md).
- No supported import-package withdraw/reject endpoint exists in the published inventory. All 62 NYC proposals
  remain unchanged/uncommitted, reason **“development test import, not demo content”**: [disposition](nyc-cleanup.json).
- Scene rendering of administrative context/candidate hatching, source-only correction contracts, and complete
  retained historical projections remain separate owner work. No invented geometry was added to unblock them.

## DESIGN

One existing multipart import route: `format=document_buildings` or `administrative_context`, strict JSON
`metadata`, hash-pinned unchanged originals. Request types live in assigned `canonical/building.ts`; the temporary
standalone helper was removed. Reuse document intake, source authority, import packages, registry identities,
revision history and administrative memberships; no migration, new store, seed or parallel importer.
Original-only authority fixes the runtime-found staged-extraction dependency for explicit human transcriptions;
parts/OCR/model outputs are not admitted as facts. Source cases are protected before recording/package/area locks.
Geometry mode remains qualification-gated. Administrative polygons have their own role and `not_assessed`
eligibility, never parcel/public-land typing. Generic GIS edits of source-only packages fail explicitly.
Local operator attribution is not production human authentication. No protected UI/scene/database/model-gateway
or A1/A2 producer code was edited; only genuine producer changes were reviewed for catalogue pins.

## COMMITS

- `f25b5e61` — reviewed D3/K1/D1b/A1/A2 catalogue and generated client/pins.
- `dbc18425` — existing-route geometry-free admission and source-only record path.
- `0b56b692` — original authority regression fix, cited conflicts, administrative context, schema folding.
- `16493a80` — API-installed Tower/Magnolia checkpoint evidence.
- `c90a8a3e` — OCR path wiring and bounded failure receipts.
- Final evidence checkpoint records sector commit, live verification, unchanged NYC disposition and this return.
Every worker commit has the required co-author trailer. No merge/rebase/push; integration remains with the lead.

## CHECKS

| Check | Exit | Result |
| --- | ---: | --- |
| `pnpm typecheck:backend` | 0 | server + API |
| Focused source admission/controller/manual-ingestion tests | 0 | 9 passed, 0 skipped |
| Canonical runtime (`verify-canonical.ts`) | 0 | live buildings, conflicts, hashes, roles, HTTP codes, GIS guards |
| LF archive (`check-lf-export.py`) | 0 | 290 operations, 323 schemas, 34 reviewed producers |
| `pnpm platform:doctor --profile demo` | 0 | health/ownership/path availability; not OCR execution proof |
| `git diff --check` + new helper line lengths | 0 | clean; no new code lines >120 |

Reproduce those task checks with:
```sh
pnpm exec tsx docs/evidence/gf-backend/k2/verify-canonical.ts
python docs/evidence/gf-backend/k2/check-lf-export.py
```

LF export preserves exact historical receipt hashes, without editing checkout receipts or `check.py`.
An intermediate export found an uncommitted evidence link; committing the receipt resolved it. The live harness
initially expected `no-store` for original downloads; existing original transport is `private,max-age=60`.
The harness now tests its actual private contract; canonical routes still require `private,no-store`.
Test-generated K1 example changes were restored. No `.env`/secret access, volume reset/removal, original rewrite,
public activation or change to another Docker project. External command logs: `E:/BhuAayam-data/task-data/k2/`.

## NEXT

Lead reviews/integrates the return. OCR-runner owner first supplies a **sanitized retained exception/dependency
trace**, under the existing bounds and private scratch policy, before one new bounded comparison. Do not guess
its cause, keep rerunning, weaken limits or download Hindi/model assets. Scene owner can consume the explicit
administrative layer without parcel classification. Separate owner tasks must reconcile geometry-bearing fresh
admission/analytical qualification and add source-only correction semantics before such inputs can progress.
