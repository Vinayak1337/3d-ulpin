# Budget, model routing and runtime policy

## 1. What can be said about “under 20%”

Twenty percent is an **operating target chosen for this run**, not a measured cost estimate. The repository’s actual starting state, build/runtime problems, geometry and review defects, native-device access, context sizes and retries are not established by the planning files. A clean implementation might fit; this pack does not claim it will.

The earlier 500-credit and 2,000–4,000-credit-equivalent examples were hypothetical token scenarios. They were not observed project costs, prepaid spending recommendations or conversions of a Pro20× quota. Do not use them as a completion guarantee.

**Verified public context as of 12 September 2026:** Work/Codex use a shared allowance; applicable five-hour and weekly windows are distinct. Usage depends on the task/model/settings, and the model picker/usage page is account-specific. Check whether the displayed percentage means used or remaining. [O1]

## 2. Define the denominator before accounting

Default interpretation for this handoff: spend no more than **20 percentage points of a full five-hour allowance**, while independently capping consumption at **20 percentage points of the full weekly allowance** when both windows apply. This is a conservative proposed interpretation of the user’s ambiguous “20%,” not an OpenAI plan conversion.

Example, purely illustrative: a five-hour meter moving from 90% remaining to 70% remaining consumed20 percentage points. That is not20% of the starting 90% remaining balance. A weekly movement from 80% to 77% is a separate 3 percentage-point observation; do not add it to the five-hour movement or assume one predicts the other.

If less than the target remains, stop before included allowance is exhausted and report the smaller available envelope. Do not infer a safe purchased-credit fallback. Maintain separate records for each applicable window and its reset time.

## 3. Calibrate with actual work

Before the first feature swarm, record the current usage observation and then run one finite calibration package:

- Inspect the actual repository and environment; freeze only the minimum schema/profile needed next.
- Start one runtime/health probe and compute one independent simple-prism expected result.
- Use no more than two child workers, each with a bounded output; only one blocking research question if required.
- Stop the batch, let its active work finish, record the next usage observation and compare the completed artifact with the budget spent.

This is not a promise to complete a fixed feature for 2%, 500 credits or a fixed duration. It is a way to learn from a representative first batch rather than authorize an unrestricted run on a guess.

Do not linearly project from an easy schema task to hard native/concurrency work. Use the observation to choose the next small batch, not claim a statistically validated project estimate.

## 4. Feature cutoff and reserve

Reserve **25% of the chosen run budget** for integration, required tests, fixes and the human handoff. Under the full20 percentage-point target, new feature dispatch stops when measured consumption reaches15 points in either controlling window; the remaining 5 points are reserved. If the feasible budget is smaller, scale the reserve accordingly.

Apply the cutoff to whichever applicable window reaches its guard first. Each worker receives a bounded ticket and must stop at its artifact/test boundary. Reduce concurrency as the guard approaches. In-flight work and delayed/rounded telemetry mean this is **not a hard billing cap**.

Do not wait until 20 points are already consumed before asking workers to summarize. Maintain the resume artifact continuously. If remaining budget cannot safely support the next batch, stop at the current checkpoint with incomplete requirements clearly identified.

## 5. Unknown, delayed or reset telemetry

**Unknown usage:** Do not record 0. Do not fabricate a percent from token count, model name or message count. The default is one bounded calibration package followed by a checkpoint; do not continue a full budget-targeted swarm when the budget cannot be observed. A user-provided current meter observation can be recorded with its timestamp and source, but it is not automatic live telemetry.

**Unrelated concurrent account activity:** Mark attribution uncertain; the meter delta is an upper bound on this run only when no reset/refund obscures it. Do not assert per-agent costs from account-level usage alone.

**Window reset:** Split the ledger into segments. Keep the run’s earlier consumption instead of resetting project spend to zero. When accurate segment accounting is impossible, mark the total unknown and checkpoint rather than claiming the task stayed under 20%.

**Limits/credits:** Do not purchase credits/resets, enable auto-reload, consume a saved reset, switch to a separately billed API key or create a paid service without separate authorization. Existing credit behavior is an account setting, not something a prompt can turn off. Credits can cover eligible usage after included limits, and concurrent work can overshoot a positive credit balance. [O4]

## 6. Preferred dispatch policy

These choices are our proposed workload allocation, not benchmark guarantees:

| Task | Preferred model/effort | Escalation rule |
|---|---|---|
| Lead and integration | Astra high | xhigh only for one concrete unresolved mechanism. |
| Geometry, auth, review correctness | Astra high | Reproduce first; bounded xhigh investigation only if needed. |
| Input APIs, ordinary web/mobile screens | Astra medium | High for a specific difficult interaction/auth/build defect. |
| Independent adversarial tests | Astra high | Medium for routine execution/report cleanup. |
| Exact extraction of supplied facts | Luna low or lowest supported | Hand interpretation back; do not pad the answer. |
| Bounded official-documentation/data question | Terra medium | Sol high only if a material ambiguity remains. |
| Difficult evidence-backed research decision | Sol high | One decision/test, not the entire architecture. |

Run standard speed by default; do not turn on Fast mode to make an uncontrolled swarm finish sooner. Reuse an agent for a tightly related follow-up when its context is still useful; start a fresh narrow agent when the old context is unrelated. Do not keep idle workers or open duplicate investigations.

A model is not automatically the least expensive way to solve a task merely because its per-token rate is lower. Quality failures and repeated investigations can erase savings. Use the simplest adequate worker and escalate with evidence.

## 7. Native delegation, not a new API orchestration project

Current official subagent guidance documents inherited parent settings unless overridden and support for per-agent configuration. Subagent activity adds token work. [O2] Therefore, verify the runtime’s actual dispatch controls and explicitly select the intended model/effort for each child.

Use available native subagent tools in the authorized environment. Do not invent a `get-astra` endpoint or build a custom API-key swarm runner merely because the user described an Astra-led swarm. Labels such as Astra/Sol/Terra/Luna must map to actual available model identifiers; the exact mapping belongs in the preflight record. A successful spawn must report or otherwise establish the selected model before it is claimed in the final result.

When model override is unavailable, say so and use an available allowed model for the bounded task; do not call an inherited Astra worker “Luna research.” When delegation itself is unavailable, execute bounded role tickets sequentially and report that limitation. The lack of a research model must not force an unauthorized external provider.

### Optional local configuration example

Only for a compatible installed Codex runtime after checking its own current configuration schema. Merge reviewed fields into the existing configuration; do not replace the user’s whole file or change unrelated settings.

```toml
[agents]
max_concurrent_threads_per_session = 3
default_subagent_reasoning_effort = "medium"
```

The concurrency field excludes the parent in the current documented local configuration. [O2] Select verified model identifiers per child; no unverified model IDs are embedded here. Custom per-agent instructions can be created from `agents/*.md` in the actual supported format after inspection. These Markdown profiles are not automatically installed runtime agents.

The runtime may differ from this local configuration surface. A TOML snippet in a document does not enable tools in every ChatGPT interface or establish any account spending cap.

## 8. Optional credit accounting when token data really exists

Current published standard-speed Work/Codex credit rates, **per million tokens**, as checked 12 September 2026 [O3]:

| Model | Uncached input | Cached input | Output |
|---|---:|---:|---:|
| Astra | 250 | 25 | 1,250 |
| Sol | 100 | 10 | 500 |
| Terra | 50 | 5 | 300 |
| Luna | 5 | 0.5 | 30 |

For measured token counts, sum each model/category separately:

```text
credit_equivalent = Σ_model(
  uncached_input_tokens / 1_000_000 * input_rate
  + cached_input_tokens / 1_000_000 * cached_rate
  + output_tokens / 1_000_000 * output_rate
)
```

Use non-overlapping input categories and the provider’s reported complete output accounting. Unknown cached/reasoning/worker usage stays unknown. Include the lead, child agents and retries when those figures are available. Do not double-count the parent’s aggregate if it already includes children. Do not label this calculation purchased credits actually charged unless the account billing record establishes that.

The table does not convert a20× allowance into a fixed token wallet or predict the percentage used. Different performance, tool behavior and billing surfaces require their own actual observations. [O3]

## 9. What to report at each gate

One concise checkpoint: completed integrated behavior; tested commit; active/closed workers and actual settings when observable; remaining required tasks; observed five-hour and weekly deltas with uncertainty; decision to continue a bounded batch or stop; exact resume path. Do not repeatedly paste the whole task graph or source archive.

Source references O1–O4 are resolved in `07_SOURCE_BASIS.md`. All thresholds, role assignments, reservations and stop rules in this document are the proposed execution policy, not a native guaranteed limit setting.
