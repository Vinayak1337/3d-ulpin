# AD3 step 0 — every reader of `GET /api/v1/areas/{areaId}/context`

The fields AD3 removes from the answer: `features` (top level; `displayFeatures` stays), per feature
`sourceGeometry`, `geographicGeometry`, `sourceReference`, and every `packages[]` field but `id`, `state`,
`quarantine` (its `message`, `sourceSha256`). `displayFeatures` holds every recorded feature plus the area's
uncommitted proposals (marked `displayState: 'unrecorded_proposal'`), so a reader that wants recorded features
reads it by id or skips the marked ones. Found with `rg 'areas/.*context|/context'` over code files.

## Not readers of this route

| Reader | Why |
|---|---|
| `apps/web/**` (`ProductHeader.tsx:24`, `useBlock.ts:18`, `BlockHome.tsx:23`, `RegisterPage.tsx:70`, `RegisterStart.tsx:41`, `PropertyScene.tsx:32`, `SpatialExtractionPanel.tsx:127`, `AddFiles.tsx:103`, `useWorkspace.ts:50`) | the frozen app calls its own Next route `apps/web/app/api/v1/[...path]` → `area-routes.ts:88` → `areaContext()`, not the Nest route; unchanged |
| `scripts/golden-journey/{govern,identity-card,run,story}.ts` | `./context` is the journey's own reader context; the area read is `/areas/{areaId}/canonical` (`context.ts:12`) |
| server callers of `areaContext()` (`scripts/verify-area.ts`, `verify-block-membership.ts`, `usp/data/import-d1.ts`, `usp/document-package-authority-proof.ts`, `tests/ai-extraction/integration.ts`, `docs/evidence/gf1/ad1/server-timing.ts`) | call the domain function, which keeps the full context (D1) |
| `apps/studio/src/local/**` | the context route is `mode: 'live'` (`routes.ts:121`); no local handler serves it. `sources.ts:31` `derivedContexts` is read only by `contract.test.ts:25-28`, which validates it against the published answer: reshaped by the same projection (D7) |

## Readers, and what each reads

| Reader | Fields read | Reads a removed field |
|---|---|---|
| Studio `map/MapWorkspace.tsx:63,67,91-101,103-104,120-121,163-164,210,351` | `displayFeatures ?? features`; `packages[].id/state/quarantine` | **yes**, the `features` fallback → `displayFeatures` |
| Studio `register/RegisterPage.tsx:105` | `displayFeatures ?? features` | **yes**, fallback → `displayFeatures` |
| Studio `register/RequestsPage.tsx:254` | `(displayFeatures ?? features)` building kinds | **yes**, fallback → `displayFeatures` |
| Studio `review/WorkspacePage.tsx:340` | `displayFeatures ?? features` | **yes**, fallback → `displayFeatures` |
| Studio `review/candidates/CandidateReviewPage.tsx:46,63,68` | `area` | no |
| Studio `api/queries.ts:12` `AreaFeature = AreaContext['features'][number]` | type of a feature | **yes**, typed from `displayFeatures` |
| Studio `api/demo-import.ts:102-108` | writes the cache from the demo stream: `displayFeatures`, `packages` | no |
| `scripts/demo-import/plugin.mjs:85,216` | serves a stand-in answer in demo mode with `features: []` | writes it; `features: []` dropped |
| `scripts/db/serving-nyc-import.ts:89-90` | `packages[].id` | no |
| `scripts/ml/verify-workflow.ts:209,274-276` | `area.revision`; `features[].id/height/worldStatus/geometry` | **yes**, `features` → `displayFeatures` |
| `scripts/uttam-nagar/import-osm-reference.mjs:33,48-56` | `area.revision/siteId`; `features[].kind/worldStatus/height`; writes the answer to a runtime file | **yes**, `features` → `displayFeatures` |
| `scripts/ux/verify-source-workflow.ts:17,20,36` | `area.revision`; `features[].id` | **yes**, → `displayFeatures` |
| `scripts/ux/verify-complete-journey.mjs:15,27` | `features[].id/geometry/identifier/sourceRevisionId/height` | **yes**, → `displayFeatures` |
| `scripts/ux/verify-hierarchy.mjs:19-20` | `features[].kind/id` | **yes**, → `displayFeatures` |
| `scripts/verify-officer-restart.ts:20,26,50-59` | `features[].id/identifier/revision/sourceRevisionId/geometry` | **yes**, → `displayFeatures` |
| `scripts/verify-officer.ts:544` | `latestCheck.stale` | no |
| `scripts/spatial/studio-saved-verify.mjs:22-23,54,134` | `features[].kind/id`; the whole answer before/after | **yes**, → `displayFeatures` |
| `scripts/spatial/uttam-display-verify.mjs:67-89,163-164` | `area.id`; `features[].kind/worldStatus/sourceRevisionId`; digest of the answer | **yes**, → `displayFeatures` |
| `scripts/usp/real-source-smoke.mjs:226-228` | `packages[].id/sourceRevisionIds/features[0].id` | **yes**: the same facts are read from `/import-packages/{id}` at `:218-224`; the area read now asserts the listed package's `state` |
| `scripts/usp/manual-mapping-smoke.mjs:106` | `packages[].id` | no |
| `scripts/usp/manual-mapping-lock-order.ts:53` | `area` | no |
| `tests/e2e/usp-product-journey.spec.ts:149-152` | `features[].id` | **yes**, → `displayFeatures` |
| `tests/e2e/usp-studio-frame.spec.ts:60,80,224,228` | `features[].id`; `packages[0].name` | **yes**: `displayFeatures`; the name is read from `/import-packages/{id}` |

## Evidence harnesses of finished gates (`docs/evidence/**`)

Records of earlier gates; their results are recorded and they are not re-run by any current gate. They are
listed, not changed; a rerun of a harness marked "yes" needs the canonical area route or `areaContext()`.

| Harness | Fields read | Reads a removed field |
|---|---|---|
| `gf-backend/k2/context-through-api.ts:27` | `area` | no |
| `gf-backend/k2/install-through-api.ts:71,93` | `area`; `features[0].id` | yes (`features`) |
| `gf-backend/k2c/roofprint-through-api.ts:33` | typed `AreaContext`, `area` | no |
| `gf-backend/k2c/verify-canonical.ts:97-99` | `features.length`, `displayFeatures.length` | yes (`features`) |
| `runtime/reh1/{journey.ts:51,part-c.ts:60}` | `area` | no |
| `gf1/zb1/area-read.ts:10-19` | the published schema equals `areaContext`; `features[].revision` | yes (`features`, schema) |
| `gf1/cr1/steps.ts:120-169` | `areaContext.parse`; `features[].geographicGeometry/sourceGeometry` | yes |
| `gf1/gn1/steps.ts:207-302` | `areaContext` schema; `features[].geographicGeometry/sourceGeometry` | yes |
| `gf5/m1/capture.mjs:46,86` | whole answer as bytes; a mock `{"features":[]}` | no field read |
| `gf5/lv1/lv2-callers.mjs:26` | serves a stand-in answer to a caller | no field read |
| `gf5/h8/capture.mjs:35,40` | prose naming `features[].identifier` | no field read |
