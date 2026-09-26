# 02 · Backend execution ownership and ordinary Codex tasks

**Current scope, 26 September 2026:** [Delivery policy](current-delivery-policy.md) and the [operating guide](../orchestration/OPERATING_GUIDE.md) govern. All active plans are backend-only. This cleanup edits plans; it does not implement features. The lead may execute an assigned bounded task directly. The user owns UI design and implementation.

<!-- plan-next-gate: GF0 -->

Read [H00](00-README.md), [H01](01-shared-contracts-and-ownership.md), the assigned [H29 card](29-agent-task-cards.md), [H28](28-data-acquisition-and-finale-tests.md) and [H99 API boundary](99-ui-ux-and-integration.md) as relevant. Reconcile live `staging` in the sole original checkout and record its SHA. Consolidated application baseline: `45d033baae7ec4e5a572d82459b0062c70a12c95`; this is historical, not the live head. Recorded D0/PACK0 and single-real-D1 results are historical baseline evidence, not tasks to restart or qualification for new official-source tests.

## 1. Execution surface and Fast

Use ordinary reusable Codex tasks, not subagents or custom-agent configuration. Only the lead dispatches authorized tasks; delegated owners stop after their bounded result and callback. Creation of another ordinary task still requires user authorization. Prefer existing role tasks and direct execution when no independent task is useful.

The user requests Fast. On 26 September this task observed `service_tier = "priority"` in the host configuration. The task API has no speed argument; a configured preference does not prove a specific turn used it. Record requested mode, configured tier, observed model/effort and observed tier separately; report an omitted tier as unobserved. Do not change host authentication/configuration. A task authentication failure is reported once without a retry loop, substitute paid API access or model-setting guess.

## 2. Role tiers

| Tier | Ordinary task | Default | Use |
| --- | --- | --- | --- |
| T-lead | Delivery/coordination | GPT-6 Astra high | Scope, ownership, direct assigned work, integration; xhigh only for a difficult specific decision |
| T-work | Implementation | GPT-6 Sol high | Bounded backend changes; medium/low for simple fixes, xhigh for difficult integration |
| T-read | Research/data/admin | GPT-6 Luna low/medium | Official discovery, inventories and documentation; high for difficult reconciliation |
| T-risk | Review | GPT-6 Astra high | Security, privacy, transactions and geometry; medium for a small review |

A separate Sol review is appropriate for straightforward changes. Verify actual model/effort; do not claim a requested override ran. Use low through xhigh, not Max/Ultra. If the client cannot enforce a selection, record the limitation and use an explicit serial fallback within the authorized role. Astra/Sol/Luna review is same-family engineering review; cross-family or human milestone acceptance remains separately required. Runtime private-record inference uses H20's governed gateway, never coding tasks.

## 3. Ownership and assignment

One writer owns each shared seam. Use the sole `/Users/vinayak/Desktop/3D Ulpin` checkout on `staging`; do not create a worktree or switch branches beneath another owner. Preserve concurrent edits and the user's index. Shared schema, transactions, storage and jobs remain FND-owned; feature owners keep their bounded service leaves; DATA owns official-source acquisition/truth; DEPLOY owns provider/egress/credential policy. User-owned frontend is excluded except explicitly assigned API compatibility wiring.

An assignment records task ID, outcome, relevant card/contracts, pinned base, exact owned paths and exclusions, requested model/effort/Fast preference, cheapest sufficient checks and callback destination. State whether it is planning-only and whether staging/commit is authorized. Do not infer implementation or commit authority from a plan card.

An owner returns exact changed files/diff or authorized commit, actual commands/exits and receipts, observed model/effort/tier, unresolved qualifications, dirty paths and resource cleanup. Send one completion callback and stop. Never revert another owner's changes or silently take a shared file.

## 4. Backend delivery boundaries

Use one canonical registry, source store, job authority, provider gateway and conversion/validation contract. Preserve exact IDs, input/source revisions, manifests, hashes, privacy and review history. H99 specifies the record-backed API projection needed by the user-owned UI; it schedules no screen, renderer replacement, layout, theme or mobile work.

Select dependency-ready backend cards through H00/H29 and the release manifest only after implementation is assigned. All new GF0–GF5 claims remain pending until their evidence qualifies. Full-product learner/public/assistance/enrichment/scale contracts remain deferred; this cleanup adds no product feature.

Acquire unchanged official sources under H23/H28, data.gov.in first. Do not manufacture fixtures, adverse facts, PII or expected answers. Missing authentic coverage stays unqualified. Use reviewed exact-path/record cleanup; protect mixed bundles, real originals and unknown persisted state. Do not reset services, reseed, overwrite credentials, deploy, activate public routes or make live provider calls without authorization.

## 5. Lean verification and acceptance

For planning, validate links, owner/test mappings, release dependencies and policy consistency; this proves no runtime behavior. For later backend implementation, use locked dependencies, existing isolation guards, typecheck and directly affected existing checks once. Test actual producer/consumer, privacy and stale/recovery semantics where changed. Add a test only for a concrete high-impact failure. No full regression or UI capture campaign merely to retire text.

A backend pass does not establish browser rendering, usability, visual fidelity, source accuracy, learning permission, scale or deployment. Keep these qualifications distinct and preserve the release's outstanding user-owned integration dependency. After two focused failed fixes of one defect, return the evidence rather than restarting the feature. Human/credential/permission blockers are not solved by more reasoning.
