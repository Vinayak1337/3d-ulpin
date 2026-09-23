# 12 · Explainable spatial findings and a complete review action

Owner **FIND**. Baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`; revised 22 September 2026. Read [00](00-README.md), [01](01-shared-contracts-and-ownership.md), the RIGHTS projection in [16](16-shared-spaces-and-vertical-rights.md) when enabled and UI slots in [99](99-ui-ux-and-integration.md). ER-08/11/12/13/24 are incorporated. New code paths below must be implemented.

## A. User outcome and product value

Allow an officer to inspect a measured parcel/road/vertical-space discrepancy, understand its evidence and uncertainty, then open a saved review case for the actual participants. Identical plan footprints on different floors need not share any positive volume. An easement assertion can provide review context without proving a crossing is lawful. The result is technical screening, never automatic enforcement.

## B. Current implementation and gap analysis

[Registry geometry](../../services/geo/geo/registry.py) already distinguishes contextual parents from competing spaces, checks relationships and queries prisms, but limits calls to 100 volumetric spaces and rejects some hole-bearing intersections. [Area semantics](../../services/geo/geo/area_semantics.py) preserves roles, dates and utility/reference metadata. [Core geometry](../../packages/contracts/src/spatial/core/geometry-schema.ts) supports richer representations than every legacy storage path. [Investigations](../../apps/web/lib/server/officer-investigations.ts) are revisioned but start from a building dossier: a parcel-only case cannot use that API unmodified.

Implement exact manifest-based findings, explicit applicability/coverage, geometry capability qualification and a minimal scoped-case bridge. Reuse existing algorithms/history where compatible; do not label a code-supported risk a reproduced runtime incident.

## C. Scope and non-goals

First release: qualified planar Polygon/MultiPolygon and prism analysis, parcel intersections, recorded-road-land comparisons, explicit containment/membership errors, bounded documentary disagreement and saved scoped review. Hole/component support requires actual persistence→worker→result round-trip tests. Unsupported representations remain retained/displayable with analytical capability unavailable.

No arbitrary triangle-mesh/IFC boolean engine, statutory setback defaults, automatic rights adjudication, false precision from satellite pixels or AI-selected measurements. Enhanced RIGHTS context is optional; absence cannot clear a discrepancy. Local function-level correctness does not establish survey accuracy.

## D. HLD and end-to-end flow

Run checks → pin scope/participants/frames/source/relationship revisions → indexed broad-phase candidate generation → role/reference/applicability tests → deterministic narrow-phase computation → immutable run/results and coverage → exact overlay/evidence → saved scoped case or compatible building investigation → clarification/correction/disposition → rerun with history retained. All accepted worker results use FND fencing and exact input manifest. Partial imports may show provisional findings but never completed coverage prematurely.

## E. Targeted LLD

### Geometry operation contract

FIND exports one qualified operation interface for IMPACT/HISTORY: request `{leftComponents,rightComponents,operation,framePins,methodVersion}`; result `{state:'assessed'|'not_assessed',reasonCode?,intersectionComponents,areaM2:number|null,volumeM3:number|null,contact,methodVersion,inputPins}`. Profiles follow 01; values are null when not meaningful, never invented zero. No access to display meshes as analytical input.

Single-prism overlap: `dz=max(0,min(upperA,upperB)-max(lowerA,lowerB))`; positive volume equals intersection area × dz. Boundary contact is distinct. Preserve holes and multipart rings. Compound spaces retain one semantic identity with separate component refs; divide the combined Z endpoints into slabs and union relevant footprints within each slab before intersection/volume summation. This prevents double-counting overlapping components. Alternatively reject invalid internal overlap explicitly; never compute union-footprint × full vertical extent. Only enable the compound profile after persisted round-trip tests pass; keep legacy mirrors unavailable if they cannot represent it losslessly.

Exact source frame, units, axis meaning and vertical benchmark/transform must be compatible. A visual offset or EPSG number alone is insufficient. Missing height yields planar-only assessment; missing datum prevents 3D comparison. Use existing numerical policy for stable arithmetic, separately reporting supplied positional error bounds. Missing accuracy is uncertainty_unknown; compatible error bounds may support a conservative engineering uncertainty_sensitive flag, not a probability or legal tolerance.

### Rule and rights compatibility table

| Inputs | Deterministic technical outcome |
| --- | --- |
| Two recorded-parcel polygons | Positive area or contact; does not select the correct owner/boundary |
| Structure and recorded road-land polygon | Role-qualified crossing with supplied validity/reference; source road surface/centreline alone cannot establish this test |
| Parent building containing its flat/floor | Context relation, not competing ownership |
| Same XY but separated Z | No positive volume; boundary contact if applicable |
| Positive shared volume, exclusivity unknown | Geometric discrepancy; rights compatibility not_assessed |
| Explicit incompatible exclusive assertions over the same supported extent and overlapping supplied validity | possible_incompatibility requiring review, not ownership verdict |
| Multiple shared-use assertions | Shared use itself is not an exclusive conflict |
| Easement/restriction claim with unresolved extent or validity | Context retained, compatibility not_assessed; never auto-clear geometry |
| Two contradictory extracted facts | Only compare if exact semantic target, quantity/definition and evidence are established; alias similarity is insufficient |

RIGHTS supplies claim/review/authority separately. Accepted technical assertions are not proof of legal validity. PACK receives only independently reviewed applicable context edges; finding participation does not grant blanket document inheritance.

### Findings, case identity and coverage

`FindingRun`: scope/selection/filter, method/rule set, full manifest, expected/received/assessed/skipped counts, missing neighbour dependencies, status. `FindingResult`: run ID, stable case key, participant pins with roles, rule/version, geometry/records/relationship category, assessment state, measurements/units, uncertainty, source pointers, reasons and next action. Keep human disposition separate from immutable computation.

Case key hashes rule family plus semantic participants (sorted for symmetric rules, role-ordered for directional rules). Component IDs belong to result details; do not hash floating-point component geometry into the long-lived case identity. If a component splits/merges and correspondence is uncertain, retain a parent case with new result components rather than silently joining unrelated cases. Result key additionally pins manifest and algorithm version. Deduplicate pairs across chunks for the entire run. Chunk IDs and mesh IDs never identify properties.

Default local qualification workload: D0 ≤30 spaces; existing legacy calls stay ≤100 spaces/2,000 context records. Later 500-exterior scopes use bounded indexed candidate pages and child work ≤5,000 candidate pairs/≤60 seconds under FND budgets, with complete source objects and cross-page dedup. Exceeding a bound returns partial/needs_partition, not no findings. Never remove existing caps without measured qualification. Counts describe loaded/assessed data, not a complete real-world inventory.

### Parcel-only review bridge

FIND owns proposed `ScopedFindingCase {id,version,scope,participantPins,caseKey,resultRefs,legacyInvestigationId:null|string,disposition,notes,evidenceRequests,history}`. Persist `usp_finding_cases` and revisions plus existing `usp_finding_runs/results/case_links`. A compatible building case links through FND to the existing investigation; parcel-only cases remain valid without a building. This is a minimal review envelope reusing audit/notes/request components, not a second full workflow platform.

Dispositions: open → under_review → explained/correction_proposed/resolved. Each update requires expected case version, current result manifest, reason and evidence when asserting explained/resolved. New evidence never rewrites old run/history; a changed result reopens review via a new event. Geometry correction uses existing draft/review commands, not a finding API write to property rows. A prior case can retain its old snapshot while a new run is linked as a follow-up.

Under `/api/v1/usp/findings`: `POST /runs` (scope/rules/guard → 202), `GET /runs/:id`, `GET /runs/:id/results` (manifest cursor), `POST /results/:id/case` (guard/current pins → scoped case), `GET /cases/:id`, `PATCH /cases/:id/disposition` (expected version/reason/evidence). The former proposed building-only `/investigation` action is replaced by `/case`; UI must use this route. FND mounts/authorizes; source/party disclosure is separately checked. READY receives minimal status/coverage, not full dossiers. AI explanations are optional restatements of deterministic facts.

## F. Exact implementation map

| File | Change / owner |
| --- | --- |
| Existing registry/area/core geometry linked in B | Reuse compatible methods; FND alone edits shared entrypoints and representation bridge |
| Proposed `packages/contracts/src/usp/findings.ts` | FIND rule/result/case/coverage/operation schemas |
| Proposed `services/geo/geo/usp_findings.py` | FIND qualified planar/prism/slab operations; no arbitrary mesh authority |
| Proposed `apps/web/lib/server/usp/findings/{rules,service,cases,routes}.ts`, `migrations/12-findings.ts` | FIND run/dedup/scoped-case persistence; FND registration |
| Proposed `apps/web/features/usp/findings/{FindingPanel,FindingEvidence,CheckCoverage,ScopedCasePanel}.tsx` | FIND evidence/action leaves |
| [FindingsTray](../../apps/web/features/officer/block/FindingsTray.tsx), [Issues](../../apps/web/features/officer/register/Issues.tsx), [Investigation](../../apps/web/features/officer/register/Investigation.tsx) | UI mounts compatible panels and exact overlays |
| Proposed `tests/usp-findings.test.ts`, `tests/usp-findings-integration.ts`, `services/geo/tests/test_usp_findings.py`, `tests/e2e/usp-findings.spec.ts` | FIND numeric/persistence/review/permission tests |

## G. UI placement and interaction

Map Checks → result → exact participants/level/intersection → Evidence → Open review case. Parcel-only result opens its parcel-scoped case, not a fabricated building. Full register reuses the same panel. Show measurement, applicable source roles, coverage and next action before details. Loading marks old results stale; empty says no finding among assessed inputs; missing Z stays planar; failures allow bounded retry; denied evidence reveals no private filenames. 99 owns map/camera/mobile/focus. Review state never replaces a visible computational limitation.

## H. Ownership and dependencies

`feat/usp-findings`; own FIND leaves/tests/migration. F0 permits pure cases; F1-feature requires actual geometry, case and job bridges. RIGHTS enrichment can arrive later. INGEST requires this producer only for completed reconciliation, not initial parsing/preview. IMPACT/HISTORY consume the shared qualified operation; they cannot fork it. FND/UI sole owners handle shared code. Real survey/rights qualification is D7, not a prerequisite for D0 implementation.

## I. Implementation sequence

1. Receive D0 independent oracles and preserve baseline regression cases.
2. Implement exact role/reference/profile tests and single-prism operations; qualify richer component round trips before enabling them.
3. Persist manifest-pinned runs with complete pair dedup/coverage and fenced completion.
4. Complete two-parcel/no-building result → evidence → scoped review → reload.
5. Link compatible existing building investigations through FND without replacing old snapshots.
6. Mount UI; connect READY/INGEST/IMPACT consumers and optional RIGHTS context; then measure larger D3 workloads.

## J. Test data and verification

**Before coding:** D0 from [00](00-README.md). O-01 must yield 10 m²/20 m³; O-02 zero positive volume; O-03 courtyard area 96 m² (1e-6 fixture tolerance, not survey accuracy). Include negative basement levels, mezzanine, unequal levels, multiple buildings per parcel, one building across two parcels, holes/multipart and duplex components with an empty intermediate region. Verify complete persistence→worker→API round trips or a lossless retained/explicit unsupported result; a pure core test alone does not qualify legacy storage.

**After implementation:** use [existing Delhi/OSM inputs](../GOOGLE_UTTAM_NAGAR.md) for source-role/partial-coverage testing. An OSM centreline with no recorded width must not pass a road-land encroachment test. Actual local boundary conclusions require D7 matched survey data via [NAKSHA](https://dolr.gov.in/en/about-naksha/) or [Delhi records](https://dlrc.delhi.gov.in/) and an approved custodian sample. No complete crosswalk is assumed; use D0 while that external gate remains unmet.

Test unknown accuracy, incompatible datum, missing heights, same label/different building, valid shared use, unresolved easement, contradictory exclusive assertion, stale case link, two concurrent reviewers, duplicate cross-chunk pair, late result, unavailable RIGHTS and parcel-only saved review. Source and relationship updates with unchanged property revision must invalidate old results. Inspect actual selected IDs and saved case history, not merely red pixels.

Run `pnpm typecheck`, `pnpm test:registry`, `pnpm test:area`, `pnpm test:register-scope`; `python -m pytest services/geo/tests/test_registry.py services/geo/tests/test_usp_findings.py`; `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-findings.test.ts`; `pnpm exec tsx tests/usp-findings-integration.ts`; `pnpm exec playwright test tests/e2e/usp-findings.spec.ts`. Return numeric expected/actual values, source/manifest/case receipts, coverage and V4 evidence; no real-world accuracy claim from synthetic oracles.

## K. Copy-paste assignment

> Implement FIND from 00, 01 and this file on feat/usp-findings. Obtain D0 numeric fixtures; build qualified role-aware planar/prism checks, exact run coverage/dedup and the minimal scoped-case action including two parcels with no building. Preserve existing investigations via FND bridges, identities and source history. Qualify holes/components through actual storage before enabling analysis; never fill courtyards or construct a duplex envelope. Use the rights table, unknown states and explicit D7 real-data gate. UI/FND own shared mounts/hooks. Complete J real-service numeric, stale/retry and saved-review tests and return commits/receipts/screenshots. No legal verdict, duplicate geometry service, guessed survey evidence or main merge without authorization.
