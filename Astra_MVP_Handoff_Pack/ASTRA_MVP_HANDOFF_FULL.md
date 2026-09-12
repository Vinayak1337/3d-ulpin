# Astra — Complete MVP Execution Handoff

**For Vinayak · 12 September 2026 · Planning and execution instructions, not completed software.**

This is the single-file version of the new execution pack. The ZIP also contains the original project references, individual worker prompts and machine-readable templates. When using this file alone, attach the source01/02/revised03/addendum documents too. Internal links resolve in the extracted ZIP.



---

<!-- Section source: 00_START_HERE.md -->

# Start here — Astra MVP handoff pack

**Prepared for Vinayak · 12 September 2026**

This pack is an execution specification for the next authorized development session. It does not contain a newly built application, completed application tests, or a measurement of your subscription usage.

## Use it

Open the intended repository/workspace in the development environment, attach or extract this pack, select **Astra high** as the lead, and paste the launch instruction below. The lead must discover the available models, delegation tools and usage telemetry; model names in the plan are preferences, not proof of runtime availability.

Use the split pack when repository files are accessible. The single-file `ASTRA_MVP_HANDOFF_FULL.md` contains the complete new execution instructions for an attachment-only handoff. The preserved source documents are included under `reference/`; source-specific details remain authoritative there.

## Launch instruction

```text
Implement the 3D Property Registry MVP described in this pack. Do not answer with another general implementation proposal.

Read 01_ASTRA_MASTER_HANDOFF.md as the lead, then use 02_AGENT_CARDS.md, 03_MVP_TASK_GRAPH.md and 04_ACCEPTANCE_MATRIX.md to execute. Inspect the actual repository and available runtime first. Respect existing work and the latest revised three-person allocation: I own the complex core; my teammates will extend bounded data, API, UI and testing work after the MVP.

Use Astra high as the lead/integrator. Use Astra for production coding and correctness tests, medium for routine implementation, high for geometry/auth/review/integration, and xhigh only for one justified difficult blocker. Use Luna low for exact extraction, Terra medium for bounded source research, and Sol high for a genuinely ambiguous blocking research question. Verify supported model IDs/efforts and actual tool availability before dispatching. Do not claim a model was used unless it was selected. Do not silently inherit xhigh into every worker.

Use at most three live child agents; prefer two coding workers plus one bounded research or independent-test worker. No recursive spawning. Assign one concrete work ticket, one writable path lease and one testable output to each worker. Freeze the small shared contract before dependent parallel implementation. You own integration, shared contracts and final acceptance; keep coding while children work rather than becoming a passive coordinator.

The finish line is the first complete manual web plus online Android lifecycle: real sources → supported candidate geometry → genuinely computed finding → evidence request → native response → explicit correction and fresh checks → distinct-reviewer acceptance → persistent prototype identity lookup. Preserve C-001, its unverified 2.8 m draft limit, the supported 3.0 m correction, common circulation and basement. Keep source receipt, suitability and record acceptance separate.

Treat 20% as a measured run target, not a guaranteed price. Use the budget/window rules in 05_BUDGET_AND_RUNTIME.md. Reserve the last quarter for integration, testing and handoff. No paid API fallback, purchased-credit purchase, auto-reload changes or limit bypass. If usage cannot be observed, execute only the bounded calibration package and stop at its checkpoint with the observability gap instead of pretending to enforce 20%.

Proceed through task gates without routine confirmation while within scope and budget. Do not build offline sync, a generalized dependency engine, AI extraction, universal BIM, planning/exchange or a swarm product in this run. Research only questions that block the next implementation. Do not weaken access, review freshness, persistence or the native evidence loop to claim completion.

Run real tests and distinguish actual-device, emulator, browser, service-only and not-run evidence. Leave a runnable checkpoint, exact supported scope, observed usage with uncertainty, and separately actionable next tasks for me and both teammates. Begin T00 now; keep the startup plan brief and start implementation.
```

## Reading map

| File | Purpose |
|---|---|
| [Master handoff](01_ASTRA_MASTER_HANDOFF.md) | Product cutoff, architecture, operating rules and detailed implementation constraints. |
| [Agent cards](02_AGENT_CARDS.md) | Ten child-role templates; instantiate only the profiles needed now. |
| [Task graph](03_MVP_TASK_GRAPH.md) | Fifteen bounded tickets with dependencies, outputs and gates. |
| [Acceptance matrix](04_ACCEPTANCE_MATRIX.md) | Required observable checks; every row begins NOT_RUN. |
| [Budget and runtime](05_BUDGET_AND_RUNTIME.md) | 20-percentage-point target, calibration, accounting, effort and stop rules. |
| [Human continuation](06_TEAM_CONTINUATION.md) | Actual post-MVP assignments mapped to revised 03, without rebuilding completed work. |
| [Source basis](07_SOURCE_BASIS.md) | What came from the supplied files, what is proposed here, and current official runtime references. |
| `agents/`, `templates/`, `orchestration/` | Small worker prompts, task/report/state templates and descriptive planning data. |

The JSON planning files are **not executable Codex configuration or API requests**. Native runtime configuration is described separately and must match the installed version. Do not upload private project sources to unrelated third-party services to make delegation work.


---

<!-- Section source: 01_ASTRA_MASTER_HANDOFF.md -->

# Astra — MVP Execution Handoff

**Project:** Evidence-linked 3D Property Registry / 3D ULPIN and Vertical Property Mapping  
**Owner:** Vinayak  
**Prepared:** 12 September 2026  
**Status:** Implementation instructions, not completed software or measured usage  
**Default objective:** Finish the first complete manual web + Android lifecycle, then hand the remaining baseline to the human team  
**Budget policy:** Target no more than 20 percentage points of the selected full allowance; measure rather than promise

## 1. Your mandate

You are the Astra lead engineer and integration owner working for Vinayak. Implement the MVP, not another general proposal. Read the supplied project baseline, inspect the actual implementation environment, make the small decisions required to start, and execute bounded work through specialized subagents.

Use Astra for production coding and correctness tests. Use Terra, Luna or Sol for appropriate research and supporting extraction, with explicit effort settings. Spawn only agents whose inputs exist and whose outputs have an identified next consumer. The purpose of delegation is to produce one working product—not many independent code dumps.

Continue across the gates without asking for routine approval. Stop at the verified MVP, the budget stop condition, a non-resolvable authorization/environment blocker, or a required user decision that would materially change scope. Choose reversible implementation defaults for details the sources leave open and record them. Never silently weaken the product to obtain a green report.

The agents are development helpers. Do not build an agent-swarm platform, agent dashboard, LLM router or runtime OpenAI dependency into this property application. The manual MVP must run without model inference or an OpenAI API key.

## 2. Source authority and the staffing correction

Read these once as lead, then provide each worker only the relevant excerpts and files:

1. The latest user instruction: build an agent-assisted MVP, mostly Astra coding, economical research agents, and leave suitable continuation to the three-person team.
2. This handoff: autonomous-run boundaries, agent roles, budget policy, MVP cutoff and explicitly proposed implementation defaults.
3. [01 — Product baseline](reference/three_person_implementation_plan/reference/01_Product_Problem_and_Solution.md): product meaning, source limitations, reference case, roles and lifecycle.
4. [02 — Architecture](reference/three_person_implementation_plan/reference/02_Modules_and_Architecture.md): nine modules, two clients, backend boundaries and six-phase dependency order.
5. [Revised 03 — Human implementation plan](reference/three_person_implementation_plan/03_Three_Person_Implementation_Plan_REVISED.md): Vinayak owns the difficult core; teammates own bounded supporting work.
6. [Reviewed addendum](reference/three_person_implementation_plan/reference/Reviewed_Additions_and_Guardrails.md): relevant evidence, geometry, provenance and scope guardrails.

The OLD allocation assigning all specialist backends to A/B and restricting Vinayak to UI is superseded. Do not reintroduce it from old 03 or the old ownership paragraphs in 02. The AI workers may implement difficult mechanisms on Vinayak’s behalf; this does not transfer long-term architecture ownership to the less experienced teammates.

A/B/V task IDs refer to **humans**. C-/R-/O- role IDs in this pack refer to **AI agents**. Keep the namespaces distinct.

Do not infer a repository name, existing implementation, connected government API, licensed dataset, deployment, model entitlement or device connection from these planning documents. Existing code is evidence only after inspection and relevant execution.

## 3. Exact finish line

Deliver the following user journey using persisted data and actual application/processing services:

> Sign in as a preparer → open/create the synthetic C-001 case → upload parcel/plan/level/reference sources → inspect those sources → prepare supported unit prisms → compute U03’s incorrect overlap with U01 → open the boundary’s evidence → assign RQ-LEVEL-01 → return E-LEVEL-02 r2 from the Android client → inspect suitability → explicitly update the relevant source bindings and correct U03 from 2.8 m to 3.0 m → run fresh checks → submit a fixed snapshot → accept through a different authorized reviewer → retrieve the same accepted prototype identity and history after refresh/relogin.

No accepted unit revision exists before the initial acceptance. Common circulation and BSM-01 are present from the beginning. U04’s initial unsupported level evidence cannot become suitable merely because its 3.0 m value happens to be correct.

**The first acceptance must be reachable from a clean seed with no accepted records.** Seed data may supply synthetic raw files, identities and empty/draft case scaffolding. Do not pre-seed the completed review, a fake validation result, or an accepted identity and call the resulting screen the lifecycle.

### Included in this autonomous MVP

| Area | Required implementation |
|---|---|
| Identity and cases | Shared identity, server-derived actor, project/record scope, distinct preparer/reviewer, assignments and minimal admin task visibility. |
| Sources | Real authorized uploads, verified finalization, private original retention, immutable revisions, scoped reads and purpose-specific inspection states. |
| Geometry | Explicit local metric prism profile, stored footprint/Z specification, construction and genuinely computed contact/overlap findings. |
| Workbench | Linked unit tree, plan and 3D selection; supported outline and level editing; source/component evidence access. |
| Evidence | Targeted request, assignee, permitted mobile attachment/note, exact request/source IDs and idempotent receipt. |
| Review | Immutable submission snapshot, readiness, separation of duties, freshness and concurrent-change protection in the decision transaction. |
| Registry | Stable prototype identity published through acceptance; accepted-record lookup and attributable history. |
| Engineering | Repeatable local stack, tests, clean-start instructions, explicit supported profiles and human continuation packets. |

### Deliberately not part of this run

Reliable offline synchronization, a generalized change-impact engine, full Observed/Recorded/Compare tooling, heavy imagery/cloud/raster/DXF pipelines, AI extraction/training, optional IFC, corridor/vertical queries, exchange/import, split/merge workflows, production-scale operations and public citizen features remain later baseline work.

Preserve their necessary foundations—source ancestry, timestamps, revisions, relationship fields, operation IDs and exact snapshots—but do not implement whole later modules just to populate navigation. Unsupported pages should be absent or clearly marked unavailable, not decorated with fictional results.

**Do not automatically enter Phase 3 just because tokens remain after the MVP.** Finish verification and the handoff, then stop. The continuation plan preserves Phases 3–6 in order. A future expressly extended run can execute those packets.

### What “complete” may be reported as

- **MVP_VERIFIED:** all required acceptance rows pass against real services, web interaction is checked, the online native flow is checked on an actual Android device, and clean-start reproduction is demonstrated.
- **IMPLEMENTED_WITH_VERIFICATION_GAPS:** implementation exists, but required runtime/browser/device checks could not be executed. Name each gap; an emulator test is not an actual-device test.
- **PARTIAL_BUDGET_STOP:** the budget policy stopped the run before the full gate. Preserve the last working checkpoint and exact missing tasks.
- **BLOCKED_ENVIRONMENT:** a required authorized capability cannot be obtained in the current environment. Preserve code, the failing command and the precise missing requirement.

These are reports of evidence, not labels chosen to flatter the result. This handoff itself establishes none of these outcomes.

## 4. Non-negotiable architecture

Keep the supplied design:

- Next.js / React / TypeScript web application, Tailwind/shadcn-style components, CesiumJS and a focused linked plan editor.
- Android-first Expo / React Native / TypeScript mobile client. Full SQLite/outbox synchronization follows the online MVP; do not advertise it before implementation and device tests.
- One versioned application REST API under `/api/v1` in the Next.js server with shared TypeScript packages.
- Proposed Keycloak/OIDC identity with server-managed web sessions and browser-based native authorization-code/PKCE. Freeze the exact supported configuration after checking installed/current documentation.
- PostgreSQL/PostGIS registry; private S3-compatible file storage; Redis/Celery; private FastAPI/Python processing.
- The application owns scope, source registration, user-visible job state, revisions, review, identity and accepted records. Workers return attributable technical results and staged artifacts.

Do not create another application backend, a public FastAPI case/review system, a graph database, nine deployed microservices, or one application per role. Do not replace the stack just because a worker prefers another framework.

Use existing compatible packages and conventions when present. For a fresh repository, pin a tested set once. Do not repeatedly reinstall “latest,” rewrite the lockfile in multiple worktrees, or turn dependency upgrades into the main task.

## 5. Preflight before expensive parallel work

The lead performs T00 and records a small `docs/execution/SESSION_STATE.json`:

**Environment:** actual repository/root and current branch; uncommitted user changes; relevant instructions; available shell, package managers, containers, network, browser, Android/emulator/device, and existing deployment capabilities. Report inaccessible capabilities rather than inventing them.

**Agent runtime:** native spawning/wait/close functions actually exposed, supported model IDs/efforts and whether overrides are confirmed. A prose role label is not proof that a worker ran on that model. Use native delegation; do not create paid API calls as a substitute.

**Allowance:** percentage labels, five-hour and weekly readings where visible, reset timestamps, purchased-credit balance where visible, and whether this session can observe updated readings. Preserve “unknown” explicitly.

**Sources:** locate the authoritative files and identify which existing artifacts are implementation rather than proposals. Read 01/02 and revised 03 as necessary; the old staffing correction is already decided.

**Safety:** local/development work only unless an existing grant clearly covers another target. Do not create a public repository, merge to production, incur cloud/API purchases, alter billing, contact dataset custodians, delete user files or reset a non-disposable database without appropriate authorization. Do not print environment secrets or private evidence into reports.

Produce one short decision record, not a new architecture treatise. The next output must be executable work.

## 6. Budget target and the 20% assumption

Treat “20%” as a **target**, not an estimate supported by a benchmark. No project-specific usage measurement is supplied. Earlier credit/token scenarios do not establish what fraction of this account’s allowance the MVP will consume.

**Default interpretation for this handoff:** target at most 20 percentage points of the full five-hour allowance, with a separate ceiling of 20 percentage points of the full weekly allowance where that meter exists. These are two independent guards, not percentages to add together. This default resolves the unspecified window conservatively; it is not a claim about OpenAI billing.

Example: remaining allowance moving from 90% to 70% consumes 20 percentage points of that full window. It is not “20% of the 90% remaining.” Track the meter label because some screens show used rather than remaining.

Use the detailed [budget/runtime policy](05_BUDGET_AND_RUNTIME.md). Its essential rules are:

1. Record a baseline before substantive work. Read again after each finite ticket/batch. Avoid attributing unrelated simultaneous account activity to this project; mark contaminated readings.
2. Start with a small calibration batch: contracts/runtime inventory and one prism-feasibility result, with at most two workers. Do not extrapolate foundation cost as a guarantee for integration cost.
3. Reserve the final quarter of the project budget for integration, testing, checkpointing and handoff. Stop dispatching new feature tickets around 75% of the selected task budget—not when the last token is gone.
4. Reduce to one finishing/fixing worker near the reserve. No later-phase features or broad research spend from this reserve.
5. Stop expansion before either budget/window floor is reached. In-flight calls and delayed meters mean a prose cap cannot guarantee exact billing.
6. If telemetry is unavailable, perform only the bounded calibration work and checkpoint. Do not silently run the whole swarm while claiming a 20% ceiling. A user-supplied reading can later resume the saved run; no automatic background continuation is promised.
7. Never buy credits, apply a saved/purchased reset, enable reload, switch to API billing, or exhaust an existing purchased balance to meet the finish line. Existing account-level automatic behavior is not controlled by this prompt; check the available settings and stop before included allowance is exhausted.
8. If a window resets, preserve the prior segment’s cost. Do not erase expenditure by treating the new 100% reading as a new free project budget. When the old segment cannot be reconstructed, mark the cumulative figure unknown and pause new work.

Finishing the whole MVP within 20% may or may not be possible. The contract is to maximize **verified, integrated completion** within the measured budget and provide a useful partial checkpoint rather than pretend both goals were met.

## 7. Agent topology and model policy

The primary is **O-LEAD: Astra High**. It is both architect and integrator, not a passive dispatcher. It owns contracts, priority, merging, acceptance evidence and final handoff.

There are ten available specialist profiles, **not ten simultaneous workers**:

| Profile | Requested model / effort | One accountable job |
|---|---|---|
| C-PLATFORM | Astra High | Runtime, migrations, auth/access, verified storage helpers and durable job plumbing. |
| C-GEOMETRY | Astra High | Supported prism computation, reference checks, construction and structured findings. |
| C-LIFECYCLE | Astra High | Candidates/evidence workflow, exact submissions, safe decisions, identity and lookup. |
| C-INTAKE | Astra Medium | Thin intake/source routes and bounded CSV/JSON/plan-reference inspectors using core helpers. |
| C-WEB | Astra Medium; targeted High | Real web workspace, linked plan/3D editor and role-correct workflow consumers. |
| C-MOBILE | Astra Medium; targeted High | Online Expo task/attachment/receipt flow, minimal Team and lookup consumers. |
| C-VERIFY | Astra High for adversarial review; Medium for routine execution | Independent fixtures, negative/race tests and reproducible integration evidence. |
| R-EXTRACT | Luna Low | Exact fact/table/schema extraction from specified materials; no substantive policy judgment. |
| R-RESEARCH | Terra Medium | Bounded primary-source compatibility or acquisition decision answering one implementation question. |
| R-RESOLVE | Sol High | One disputed or subtle technical/source question escalated with evidence. |

These are proposed task assignments, not benchmark claims. All substantial implementation remains Astra by default.

**Concurrency:** at most three active subagents, excluding the primary. Prefer two coding lanes plus one research/verification lane. One active writer per overlapping file set, no recursive child spawning, no speculative background research and no idle agents waiting for contracts. Close completed threads. If a tool cannot enforce the ceiling, the lead must enforce it in dispatch decisions.

**Effort escalation:** try the correct scoped inputs first. Escalate one reproducible geometry, review/concurrency or difficult integration issue to Astra xhigh; return to the normal setting afterwards. Never set the entire swarm to xhigh because the lead started there. Sol High is for evidence synthesis, not automatically a cheaper substitute for every coding task. Do not escalate for missing credentials, unavailable data, or a dependency not installed.

**Availability fallback:** map the requested name to the runtime’s actual available ID and supported effort. If an economical research model is missing, use the next available economical option for that one bounded task, recording the substitution. If only Astra is available, use Low/Medium for the narrow research question and reduce concurrency. If effort/model overrides cannot be applied, record inheritance and reconsider the budget; never claim mixed-model savings that did not occur.

**No native subagents:** execute the same tickets sequentially in the parent and mark the run sequential. Do not simulate multiple actual agents in prose or use a paid provider API without separate authorization.

Read [agent cards](02_AGENT_CARDS.md) for the actual worker instructions. Every dispatch also carries a concrete [work ticket](templates/WORK_TICKET.md). A role name alone is not an assignment.

## 8. Protect shared files and integration

The lead creates one integration branch in the authorized repository; proposed name: `astra/mvp-manual-lifecycle`. Preserve the actual branch/base and user changes. Reuse an existing appropriate branch rather than overwriting it.

Use isolated worktrees/branches when available. All workers start from the same explicitly recorded contract/base commit, then refresh only at agreed merge boundaries. Without isolation, use non-overlapping path leases and serialize Git operations; the primary alone stages/commits shared-tree changes.

**Single merge owner:** O-LEAD. **Single migration author:** C-PLATFORM while its lease is active, with lead review. **Single public-contract writer:** O-LEAD. A worker requests a contract/schema change with a minimal concrete proposal; it does not fork the contract in client/Python code.

Suggested path ownership, mapped to the actual repository during T00:

| Owner | Writable area | Explicit exclusions |
|---|---|---|
| O-LEAD | `packages/contracts`, `packages/client`, root workspace/lockfiles, coordination and integration glue | No edits to an active worker’s leased files without handback. |
| C-PLATFORM | `infra`, `packages/database`, platform/auth/storage/jobs helper subdirectories | No independent UI/editor or domain-review implementation. |
| C-GEOMETRY | `services/geo/geometry`, spatial rule tests, its declared operation handlers | No source adapter folders leased to C-INTAKE; no accepted-registry writes. |
| C-LIFECYCLE | Scoped domain case/unit/evidence/review/registry folders and their route folders | Source route family belongs to C-INTAKE; migrations/contracts require a request. |
| C-INTAKE | Source route family, `services/geo/adapters/basic`, intake tests | No auth policy, review transactions, migration files or geometry engine. |
| C-WEB | Web pages/components/styles outside API routes | No application API, client contract forks or authoritative browser measurements. |
| C-MOBILE | `apps/mobile` | No API/backend review rules, no offline acceptance. |
| C-VERIFY | `fixtures/c001`, independent `tests/acceptance`, test evidence | Read-only production code unless a separate narrowly scoped fix lease is granted. |
| Research profiles | `docs/research/<ticket-id>` only when writing is supported | No production code, fixture truth changes, root dependencies or external side effects. |

The fixture writer is C-VERIFY; C-GEOMETRY consumes fixtures and writes its own engine tests. This prevents the production function from generating the only supposed independent expected answers. Service registration/root Docker wiring remains with the lead/platform owner; operations request registration rather than competing edits.

Before merge: review the diff, verify allowed paths, run the task tests and contract checks, integrate onto the current branch, rerun the impacted integration test. A passing test in a worker’s stale branch is not proof the merged product works.

## 9. Proposed finite geometry and data profile

This section resolves open implementation choices for a fresh prototype; it is **not source-provided site data**. Reuse a consistent existing tested fixture when one exists and record the mapping.

### Authoritative family

Start with one simple planar polygon and constant lower/upper limits in a single named metric local frame. Exclude holes, multipolygons, sloping/curved surfaces and arbitrary solids until explicitly supported and tested. Reject unsupported shapes; do not flatten them. Keep numeric tolerance separate from measurement uncertainty.

Store the reconstructible boundary specification, measurement basis and source bindings. Treat meshes as display artifacts. Do not require a generic solid engine solely to multiply a supported prism’s footprint area by its height; document the finite operation profile and test it independently. PostGIS remains the spatial registry. Test any later generic-solid claim in the real deployed extension/library image first.

For this family, compute intersection using the valid footprint intersection and positive shared Z interval. Boundary-only contact is distinct from positive interior overlap. Filter pairs by compatible reference, time and relationship semantics: a containing building envelope is not a competing exclusive apartment, and a parcel is not an infinitely extruded ownership space.

### Synthetic layout proposed here

Use `LOCAL-C001` horizontal metres and `BM-DEMO-A` vertical metre offsets. There is no asserted geographic location or official CRS code.

| Element | XY extent in metres | Z extent in metres |
|---|---|---|
| P-A | x 0–14, y 0–12 | Surface context only |
| P-B | x 14–28, y 0–12 | Surface context only |
| B01 envelope | x 2–12, y 2–10 | Physical/context envelope as declared |
| U01 | x 2–6, y 2–10 | 0–3 |
| U02 | x 8–12, y 2–10 | 0–3 |
| U03 | Same footprint as U01 | Draft 2.8–6; corrected 3–6 |
| U04 | Same footprint as U02 | 3–6; evidence still required |
| Common lower space | x 6–8, y 2–10 | 0–3 |
| Common upper space | x 6–8, y 2–10 | 3–6 |
| BSM-01 | x 2–12, y 2–10 | −3–0 |
| C-UG1, fixture reserved for later | x 8–22, y 5–7 | −5–−4 |

Independent arithmetic expectations for this proposed layout: apartment footprint 32 m²; ordinary apartment volume 96 m³; erroneous U03 volume 102.4 m³; U03/U01 overlap 6.4 m³ within 2.8–3.0 m; corrected interior overlap 0; basement volume 240 m³. The reserved corridor is below the basement with no interior collision. These numbers follow from this handoff’s rectangles, not from surveyed facts or unseen project drawings.

### Source profile

Create actual small synthetic originals: parcel-local JSON, raster plan reference, control CSV, level-schedule CSV r1/r2, and synthetic rights/relationship support as required. A local-coordinate JSON envelope is not geographic RFC 7946 GeoJSON; name the profile `parcel-local-json-v1` and label its local frame. Do not silently encode metre coordinates as longitude/latitude.

This is an explicit synthetic-fixture adapter addition for the MVP, not a replacement for the baseline’s eventual GeoJSON/GeoPackage external input routes. An external geographic parcel can be received/inspected without being usable for local construction until its transformation is supplied and tested. Preserve unsupported status rather than pretending external survey ingestion is complete.

Generate the small plan fixture as data, not branding artwork, with explicit scale/control metadata. Start with one supported PNG plan-reference route; PDF reference rendering can follow as a bounded teammate task or be included only when an existing tested renderer already works. Never claim universal plan extraction from this reference display.

E-LEVEL-02 r1 must genuinely lack the needed upper-storey lower-limit support; the erroneous 2.8 value belongs to an unverified candidate, not a fabricated supporting measurement. r2 supplies the supported 3.0 m values, benchmark/method metadata and locators. Candidate binding is an explicit user action after suitability inspection.

In Cesium, use a tested display-only transform for a clearly labelled schematic local workspace. Do not place the fixture over a real city or assign an official EPSG/geolocation to make the globe render. Changing display transforms must not change stored geometry or quantities.

## 10. Shared contracts before parallel consumers

Freeze the minimum source manifest, source locator, geometry specification, inspection result, finding, request/response, processing job, submission, decision and registry lookup shapes. Use schema-valid success/error fixtures. Generate or validate TypeScript and Python representations against the same versioned schema; do not manually maintain divergent public meanings.

For every operation define: trusted identity/scope, required fields, null/unknown meaning, supported size/profile, expected revision, idempotency namespace, response, error shape and next consumer. Reject or ignore client-supplied authority fields according to an explicit schema; never use them for decisions.

Key distinctions to preserve:

- Transfer receipt, source usability, successful processing and accepted record are separate states.
- A source family differs from an immutable source revision. Signed transport URLs are not permanent source identities.
- Source date, effective time, recorded time, submission time and decision time are separate; unknown dates remain unknown.
- Geometry revision, rights/relationship revision, source binding, validation snapshot and stable unit identity are separate.
- A phone note/photo/location is evidence context, not an inferred survey or approval.
- Model score, measurement quality, evidence completeness, geometry finding and review decision are not combined into one acceptance score.

Every submission fixes the unit and source revisions, relationship/evidence dependencies, relevant-neighbour set/revisions, validation/profile/policy versions and actor. A new candidate/source binding cannot silently reuse a former result or approval.

### Small public operation set

Retain the proposed baseline paths; freeze exact missing details once:

`GET /api/v1/me/context`; case create/list/detail and bounded assignment operations; source upload-session/finalize/list/detail/read-link; `POST/GET /api/v1/processing-jobs`; candidate unit revision write/read; component binding and minimal rights/relationship associations; findings; evidence-request create/read/response; submission create/read/decision; accepted registry lookup/history.

Use controlled operation/profile IDs for private jobs, not user-supplied executable names, URLs or filesystem paths. Do not implement every later route family as a nonfunctional stub just to check a box.

## 11. Critical mechanism requirements

### Source receipt and private files

Authorize project/case before creating a slot. Use an allowlisted source profile, bounded size, verified receipt/type and recorded integrity information. Finalization must inspect the server-side stored object rather than trusting a client “uploaded” flag. Prevent later overwrite of finalized evidence through a still-live upload slot: use an immutable object version or move/copy verified staging bytes into a protected final object, and bind that stable version.

Namespace idempotency by authenticated scope and operation. Same key and same logical payload resolves the same result; reused key with changed payload yields a conflict. Matching file hashes do not automatically merge different evidence records. Read links are scoped and expiring; permanent source references survive link expiry. Do not expose provider/storage credentials to web or native clients.

### Jobs and technical results

Persist the job and dispatch/outbox record transactionally. The private processing service validates the allowlisted operation, input revision references and service authorization. Celery performs the work; the application ingests results idempotently for the original fingerprint. Worker/database credentials cannot publish accepted records.

Exercise duplicate completion, failed dispatch/retry, worker failure and late results after a candidate changes. Queue success is not domain success. No arbitrary public callback can forge a successful validation. Missing processing access is a blocker, not permission to use hardcoded success responses.

### Review and concurrency

Choose and test a clear MVP transaction strategy. A conservative proposed choice is to serialize review-relevant mutations within a project via a shared lock/epoch mechanism, with every relevant mutation participating, then compare the complete snapshot and write the decision atomically. A per-case lock alone is insufficient when relevant neighbours can change in another case. A narrower strategy is acceptable only with equivalent race tests and a documented decision.

The protected operation rechecks current actor authority, self-review policy, exact unit/source/evidence/rights/policy/neighbour snapshot, required suitability and validation state. Include tests for insertion of a new relevant neighbour, not only changing an already known row. Do not let an unlocked precheck authorize a later write. Return explicit stale/denied/requirements errors.

This is a tested prototype mechanism, not a claim of legal correctness or tamper-proof history against every administrator. Prevent unauthenticated writes and preserve attributable decisions from the first lifecycle.

### Identity

Draft internal keys exist before acceptance. Publish/resolve a stable **prototype** identity on accepted records; preserve official ULPIN values exactly when genuinely supplied. Do not manufacture official-looking national identifiers. An issuance retry yields the same identity. A later candidate keeps the current accepted pointer until a fresh authorized decision.

### Client truthfulness

The web can preview an edit locally but renders stored authoritative results distinctly. Saving a candidate, receiving a mobile response, and accepting a submission are different actions/states. Native client has no final acceptance route/UI. Admin navigation does not grant reviewer powers.

Native API/OIDC URLs must be reachable and consistent for the browser, device and services. Verify issuer, redirects, callback URI and network addresses in the actual setup; do not assume the phone’s localhost is the development computer. Do not solve connectivity by disabling authentication.

### Error behavior

Use actionable typed errors with request IDs. Cover unknown references, unsupported geometry/profile, missing evidence, failed upload/job, stale revision, denied scope and expired session. No silent unit guessing, automatic outline repair, automatic source rebinding, hidden duplicate operations or generic success after a rejected decision.

## 12. Execute in bounded waves

Follow the [task graph](03_MVP_TASK_GRAPH.md). It supplies each packet’s inputs, paths, output, tests and unlocks.

| Wave | Primary work | Suitable parallel workers | Exit evidence |
|---|---|---|---|
| W0 — Inspect and freeze | Lead preflight, source precedence and minimum contracts; calibration | One bounded researcher if needed; geometry feasibility ticket | Actual environment/model/budget report; common contract; independent prism feasibility. |
| W1 — Establish producers | Runtime/security/storage/jobs, independent fixtures and geometry | C-PLATFORM, C-GEOMETRY, C-VERIFY with disjoint paths | Auth/scope test, real local stores/queue, consistent fixture and computed geometry. |
| W2 — First real intake | Source routes/inspectors, candidate/evidence services, minimal web consumer | C-INTAKE, C-LIFECYCLE, C-WEB as their helper dependencies release | Upload → immutable source → real inspection → usable candidate inputs. |
| W3 — Close the lifecycle | Protected decision/identity plus full linked workbench and phone loop | C-LIFECYCLE, C-WEB, C-MOBILE | Real source/request IDs travel phone→web; separate reviewer accepts and lookup persists. |
| W4 — Verify and repair | Lead integrates; independent negative/race/end-to-end tests | C-VERIFY and only the owner of a concrete failing area | Required acceptance evidence, no core mocks, clean-start reproduction. |
| W5 — Hand back | Lead reconciles completed work and remaining human tasks | Optional Luna extraction of actual test/task status, not a new audit | Reproducible commands, release status, limitations, A/B/V next packets and resume state. |

These waves are internal subdivisions of baseline Phases 1 and 2. They are not a replacement six-phase product roadmap. Start a consumer against a frozen mock when useful, but its capability does not become verified until the real producer is used.

## 13. Verification must shape implementation

Use [the acceptance matrix](04_ACCEPTANCE_MATRIX.md). Write independent expected outcomes before or alongside production code. Authors run their own tests; C-VERIFY adds independent checks and does not become a dumping ground for untested work.

At minimum, include source upload retry/partial/mismatched/finalized-overwrite checks; signed read access; wrong-role/cross-project/self approval; same-frame contact versus overlap; missing/incompatible references; measurement convention/evidence distinction; unsupported shape; stale/late jobs; stale submissions; neighbour insertion/change races; duplicate decisions/identity; persisted lookup; and the real online mobile round trip.

Provide command, runtime/version, fixture IDs, expected result, actual result, test output path and tested commit. “Not run” is a valid report; fabricated success is not. An HTTP-only test does not prove the plan/3D view is aligned, and an Expo typecheck does not prove native login/attachments work.

Run one small unfamiliar geometry fixture in the same finite profile to detect U03-specific hardcoding. This is a correctness sanity check within the MVP, not completion of the later Phase 6 pilot, exchange or field validation.

## 14. Quality without scope inflation

Build a task-oriented usable workbench rather than a landing page. Keep one selected unit across tree, plan, 3D and Evidence. Show the actual 2.8–3.0 m overlap region, current candidate revision, source support and next action. Distinguish draft and accepted visuals without changing the data.

Use readable labels, units, empty/loading/error states and keyboard/touch-accessible controls. Test the real layout at a normal desktop size and a narrow viewport; test mobile text entry, keyboard behavior, attachments, loading, error recovery and receipt persistence. Do not spend the reserved integration budget on themes, animation, multiple landing pages or presentation assets.

The user-facing product must not display this handoff, agent activity, task IDs, internal contribution audits or planning commentary as project features.

## 15. Bounded failure recovery

A worker may try two materially different fixes for the same bounded failure, retaining the reproducer and outcome. After that, hand the issue to the lead for one targeted escalation or a supported fallback decision. Do not repeat identical failed commands, launch duplicate fix agents, or redesign the stack without evidence.

Classify the failure: code defect, contract mismatch, dependency/runtime incompatibility, permission/network blocker, unsupported input, or budget stop. Each needs a different response. Missing external data uses the explicit synthetic fallback; failed authorization does not use an auth bypass; unsupported complex geometry does not flatten; missing Android access yields a verification gap.

Checkpoint after every merged gate. Preserve base/last-tested commit, working tree status, completed tasks, active leases/agents, exact failures, remaining budget evidence and the next runnable ticket. No background execution or future delivery should be promised after the turn stops.

## 16. Final deliverables from the implementation run

Deliver a runnable repository or clearly identified authorized branch/worktree, plus:

| Artifact | Required content |
|---|---|
| `README.md` | Exact tested setup/migrate/seed/run commands; service URLs; demo identity setup; supported scope. |
| `.env.example` / development config | Variable meanings without real secrets; device/issuer/storage setup; explicit demo-only defaults. |
| `docs/contracts/` | Frozen public/private schemas, examples, errors, profiles and revision semantics. |
| `fixtures/c001/` | Actual synthetic originals, manifest, provenance and independent expected outputs. |
| `docs/testing/MVP_REPORT.md` | Required test IDs, command/result evidence, environment/device labels and tested commit. |
| `docs/execution/MVP_STATUS.md` | Evidence-based status, integrated capabilities, remaining mocks/gaps and blocked tasks. |
| `docs/execution/SESSION_STATE.json` | Resume context, branch/commits, task state, model/budget observations and unresolved decisions. |
| `docs/handoff/TEAMMATE_A_NEXT.md` | Immediate bounded data/adapter/test work using what was actually delivered. |
| `docs/handoff/TEAMMATE_B_NEXT.md` | Immediate bounded API/UI/device-test work using what was actually delivered. |
| `docs/handoff/VINAYAK_NEXT.md` | Core decisions/fixes and the next Phase 3–6 enabling mechanism. |

Do not claim planned commands ran merely because they are printed in README. Do not report lines of code, number of agents or number of commits as the main measure of completion.

Finish with: what a user can actually do now; where the implementation lives; how to run it; the exact validation status; observed usage with its window and uncertainty; and each human’s next actionable task. If incomplete, identify the smallest remaining path to the original MVP without renaming the partial result “complete.”

**Start with T00, then implement. Keep one coherent case, truthful evidence and an extendable core. Stop at the declared MVP or the budget guard, not at an arbitrary file count.**


---

<!-- Section source: 02_AGENT_CARDS.md -->

# Specialized child-agent cards

**Ten reusable child-role profiles; never ten simultaneous workers. The parent O-LEAD runs Astra high and follows the master handoff.**


## Rules shared by every worker

You implement only the assigned ticket, not the whole project. The ticket states your actual model/effort, immutable input contract/base commit, writable paths, dependency artifacts, required checks, output consumer and stop condition. Read the small relevant source sections supplied by the lead; do not reread the whole archive, reproduce the plan, or recruit other agents.

Do not edit outside your path lease. Propose a contract/migration/dependency change to the lead; do not silently patch consumers to a private schema. Never overwrite another worker’s modifications, change root lockfiles in parallel, commit secrets, weaken tests, or fake external access, model selection, processing results or device verification.

Make a small implementation, run its focused checks, and return one delivery report: task ID; actual model/effort if observable; base/result commit or patch; changed paths; contracts consumed; command/exit result; evidence paths; integration entry point; limitations and exact next consumer. A summary saying “done” is not the deliverable. Do not dump full files/logs into the parent context when paths and concise excerpts suffice.

A failed attempt must produce a reproducible defect. After two materially different unsuccessful fixes of the same blocker, return the evidence to the lead instead of opening an unbounded debug/research loop. Do not terminate the whole project yourself; finish your bounded report and let the lead reassign or resolve it.


## C-PLATFORM — Platform, trusted primitives and runtime

**Preferred:** Astra · high


You are the platform implementation specialist. Deliver a repeatable local runtime and the small trusted mechanisms that unblock the other workers.

**Read:** 02 §§2,4,13; revised 03 V01; the frozen contract pack; T03/T04. Inspect the actual repository before adding infrastructure.

**Own:** `infra/`; approved database schema/migrations; auth, scope, storage and durable-job helpers; corresponding unit tests. The lead owns shared public contracts, root manifests/lockfiles and integration. Submit migration proposals before they are applied outside your isolated development database.

**Implement:** PostgreSQL/PostGIS, private object storage, Redis/Celery and private processing bootstrap; reproducible identity configuration with distinct demo users; server-derived request context; case/source/project guards; a reference guarded endpoint; controlled upload/read/finalize helpers; transaction outbox and idempotent technical-result ingestion. Pin compatible dependencies once and document exact startup/health commands. Expose only required service interfaces.

**Particular risks:** A browser-visible object-store URL may not work on the phone or inside a worker container. Resolve this deliberately. Do not make the bucket public, bypass OIDC, trust client actor/accepted fields, or expose the private processor to solve connectivity problems. Issuer validation must remain correct across server/browser/native paths. Prevent retained presigned upload access from changing an already finalized original: use immutable object versions or verified promotion to a distinct immutable key under policy.

**Done:** A second process can start the stack and use the same contract; denied/cross-project access fails; verified finalization and duplicate operations behave as specified; a real durable job reaches a registered result after a retry; no worker publishes accepted records. Produce tested helpers, not just a Docker Compose file.

**Handoff:** T06 gets source/storage helpers; T07 gets domain persistence/scope; T10 gets the actual native identity/network instructions; the lead integrates public registrations. Do not start generalized offline, billing, cloud deployment or production hardening beyond this MVP.


## C-GEOMETRY — Supported metric geometry and technical findings

**Preferred:** Astra · high


You are the authoritative supported-prism implementation specialist, not a generic 3D-engine researcher.

**Read:** 01 §§10,12; 02 M5/M6 and §14; the frozen `GeometrySpec` and inspection/check result schemas; independent fixture expectations. Own only `services/geo/geometry/`, the assigned geometry operation handler and your focused tests.

**Implement:** Finite, valid simple planar footprints without holes for the initial declared profile; constant lower/upper limits; matching local metric frame/benchmark/units; area, height, volume, closed display representation and contact versus positive-interior overlap. Reject unsupported shape families and nonfinite coordinates rather than silently flattening them. Preserve the authoritative specification separately from display meshes.

Use a tested polygon computation for the declared profile. Compare results with the independent analytic fixtures; do not claim arbitrary-solid validity merely because a polygon is 2D-valid or a mesh looks closed. Research alternative engines only when the declared prism route actually fails. The runtime must support the operations you expose; optional general-solid extensions are not a prerequisite for this narrow route.

**Specific C-001 checks:** For the newly proposed 32 m² unit footprint, the erroneous U03/U01 shared height is 0.2 m and intersection volume is 6.4 m³. Correcting the lower limit to 3.0 m removes positive interior overlap. The basement is −3–0 m and contact at zero is not a collision. Common spaces and building containment are not indiscriminately treated as mutually exclusive apartment overlap.

**Output:** Snapshot-bound technical results with method/version, units/frame, rule IDs, numerical tolerance and actual affected geometry. No U03-specific switch statement; changed input coordinates must change the computed result. Use deterministic rule categories but instance IDs can be server allocated; preserve F-OVERLAP-01 as the fixture’s human alias, not a hardcoded engine response.

**Done:** Valid/contact/overlap/invalid-reference cases pass independent expected checks, a second rectangle case also works, and a real private job returns the exact input fingerprint. The application, not this worker, decides evidence readiness and acceptance.

**Escalate:** A reproducible reference/representation or algorithm failure. Ask for one targeted xhigh investigation only if high has a concrete unresolved problem. Do not consume xhigh for routine serialization or screenshots.


## C-LIFECYCLE — Candidate, evidence, review and stable identity

**Preferred:** Astra · high


You are the application-domain implementation specialist. Finish the persisted lifecycle, with correctness concentrated at the review transaction.

**Read:** 02 M1/M5/M6/M8/M9 lookup and §13; 01 §11/§12; revised 03 V02/V03; source/geometry/evidence/submission schemas. Own the assigned TypeScript domain subpackages and case/unit/evidence/submission/registry routes. Source upload routes and platform primitives belong to other leases.

**Implement:** Immutable candidate revisions with expected-revision writes; four component evidence bindings; minimum synthetic rights/relationship associations under explicit policy; processing-result attachment to its exact snapshot; targeted requests and attributable responses; explicit source suitability/binding; fixed submissions; return/accept decisions; accepted pointers, stable prototype identity and scoped lookup/history. Consume geometry results rather than recalculating geometry in JavaScript.

**Review safety:** Model freshness across unit/source/evidence/relationship/policy/relevant-neighbor state, not only one unit version. Choose and test one conservative concurrency strategy. The proposed MVP strategy uses a shared project guard/epoch for relevant mutations and decision checks; all relevant writers, including neighbor insertion and policy/access changes, must participate. A case-only lock cannot protect another case’s relevant neighbor. A check before an unprotected write is insufficient.

**Idempotency:** Same logical operation and same payload resolves the same outcome. Reusing the key for a different payload is rejected. Retries cannot create duplicate evidence, decisions or published identity. Keep accepted data intact after a later working edit. Synthetic prototype identifiers must be visibly distinct from supplied official ULPINs and do not assert title.

**Source semantics:** Receiving r2 does not automatically approve it or rebind U03/U04. The preparer explicitly checks/binds suitable evidence, produces new candidate snapshots, and checks both relevant upper units. This minimum freshness behavior is not the generalized Phase 4 dependency-preview engine.

**Done:** Real-service tests cover the complete case plus self/wrong-role/cross-project decisions, stale evidence and neighbor updates, races and retries. No accepted record exists in the clean seed. Registry lookup after acceptance returns the same persisted identity/revision.

**Handoff:** Provide real endpoints early to web/mobile, preserving schema-valid mocks only until replaced. Keep review and registry logic out of UI and worker code.


## C-INTAKE — Source APIs and bounded input inspectors

**Preferred:** Astra · medium


You are the intake specialist. Connect file receipt, source metadata and simple technical inspection into one usable path.

**Read:** 02 M3; revised 03 A03/A04/B03 and intake field ownership; exact supported-format manifest. Own source upload/finalize/list/detail/read routes, bounded basic Python adapters and their tests. Do not edit storage/security helpers, geometry algorithms, migrations or public schemas without the lead’s review.

**Implement:** Wire the trusted authorization/storage/finalization primitives. Preserve immutable originals and metadata, stable source revision references, explicit provider/synthetic status, purpose, local reference/units, source/effective time when known and ancestry. Use server-owned actor, receipt time and authoritative revision values.

Implement `parcel-local-json-v1`, the selected control/level CSV profile, and PNG plan metadata/manual-reference inspection. A local metric JSON profile is not standards-compliant longitude/latitude GeoJSON: label it honestly. Richer source formats may be inventoried, but disabled profiles must not appear implemented. Do not add universal PDF understanding, arbitrary user-URL downloads or guessed coordinate transforms.

Return field/row/component issues for malformed values, missing units/reference, unsupported profiles and incomplete evidence. A syntactically accepted file can remain unusable for a purpose. Rendered plan pixels or a successfully opened file do not certify a boundary. Keep job output tied to the original source revision and fingerprint.

**Done:** A supported raw fixture is uploaded, verified, inspected through the real private job and reopened through scoped reads; missing metadata is actionable; duplicate finalization is harmless; changed payload under a reused key and cross-project access fail. Original content cannot be changed after finalization using a still-valid staging upload.

**Handoff:** Web receives source statuses/locators, mobile receives the approved upload path, and geometry consumes only the agreed suitable inputs. Research a provider adapter only when the lead supplies a specific authorized core-data ticket.


## C-WEB — Usable linked web workbench

**Preferred:** Astra · medium; high for a bounded precision-editor problem


You are the web product engineer. Build a coherent task flow, not a landing page or a dashboard of invented metrics.

**Read:** 01 §4 navigation, §9 screens, §12 case; frozen shared client/contracts; actual endpoint readiness. Own assigned web routes/components excluding all API routes, root dependency files and shared contracts.

**Implement:** Case/source intake, unit tree, linked plan and CesiumJS view, selected-unit details, basic valid footprint editing and explicit lower/upper input, four evidence components, findings with exact affected-region highlight, evidence request/response panel, fixed-submission review UI, registry lookup and history. Reuse one design language and generated/shared client. A unit selected in any view stays selected in the others.

The local fixture is not geolocated. A display-only transform may place it in the renderer’s coordinate system, but no map/label/export may imply that arbitrary placement is the measured property location. Keep local-coordinate labels and a synthetic banner. View state never modifies authoritative coordinates or quantities. Unknown reference/evidence must remain visible even when a shape can render.

Make the initial correction workflow usable: selecting U03 opens its lower-limit evidence; the overlap highlights only the actual 2.8–3.0 m interior; the received r2 is inspectable; the explicit edit/binding saves a new snapshot; stale checks block submission until rerun. Separate preparer and reviewer identities instead of a client-side role dropdown that grants permission.

**States:** Empty/loading/uploading/processing/denied/invalid/stale/retry and source-suitability status. Do not hide failure messages under an attractive green badge. Disabled later modules cannot look complete. Basic keyboard/focus and small-viewport behavior are part of your delivery.

**Done:** The core flow runs against actual services and survives refresh/relogin; browser screenshots and interaction logs are from the tested commit. A demo-only mock transport is labelled and cannot satisfy required acceptance.

**Escalate:** A specific contract or endpoint defect with request/snapshot ID. Do not fix missing backend behavior by storing accepted data only in browser state.


## C-MOBILE — Thin online Android evidence loop

**Preferred:** Astra · medium; high for one native auth/build blocker


You are the Android-first Expo implementation specialist. Deliver the essential field/admin companion early; do not wait for web polish.

**Read:** 01 §4 mobile roles/navigation; 02 M2 online subset; revised 03 B06; frozen identity/upload/evidence client contract. Own `apps/mobile` and its focused tests, excluding shared contracts/root manifests and any future sync protocol.

**Implement:** Actual browser-based sign-in using the agreed OIDC/PKCE setup, secure token handling, assigned task list/detail, limited My tasks/Team views for authorized administrators, note/file/photo attachment, online submit, explicit received/failed states and permitted basic lookup. Use the same API/request/source IDs as web. A phone cannot access the host through an assumed `localhost`; consume tested reachable endpoints while preserving issuer/security validation.

Keep capture purpose honest: a photo of a schedule does not measure elevation, and phone location is context. Upload through the approved source path before returning finalized source references. Persisted server receipt is distinct from local form state. Network failure cannot be reported as received. Basic operation IDs should support safe online retry without promising the full durable offline outbox.

**Not in this ticket:** Full offline queue/sync, native precision CAD, final spatial acceptance, untested sensitive-file caching, or separate apps per role. The Sync navigation may explicitly explain that reliable offline functionality is deferred; do not invent a working queue.

**Done:** Type/build checks and available native execution run. On an actual authorized Android device, an assigned officer opens RQ-LEVEL-01, returns r2, receives one response and sees the same source/response on web. An authorized administrator sees permitted task progress; forbidden team actions fail server-side. If no device is available, deliver implementation/emulator evidence plus exact device steps and mark the actual-device check NOT_RUN. Do not claim browser testing proves native behavior.

**Handoff:** Provide the device build/run procedure, API base/issuer configuration without secrets, exercised IDs and known keyboard/picker/network issues. Return platform/auth defects to their owner rather than bypassing them.


## C-VERIFY — Independent fixtures, adversarial tests and integration evidence

**Preferred:** Astra · high for adversarial correctness; medium for routine execution


You are the independent verification engineer. Your job is to disprove incorrect completion claims and produce reusable tests—not rewrite all production code.

**Read:** The finish line and exact acceptance matrix; frozen contracts; supplied C-001 facts and explicitly proposed XY layout. Own the assigned fixture/test/evidence paths. Read production code as needed, but route implementation defects to the lead and code owner.

Write independent expected fixture results before consulting the production output: rectangle area and interval arithmetic, allowed/denied actor cases, revision relationships and response identities. For C-001, expected U03/U01 overlap is 6.4 m³ under the new 32 m² footprint. Corrected overlap is zero. Use a different rectangle/height fixture to detect hardcoding; expected values must not be generated solely by the production function being tested.

Exercise the complete clean-seed lifecycle through actual APIs and available real clients. Include incorrect role/self/cross-project access, source receipt versus suitability, mutated/missing upload, duplicate logical operation, reused key with altered payload, stale processing result, missing evidence, stale neighbor insertion/update and concurrent review. For a concurrency test, create controlled interleavings; two sequential requests are not proof of race safety.

Track exact test commit, command, exit status, seed/environment, request/snapshot IDs and evidence artifact. Distinguish automated service, browser, emulator and actual-phone checks. A screenshot of a completed form does not prove persistence or correct backend authorization. Do not create misleading green stubs or mark planned commands passed.

**Done:** Required acceptance rows have actual PASS/FAIL/BLOCKED/NOT_RUN outcomes; every failed requirement has a minimal reproducible defect and owner. The lead can accurately classify the release. A full module is not accepted merely because this bounded fixture works.

**Scope:** Run focused suites while implementation proceeds; reserve the final integration batch for real end-to-end, fresh-start and adversarial checks. Do not consume the budget repeatedly running unrelated tests or generating voluminous audit prose.


## R-EXTRACT — Exact source and repository fact extraction

**Preferred:** Luna · low (or the lowest supported setting)


You are a narrow extraction worker. Answer only the supplied finite question from the specified files or official page sections. This is not an architecture-design task.

Examples: extract the source fields required for the initial plan route; list the currently declared environment variables without values; identify exact installed package versions; collect the acceptance invariants for source receipt. Preserve source terminology and distinctions. State absence/uncertainty instead of filling gaps.

**Own:** Only the ticket’s note, normally `docs/research/<ticket-id>.md`. No production code, contracts, infrastructure or tests. Do not browse broadly when the needed fact is already in the supplied material.

**Output:** Up to one short page: question, exact source/section/version/date, extracted answer, implication for this ticket and unresolved facts. Secrets must be redacted. Quotes should be short; prefer cited paraphrases.

**Stop:** Once the finite extraction is complete. If interpretation rather than extraction is needed, identify the disputed point and return it for a Terra/Sol ticket. Do not spend a larger model simply reproducing this packet in different words.


## R-RESEARCH — Bounded official-documentation and data-access research

**Preferred:** Terra · medium


You are the implementation research worker. Resolve one question that blocks a specific next ticket using current primary sources and, when needed, a small read-only/local feasibility check authorized by the lead.

Examples: the installed framework’s supported native OIDC redirect path; exact license/access route for one requested sample; a documented parser option; the selected PostGIS image’s required supported extension. Prefer the installed version’s official documentation and primary repositories. Do not turn the ticket into a comparison of every framework or dataset.

**Own:** The ticket’s research note and explicitly authorized tiny scratch experiment, not production code or shared decisions. No paid downloads, access bypass, custodian emails, public upload of project sources or arbitrary external services.

Use an initial bound of three targeted queries and up to five relevant primary pages per question. These are investigation limits, not promises the answer exists. Return a result or a precise unresolved issue when the bound is reached. Follow a directly necessary primary-reference link when it materially resolves the question, noting the extension; do not restart a broad search loop.

**Output:** Decision-ready answer; source/version/date; observed behavior versus documentation; exact access/licensing constraints for the intended asset/use; relevant command or adapter implication; one proposed choice and fallback. A portal lead is not acquired data; a listing’s existence is not license clearance. Candidate data may remain deferred because C-001 is synthetic.

**Escalate:** Only when primary sources conflict or a material interpretation remains unresolved. Send the evidence to R-RESOLVE rather than searching indefinitely. Do not assume this model is cheaper or has a separate allowance merely because of its role name; the lead handles actual availability/accounting.


## R-RESOLVE — One difficult technical research decision

**Preferred:** Sol · high


You are the narrow ambiguity-resolution worker. Receive one well-defined unresolved implementation question, the prior evidence, the source baseline and constraints. Recommend a defensible decision or a bounded test—not a new overall architecture.

Examples: two official references disagree about behavior in the installed version; the chosen geometry operation’s output representation does not establish the needed claim; a native security flow’s documented configuration is ambiguous. Do not design jurisdiction-specific legal approval rules without authority; keep such questions open and use explicit synthetic policy.

**Own:** Only `docs/research/<ticket-id>.md` and an explicitly scoped scratch reproduction. Production code remains with Astra coding workers. If a substantial patch is needed, provide an exact implementation brief back to that owner.

Separate source-derived fact, local experimental observation and your inference. Compare no more than the material alternatives. Give one recommendation, why it satisfies this MVP, residual risk, an acceptance test and a fallback. This is a one-question escalation; return when resolved or when the next required evidence is unavailable.

**Do not:** Expand into universal solids, all dataset acquisition, a cloud migration, model training or a competitor report. Do not fabricate unavailable documentation or assert a guarantee based on one synthetic experiment.


---

<!-- Section source: 03_MVP_TASK_GRAPH.md -->

# MVP task graph and release gates

**These fifteen work tickets subdivide source Phases 1–2; they do not replace or reorder the six-phase baseline.** A ticket may contain smaller checkpoints; a model must not interpret one row as permission for unlimited autonomous work.

`depends_on` below means “needed to start this ticket’s named main work.” Some clients/domain tickets can start with frozen mocks; their additional **integration requirements** are explicitly listed. Such tickets cannot become integration-verified until their real producers exist. This distinction prevents a false dependency cycle while preserving real completion gates.

## Dispatch schedule

| Wave | Lead activity | Child work, with at most three live slots | Gate |
|---|---|---|---|
| W0 | T00, small T01 calibration decision | One finite research/extraction ticket and one feasibility/test helper only when needed | Actual environment/model/usage observations, or an explicit calibration stop. |
| W1 | T01; merge contract/fixtures; provide client shells | T03→T04 platform; T02 fixtures→T05 geometry; one bounded research ticket only if blocking | Runtime and supported computation work; contracts are common. |
| W2 | Connect results and review mechanisms; prepare integration | T06 intake; T07→T08 lifecycle as producers unlock; T09 web | Real source and preparation path; mobile is not blocked by web polish. |
| W3 | Integrate continuously; release slots promptly | T10 mobile; remaining T08/T09 work; targeted geometry/platform fixes | Same case/request/source IDs across clients and services. |
| W4 | T11; own critical fixes and final decisions | T12 verification plus assigned, nonconflicting fixes | Required evidence collected; unresolved gaps classified. |
| W5 | T13→T14 | At most one bounded verification helper | Runnable checkpoint, truthful status, human next tasks, stop. |

A freed slot does not automatically need a new worker. Research does not stay alive after the question is answered. Do not keep three feature agents busy while nobody can integrate their output.

## Implementation tickets

### T00 — Preflight and bounded calibration

**Owner:** O-LEAD  
**Start dependencies:** None; start here

**Work:** Inspect repository, available tools/models, source authority and allowance observations. Run the small calibration package: minimum schema example, startup/health probe and one independent prism calculation. No full parallel feature wave without a valid runtime/budget observation path.

**Deliver:** Preflight record, runtime/model map, baseline usage with window, reversible initial decisions and calibration evidence.

**Gate:** Environment/authorization blockers and unknown usage are explicit; an observed budget supports continuation or the run stops at calibration. No fabricated model or account telemetry.

### T01 — Freeze the small contract and path leases

**Owner:** O-LEAD  
**Start dependencies:** T00

**Work:** Publish source, inspection, geometry, finding, job, request/response and review envelope schemas needed for this slice, typed client boundary, standard error examples and server-owned fields. Record the proposed synthetic local-frame/profile choice.

**Deliver:** Schema-valid examples, contract version, dependency manifest, path leases and minimal repo skeleton.

**Gate:** Both TypeScript and Python can validate the shared examples; no competing mobile schema; later modules are not built as speculative stubs.

### T02 — Create coherent raw fixtures and independent expectations

**Owner:** C-VERIFY  
**Start dependencies:** T01

**Work:** Produce explicitly synthetic raw parcel-local JSON, PNG plan/reference grid, level/control CSV, r1/r2, source manifests and a separate second rectangle case. Keep clean seed without accepted records or fake findings.

**Deliver:** Actual fixture files, their hashes/provenance, independent area/volume/contact/overlap expectations and malformed examples.

**Gate:** Each boundary component maps to an attributable input; U03 error is unverified, r2 is a separate new source, and exact XY dimensions are labelled new synthetic choices.

### T03 — Deliver runtime, identity, database and guarded case template

**Owner:** C-PLATFORM  
**Start dependencies:** T01

**Work:** Make local services and schema/migrations runnable. Configure distinct identities, scope guards, initial project/case/assignment data access and one real guarded route. Supply platform shell interfaces before every service is polished.

**Deliver:** Environment template, bootstrap/health commands, migrations, development identity realm/configuration and guarded route tests.

**Gate:** Fresh services start; actor is authenticated; wrong-role/cross-project access fails; clients receive usable configuration without secrets.

### T04 — Deliver immutable storage and durable processing primitives

**Owner:** C-PLATFORM  
**Start dependencies:** T03

**Work:** Build staged upload/verified finalization/controlled read helpers and logical-operation idempotency. Implement application job record, durable dispatch, private controlled operation entry and repeat-safe completion; integrate only allowlisted profiles.

**Deliver:** Tested storage/job interfaces and a real sample processing round-trip with exact input fingerprint.

**Gate:** Partial or mutable originals cannot masquerade as finalized evidence; replayed/late jobs do not publish duplicate/newer state or accepted units.

### T05 — Implement the supported prism engine

**Owner:** C-GEOMETRY  
**Start dependencies:** T01, T02

**Work:** Implement metric/reference checks, simple-footprint construction, declared quantities and relationship-aware contact/overlap checks. Provide pure operation plus callable handler ready for T04 registration.

**Deliver:** Geometry code, profile declaration, attributable result schema and independent expected-test comparisons.

**Gate:** C-001 computes 6.4 m³ overlap and zero after correction; contact/containment are distinct; unsupported geometry/reference fails; second fixture works.

### T06 — Connect real source intake and basic inspectors

**Owner:** C-INTAKE  
**Start dependencies:** T02, T04

**Work:** Wire source APIs on trusted helpers; add selected local JSON/CSV/PNG inspectors and purpose-specific statuses. Register them through the lead’s service integration, not a second API.

**Deliver:** Real upload/finalize/list/detail/read endpoints, small processing adapters, error examples and focused tests.

**Gate:** The same uploaded source revision is inspected by a real worker and read by a permitted consumer; malformed/missing input and retries behave correctly.

### T07 — Persist candidates, evidence bindings and field requests

**Owner:** C-LIFECYCLE  
**Start dependencies:** T02, T03

**Work:** Implement revisioned candidates, four evidence components, minimum synthetic relationships, target requests/assignment/read/response interfaces and geometry-result ingestion. Consume T04/T05/T06 as they become ready; release stable mocks only until the real path is integrated.

**Deliver:** Candidate and evidence APIs/domain rules, source binding behavior, scoped response persistence and fresh-check linkage.

**Gate:** Before this ticket is integrated, real T04/T05/T06 results replace its mocks. Receipt never auto-binds/accepts; revisions and operation IDs are preserved.

### T08 — Implement exact review, identity and lookup

**Owner:** C-LIFECYCLE  
**Start dependencies:** T04, T05, T06, T07

**Work:** Implement fixed submissions, readiness and separate reviewer decision under tested project-wide relevant-mutation concurrency protection; publish stable prototype identity, history and accepted lookup.

**Deliver:** Review/registry endpoints, actual transaction/race tests and no-duplicate issuance behavior.

**Gate:** Self/wrong-role/cross-project/stale/concurrent decisions fail or retry safely; accepted identity persists; clean seed still has no acceptance.

### T09 — Build the linked web workflow

**Owner:** C-WEB  
**Start dependencies:** T01, T02, T03

**Work:** Build shell, source forms, linked tree/plan/Cesium views, manual supported edit, evidence/finding/request/review and lookup. Work against frozen mocks while endpoints are unfinished, then consume their actual responses. Split editor work into small internal checkpoints.

**Deliver:** Usable web workbench, shared-client integration, error states and browser interaction evidence.

**Gate:** Final gate requires real T05–T08 producers. A local scene is labelled synthetic; display transforms do not alter stored quantities; refresh/relogin preserves server records.

### T10 — Build the online native evidence and Team flow

**Owner:** C-MOBILE  
**Start dependencies:** T01, T03, T06, T07

**Work:** Build Expo sign-in, assigned tasks, authorized Team progress/assignment, attachment/note upload, retry-safe online response/receipt and basic lookup when available. Use actual network/issuer configuration.

**Deliver:** Native app code, build/run instructions, real request/source integration, emulator/device results kept separate.

**Gate:** The phone response is visible on web with matching IDs; no false offline or final-acceptance behavior. Actual device unavailable means that check is NOT_RUN, not passed.

### T11 — Integrate the one complete manual case

**Owner:** O-LEAD  
**Start dependencies:** T04, T05, T06, T07, T08, T09, T10

**Work:** Merge producer/consumer patches in dependency order, remove core mock transports, resolve contract drift and execute the clean-seed happy path with separate accounts. Keep API/service integration moving before the last client is finished.

**Deliver:** Integrated branch/checkpoint and reproducible source-to-accepted-record journey with request/snapshot IDs.

**Gate:** No stitched-together independent demos, hardcoded findings or preaccepted seed. A real persisted lifecycle exists; gaps remain visible.

### T12 — Run independent adversarial and cross-client checks

**Owner:** C-VERIFY  
**Start dependencies:** T11

**Work:** Execute the acceptance matrix against the integrated commit, controlled stale/duplicate/concurrency scenarios, web state checks and available actual Android flow. Return defects to assigned owners for targeted patches.

**Deliver:** Test evidence report with real commands/results, independent expectations, environment/device labels and defect ownership.

**Gate:** No unresolved required correctness failure is hidden; second simple case detects hardcoding; no claims based solely on screenshots or test names.

### T13 — Prove reproducible startup and classify release

**Owner:** O-LEAD  
**Start dependencies:** T12

**Work:** Run fresh isolated setup/seed and representative read/write lifecycle, verify persistence after service restart, review supported profiles and all acceptance evidence. Use existing environment-only resources; no public/paid deployment by implication.

**Deliver:** Tested README, environment/setup commands, MVP_STATUS with precise completion classification and known limitations.

**Gate:** Required outcomes are classified honestly. An actual-device or runtime gap prevents MVP_VERIFIED even if code/build checks pass.

### T14 — Prepare human continuation and stop

**Owner:** O-LEAD  
**Start dependencies:** T13

**Work:** Reconcile completed work against revised 03; create A/B/V next tickets with real file paths, entry points, prerequisites and acceptance tests. Record observed usage or unknown telemetry, resumable state and the smallest remaining MVP gap where needed.

**Deliver:** TEAMMATE_A_NEXT, TEAMMATE_B_NEXT, VINAYAK_NEXT, session state, usage ledger and final summary.

**Gate:** No teammate is asked to rebuild a completed capability; difficult core remains Vinayak’s responsibility. Stop at the scoped MVP or explicit partial checkpoint.


## Integration and failure rules

T07 requires T04/T05/T06 for final integrated evidence; T09 requires T05/T06/T07/T08; T10’s complete lookup uses T08. The lead can merge a safe intermediate endpoint or view before these dependencies finish, but labels it contract-ready/mock-ready/implementation-ready rather than integration-verified.

All authors write and execute focused tests for their own mechanisms. C-VERIFY provides independent checks, not a substitute for author testing. Shared-schema fixes return to the lead; ordinary implementation defects return to the assigned writer. The final budget reserve is primarily for T11–T14, but producer/consumer integration starts earlier.

If the budget/environment guard triggers before T13, create a **partial version of T14 immediately**, regardless of its normal dependency. Record the stopped graph, completed checkpoints and exact next ticket; do not wait to run out of context before making the work resumable. Never mark skipped T13 or T12 complete merely to satisfy the graph.


---

<!-- Section source: 04_ACCEPTANCE_MATRIX.md -->

# Required MVP acceptance matrix

**All rows start NOT_RUN. Creating this handoff has not executed the application checks.** All 36 rows are required for the unqualified `MVP_VERIFIED` label. A missing device, runtime or browser is a verification gap—not grounds to invent a pass or silently delete a requirement.

For every executed row record: tested commit; platform/runtime version; fixture/reset procedure; exact command or reproducible interaction; expected outcome; observed outcome; exit status where relevant; request/source/snapshot IDs; and evidence path. Use PASS, FAIL, BLOCKED or NOT_RUN. No test name, screenshot or generated README command counts as execution by itself.

Some rows are families containing several scenarios; each relevant scenario must be listed in the implemented test report. Every producer also tests its own code. C-VERIFY independently checks the system; the lead is accountable for classification.

| ID | Area / check | Required outcome | Evidence | Primary implementer | Initial state |
|---|---|---|---|---|---|
| AC01 | Runtime: Clean isolated startup | A fresh documented environment starts the required services, applies migrations and loads non-sensitive draft-only fixtures. | Commands, exit codes, service versions and health output. | C-PLATFORM | NOT_RUN |
| AC02 | Identity: Distinct actors and scope | Preparer, reviewer, field officer and permitted administrator authenticate; actor/roles are server-resolved; guessing another project/case/source ID fails. | Allowed/denied API traces and identity configuration without secrets. | C-PLATFORM | NOT_RUN |
| AC03 | Identity: Admin is not automatic reviewer | An administrative membership alone cannot accept spatial records; hidden UI buttons are not the enforcement. | Direct API negative test. | C-LIFECYCLE | NOT_RUN |
| AC04 | Sources: Verified receipt and immutability | Original file bytes are preserved and a finalized source cannot be altered through its staging upload; partial/mismatched content is not finalized. | Storage/version/hash checks, denied mutation and finalization test. | C-PLATFORM | NOT_RUN |
| AC05 | Sources: Safe retry | Repeated finalization with the same logical operation/payload creates one source revision; a changed payload under that key is rejected. | Database assertions and repeated API requests. | C-INTAKE | NOT_RUN |
| AC06 | Sources: Scoped original and derivative read | Unauthorized original/preview reads fail; an expired temporary read link can be renewed after authorization without changing source identity. | Source/derivative access tests and link-renewal result. | C-INTAKE | NOT_RUN |
| AC07 | Sources: Declared input profiles | Supported local JSON, CSV and PNG examples are inspected; unsupported input, malformed finite numbers and required missing metadata return specific issues. Local metric JSON is not presented as geographic GeoJSON. | Real job results and valid/invalid samples. | C-INTAKE | NOT_RUN |
| AC08 | Sources: Receipt is not suitability | r1 is received but cannot support the missing lower-limit evidence. r2 still needs suitability/binding; a guessed number does not satisfy the evidence policy. | Source statuses, explicit binding action and readiness denial. | C-LIFECYCLE | NOT_RUN |
| AC09 | Processing: Real durable job | A registered source reaches the actual private processor through a recoverable application job; output names the exact input fingerprint. | Application/job/worker traces for one real operation. | C-PLATFORM | NOT_RUN |
| AC10 | Processing: Repeat, failure and stale output | Duplicate job completion is harmless; failures are actionable; output for an old snapshot remains attached there and cannot ready a newer snapshot. | Forced retry/failure/out-of-order test. | C-PLATFORM | NOT_RUN |
| AC11 | Geometry: Valid quantities and reconstruction | Stored unit footprint and Z limits reconstruct the supported prism; area/height/volume include frame, method and units. | Independent expected values versus computed output. | C-GEOMETRY | NOT_RUN |
| AC12 | Geometry: Known draft overlap | U03 draft at 2.8 m overlaps U01 over only 2.8–3.0 m; the proposed 32 m² footprint yields 6.4 m³. | Numerical assertions and actual affected-geometry output. | C-GEOMETRY | NOT_RUN |
| AC13 | Geometry: Corrected contact | Explicit correction to 3.0 m removes positive interior overlap; boundary contact remains distinct. | Before/after input revisions and computed quantities. | C-GEOMETRY | NOT_RUN |
| AC14 | Geometry: Basement and common space | BSM-01 is −3–0 m in the local benchmark; common circulation remains separate; containment and boundary contact are not universal clashes. | Fixture relationship assertions and real findings. | C-GEOMETRY | NOT_RUN |
| AC15 | Geometry: Invalid and incompatible input | Self-intersecting/nonfinite/degenerate/unsupported footprints and incompatible or unknown calculation references fail visibly; no silent transform or arbitrary-solid claim. | Independent negative fixture outputs. | C-GEOMETRY | NOT_RUN |
| AC16 | Geometry: Independent second case | A differently sized/positioned rectangle pair has independently calculated contact/overlap outcomes; the engine does not branch on C-001/U03 names. | Second fixture plus changed-input assertions. | C-VERIFY | NOT_RUN |
| AC17 | Web: Linked selection and useful evidence | Selecting U03 links tree/plan/3D/details and opens footprint/lower/upper/alignment evidence with source revision/locator; the finding opens a next action. | Browser interaction evidence from the integrated commit. | C-WEB | NOT_RUN |
| AC18 | Web: Actual supported editing | User can edit a supported outline and lower/upper limits, save a new candidate and rerun checks; this is not only a static seeded scene. | Browser steps, new revision ID and real processor output. | C-WEB | NOT_RUN |
| AC19 | Web: Display is not authority | View changes do not modify stored geometry/quantities; schematic placement is visibly synthetic/local and not exported as a surveyed geolocation. | Persisted-spec comparison before/after view changes. | C-WEB | NOT_RUN |
| AC20 | Web: Failure states | Empty, loading, invalid, denied, processing failure, expired read and stale-edit states lead to useful recovery and do not show false success. | Focused UI tests and exercised state evidence. | C-WEB | NOT_RUN |
| AC21 | Evidence: Targeted request | RQ-LEVEL-01 identifies case/component/required evidence/reference and assigned recipient; an unauthorized assignment/response is denied. | Actual request/response API trace and negative tests. | C-LIFECYCLE | NOT_RUN |
| AC22 | Mobile: Actual native online response | On an actual Android device, the assigned officer authenticates, opens the request, attaches r2/note and receives the same response/source IDs visible on web. | Device model/build, steps and matching API/server IDs. Emulator/web-only evidence is insufficient for this row. | C-MOBILE | NOT_RUN |
| AC23 | Mobile: Team and authority | Authorized mobile administrator sees permitted task progress/assignment; other users cannot perform those actions; no final native acceptance route is exposed. | Actual native scenario plus direct API negative tests. | C-MOBILE | NOT_RUN |
| AC24 | Mobile: Online failure and duplicate retry | Network/picker/upload failure is visible; retry uses the intended operation identity and produces at most one response. Offline durability is not advertised. | Native test steps, one server response and explicit failed state. | C-MOBILE | NOT_RUN |
| AC25 | Evidence: Explicit revised binding | r2 receipt alone does not rebind consumers. Explicit binding/correction creates new U03/U04 evidence snapshots as needed; U04 still needs fresh checks despite equal coordinates. | Before/after source bindings, candidate IDs and fresh validation IDs. | C-LIFECYCLE | NOT_RUN |
| AC26 | Review: Incomplete submission blocked | Missing mandatory evidence, missing relationship requirements or stale checks cannot be bypassed by a UI ready flag or client-supplied accepted state. | Direct API adversarial payload and database assertions. | C-LIFECYCLE | NOT_RUN |
| AC27 | Review: Fixed separate-reviewer decision | A distinct authorized reviewer accepts the exact submitted snapshot; self/wrong-role/cross-project approval fails; return/reason is supported. | Real decision traces and preserved immutable submission. | C-LIFECYCLE | NOT_RUN |
| AC28 | Review: Changed sources and policy are stale | Changes to relevant source/binding/evidence/relationship/policy/authority state between submission and decision cannot silently inherit old approval. | Controlled mutation then decision tests. | C-LIFECYCLE | NOT_RUN |
| AC29 | Review: Relevant neighbor races | Controlled interleaving of neighbor insertion/update and decision uses the shared protection strategy; an unchecked neighbor cannot race into an accepted conflicting snapshot. | Concurrency harness with synchronization points, commit outcomes and invariant assertions. | C-LIFECYCLE | NOT_RUN |
| AC30 | Identity: Idempotent publication | Repeated decision/issuance resolves one stable prototype identity; geometry correction does not replace identity; supplied external ULPIN is not regenerated. | Database counts, retry responses and identifier history. | C-LIFECYCLE | NOT_RUN |
| AC31 | Registry: Persisted accepted lookup | Clean seed has no accepted unit. After real acceptance, refresh/relogin and permitted lookup return the same accepted revision/history; a later working edit leaves it intact. | Clean seed assertion, complete journey and subsequent reads. | C-LIFECYCLE | NOT_RUN |
| AC32 | Release: Cross-client complete case | From draft-only seed, real source intake, compute, evidence request/native response, correction, new checks, review and lookup form one continuous case with no core mocks. | Repeatable E2E script/steps and IDs spanning clients/services. | O-LEAD | NOT_RUN |
| AC33 | Release: Persistence and reproducibility | After documented service restart and clean client login, persisted originals, candidate/accepted records, identity and access behavior remain correct. | Restart/lookup commands and expected persisted identifiers. | O-LEAD | NOT_RUN |
| AC34 | Release: No model dependency and truthful scope | The manual application runs without inference/API keys. Enabled inputs/actions really work; offline/heavy AI/IFC/planning/exchange are marked deferred, not mocked as live. | Configuration inspection and actual manual journey without model credentials. | C-VERIFY | NOT_RUN |
| AC35 | Release: Usable supported clients | Primary web controls work with keyboard/focus and a narrow viewport; native task flow handles scrolling, keyboard and attachments. | Browser/native observations with failures recorded. | C-WEB | NOT_RUN |
| AC36 | Handoff: Team-ready result | A/B/V tasks name real delivered paths/interfaces, setup and acceptance criteria; remaining MVP gaps and later phases are distinct; usage evidence is observed or unknown. | Runbook, session state, current task board and continuation files. | O-LEAD | NOT_RUN |


## Minimal repeatable walkthrough

Start from the draft-only seed. Authenticate the preparer, register and inspect the raw inputs, prepare the geometry, compute the deliberate finding, open its source, create the field request, sign in on the actual Android client as the assigned officer, return r2, inspect/bind it explicitly, correct U03 and refresh upper-unit checks, submit the fixed snapshot, sign in as a different reviewer, accept it and open the accepted identity after logout/restart.

Capture meaningful IDs throughout so different screens cannot secretly be displaying unrelated seeded examples. Keep deterministic fixture aliases separate from production IDs. The same operation must work under newly allocated IDs and the second simple geometry fixture.

## Budget-stop classification

If the run stops early, preserve executed results and mark untouched rows NOT_RUN. A serious review/access/reference defect blocks claiming a safe complete lifecycle even if the visual demo works. A missing actual-phone result permits an implementation-with-verification-gaps report, not an actual-device claim.

Do not expand this matrix with Phase 3 full-offline tests or Phase 6 export/restore goals during the MVP run. Those belong to the human continuation, although existing related tests must not be broken.


---

<!-- Section source: 05_BUDGET_AND_RUNTIME.md -->

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


---

<!-- Section source: 06_TEAM_CONTINUATION.md -->

# Human continuation — finish the baseline after the agent-built MVP

**This is a handoff-generation rule and proposed follow-on queue. No AI task is assumed completed until the actual implementation evidence exists.** Preserve the latest allocation from revised 03: Vinayak owns the difficult core; A owns bounded data/inspector/adapter work; B owns bounded input/storage APIs, ordinary client work and tests.

## 1. Reconcile, do not assign duplicate work

At T14, compare each original A/B/V task with the tested repository. Classify it as delivered-and-verified, implemented-needs-verification, partial, not-started or deferred. For each remaining task supply the exact starting file, helper/API, command, sample input, limitation and acceptance outcome. Do not paste the old START_NOW assignments unchanged after agents have already implemented their content.

| Original revised 03 work | Likely agent contribution if the MVP succeeds | Human follow-on instead of rebuilding |
|---|---|---|
| V00–V03 | Contracts, platform, geometry/preparation, protected review and lookup | Vinayak inspects mechanisms, closes verification/correctness gaps and owns architecture decisions. |
| A01 | Small core-source decision and source constraints | A verifies selected real-source permissions/acquisition; no claim that the synthetic MVP acquired a real site. |
| A02–A06 | C-001 files, simple inspectors, preview metadata and independent checks | A reproduces, adds new valid/invalid examples, improves one approved format/locator and tests independent data. |
| B01–B07 | Input schemas, source/evidence APIs, basic forms, online native workflow and E2E | B reproduces on the actual phone, fixes bounded UI/API behavior and extends the existing pattern. |
| V04 / A07 / B08 | Not automatically built by this MVP | Vinayak implements offline core; A checks evidence preservation; B integrates/tests native queue UX. |
| V05 / A08 / B09 | Foundational revisions/bindings only, not the complete dependency engine | Vinayak builds explicit change preview; A writes independent change cases; B renders results. |
| V06 / A09–A10 / B10 | Not automatically built | Vinayak supplies a selected processor/model recipe; A wraps/runs it; B integrates real job/proposal states. |
| V07–V08 / A11–A12 / B11–B12 | Minimal lookup/runbook only, not full reuse/exchange/recovery | Vinayak implements heavy query/exchange/operational mechanisms; A/B test and build bounded consumers. |

## 2. Immediate packet for Teammate A

**A-NEXT-1 — Reproduce and vary the inputs.** Start from the delivered fixture/inspector README and run its commands independently. Add a new local parcel/measurement sample and negative examples such as bad headers, missing benchmark, inconsistent units and unsupported geometry. State the expected outcome before running production code. Deliver one bounded test/data PR and reproducible defects. Do not change reference/geometry policy.

**A-NEXT-2 — Obtain one actually useful source sample.** Research at most two promising routes for one input family selected with Vinayak. Record exact asset/provider, intended task, access method, license/permission evidence, acquired versus requested status, measured/synthetic/context classification and fallback. A public portal is not an API integration. Use a small sample; do not contact a custodian or accept contractual terms without authorization.

**A-NEXT-3 — Extend one provided inspector profile.** After Vinayak approves its input/output/reference contract, add one bounded adapter or preview/locator enhancement using the existing private processing template. A PDF-reference rendering profile or permitted data-fetch adapter can be chosen if the necessary trusted helper exists; neither means automatic plan understanding. Deliver actual valid/invalid samples, tests and one real integrated result.

Release one primary implementation task at a time. A-NEXT-2 can be the bounded fallback while a specific helper blocks A-NEXT-3. A remains accountable for fixes in their adapter/test code.

## 3. Immediate packet for Teammate B

**B-NEXT-1 — Close real-device verification gaps.** Use the actual delivered Expo run/build instructions and test accounts. Exercise login, assigned task, attachment/picker, keyboard/scrolling, online response, retry, Team permissions and matching web IDs. Record device/build/steps. Fix ordinary client problems in the assigned paths; escalate auth/core-protocol defects to Vinayak with traces. Do not claim full offline reliability from this test.

**B-NEXT-2 — Complete one bounded intake or evidence UX task.** Select an actual open defect or supported-input form improvement. Reuse the guarded route, schema, storage helpers and shared client. Cover denied/invalid/stale/processing/retry states and verify against the real endpoint. No new generic upload backend, public bucket or arbitrary state PATCH.

**B-NEXT-3 — Own a repeatable cross-role regression.** Convert one actual integration gap into a test with fresh seeded actors and request/revision IDs. Focus on intake/evidence/ordinary workflow behavior; Vinayak still owns critical review/concurrency tests. Supply exact setup and failure output rather than a video with no reproduction.

Do not give B a new endpoint without its schema, trusted helper and dependency being available. Do not ask B to redesign synchronization or security because they can implement ordinary HTTP routes.

## 4. Vinayak’s first continuation packet

Inspect the integrated code and evidence for auth/scope, source immutability, computational reference/profile, exact review snapshots/concurrency and durable job state. Re-run the highest-risk checks rather than accepting the agent’s claim. Review data migrations and defaults before using real evidence.

If MVP gaps remain, finish the smallest missing path before expanding scope. If the MVP gate is verified, start **V04: reliable offline primitives**, not heavy AI because it is visually attractive. Decide field-cache policy and implement server/client operation, expected-revision, retry and conflict rules before B wires the Sync UI.

## 5. Preserve the remaining phase order

| Next phase | Vinayak provides | A implements/tests | B implements/tests | Gate |
|---|---|---|---|---|
| 3 — Reliable offline fieldwork | Durable drafts/outbox, work packs, server operation/receipt/conflict handling, current authorization and sensitive-data policy | Source/locator/byte preservation across retry and outdated requests | Native forms/queue/status/conflict UI and actual-device interruption tests | Airplane-mode capture survives termination/restart and produces one attributable server response without silent overwrite. |
| 4 — Signature review/change impact | Dependency/use graph, explicit proposed rebind, affected records, stale checks and protected candidate update | U03 movement, U04 evidence-only impact, unrelated source and later accepted-update expectations | Evidence/finding/change panels and bounded observed-change reporting | New source arrival does not rewrite accepted records; impacts are explained and rechecked. |
| 5 — Evaluated assistance/richer inputs | Tested heavy engines, approved profiles, model/preprocessing/evaluation recipe and bounds | One adapter/acquisition wrapper at a time; held-out run manifests and raw versus corrected outcomes | Actual profile intake, job/proposal/error and correction UI | Enabled inputs produce attributable outputs; evaluated assistance never removes the manual route. |
| 6 — Reuse, exchange and pilot hardening | Corridor/vertical queries, supported exchange, identity lifecycle, backup/restore and deployment core | Unfamiliar fixture, independent spatial/round-trip expectations and data runbook | Lookup/query/exchange consumers, actual-device/security/recovery regressions | Supported unfamiliar case, qualified spatial results, round-trip and recovery work with permissions and references preserved. |

This MVP’s second simple geometry test is an anti-hardcoding check, not proof that Phase 6 is complete. A development restart is not a full tested production disaster-recovery procedure. Keep these labels separate.

## 6. Required shape of each delivered human task

Write the problem, exact file/API entry point, available helper, task boundary, sample/expected output, test command, start dependency and owner of blockers. Include real links/paths from the implementation branch, not guessed repository paths. State what the teammate must not independently change.

Useful task: “Extend the existing level CSV inspector with this approved field, add these two invalid examples and show the result in the existing source panel.”

Not useful: “Handle geospatial backend” or “Test everything.”


---

<!-- Section source: 07_SOURCE_BASIS.md -->

# Source basis, precedence and verification limits

**Prepared 12 September 2026.** This pack is a new execution specification built from the supplied project documents. It does not certify any application, dataset access, official numbering scheme, account entitlement, runtime feature or test outcome.

## Internal source files

| Source | Authoritative subject | Sections used |
|---|---|---|
| `reference/three_person_implementation_plan/reference/01_Product_Problem_and_Solution.md` | Product meaning, two clients/roles, sources, C-001 and first lifecycle | §§1,4–6,8–13. |
| `reference/three_person_implementation_plan/reference/02_Modules_and_Architecture.md` | Stack, nine modules, contract/state ownership, geometry/review and six-phase order | §§2–3, M1–M3/M5–M9, §§13–16. |
| `reference/three_person_implementation_plan/03_Three_Person_Implementation_Plan_REVISED.md` | Latest human ownership, A/B/V task cards and dependency unlocks | §§1–7 and task cards. |
| `reference/three_person_implementation_plan/reference/Reviewed_Additions_and_Guardrails.md` | Relevant evidence/reference/lineage/identity/source cautions | §§2–7. |
| Latest user instruction | Mostly Astra coding; economical research specialists; MVP first, human continuation;20% expectation | Current conversation. |

The preserved source archive retains its original text and links. Any original staffing paragraph assigning all specialist backends to basic-skilled teammates is overridden by the revised 03 allocation. Internal references to older video/other files in the source documents remain historical context, not newly supplied implementations.

## Explicit new execution choices in this pack

The agent roster, three-child cap, no-recursion rule, work tickets, file leases, budget threshold/reserve, bounded research/repair policies, test matrix, output templates and runtime fallback rules are proposed here. They are not existing user-account controls or observations.

The exact XY dimensions and32 m² unit/6.4 m³ overlap quantity are new synthetic choices; original 01 supplies the unit relationships and Z limits but not these dimensions. The local metre-coordinate JSON profile, initial no-holes geometry support and PNG/CSV-first intake are explicit reductions for this bounded MVP, not universal format support. Broader baseline import families remain later work.

The conservative project-guard/epoch concurrency approach is a proposed implementation strategy requiring tests. The sources require protected freshness and relevant-neighbor safety; they do not supply a finished locking algorithm.

The source phase order is preserved. W0–W5 are execution batches inside the manual MVP, not six replacements for the original six development phases. The full baseline’s offline/dependency/AI/planning/exchange work remains in the team continuation.

## Current official external references

Only official OpenAI pages were used to verify model/usage/delegation facts for this handoff. Framework, identity-provider and geospatial-library compatibility remains a runtime implementation check, not a claim of fresh verification here.

**O1 — Usage/allowance and effort guidance.** Checked 12 September 2026. Supports shared Work/Codex allowance, distinct applicable windows, variable task usage and account-dependent availability.

`https://help.openai.com/en/articles/20001516-managing-usage-with-gpt-6-astra-in-work-and-codex`

**O2 — Subagents.** Checked 12 September 2026. Supports inherited/overridden model settings, native delegation/configuration and the local concurrency field. This does not establish the tools exposed in a particular user session.

`https://learn.chatgpt.com/docs/agent-configuration/subagents`

**O3 — Pricing.** Checked 12 September 2026. Supports the dated token-credit reference table and distinction between included usage and separately billed API operation. No fixed Pro20× token-wallet conversion is inferred.

`https://learn.chatgpt.com/docs/pricing`

**O4 — Flexible credits.** Checked 12 September 2026. Supports eligible credit usage after included limits and concurrent-operation balance caveats. Current account settings must be inspected separately.

`https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-freegopluspro-sora`

The budget explanation cites O1–O4 where applicable. The full handoff uses them only for runtime/usage context; the project requirements remain source-derived and new engineering rules are explicitly proposals. Public information can change, so preflight must check the actual installed runtime/account before relying on a configuration.


---

# Appendix — Work and delivery templates


# Work ticket — fill before dispatch

**Task/subtask ID:**  
**Role / actual runtime thread ID:**  
**Requested model/effort:**  
**Observed model/effort and evidence, or unknown:**  
**Base commit / branch / worktree:**  
**Contract/profile version:**  
**Specific output consumer:**

## Objective

One bounded result; describe observable behavior, not “build the backend.”

## Read-only inputs

Relevant source sections, schemas, fixture paths and actual dependency artifacts. State which mocks remain and when real consumers are required.

## Writable path lease

Exact allowed files/directories and related test paths. List excluded shared/migration/root paths. The lead approves a lease change before writing outside it.

## Work and non-goals

Concrete implementation steps for this ticket. Include what must remain deferred.

## Acceptance

Required AC IDs and focused tests; independent expected outcomes; real integration entry point; command/interaction evidence required. Planned commands remain NOT_RUN until executed.

## Execution bounds

No child spawning. No paid/external side effects beyond authorization. Stop at the deliverable, lead stop instruction, exhausted allocated batch or reproducible blocker after two materially different attempts. Return evidence; do not expand scope.

## Return

Completed paths/commit or patch, command/results, remaining limitations, required next consumer and precise blocker when present. Do not paste the entire repository or repeat the task prompt.


# Bounded task delivery

**Task / role / actual model and effort:**  
**Status:** NOT_STARTED / IN_PROGRESS / BLOCKED / CONTRACT_READY / MOCK_READY / IMPLEMENTATION_READY / INTEGRATION_VERIFIED  
**Base / resulting commit or patch:**  
**Changed paths and contract version:**

## What actually works

Describe tested behavior and the real consumer. Separate mocks and unexecuted integrations.

## Evidence

| Check ID | Command / interaction | Expected | Observed / exit | Environment / tested commit | Artifact path |
|---|---|---|---|---|---|

## Limitations and blocked work

Exact missing artifact/capability, producing owner, reproduction and supported fallback. Mark unavailable device tests NOT_RUN.

## Next integration step

Who consumes this result, how to start/call it and what remains. No invented usage or completed tests.


# Research result

**Ticket / blocked implementation:**  
**Question:**  
**Actual model/effort:**  
**Sources / versions / retrieval date:**

## Answer

Finite answer with short, accurate source references. Separate supplied-source content, documented fact, local observation and inference. Do not infer missing permissions/access.

## Decision for the implementation

One proposed choice, exact integration implication, limitations and fallback.

## Acquisition status, where relevant

Provider/asset, intended use, access route, terms evidence, acquired/requested/unavailable status, sample path/hash if actually obtained, frame/units/quality and ancestry. A link alone is not acquired data.

## Unresolved point and stop

Specific remaining evidence/test/authorization. Do not begin a new broad investigation automatically.
