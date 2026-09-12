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
