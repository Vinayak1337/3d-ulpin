# IFC-02 - private source/job checkpoint

**Lead integration, 1 October:** original workflow, retry/cache corrections and closure integrate through `205bdb1`. Lead matches closure receipt SHA `1dd86613da90bf84b7f32c8ba0b96268f5d3a68115cafc4593acbdde3733de5c`, reuses completed source/profile/native proof and passes 18 integrated authority/cache/compatibility controls (one configured-process check explicitly skipped), one no-listener five-route check and backend typechecks. A fresh profile/2 for the integrated checkout is still required before a native runtime assignment; no saved owner profile is repointed. Real HTTP/SQL/private-object persistence remains unrun while Docker is unavailable. Generic retry refuses IFC before mutation; current writers remain strict and saved read-profile exceptions remain exact.

1 October 2026. Code `f20e97a6701a8866c9df9455eb438c15098c838c`, tree `ce700854d406c63defb7be9e7eaf33f9ee96ee35`, from exact base `d42b2fb8df0c2021a0f1106015ff830db0cd5acc`, branch `task/desktop-ifc-private-api`. Shared ownership amendments: lead `88693837` and `6f56c274`. Primary staging remained read only. Supplied permissions: `never` / `danger-full-access`; requested Sol6.1/xhigh/default-standard. Actual per-turn model/effort/tier were not exposed.

## Delivered

Five guarded private Nest routes: unchanged multipart original receipt, explicit retry, exact-job status, accepted native JSON and original download. Reuses existing cases/sources/operations, private objects, canonical fenced attempts and transactional outbox. No SQL, queue, registry, provider, geometry conversion or frontend was added. Lineage remains caller-declared. Missing tools queue a retained original and produce recoverable `IFC_UNAVAILABLE`; interrupted native jobs require a new explicit retry.

Case/source/access/archive/latest-family/context/reader and accepted-fence checks run before and after relevant object I/O. Staged artifact and size-pinned result are read back before acceptance. Unknown COMMIT outcome preserves canonical state. Generic originals delegate to IFC authority; generic streaming refuses IFC. Source projections omit private marker/lineage/parts. Captured/current malformed markers, snapshot/copy/package paths and copied-source ancestry cannot fall back to legacy handling.

Windows-only server configuration pins the existing interpreter and 3,022 physical files (175,690,666 bytes). It rejects drift and added runtime-root loader files. HTTP callers cannot supply paths/executables. The new wrapper uses the unchanged supervised reader, fixed global mutex, named kill-on-close Job and bounded reaper after termination. Scratch was empty after checks.

Limits: original 32 MiB; multipart 33 MiB; 100,000 entities; 10,000 records; artifact 16 MiB; result/status 16 KiB; depth 64; one parser; 2 GiB process/tree ceiling; parse 60 s; wrapper 90 s; total worker 150 s within the 180 s canonical lease. Request phases share 45 s; reads 60 s; terminal/uncertain-owner cleanup has a separate 2 s bound. Parser processing uses two affinity cores, one compute pool and the accepted six-total-OS-thread allowance; literal two OS threads is not claimed.

## Evidence and limits

All final checks below exited 0. SQL/storage tests are memory protocol controls, not PostgreSQL lock/persistence or HTTP evidence. Certification examples remain buildingSMART CC-BY-4.0 `test_only`, separate from operational facts and learning labels. Both unchanged IFC2X3/IFC4 sources and accepted projections were checked for missing/unqualified reference semantics; the new host workflow ran IFC2X3.

| Check | Actual result |
| --- | --- |
| `pnpm exec tsx --test tests/ifc-authority.test.ts tests/ifc-read-compatibility.test.ts tests/usp-private-mvt-read.test.ts` | 15 pass, 1 configured-process case skipped in this offline command. Source/access drift, alternate paths, outage/receipt/retry, late owner, interrupted attempt, initial-SQL stop, read compatibility and earlier MVT exceptions. |
| `pnpm exec tsx --test --test-name-pattern "accepted native summary" tests/ifc-authority.test.ts` | 1 pass after adding retained IFC4 projection control. No new parser run. |
| `pnpm exec tsx --test --test-name-pattern "one configured host invocation" tests/ifc-authority.test.ts` | 1 pass with new profile env and `ULPIN_IFC_LOCAL_PROCESS=1`. Real wrapper and canonical worker logic, staged acceptance, exact artifact/status/original, tool drift and stale denial through SQL/S3 doubles; final elapsed 21.402 s. |
| Existing env Python `-I -B tests/test_ifc_host_wrapper.py -v` | 3 pass: BUSY without native launch; hard cancel after observing parser PID 25752, reaped before host capacity; profile drift without publication. `ULPIN_IFC_TEST_RECEIPT` names the final local-process receipt. |
| `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test tests/ifc-nest-routes.test.ts` | 1 pass: five native route/schema/private-header/guard/query checks; no listener or generated-file write. |
| `pnpm typecheck:backend`; wrapper/helper in-memory Python `compile`; `git diff --check` | Pass. |

One initial successful host run was retained as `worker-local-process.txt`; the final run was justified by the executable-directory loader gap found during review. No unrelated parser campaign or historical validation/reprocessing ran. No API/DB/geo/Docker startup, provider/GPU use, push or deployment occurred. HTTP/persistence qualification remains open while Docker is unavailable. Lead owns integration, generated OpenAPI/client/catalogue and later runtime assignment.

Originals: IFC2X3 `c4db65ba847f6b369a95d6c54fa11f4750cbe6d59f021934e8923d8d578e5885` / 92,542 bytes; IFC4 `8790a1e193e82b8e7e7f337ec2633cd40f2120590317a1443503a25b079e2e80` / 142,325 bytes. Final native artifact: `66dcfb321cac47b605ffed87beaf060b50b1203a151b738fe446b6251d003d3a` / 55,011 bytes, 45 projected records.

## Tool and shared digest pins

Full per-file old/new constituent lists, hashes and command receipts: `E:/BhuAayam-data/task-data/desktop-ifc-native/api-checks/final-pins.json`, SHA256 `6c3d41254e3017007ff83423f8573121c430bd56fd590ceb0d878e50619877ef`. Old physical reconstructions respect Git attributes/autocrlf and exactly match the independently approved pre-IFC MVT/semantic digests. New physical values are this tested worktree; Git/LF values describe committed bytes, not another live runtime.

| Runtime pin | SHA256 |
| --- | --- |
| `pythonSha256` | `372c2eae555b344520bf147be0096e009069aeca4e7f78d6aecea6d53158056a` |
| `profileSha256` | `8c72df1e49d9ff6682a71aabb6b9e2dd539d37c9a14f86c75b89abb98b33e099` |
| `readerSha256` | `1a8881b6b725e8fb6a770910358bea136710671284a34186e31536a3b6598364` |
| `supervisorSha256` | `adb56f0584f5eaa3fb62ed6836bd031b38e98da7e812d45e484f237a832d3955` |
| `dependencyLockSha256` | `2cb966fe12eac6e8de321dc8abfc52b1c5e92d6e62c01013f0ff2d6f317402fd` |
| `codeSha256` | `b654f6638ae9eee947bf5deae447d752c2ef4e35979dc3da98ea4b6625f1df7c` |

Existing base interpreter: `C:/Users/kvina/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`; unchanged isolated environment: `E:/BhuAayam-data/task-data/desktop-ifc-native/env`; new profile/scratch: `api-checks/profile.json` and `api-checks/scratch` under the private IFC root. Configuration is `ULPIN_IFC_PROFILE` plus `ULPIN_IFC_PROFILE_SHA256`; no retained config or `.env` was changed.

| Digest | Old physical -> new physical | Old Git/LF -> new Git/LF |
| --- | --- | --- |
| mvt (19 constituents) | `37f9c493f48724bc8d9627718a5781d3a3514e91d2055ab57492041729dbcbfc` -> `f135c1c6c7b727d37f1e9c512bcda617d9341ccd6940fc621e64969216cac905` | `9a9790012ba12ed203ecde3660406a307f59b178399f704e8e9d3e5246c83c76` -> `64b5b4f8ae0a0366a15139e3bdd6692e1753c06590073c7c81a8dfa3df34079e` |
| semantic (9 constituents) | `2fc75b285a9b57fffaebad822497a30c59274b6e7345e44f760470a39f284be1` -> `27a3e083888a3cce36cc6cdd0fedf0e9ace10acb63447772004aa09b57b88c92` | `2410cb1dc2581631c11f3eea1f10bbe79c5d328d457426b7fb60ae550594673a` -> `d38d11c0c0c9e97339fee2f1adf30fa40f01faa7e6bff0ba87a606940041ae66` |
| validator (9 constituents) | `bb6ffcc2d2210156e66b934d49a3d1964fd890c34606833008533893cbeadd2b` -> `68b36dea13d51740eeaa37313d309214c6d9af6f64efa1001dc521dbc10f25a9` | `085a5654bb40bd9753f487fc6b70c4178c49dc4ae006f25164df0350e03652a5` -> `ebd6a2f21e383866679ec995eb65ba20a8a687504da5240c9542214ba0c0a851` |

`jobs.ts` stayed exactly at the approved proposal: physical `141b8d7d32a8c32363d6e995ef5a00520fe09917a611826dd295da6f83ef0b02` -> `616d499d85c8a14520543e29572d49dfa6a0069a78d71ce1918f746fdb73c394`; Git/LF `52fa7600eb7aa8f69c3203d8bab58b249b0b271bbbaaeccaecb3713e699ee106` -> `2f972aaf3afff565a628d895753f9752ab6f1f874d70328ca9c1955e49072518`.

MVT/semantic exceptions admit only the two explicit pre-IFC representations for immutable reads. Every non-code MVT pin, source/access/revision/parser/input, preparation, seal, observation and closure check remains. Stored digests are never rewritten. Read propagation covers projected observations/details/status, semantic chunks, tile generations and sufficiency. Default enrollment, attempt replay, compilation, publication, sealing and recovery stay current-exact and reject old profiles. Earlier approved MVT exceptions retain their semantics.

CityJSON validator code remains strict: the shared job addition changes its digest above. Existing explicit validations may be producer-stale; reports/pins remain retained. No validator compatibility exception or rerun was added. No-selected-validation reference admission is unaffected.

Constituent paths follow; the private JSON carries every exact per-file old/new hash.

### mvt (19)

- `packages/contracts/src/usp/private-mvt.ts`
- `packages/server/src/modules/usp/tiles/grid.ts`
- `packages/server/src/modules/usp/tiles/bounds.ts`
- `packages/server/src/modules/usp/tiles/compiler.ts`
- `packages/server/src/modules/usp/tiles/capacity.ts`
- `packages/server/src/modules/usp/tiles/service.ts`
- `packages/server/src/modules/usp/tiles/publication.ts`
- `packages/server/src/modules/usp/tiles/storage.ts`
- `database/sql/95-ingestion/private-mvt-cell.sql`
- `database/sql/95-ingestion/private-mvt-schema.sql`
- `packages/server/src/infrastructure/storage.ts`
- `packages/server/src/modules/usp/jobs.ts`
- `packages/server/src/modules/usp/ingestion/projected-vector.ts`
- `packages/server/src/modules/usp/ingestion/events.ts`
- `packages/server/src/modules/usp/ingestion/semantic-chunks.ts`
- `packages/contracts/src/usp/semantic-chunks.ts`
- `database/sql/95-ingestion/semantic-chunks.sql`
- `apps/api/src/modules/ingestion/private-mvt.controller.ts`
- `apps/api/src/modules/spatial/private-spatial.guard.ts`

### semantic (9)

- `packages/contracts/src/usp/projected-vector.ts`
- `packages/contracts/src/usp/semantic-chunks.ts`
- `packages/server/src/modules/usp/ingestion/projected-vector.ts`
- `packages/server/src/modules/usp/ingestion/projected-publication.ts`
- `packages/server/src/modules/usp/ingestion/semantic-chunks.ts`
- `packages/server/src/modules/usp/ingestion/semantic-display.ts`
- `packages/server/src/modules/usp/jobs.ts`
- `packages/server/src/modules/usp/tiles/capacity.ts`
- `database/sql/95-ingestion/semantic-chunks.sql`

### validator (9)

- `packages/contracts/src/registry-cityjson-validation.ts`
- `packages/server/src/modules/registry/cityjson-draft.ts`
- `packages/server/src/modules/registry/cityjson-validation-config.ts`
- `packages/server/src/modules/registry/cityjson-validation-processor.ts`
- `packages/server/src/modules/registry/cityjson-validation-worker.ts`
- `packages/server/src/modules/registry/cityjson-validation.ts`
- `packages/server/src/modules/usp/jobs.ts`
- `packages/server/src/infrastructure/storage.ts`
- `packages/server/src/infrastructure/db.ts`

### ifc (8)

- `packages/contracts/src/usp/ifc-ingestion.ts`
- `packages/server/src/modules/usp/ingestion/ifc.ts`
- `packages/server/src/modules/usp/ingestion/ifc-config.ts`
- `packages/server/src/modules/usp/ingestion/ifc-processor.ts`
- `packages/server/src/modules/usp/ingestion/ifc-worker.ts`
- `packages/server/src/modules/usp/jobs.ts`
- `packages/server/src/infrastructure/storage.ts`
- `packages/server/src/infrastructure/db.ts`

## Retained command receipts

| Private filename | SHA256 |
| --- | --- |
| `profile.json` | `8c72df1e49d9ff6682a71aabb6b9e2dd539d37c9a14f86c75b89abb98b33e099` |
| `focused-code-tests.txt` | `c23dacdb517e58055a75921ed72f6f267431012ed505d1c6c98327c6b4e38a5b` |
| `worker-local-process-final.txt` | `3091e2454763b553d8d97d322048e71b8ebe6aae49689360863fdd7c3f6bafb6` |
| `host-controls-final.txt` | `c2cda7ea020322bca2a6cf51eb7bf710ddb09ed96b64aa8c29caa8f657be1bda` |
| `nest-routes.txt` | `bee7f354669a2a5501888d79582ee1e9bf8b1f9ffc63ae5a1b333601a6e0e574` |
| `backend-typecheck.txt` | `62a6c61cda9b483b29da1f659b0be2f68f901d5953a04698c91b1dbcf62685c2` |
| `summary-final.txt` | `55fa6f12deb19a2f4eca6f8e82b1a872cbeccfe2b4748612cf76c269ac9e49ed` |

## IFC-02 review corrections, 1 October

Code `9906d615dbe5b7a53c1d3a364ea92316876ae00c`, tree `58b093fa7ea231b5df3ec6ac3ba04862b52960d3`, on the same branch/worktree from candidate `24879bdeb41e2820a36ce1061c2b321844e3e66f`. Assignment `a1c3460:docs/orchestration/PARALLEL_20261001E.md`; returned review `8396490:docs/evidence/usp/desktop-backend-review/ifc-api-review.md`. Read-only staging observed at `e050cec3c8df10f8ff1a2c5c3539c5520d14de6c`; integration remains lead-owned. Supplied permissions remain never/danger-full-access; requested Sol6.1/xhigh/default-standard, actual per-turn settings unexposed.

Both findings are corrected:

- **P1:** generic `retryJob` refuses `ifc-native` with HTTP 422 / `IFC_CANONICAL_RETRY_REQUIRED` immediately after lookup, before case locks or mutations. Recovery directs callers to source-bound IFC retry. Two failed-job caller controls produce no copies, source updates, events or queued capacity. Worker metadata/attempt authority remains strict.
- **P2:** `ifc-python-profile/2` uses `verified_bytecode_read_no_write`, including runtime/environment caches and reachable repository Python sources/caches. Node verifies the complete inventory immediately before wrapper or reaper launch, covering imports before Python-side verification. The wrapper verifies again before/after native processing and narrowly adapts the unchanged CLI child command to add `-B`, preventing new cache writes. Cache reads remain permitted only with verified bytes; `-B` is not claimed to prevent reads. Drift refuses launch, and an unavailable reaper preserves scratch.

**This supersedes the earlier cache-excluding runtime qualification.** Historical `/1` profiles now return controlled unavailable under current checks; generate a fresh `/2` profile for the actual checkout/runtime. No old profile, pin or receipt was rewritten. Accepted native reader/CLI physical and Git bytes, retained environment and shared caches remain unchanged.

Fresh private scope: `E:/BhuAayam-data/task-data/desktop-ifc-native/api-checks/ifc-02-corrections/`. Profile inventory: **4,838 files / 215,910,429 bytes, including 1,811 `.pyc` files**. Existing interpreter/environment remain the historical paths above; correction scratch is empty. Profile and tool verification were repeated during receipt reconciliation without another native parser run.

| Changed runtime pin | Previous SHA256 | Correction SHA256 |
| --- | --- | --- |
| profile | `8c72df1e49d9ff6682a71aabb6b9e2dd539d37c9a14f86c75b89abb98b33e099` | `4be36984cd8bf3cbe0b661c23a2a562fe1d2a0a43d5b58585af38a6b78803606` |
| wrapper/helper | `adb56f0584f5eaa3fb62ed6836bd031b38e98da7e812d45e484f237a832d3955` | `092230a99ad01841dace32cff6826dc330333245c1fa00c72ae925bc9a6cf18b` |
| IFC code, physical | `b654f6638ae9eee947bf5deae447d752c2ef4e35979dc3da98ea4b6625f1df7c` | `7900454406c7ebebb4b30872bf059c8eda5dfecffdc5b15cf2ae707e08faf5fd` |
| IFC code, Git/LF | `f30df1bffa6512c6cf9c145f3d933d5584ffb9d006e594cbcba90d958415cd76` | `c7d6d9b23fd9334079868b046907cd9bc3d0c3efb2f298552b409e113279aa1a` |

Python, reader and dependency-lock pins remain the historical values above. All 19 MVT, 9 semantic and 9 validator constituents and aggregate physical/Git hashes match the previous candidate exactly: `domain.ts` is outside those lists, and the remaining production edits are IFC leaves. No new immutable-read exception, stored-pin rewrite or validator rerun was introduced.

Narrow correction checks, all exit 0:

- `pnpm exec tsx --test --test-name-pattern "generic retry caller" tests/ifc-authority.test.ts`: 1 pass; `generic-retry.txt`.
- `pnpm exec tsx --test tests/ifc-bytecode-profile.test.ts`: 2 pass; `bytecode-profile.txt`. Actual Node config and Python verifier reject a timestamp/size-valid forged cache with unchanged source; repository caches include Windows case variants; frozen `/1` profile is refused unchanged; child adapter confirms cache writes disabled. Isolated protocol scopes are preserved.
- One configured `one configured host invocation` test with the fresh profile and `ULPIN_IFC_LOCAL_PROCESS=1`: 1 pass / 28.479 s; `worker-smoke.txt`. Real wrapper/native parser, SQL/storage doubles. IFC2X3 source and artifact match the historical SHA256/size exactly, and inventory remains stable.
- `pnpm typecheck:backend`, in-memory wrapper/helper Python compile and `git diff --check`: pass; `backend-typecheck.txt`, `python-compile.txt`, `diff-check.txt`.
- Pinned Python `-I -S -B <correction-scope>/reconcile-corrections.py`: exit 0; unchanged originals, historical evidence, accepted reader/CLI, shared digests and empty scratch verified. Script SHA256 `2ebdbee5f0defe4a16b1df24c7f1aea0e79203ff2466e3b175ab3d8a51a66a54`.

New `correction-pins.json`: **35,459 bytes**, SHA256 `1cd656b9df723ea228c5c4ba1c899a5e9db7574529531b77c40d7af14c43cbac`. It records changed-file physical/Git hashes, old/new tool and group pins, exact command/log hashes, preserved reviewer controls and historical evidence. Original `final-pins.json` remains unchanged at `6c3d41254e3017007ff83423f8573121c430bd56fd590ceb0d878e50619877ef`.

HTTP/PostgreSQL/private-object persistence remains unrun while Docker is unavailable; no HTTP status execution is claimed by the caller control. Inputs remain `test_only`; geometry, global placement, rights, learning, scale, Linux and release gates remain unqualified. No services, source acquisition, providers/models/GPU, frontend, workers, polls/schedules, push or deployment occurred during corrections. Return exact commits and this evidence through the authorized lead callback, then stop.
