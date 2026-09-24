# 21 — Concurrent schema learner and safe automatic handover

**Release: `full_product` (FP-LEARN).** Real training, qualification and pending-only same-import handover remain committed scope, after the finale. They do not block GF0–GF5. H27 domain AI is a different capability and stays in the finale.

**Full-product handoff, 24 September 2026. Owner: LEARN; FND owns shared contracts, persistence and dispatch; DEPLOY owns provider permission.** This is a real ML implementation plan, not a description of an existing trained model.

## A. Exactly what the learner learns

Learn how supported source layouts map to our existing concepts: object role, source field/path, target field, permitted conversion, parent-key candidate and an explicit unknown option. The model suggests a constrained conversion plan; the shared executor copies exact identifiers/coordinates, converts declared units and validates the result.

Do not train it to hallucinate a final giant geometry JSON. Never learn property ownership, cadastral authority, CRS or floor boundaries from plausible numbers alone. Layout understanding, image-based building extraction, floor-plan segmentation and visual height estimation are separate tasks with different training sets and qualifications.

The ambition is adaptation to new schemas through a growing capability system, not a guarantee for every arbitrary encoding or information absent from the source. A target concept outside our vocabulary requires a reviewed schema extension, not runtime database migration.

## B. Three runtime paths

| Input | Route |
| --- | --- |
| Exact familiar family, unchanged semantics and qualified mapping | Reuse mapping and deterministic executor; no repeated Sarvam call and no redundant model call |
| Supported new/changed layout inside the learner's qualified domain | Model proposes field/operation candidates; constrained decoder + validators qualify an executable mapping |
| Unfamiliar/ambiguous/unsupported semantic pattern | Sarvam-assisted interpretation if allowed, or a grouped clarification; retain unknowns and partial results |

All paths use H14 chunks, receipts, validators, geometry publication and the same map. Reuse is not learning; actual model training and evaluation are separately reported. Undocumented semantic changes with identical plausible values cannot always be detected. Missing unit/datum assurance remains explicit.

## C. First trainable model: a small CPU baseline

Start with a pairwise field-to-target classifier rather than a new large language model. For each source path and candidate target concept, construct features from character n-grams of names/descriptions, parent paths and neighbouring headers; declared data types/units; bounded value-shape statistics; null/missing rates; date/numeric/identifier patterns; and geometry-role metadata. Do not include full private document text, raw personal IDs or millions of coordinate values by default.

Implementation choice to qualify: scikit-learn `HashingVectorizer`/`FeatureHasher` plus `SGDClassifier(loss="log_loss")` with `partial_fit`, and a versioned fixed numerical feature scaler. Pairwise valid/invalid labels avoid dynamically adding target classes mid-fit. Separate constrained operation selection covers copy, enum lookup, explicit unit conversion and source-key linkage. Constraint assembly can permit one-to-many mappings only when that operation and source semantics are declared; it must not impose an incorrect universal one-to-one schema match.

This is an intentionally bounded baseline, supported by documented incremental-learning APIs, not a claim of universal semantic understanding. Freeze feature/target vocabularies and versions. A CPU model avoids competing with the interactive GPU initially. Upgrade to a locally hosted licensed multilingual/table encoder with a small trained head only when independent evaluation demonstrates a real gap; qualify its model licence and India execution path. Do not ship an encoder merely because it produces embeddings.

## D. Training data and eligibility

Create a durable, append-only `MappingExample` with source family/revision/hash and locator, raw profile, target/operation label, negatives/abstention, label origin, independent-check receipt, permission scope, eligible usage, tenant/project, and split assignment. Preserve the original evidence separately.

High-quality labels come from source documentation with an independently checked mapping, approved human corrections, permitted authored fixtures, or an explicitly permitted teacher workflow plus independent source checks. JSON validity or agreement with Sarvam alone does not make a semantic label true. Many identical rows under one header are not many independent schema examples. Weight/deduplicate by layout and decision; include rare/missing/conflicting patterns.

**Sarvam training gate:** its published Terms of Service, effective 29 July 2026, section 10.5(a), restrict developing/training/testing/improving ML from its offerings or derived outputs without express written permission. Product-specific terms may govern. DEPLOY must record applicable written permission before Sarvam-derived outputs enter training, model evaluation or a teacher-agreement dataset. Human correction is not an assumed workaround. Default those outputs to `trainingEligible=false`.

Independent permitted labels can train the learner alongside the running import without using restricted teacher outputs. Keep their provenance and evaluation ground truth independent. No permission means the teacher-distillation route remains blocked; do not delete the learner from the architecture or silently switch providers. Never train on another tenant's private data without explicit permission. Publicly downloadable data is not automatically licensed for all model uses. Production qualification includes held-out Indian sources. Foreign benchmark/holdout examples remain test-only and cannot enter production training by default or contaminate later evaluation.

## E. Concurrent lifecycle

The learner runs as a low-priority registered job on the existing work infrastructure. It consumes eligible example events without blocking conversion. There is one writer per candidate model version and a separate immutable production model artifact.

`collecting → training_candidate → evaluating → shadow → qualified → active → superseded/rolled_back`.

Start bounded updates only when enough new, diverse eligible decisions exist for the configured task. An initial engineering trigger may be a small batch of newly labelled decisions; this is a scheduling trigger, never a readiness proof. Do not claim a universal number of chunks is sufficient. Balance new-family examples with a replay sample of older eligible families to test and reduce forgetting. Fix random seeds, feature version, training split, dependencies and model checksum.

Proposed initial resource envelope: one CPU training task, at most two CPU threads and 1 GiB additional RSS, with measured time slices and checkpoints. These limits must be tuned on the actual host. Pause/yield when upload/conversion/publication backpressure, memory or interaction budgets are breached. Do not run large GPU fine-tuning alongside an interactive render unless an isolated India-hosted worker is independently qualified. An import can finish before learning qualifies; keep the candidate for future permitted evaluation without claiming a same-import takeover occurred.

## F. Qualification and statistical honesty

Keep discovery examples, training, tuning and final evaluation disjoint. Hold out complete source layouts/families and actual difficult cases, not only random rows from the same file. A family used for debugging becomes development data; obtain a new untouched family for generalization claims. Within-family evaluation separately proves repeated-record conversion. Scope qualification narrowly by source family, encoding, version, semantics and target task.

Gate requirements:

1. Zero observed critical identifier, unit, reference-system or source-loss errors on the independently checked critical suite; this does not prove a zero real-world error rate.
2. Report per-decision correctness, false-confident errors, abstention/coverage, rare/null cases, and known-family regression versus the baseline.
3. Calibrate confidence on held-out labels and select thresholds for a predeclared error budget. Raw classifier probabilities are not certainty. Report confidence intervals and effective independent sample counts; correlated rows cannot justify a universal high-accuracy claim.
4. A shadow run uses the actual executor and unused real records. Independent expected values, not the teacher's approval, decide correctness.
5. Show measured CPU/memory/latency and useful throughput. If a deterministic exact mapping is already faster, keep it. Candidate training cost and teacher calls must be included in any savings claim.
6. A model can abstain on critical unknowns and still be useful, but cannot pass by rejecting every record. Set minimum useful coverage by cohort before evaluation.

Persist a signed/hashed `QualificationReceipt` with dataset/split hashes, metrics, thresholds, observed failures, permitted domain, algorithm/version, approval policy and resource profile. Automatic promotion is allowed only under the pre-approved policy and exact compatibility checks. There is no per-chunk human approval requirement for routine conversion; ambiguous semantics and recording remain reviewable.

## G. Promotion, versioning and rollback

FND owns `promoteConverter(family, expectedEpoch, modelVersion, qualificationReceipt)`. The operation verifies eligibility, model hash and required metric gates, then advances a persistent dispatch epoch atomically. Every claimed chunk pins its converter. Completed or running chunks are never silently reassigned. H14's pending-only handover, replay and rollback rules apply.

Monitor drift through raw schema/semantics fingerprints, type/constraint failures, abstention changes and independently audited samples. Do not train and serve from the same mutable weights. A failure reverts future dispatch to the last qualified route. Flag affected accepted drafts for targeted revalidation; never overwrite recorded data or old evidence. Across restarts, restored weights and binding epochs must match actual qualification receipts.

## H. Do we need reinforcement learning?

**No RL in the first implementation.** Our immediate target has explicit supervised labels: which source field means which target concept and which documented operation is correct. Incremental supervised learning, transfer and selective requests for labels directly address that problem. This is the proposed engineering choice, not a claim that RL can never help.

A later experiment may use a contextual bandit/RL policy for chunk priority, budget allocation or choosing when to ask the teacher, after reliable baselines and independent rewards exist. It must not alter ownership, geometry truth, permission or validation rules. Do not reward merely valid JSON, a prettier map or agreement with the model itself. No uncontrolled exploration on live registry records. RL is not a shortcut for missing semantics or a substitute for training-data permission.

## I. Implementation map and tests

Proposed leaves: `services/geo/geo/usp_learning/{features,dataset,train,evaluate,infer}.py`; `apps/web/lib/server/usp/learning/{service,models,qualification,routes}.ts`; shared DTOs in `packages/contracts/src/usp/learning.ts`. FND registers migrations/jobs/ports, DEPLOY owns legal/provider eligibility, DATA owns independent expected examples, UI mounts compact learning status in the batch view. No duplicate model gateway, broker, uploader or schema store.

Required tests: parameter changes after eligible examples; ineligible teacher outputs never enter train/test sets; field-vs-row leakage; multilingual/renamed/absent fields; conflicting units; new family abstention; old-family replay; immutable active model during training; crash/resume; simultaneous promotion; retired model binding; queue handover with running jobs; rollback with already published drafts; permission revocation; feature version mismatch; bounded training interference. Retain exact mapping tests as an independent baseline.

Success is an executed demo: an unfamiliar supported source begins through the permitted teacher path; a separately trained candidate qualifies; a recorded promotion moves pending compatible chunks to the learned path; the final map and source counts reconcile. Fake-provider tests prove mechanics, not live teacher permission or learning quality. Do not report per-import success where the model never qualified.

## References

Scikit-learn out-of-core classification and SGDClassifier documentation support the incremental baseline. Sherlock (Hulsebos et al., 2019) and TURL (Deng et al., 2020) support semantic-column/table learning as research directions; their results are not results for this application. Source URLs and verification date are in H23.
