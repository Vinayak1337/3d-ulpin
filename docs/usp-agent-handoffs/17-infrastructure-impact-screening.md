# 17 · Saved infrastructure impact screening

Owner **IMPACT**. Baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`; revised 22 September 2026. Read [00](00-README.md), [01](01-shared-contracts-and-ownership.md), the qualified operation in [12](12-rights-aware-spatial-findings.md) and [99](99-ui-ux-and-integration.md). ER-08/11/24 are incorporated. New paths are implementation tasks.

## A. User outcome and product value

Allow a scoped officer/engineer to save a proposed excavation or elevated-work envelope, identify potentially affected mapped spaces and inspect their evidence and assessment gaps. A trench can intersect a basement while passing below a flat. This is planning screening against supplied data, not permission, structural analysis or a safe-to-excavate certificate.

## B. Current implementation and gap analysis

[SpatialInquiry](../../apps/web/features/officer/register/SpatialInquiry.tsx) already supports point stacks and a numeric excavation rectangle. [Registry service](../../apps/web/lib/server/registry.ts) and [Python query](../../services/geo/geo/registry.py) provide bounded prism queries, limited to 100 spaces and some hole restrictions. [Area semantics](../../services/geo/geo/area_semantics.py) retains utility profile metadata. Preserve these mechanisms.

Implement saved proposal revisions, exact run manifests/coverage, qualified geometry adaptation, map input and usable report/evidence actions. Do not assume utility metadata guarantees a working general-solid collision operation.

## C. Scope and non-goals

IMPACT0: saved point-stack or polygon+vertical-interval proposal against qualified planar/prism records, real result persistence, source links and report. Geometry is provided by FIND, not duplicated. Unsupported utilities still appear as assessment gaps. IMPACT1 utility-solid calculations require separately qualified profile conversion and source depth/dimension/reference evidence; do not delay IMPACT0 on them or label them implemented when absent.

**GF3 finale path:** promote this existing IMPACT0 service and UI into the demonstration and [GF-T20 matrix](28-data-acquisition-and-finale-tests.md). There is no separate dig-screen engine. GF2's optional closed-solid qualification in [H27](27-domain-ai-and-cadastral-checks.md) may extend FIND's operation later; IMPACT consumes only profiles that actually pass it.

No route optimization, automatic permissions, legal compensation, emergency advice, mesh boolean engine or cross-site datum federation. Numeric form remains an accessible alternative to drawing. Proposed geometry is hypothetical/planned, not an observed survey.

## D. HLD and end-to-end flow

Map tool → enter/draw proposed extent → confirm frame/reference and study scope → save proposal revision → request run against exact source manifest → qualified candidate/geometry evaluation → persisted result and coverage → select affected space/source → report or request missing evidence. Editing the proposal or a source does not rewrite old runs; it marks current applicability stale and offers a new run.

## E. Targeted LLD

`ImpactProposal` stores ID/version, actor, title/purpose, SnapshotScope for assessed records, frame/reference pins, proposed classification, assumption/source pointers and geometry union: `{mode:'point_stack',xy}` or `{mode:'volume',footprint,lower,upper}`. Point-stack returns the vertical records at XY and does not claim a single 3D point collision. Volume validates finite coordinates, supported topology, lower<upper, units and exact vertical reference. Depth below ground requires the applicable ground reference; no arbitrary datum zero.

`ImpactRun` pins proposal version, record/geometry/source/relationship/transform manifest, method version, candidate set and coverage. Results distinguish positive_intersection, boundary_contact, potential_interaction_uncertain, not_intersecting_assessed and not_assessed. Area/volume are nullable by applicability. Use FIND's operation and component slab semantics; no display-only geometry, filled courtyard or duplex envelope. Return supported intersection component refs and source pointers for exact selection.

| Input | Initial capability |
| --- | --- |
| Simple valid prism in compatible local frame | Qualified positive volume/contact after FIND round-trip tests |
| Polygon without Z | Planar context/possible interaction; not assessed for volumetric intersection |
| Hole/multipart or compound unit | Only after FND/FIND persistence and operation qualification; otherwise retained with explicit unsupported result |
| Utility centreline missing depth/section | Visible assessment gap, not zero impact |
| Complete surveyed/planned utility profile | Retain source meaning; enable numerical solid test only after profile adapter validation |
| Textured mesh/unsupported solid | Context display only, no exact collision or clearance |

Utility qualification requires level meaning, benchmark, cross-section, dimensions, interpolation and source/ground reference as needed. No guessed radius/buffer or assumed legal clearance. User-entered clearance remains a labelled scenario parameter. A proposed service drawing is not an as-built location.

Store the source's horizontal and vertical uncertainty separately, with investigated segment/point coverage and date. Utility quality levels A–D describe evidence/investigation quality; they are not universal metre buffers or an automatic collision offset. One exposed quality-A point does not qualify an entire corridor. Absolute depth/elevation is displayed only after qualified ground/vertical-reference conversion; otherwise show source-relative depth or unknown. Unknown depth, an unmapped strip and incomplete inventory stay `not_assessed`, never “safe to dig.” The report is an affected-space screening result, not an official Call Before u Dig notification/submission.

Default D0 ≤30 spaces; legacy requests remain ≤100 spaces. Larger scope uses FIND's bounded indexed candidate pages and fenced child jobs ≤60 seconds; all candidate pairs/results deduplicate across pages. Do not raise legacy limits globally. Coverage stores loaded selection, known inventory completeness evidence (or unknown), assessed count, skipped reasons and required dependencies. Full assessment of loaded records is not full real-world inventory. Hidden assets produce only policy-approved incomplete-scope wording, not identifying coordinates/counts or an all-clear.

Tables: `usp_impact_proposals`, `usp_impact_runs` with immutable input/result references. Prefix `/api/v1/usp/impact`: POST proposals(create guard), PATCH proposals/:id(update guard), POST proposals/:id/runs(exact proposal version + manifest + guard → 202), GET runs/:id, GET runs/:id/results(cursor), GET runs/:id/report. Guard and access behavior follows 01. Report is an escaped summary with exact manifest/proposal/limitations and authorized source links; it need not wait for PACK extraction. A separately requested packet uses PACK's independent access/release rules.

Require scope.assess and current resource grants for execution/result/report. Sharing is explicit; no public defaults. Worker completion revalidates attempt/input pins. Revocation cannot be bypassed through saved report or result cache. RIGHTS may add affected access/shared-use endpoints with explicit partial coverage; absent RIGHTS is not no affected rights. Deterministic templates suffice; AI cannot invent measurements or select a safe route.

## F. Exact implementation map

| File | Change / owner |
| --- | --- |
| Existing query/geometry/utility helpers linked in B | FND wrapper, FIND qualified operation; IMPACT read-only consumer |
| Proposed `packages/contracts/src/usp/impact.ts` | IMPACT proposal/run/coverage/response schemas |
| Proposed `apps/web/lib/server/usp/impact/{proposals,screen,report,routes}.ts`, `migrations/17-impact.ts` | IMPACT saved runs, exact manifests, report and leaf API |
| Proposed `services/geo/geo/usp_impact.py` | IMPACT envelope/profile adaptation calling FIND operations; FND registers |
| Proposed `apps/web/features/usp/impact/{ImpactEditor,ImpactResults,ImpactCoverage}.tsx` | IMPACT numeric/drawing-result leaves |
| Existing SpatialInquiry, [BlockPage](../../apps/web/features/officer/block/BlockPage.tsx) and shared map | UI owns drawing/overlay/selection mount |
| Proposed `tests/usp-impact.test.ts`, `tests/usp-impact-integration.ts`, `services/geo/tests/test_usp_impact.py`, `tests/e2e/usp-impact.spec.ts` | IMPACT numeric, persistence, permission and report tests |

## G. UI placement and interaction

Area map tools → Assess proposed work → Point stack / Volume → draw or enter numbers → Screen mapped records. Show reference/assumptions and coverage beside results. Click basement → isolate actual level and open its source in existing drawer. Loading retains pinned proposal; empty says no intersection among assessed records plus inventory limitation; missing depth/reference is conspicuous; error preserves edit; denied resources do not leak; success names proposal/manifests. No green all-clear. UI owns camera/focus/mobile/numeric alternative, IMPACT panel content.

## H. Ownership and dependencies

Use `feat/usp-impact`; own IMPACT leaves/migration/tests only. F0 schemas allow pure work, F1/FIND qualified operation required for actual numerical screening. RIGHTS optional with unknown outcome. PACK optional for extracts, not basic report. FND owns shared query/jobs/storage; UI drawing/map; DATA fixtures. Do not implement another geometry service to bypass missing FIND.

## I. Implementation sequence

1. Obtain D0 exact trench/upper-floor/utility-gap oracle; wrap existing numeric inquiry.
2. Save proposal/run manifests and report before adding drawing UI.
3. Consume qualified FIND operations and explicit unsupported profile results.
4. Mount drawing and results through UI, keeping numeric input and same selected IDs.
5. Test save/edit/rerun/history/revocation and source-request action.
6. Attempt permitted real planned/surveyed utility evidence only after IMPACT0 passes; qualify IMPACT1 separately.

## J. Data, expected outputs and verification

**D0 before/after:** trench touches a boundary, intersects a basement, passes below a first-floor flat and crosses a utility with unknown depth. These yield contact, positive volume, nonintersection among assessed geometry and not_assessed respectively. Repeat with elevated work. Use O-01 10 m²/20 m³ and O-02 zero positive volume from H28. One input/record edit creates a new run; old report must retain old source manifest. Source-only lines cannot receive guessed depth.

**D5 planned utility after completion:** [RERA project 2079](https://haryanarera.gov.in/view_project/project_preview_open/2079) lists service drawings; acquire only a small matching allowed plan/section, inspect dimensions/reference/date and label planned. Prior catalogue verification did not acquire those drawings. **D7 real underground qualification (dataset policy, 24 September 2026):** request the relevant asset custodian's profile/as-built and control metadata for any selected pilot area through [90](90-required-human-tasks.md); no locality-specific utility inventory is required or presumed. While unavailable, D0 and geography-independent map/load tests proceed; only the corresponding real-impact claim remains unqualified.

**GF-T20 oracle:** one proposal crosses a supported basement prism and a separately unsupported utility corridor with an unmapped segment; add a single quality-A exposure, a quality-D segment, unknown depth and a changed source revision. Expected result lists the affected assessed spaces, contact/nonintersection separately, null utility collision where reference/extent is unsupported, exact investigated coverage and stale old-run status after the revision. Report relative depth unless a qualified absolute conversion exists. Check no all-clear or numeric quality buffer appears. Save the same proposal/run/report receipts for the finale; do not generate a parallel result for presentation.

Test negative levels, zero height, invalid/holed/compound geometry, reference/unit mismatch, incomplete inventory, restricted resources, missing utility dimensions, duplicate command, stale/late worker and revocation before report. A 3D model without a supported analytical profile returns a gap, not guessed result. Actual API results, stored manifests, source links and selected IDs must agree.

Run `pnpm typecheck`, `pnpm test:registry`; `python -m pytest services/geo/tests/test_registry.py services/geo/tests/test_usp_impact.py`; `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-impact.test.ts`; `pnpm exec tsx tests/usp-impact-integration.ts`; `pnpm exec playwright test tests/e2e/usp-impact.spec.ts`. Return actual numeric/result/report hashes, source coverage, saved-proposal evidence and V4 screenshots. Distinguish IMPACT0, utility adapter and field-data qualification.

## K. Copy-paste assignment

> Implement IMPACT on feat/usp-impact using 00, 01, this handoff and FIND's qualified operation. Obtain D0 trench/elevated oracles and later attempt permitted D5/D7 profiles. Complete saved numeric/drawn proposal→exact run→affected-space evidence→reopenable report, with coverage and explicit unsupported utilities. Preserve existing inquiry, source classifications and one map; UI/FND own shared mounts/hooks. Do not fork geometry, fill unknown depth or imply clearance. Run J through real services and return commits, manifests, numeric oracles, report and screenshots with separate capability gates. No main merge, external activation or fabricated data.
