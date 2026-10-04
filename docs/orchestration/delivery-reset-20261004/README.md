# Assessment and proposed delivery reset

4 October 2026. **Workers remain stopped by the user. This is an assessment and proposed next-work queue, not a restart or a release approval.**

## Conclusion

The external review identifies the main delivery failure correctly: we optimized for completing parallel backend components and running small ML experiments instead of completing a useful product journey. The lead owns that prioritization failure. The existing engineering is reusable, but its volume does not establish product completion. The fragment-support fine-tune is neither a heterogeneous-data converter nor either of the learned vision routes required by GF-AI. Continuing its present experiment is not the next useful step.

Adopt the review's direction: integrate one traceable source-to-record journey, reuse deterministic conversion, evaluate the two existing domain models, and train only against a demonstrated product gap. Correct the stale implementation claims and avoid replacing the current process with another large planning project.

Read [the delivery queue](EXECUTION.md) for dependencies and concrete completion criteria, and [the ML/data plan](ML_DATA_PLAN.md) for experiments, labels and restart conditions. These three files replace no source history or release requirements.

## What was checked

- Accepted backend: `staging@bd0ef1296bc30e9d9893431bc5d786ba105e4ad3`, initially clean.
- External recommendations: [`ML_REVIEW_RECOMMENDATIONS.md`](https://github.com/Vinayak1337/3d-ulpin/blob/389f8b5e4ddc98772ef830b12c97c35bfbe674b3/ML_REVIEW_RECOMMENDATIONS.md) and [`PROJECT_DEEP_DIVE_ACTION_PLAN.md`](https://github.com/Vinayak1337/3d-ulpin/blob/389f8b5e4ddc98772ef830b12c97c35bfbe674b3/PROJECT_DEEP_DIVE_ACTION_PLAN.md). They review the earlier consolidated report at `6c37f973`.
- Release manifest, H21/H23/H27/H28/H29/H90, operating instructions, current scene types, Studio route table, published API, relevant backend producers, source manifests, retained feasibility results and later runtime handoffs.
- Read-only source inspection and upstream documentation; no services, models, evaluations, private datasets or workers were started. Existing protected evaluation items were not reopened. Runtime availability today was not measured.

The original problem-statement attachment was not reobtained here. Its adopted [H23 summary](../../usp-agent-handoffs/23-india-data-and-delivery-plan.md#d-mapping-to-problem-statement-26011) and [H27 interpretation](../../usp-agent-handoffs/27-domain-ai-and-cadastral-checks.md) are the requirement basis; do not describe them as a fresh independent reading of the original attachment.

## Findings and corrections

| Review claim | Assessment and consequence |
| --- | --- |
| Work is not converging on release outcomes | Supported. Select the next task by the missing step in a usable journey. The lead must own shared integration, rather than reserving it while allocating more leaves. |
| No gate has started; all 30 tests have no attempts | The manifest has 30 empty test records, including **7 full-product tests**, and pending gates. This proves no registered acceptance, not no engineering execution. Source acquisition receipts and runtime checks exist outside those arrays. Reconcile relevant evidence without declaring an automatic pass. |
| Domain AI has never been tested | Incorrect as an absolute claim. [T061](../../evidence/t061/models/evaluation.md) records actual inference on 2 published plans and 12 OAM tiles. Indian/generalizable GF-AI qualification is missing. Start from these implementations and results. |
| The text model is not the required domain AI | Correct. It scores fragment support, not building masks, plan regions, vertical delineation or topology. Its development cohort cannot support a generalization claim. |
| Document association is outside our goal | Incorrect for this project. The user explicitly requested correct document-to-building/floor linking; [AI-08](../ADAPTIVE_INGESTION_EXECUTION.md) records it. Keep the feature, deliver exact/manual and deterministic linking first, and defer speculative association training. |
| The backend still lacks declaration acceptance and property-card/QR code | Stale. [Declaration service](../../../packages/server/src/modules/usp/declarations/service.ts), [command wiring](../../../packages/server/src/modules/usp/commands.ts), [card service](../../../packages/server/src/modules/usp/packets/card-service.ts) and published routes exist. Reuse them; actual source applicability, current runtime and complete gate qualification remain separate. |
| The geometry admission/exchange gap remains | Supported. [Admission](../../../packages/server/src/modules/registry/cityjson-admission.ts) still names missing qualification producers; [CityJSON export](../../../packages/server/src/modules/usp/exchange.ts) still emits an explicit geometry loss and empty vertices. Implement the missing producer/consumer connection, not another generic export. |
| Studio has 3 live and 33 mocked routes | The inspected [route table](../../../apps/studio/src/local/routes.ts) has **2 live and 31 local entries**, both on staging and the fetched reviewer branch. Local responses include retained-source derivations and application-created data; not all are invented mocks. The integration gap is real. Matching endpoint names alone does not prove matching contracts or authentication. |
| The current database has one feature and no installed area | Not established today. [Serving observation](../../api/serving-observation.json) is dated **26 September**, on an older served revision, and records an area ID for its retained package. It is not a current Windows database inventory. Inspect the selected runtime once when work resumes. |
| Docker still blocks all persistence | Too broad. [The migration ledger](../NESTJS_MIGRATION.md) records later successful RUN-CONTROL-03 and native HTTP journeys. Current staging is not thereby a standing qualified installation. Reuse working runtime recipes and check the selected flow, not every old incident. |
| Rules make GF-AI impossible | There is a real mismatch between broad development permission and DATA-07's narrow official-label gate. H90 delegates acquisition of third-party human-labelled benchmarks; it does not outlaw all human labels. A permitted institution-issued benchmark, including foreign `test_only` evidence, remains a possible route. Team-labelled Indian gate acceptance would require an explicit qualification-policy decision. |
| Teacher supervision violated policy | Not an adequate reading of the full instruction history: the user explicitly requested distillation and teacher examples, and authorized public development experiments. Those examples are provisional experimental supervision, not official records or independent test truth. That distinction must remain enforced. |
| A one-building demonstration closes GF0 | Only if it satisfies the actual GF-DATA, GF-CONTRACT and GF-BACKEND criteria. One successful journey is a milestone, not permission to waive other required evidence or claim all later gates passed. |

The document/commit totals illustrate coordination cost but are not a reliable productivity metric: generated files, evidence, merges and independent implementations have different purposes. Do not delete historical evidence just to improve that ratio. Reduce new reporting and repeated environment work.

## Changes to the proposed solution

1. **Use the existing canonical contracts.** Renderer types are a useful consumption target, not a replacement registry schema. `HTMLCanvasElement` and typed arrays are not wire records; scene types omit source identity, revision, frame and evidence authority. Add an explicit projection from existing contracts, extending only genuinely missing fields. Keep value availability, review state, provenance and geometry eligibility distinct rather than merging them into one new enum.
2. **Do not promise geometry merely because a reader exists.** An IFC storey may have no trustworthy metric elevation; a CityGML/point-cloud source may lack a compatible vertical frame. Metadata extraction is not analytical geometry. Preserve useful local/candidate output while requiring real evidence for placement and measurement.
3. **Do not force the proposed site join.** [GMDA sectors 59/63A](../../../fixtures/usp/D4/reference-area-gurugram-59-63a/manifest.json) supply context, not Tower 3's footprint or a proved placement. [Haryana/Bihar reconciliation](../../evidence/usp/association-crosswalk/review.md) supports drawing context and explicit conflicts, not an approved canonical crosswalk. G+41/G+42 is valuable evidence to display; it supplies neither a surveyed height nor a location.
4. **Keep data permission and qualification honest.** Public access or local use alone does not establish permission. Research is authorized; source-specific restrictions and production clearance remain recorded separately. Missing survey evidence blocks a survey claim, not private source inspection.
5. **Use measured data needs, not magic numbers.** The proposed 30–50 images/plans and 300–1,000 training examples are planning estimates, not universal sufficiency thresholds. Independent sites, classes, annotation quality and useful error estimates matter more than raw row count.
6. **Simplify execution without losing isolation.** Reuse one pinned offline environment and cached model artifacts. `HF_HUB_OFFLINE=1` alone is not an egress boundary. Preserve source/access checks and effective network/resource isolation, while removing redundant copies and one-off protocol layers.

The reviewer correctly prioritizes existing domain models. Its claims that 23 examples necessarily teach nothing, a 0.5B model inherently cannot work, or frontier-model failure proves no smaller model can succeed are stronger than the evidence supports. Our results demonstrate inadequate useful performance under the tried setup; they do not isolate a universal cause. A stronger pretrained reference would be informative, not a mathematical ceiling.

## Decisions before dependent work, not before all work

- **Label acceptance:** use eligible existing independent benchmarks under current rules. If the team wants team-labelled Indian data to discharge GF-AI, name that scope and amend the gate honestly; do not relabel team annotations as official.
- **Frontend integration:** Claude remains the frontend owner. Recommend one early live vertical slice, while preserving the user's late-stage integration preference until they change it. Backend API delivery and an exact contract handoff can proceed independently.
- **Finale scope/date and waivers:** currently not fixed here. Record a real deadline and any omitted claims when the owner supplies them; no invented schedule or silently reduced release gate.
- **Resume:** this assessment does not restart stopped workers. The queue below is ready for a later resume instruction.

Current user instructions take precedence over repository plans. The release manifest governs release claims within those instructions; it cannot override later user decisions on frontend, model, speed or development authorization. The proposed `release-plan → H00 → feature` hierarchy needs that correction.
