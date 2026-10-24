# Tasks

The work queue for [PLAN.md](PLAN.md). The lead dispatches from this list and keeps each task's **Status** line
current (`open`, `running <spawner> since <time>`, `done <commit>`, `sent back`, `cut: <reason>`). A worker reads only
the task file the lead writes from its entry. Researched on 23 October against the code on `task/int3-pre` (0aecb4f8);
line numbers refer to that commit. Before writing a task file the lead reads the code it names, because lines move.

## How to use it

- **Base.** Until S1.4 merges `task/int3-pre` into `staging`, cut every task from `task/int3-pre` (worktree
  `E:/Projects/ulpin-wt/int3`) and merge accepted tasks there. After S1.4, cut from and merge into `staging`.
- **Order.** Follow "After". Within that, take the step order 1, 2, 3, 4, 7, 5, 6: the base and the kits first, then
  staying up, the reading card and the cheap UI fixes, then drawing and linking.
- **Capacity.** At most three workers at once; only one of them uses this PC's runtime, Docker or GPU (the "this PC"
  tasks marked runtime, Docker or GPU). Data-drive tasks run locally but do not take that slot.
- **Spawner.** Only Claude CLI and pi codex workers ([WORKING-RULES.md §2](WORKING-RULES.md#2-who-does-the-work)).
  UI tasks (step 7, and any task changing `apps/studio`, `packages/ui` or `packages/scene`) go to the Claude CLI; other
  "code only" tasks go to codex first; "this PC" tasks go to the CLI or codex. No cloud agents.
- **Tests.** Each task names the existing test files that guard what it touches. Run those, plus the standard checks of
  [WORKING-RULES.md §5](WORKING-RULES.md#5-tests-and-evidence). Nothing else.
- **Shared files** have one writer at a time, in the order the tasks give: `packages/contracts/src/usp/intake.ts`
  (S4.3, then S6.1), `mapping-teacher.ts` (S4.2, then S4.4), `intake-reading.ts` (S4.3, S4.6, S4.7, S6.2),
  `intake-large.ts` and `intake-large-worker.ts` (S3.4, then S3.5), `dispatch-lanes.ts` (S3.2, then S3.7),
  `intake-draft.ts` (S5.3, S5.4, S5.9, S5.10), `upload-model.ts` (S5.3 to S5.10), `native_gis.py` (S5.4, then S5.5),
  `BatchPage.tsx` (S7.3, S4.8, S7.9, S7.11), `IntakeTray.tsx` and `batch-model.ts` (S7.2, S4.8, S7.12),
  `MapWorkspace.tsx` (S7.6, S7.9, S7.14), `IntakeDropDialog.tsx` (S7.2, S7.13).

## First dispatch

1. **This PC slot:** S1.1 (the full check set on `task/int3-pre`), then S1.2, S1.3, S3.3, S3.8 in turn.
2. **Two code-only slots:** S3.1 and S4.3 first; then, as they return, S3.2, S4.1, S4.2, S7.1 to S7.7.
3. **Alongside, data drive:** S2.1, then S2.2. S2.3 (the closed kit) runs in a session of its own that never builds,
   teaches or tunes afterwards.

**Waiting on the owner:** S4.12 (Sarvam sample values, PLAN "Needs you" 3); S7.11 to S7.14 (the five worst UI
problems, "Needs you" 2); S5.13 (installing Python 3.12 on E: for the IFC reader is a download: ask first).

## Step 0: Paperwork

Done on 23 October: PLAN, TASKS, STATUS, AGENTS and WORKING-RULES written; old plans archived; committed on `staging`,
pushed, and merged into `task/int3-pre`.


## Step 1: Choose the code version we build on

`task/int3-pre` (209 changes ahead of `staging`) has never had a full check run or a rehearsal since its three timing fixes. Prove it, then merge it into `staging`. Until then, cut tasks from `task/int3-pre` and merge accepted ones there.

### S1.1 Full check set on int3-pre 0aecb4f8, fix only what fails

Size M, this PC: Docker. After: none. **Status: running codex since 24 Oct 2026 (the Claude CLI account is refused by an organisation setting).**

- **What:** Run the whole check recipe the INT2 integrator used, at 0aecb4f8. No full run exists at this head; the last one is INT2 (backend 2022 tests 0 failed, Studio 616 0 failed). Fix only failing tests or real bugs, one commit each, with a regression test for each real bug. Also run the PostgreSQL dispatcher controls that LQ1 skipped, against a disposable local Postgres container, never a runtime's database.
- **Files:** Read: docs/evidence/int2/result.json (checks[] has the exact commands and env: ULPIN_PROFILE_PYTHON=E:/BhuAayam-data/ml/venv-k3a-geo/Scripts/python.exe, --tsconfig docs/evidence/int2/tsconfig.tests.json); packages/server/src/modules/cases/processing.test.ts:349 (ULPIN_DISPATCH_TEST_DATABASE_URL); docs/evidence/lq1/result.json (skips). Change: only the failing test or source file. Worktree from 0aecb4f8.
- **Check:** Full backend command (pnpm exec tsx --tsconfig docs/evidence/int2/tsconfig.tests.json --test --test-concurrency=4 tests/*.test.ts packages/server/src/**/*.test.ts) exits 0 with 0 failed. pnpm --filter @ulpin/studio exec vitest run exits 0 with 0 failed. geo pytest exits 0. The processing.test.ts PostgreSQL cases run (not skipped) and pass.
- **Tests:** pnpm typecheck:backend; pnpm studio:typecheck; pnpm studio:test; openapi.ts --check; python scripts/api/check.py; python scripts/db/verify_extraction.py; services/geo pytest (INT2 command); node --test scripts/platform/*.test.mjs

### S1.2 Fresh-runtime rehearsal part 1: create ulpin-reh-03 and run act 1 (proves SA1 and EV2 live)

Size L, this PC: Docker. After: S1.1, S3.1 merged onto int3-pre by the lead. **Status: open.**

- **What:** Rehearse the newest head (0aecb4f8 plus S1.1 fixes and S3.1) on a new, empty runtime, not reh-02: reh-02 carried old point-batch items that polluted REH16. Procedure (DEMO-RUNTIME.md:272-311): git worktree add E:/Projects/ulpin-wt/ulpin-reh-03 <serve sha>; pnpm install --frozen-lockfile; pnpm platform:start --profile demo --create --runtime ulpin-reh-03; demo-document-runtime.mjs build; demo-native-readers.mjs build then check (four verified); platform:start; platform:doctor all PASS. The image stays ulpin-geo:git-dc5deb405fb9; services/geo is unchanged since the pin. Ports are 21031-21036 (API 21036). Then act 1 with the REH16 run-a order: confirm evidence while the package prepare runs. Both cards; journey 8/8 with surfaces and citation passing. Run the demo doctor before and after. Quiet PC: no other agent runs. Leave reh-03 stopped, never removed.
- **Files:** Read: docs/backend/DEMO-RUNTIME.md:272-311; _tasks/reh16.md, reh17.md; k3 branch task/reh16-rehearsal 8f7314b2 docs/evidence/runtime/reh16/{roll.json,launch.ps1,dress.mjs,journey.mjs,cards.mjs,citations.mjs,jobs.mjs,api-watch.ps1,act1-files.json} (copy with reh-03 ports and paths). Write: docs/evidence/step1/s1-2/result.json on its own branch.
- **Check:** pnpm journey:check --case <act 1 case> passes 8/8 with nothing skipped. The act 1 TIF and LAZ each get raster-window and point-batch jobs (SA1). The cited card is reached in the run-a order with at most one re-confirmation (EV2). Demo doctor before and after shows 4ffd801a, exit 0.
- **Tests:** pnpm platform:doctor --profile demo --runtime ulpin-reh-03; pnpm journey:check

### S1.3 Fresh-runtime rehearsal part 2: our own act 2 files alone and under load, with timings

Size L, this PC: Docker. After: S1.2. **Status: open.**

- **What:** On ulpin-reh-03, run REH16's act 2 list. First file b (the zp1 ZIP) alone, measuring LQ1: layout, first map, both parts. Then file f (Niagara 26 MB GeoJSON) alone. Then the load phase, each file in its own batch. Record per file: forecast and tray words, reader outcome, map yes/no, seconds. Record job queue, execution and retry split, any S3.1 exit lines, health pool numbers every 5 s, and host CPU. Fix the REH17 act2-list CityJSON path first; it points at a reh16 file that doesn't exist. Stop reh-03 at the end.
- **Files:** k3 docs/evidence/runtime/reh16/{act2-list.json,watch.mjs,jobs.mjs,checkpoint.json}; _tasks/reh17.md steps 4-5; E:/BhuAayam-data/task-data/reh16/act2 prepared inputs. Write: docs/evidence/step1/s1-3/result.json.
- **Check:** API and dispatcher exit files stay empty through the load phase. File b: first map within 180 s, both ZIP parts within 240 s, officer time excluded. File f alone: first map time recorded beside REH15's 738 s. A verdict line for every act 2 file.
- **Tests:** jobs.mjs read-only job timing; pnpm platform:doctor --profile demo --runtime ulpin-reh-03

### S1.4 Lead: merge task/int3-pre into staging and regenerate pins

Size S, code only. After: S1.1, S1.3 (verdict), S3.1, S3.2. **Status: open.**

- **What:** Lead-only integration, done when S1.1 is green and S1.2/S1.3 give no reason to fall back to staging. The step 0 paperwork is already on staging and was merged into task/int3-pre on 23 October. Merge task/int3-pre (with the S1.1, S3.1 and S3.2 commits) into staging, then regenerate docs/api/source-pins.json, openapi and the api-client types (WORKING-RULES section 4). Point the comment at packages/server/src/modules/cases/dispatch-lanes.ts:5 to docs/design/INGESTION-ARCHITECTURE.md in the same merge, since the pins are regenerated anyway. Push staging. From then on tasks are cut from staging. Fallback if the rehearsal fails: stay on staging and fix only the failing item on int3.
- **Files:** E:/Projects/3d-ulpin (staging); scripts/api/check.py:130-138 (docs/api/*.md link check); scripts/api/refresh-contract.ts; docs/api/source-pins.json; packages/server/src/modules/cases/dispatch-lanes.ts:5
- **Check:** On staging after the merge, python scripts/api/check.py, openapi.ts --check and pnpm typecheck:backend exit 0. git log shows int3 0aecb4f8 as an ancestor of staging. Every new commit's author and message pass the no-attribution grep.
- **Tests:** python scripts/api/check.py; pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/scripts/openapi.ts --check; pnpm typecheck:backend; pnpm studio:typecheck


## Step 2: The judge kits

Reuse the real public files already on the data drive; acquire only what is missing (a large aerial photo and height map, a laser scan over 300 MB, a vector file near 1 GB, real CityJSON, CityGML, DXF and DOCX). The closed kit lives outside Git under `E:/BhuAayam-data/holdout/judge-kit-closed/`; only its manifest hash is committed.

### S2.1 Practice kit part 1: pick about 8 real public files already on the data drive

Size S, this PC: data drive. After: none (step 0 is done). **Status: open.**

- **What:** Write the practice-kit manifest from originals already retained. Don't copy or change them: reference them in place. Cover all four families and the size range. Proposed list:
- Niagara footprints, 25.4 MiB GeoJSON
- Halifax Buildings, 102.8 MiB GeoJSON
- Tweed Shapefile ZIP
- BCA XLSX (DQ1, opened in REH8)
- Baton Rouge 73 MiB WKT CSV (licence unconfirmed: state it)
- RERA scanned plan PDF, 6.3 MiB
- FZK-Haus IFC4, 2.5 MB
- NYC COPC LAZ, 74.3 MiB
Recompute each sha256 and compare it to the sibling receipt. Take the licence, URL and issuer from real-sources.md and datasets.json. Add one catalogue entry, following the DQ1 pattern.
- **Files:** Read: docs/api/real-sources.md (DA1-DA6, DQ1 sections); docs/api/datasets.json retainedExternalSources (dq1 entry as template); docs/evidence/gf5/dq1/sealed-manifest.json (shape). Write: docs/evidence/step2/s2-1/manifest.json (path, bytes, sha256, family, format, sizeBand, licenceState, licenceUrl, issuer); a datasets.json entry; a real-sources.md section.
- **Check:** A python -I one-liner re-reads every manifest path and recomputes sha256: all match the manifest and the receipts. The manifest lists at least one file in each of the 4 families. python scripts/api/check.py exits 0.
- **Tests:** python scripts/api/check.py

### S2.2 Practice kit part 2: acquire the missing files (large raster, large points, 1 GB vector, real 3D/DXF/DOCX)

Size M, this PC: data drive. After: S2.1. **Status: open.**

- **What:** Fetch about 5 public originals without login, form or CAPTCHA into E:/BhuAayam-data/datasets/practice-kit-20261024/. Each gets a sibling receipt: issuer, URL, date, sha256, licence, geography, CRS. Gaps to fill:
- a COG orthophoto of 300 MB to 1 GB (e.g. OpenAerialMap, CC BY 4.0)
- a DEM GeoTIFF (e.g. USGS 3DEP, public domain)
- a LAZ/LAS over 300 MB (USGS 3DEP)
- a newline-delimited building file near 1 GB, with more than 500,000 features to test the ceiling (e.g. Microsoft building footprints, ODbL, test_only, a vendor prediction)
- a 3DBAG tile as CityJSON plus OBJ (CC BY 4.0), or an open LOD2 CityGML tile
- one real DXF plan and one DOCX under a stated open licence (e.g. OGL v3)
Verify each licence at fetch time; never guess one. Single writer of real-sources.md and datasets.json for practice entries.
- **Files:** docs/api/real-sources.md; docs/api/datasets.json; docs/evidence/step2/s2-1/manifest.json (append, or write s2-2/manifest.json). AGENTS.md data rules (originals immutable, receipts).
- **Check:** Every new file has a receipt whose sha256 matches a recomputation. The practice manifest now has about 12 files: at least 2 above 100 MB, 1 near 1 GB, and every format family. python scripts/api/check.py exits 0.
- **Tests:** python scripts/api/check.py

### S2.3 Closed kit: a separate session acquires and seals about 12 other public files

Size M, this PC: data drive. After: none for the fetch; catalogue entry after S2.2 merged. **Status: open.**

- **What:** A session that writes no product code fetches about 12 real public originals across the four families and the size range. They must come from publishers and geographies not in the practice kit. Store them in E:/BhuAayam-data/holdout/judge-kit-closed/; the 'holdout' name puts it under every worker's never-open rule. Never profile, open or import them. The sealed manifest (generic names k01..k12, family, format, bytes, sha256, licence state) stays beside the files; commit only its sha256 and the count per family. URLs and real names stay in the receipts outside Git.
- **Files:** Pattern: docs/evidence/gf5/dq1/sealed-manifest.json and the dq1 entry in docs/api/datasets.json. Write: docs/evidence/step-2/s2-3/result.json with the manifest sha256 and counts per family only.
- **Check:** Recomputed sha256 of all files matches the sealed manifest. No sha256 or publisher overlaps with the practice manifest. All 4 families present. The committed result holds no file name, URL or publisher.
- **Tests:** python scripts/api/check.py


## Step 3: Stay up and stay smooth

Why the API exited under load is unknown (its log is private and no exit code is kept). Every in-process reader has one slot, and a large file waits for its whole read before the layout question, so 60 s to first features needs an order change (S3.4, S3.5), not only queue fixes.

### S3.1 Record why the API or dispatcher exits, and API pool pressure

Size S, code only. After: none (cut from 0aecb4f8; runs in parallel with S1.1 and S3.2). **Status: done ebc61e4b on task/int3-pre (24 Oct).**

- **What:** REH15's three API exits could not be explained because stderr goes only to the private runtime log (processes.mjs:56-60) and no exit code is kept. Add exit hooks to the API and dispatcher (exit, uncaughtException, unhandledRejection, SIGTERM). Each hook appends one JSON line to a file named by a new env var that processes.mjs sets to E:/ulpin-tmp/<runtime>/<label>-exit.jsonl. The line holds only: code, signal, error name or AppError code, the first in-repo stack frame as file:line, uptime, rss, heapUsed and heap limit. No message text, the same rule as keepWorkerError (processing.ts:94-104). Make dispatcher.ts:28-34 log the error code instead of always saying 'cannot reach the application database'. Add the pool's totalCount, idleCount and waitingCount to the health response.
- **Files:** apps/api/src/main.ts:34-60; scripts/dispatcher.ts:6-45; scripts/platform/processes.mjs:49-74; scripts/platform/demo-config.mjs:509-512 (safeEnvironment); apps/api/src/foundation/foundation.controller.ts (health); packages/server/src/infrastructure/db.ts:22-39
- **Check:** A new node test starts a child process with the hook preloaded and makes it throw. The exit file gets exactly one line with code 1, the error name and a repo file:line, and no message text. A second case with a DATABASE_URL-like value in the message shows the value absent. GET /api/v1/health in a controller test returns pool.total, idle and waiting.
- **Tests:** node --test scripts/platform/processes.test.mjs scripts/platform/runtime-stop.test.mjs; pnpm typecheck:backend; openapi.ts --check (health shape changes); python scripts/api/check.py

### S3.2 Bound in-process dispatcher reservations by the Node heap limit

Size S, code only. After: none (parallel with S1.1, S3.1; disjoint files). **Status: running codex since 24 Oct 2026.**

- **What:** dispatchMemoryBudgetMiB defaults to half of RAM, 16,231 MiB here (dispatch-lanes.ts:141-143). Every in-process worker shares one Node heap with heap_size_limit 4,288 MiB, and REH16 saw the dispatcher at 3,018 MB. Keep the machine budget for jobs the processor container runs. Add a second budget for in-process holds (rows without processor:true): v8 heap_size_limit less a stated reserve. Admit an in-process job only when both budgets fit. Never raise a lane cap.
- **Files:** packages/server/src/modules/cases/dispatch-lanes.ts:104-143 (dispatchInProcessOperations, dispatchCost, dispatchMemoryBudgetMiB), 168-225 (fits, DispatchReservations.admit); packages/server/src/modules/cases/processing.ts:366-369 (budget call)
- **Check:** New test in dispatch-scratch.test.ts (or a new dispatch-lanes test). With a 4,288 MiB heap stub and no stated budget, in-process holds stop at 4,288 minus the reserve, while a processor-run job (inspect, build) still fits under the machine budget. The existing processing-latency replay still shows LQ1's member dispatch result.
- **Tests:** pnpm exec tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/cases/dispatch-scratch.test.ts packages/server/src/modules/cases/processing.test.ts packages/server/src/modules/cases/processing-latency.test.ts; pnpm typecheck:backend

### S3.3 Kit-drop runner under scripts/rehearsal, served from a production Studio build

Size M, this PC: runtime. After: S3.1 (exit and pool fields); runtime check after S1.3 frees reh-03. **Status: open.**

- **What:** Move REH16's rehearsal scripts out of docs/evidence: presenter with frame recorder, read-only job timing, intake watch, process watch. Put them in scripts/rehearsal/ as one runner parameterised by --runtime ulpin-reh-NN, --kit <manifest> and --out. Serve the Studio from pnpm studio:build plus vite preview on 5189 (vite.config.ts:37 has the proxy) so frame times match the finale, not the dev server. The runner drops every kit file in one Add files action. It records per file: retain, layout shown, first and last part on the map, card or limit words. It also records frames per page (max, over 100 ms, longest task), queue/exec/retry per job, S3.1 exit lines and pool numbers. Output is one compact result.json.
- **Files:** Source: k3 task/reh16-rehearsal 8f7314b2 docs/evidence/runtime/reh16/{dress.mjs,jobs.mjs,watch.mjs,api-watch.ps1,launch.ps1}. Write: scripts/rehearsal/*. Read: apps/studio/vite.config.ts:7-37.
- **Check:** node scripts/rehearsal/kit-drop.mjs --runtime ulpin-reh-03 --kit <two-file mini manifest: NYC buildings-original.geojson + Tweed gpkg> writes result.json with both files' moments, a frames block for the batch and map pages, and jobs and process blocks.
- **Tests:** node --check on each script; one node --test for the manifest reader and result shape

### S3.4 Large batch files: ask the layout from the first profile part, map while the reader continues

Size L, code only. After: S1.4 (cut from merged staging), or from int3-pre if the merge is late. **Status: open.**

- **What:** The batch path waits for the whole file to be read and the profile sealed before asking the layout (intake-large.ts:133-135). That is up to 80 min for 1 GiB (streaming-vector.ts:11-17), so first features in 60 s is impossible. Reuse the existing prefix route; no new format.
1. Confirm with a test what prefix admission does with chunks after the observed prefix.
2. Return question once the first provisional generation is published.
3. Start mapping with prefixAdmissionVersion after a prefix approval.
4. When the profile seals, compare it to the approved prefix plan. If a path the layout uses changed type or completeness, stop with plain words and ask again. Never carry an approval across.
- **Files:** packages/server/src/modules/usp/ingestion/intake-large.ts:126-160,421-432; intake-large-worker.ts:360-375 (startMapping); streamed-mapping.ts:36-80,121-210; chunk-mapping.ts:70-110,130-145,240-270; streamed-profile-worker.ts:100-130; apps/api/src/modules/ingestion/streamed-profile.controller.ts:70-96
- **Check:** New intake-large test with a 5-chunk GeoJSON fixture: the item reaches needs_answer after chunk 1 while the reader is still running. After a prefix approval, chunk-mapping publishes part 1 before the reader seals. A sealed profile whose key path loses completeness stops with words and re-asks.
- **Tests:** pnpm exec tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/usp/ingestion/intake-large.test.ts intake-large-steps.test.ts streamed-layout.test.ts streamed-mapping-basis.test.ts layout-approval.test.ts streaming-vector-worker.test.ts tests/intake-api.test.ts tests/intake-zip-layers.test.ts; pnpm typecheck:backend; openapi.ts --check

### S3.5 Large batch files: drafts follow mapped parts so the first part reaches the map early

Size M, code only. After: S3.4 (same files; sequential). **Status: open.**

- **What:** Drafting starts only in the draft phase, after every chunk is mapped (intake-large.ts:136-141; intake-large-worker.ts:370-372). REH15 measured approve-to-first-map at 310 s. Let the draft step consume each mapped part as it is published, under the existing INTAKE_UNFINISHED_PACKAGE_LIMIT. partsDone and partsPlanned stay truthful while mapping continues, and the end projection still waits for the sealed mapping.
- **Files:** packages/server/src/modules/usp/ingestion/intake-large.ts:130-160 (intakeLargePhase, intakeLargeNumbers); intake-large-worker.ts:230-300,360-375 (draft, writeEndTx)
- **Check:** intake-large test: with mapping at part 1 of 5, one package is drafted and the item shows partsDone 1. Final counts after all 5 equal the sealed reader's.
- **Tests:** pnpm exec tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/usp/ingestion/intake-large.test.ts intake-large-steps.test.ts intake-large-geometry.test.ts tests/intake-api.test.ts; pnpm typecheck:backend

### S3.6 Studio: answer a prefix layout question, with words that say it covers the first part

Size M, code only. After: S3.4 (question shape). **Status: open.**

- **What:** StreamedLayoutAnswer posts only to sealed recipes (streamed-queries.ts:21). When the item's question names a provisional profile, author and approve through the prefix-recipes routes. Words: the layout is taken from the first N features read; the rest is checked as it arrives. On a re-ask after the profile seals, show what changed.
- **Files:** apps/studio/src/features/intake/StreamedLayoutAnswer.tsx; streamed-queries.ts; streamed-question-model.ts; question-model.ts; layout-command.ts
- **Check:** StreamedLayoutAnswer.test.tsx: a provisional question posts to .../prefix-recipes then .../approve and shows the prefix words. A re-ask shows the changed path.
- **Tests:** pnpm --filter @ulpin/studio exec vitest run src/features/intake/StreamedLayoutAnswer.test.tsx src/features/intake/question-model.test.ts src/features/intake/layout-command.test.ts src/features/intake/batch-page.test.tsx; pnpm studio:typecheck; pnpm studio:api-types; ui-design-check report

### S3.7 Vector-lane readers start up to the lane cap, not one per process

Size M, code only. After: S3.2 (same file dispatch-lanes.ts); dispatch only if S1.3 still shows vector-lane queue time above execution time. **Status: open.**

- **What:** streaming-vector, streamed-profile, chunk-mapping and intake-large each have one module slot (processing.ts:46-50, 391, 475, 489, 547), although the vector lane allows 2 (dispatch-lanes.ts:27). unavailableOperations blocks a second start of a held operation (dispatch-lanes.ts:235-240). REH15 under load: queue 1,559.5 s against 15.1 s of execution. Replace those four singletons with per-operation sets bounded by the lane concurrency and the S3.2 heap budget. Fencing and attempts are unchanged.
- **Files:** packages/server/src/modules/cases/processing.ts:45-50,385-395,475-500,545-552; packages/server/src/modules/cases/dispatch-lanes.ts:232-241
- **Check:** processing-latency.test.ts replay with a 12-file job mix: two streaming-vector jobs start in one tick, and the total time to every file's first dispatch drops against the current replay. A memory refusal still blocks the second.
- **Tests:** pnpm exec tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/cases/processing.test.ts packages/server/src/modules/cases/processing-latency.test.ts packages/server/src/modules/cases/dispatch-scratch.test.ts; PostgreSQL controls as in S1.1

### S3.8 Practice-kit drop 1 on a fresh runtime: measure and list what fails

Size M, this PC: Docker. After: S1.4, S2.1, S2.2, S3.1, S3.2, S3.3. **Status: open.**

- **What:** Create ulpin-reh-04 empty with S1.2's procedure, at staging after S1.4 plus S3.1 and S3.2. Drop the whole practice kit at once with the S3.3 runner on a quiet PC. This is a measurement run: produce the failure list against the plan's done line (API never exits; first features within 60 s; no frame over 100 ms) and the kept-not-drawn list caused by the 16 to 32 MiB reader ceilings. Stop reh-04 at the end.
- **Files:** scripts/rehearsal/kit-drop.mjs (S3.3); docs/evidence/step2/s2-1 and s2-2 manifests; docs/backend/DEMO-RUNTIME.md:296-311. Write: docs/evidence/step3/s3-8/result.json.
- **Check:** result.json gives every practice file a verdict (drawn, kept with words, or failed) and seconds to first features. Exit files and pool peaks are recorded, plus frames over 100 ms per page. Demo doctor unchanged.
- **Tests:** pnpm platform:doctor --profile demo --runtime ulpin-reh-04

### S3.9 Fix the long frames the practice-kit drop records

Size M, this PC: runtime. After: S3.8. **Status: open.**

- **What:** Take the worst long tasks from S3.8's frame log, measured on the production build, and remove them by spreading work across frames or moving it to the existing workers (surface.worker.ts, imagery.worker.ts). Known suspects:
- REH13 put 7 of 10 long frames 16.5 to 18.9 s after map open, right after the first surface part and raster window
- batch page up to 850 ms in REH13
- scene budgets of 4 ms (engine.ts:83-84) Method (merged from S3.9): record one browser performance trace each of a map open (the 1,661 NYC footprints) and a batch reload, name the function behind each long task before changing code, fix the top one, measure again. REH15 showed 500 ms 0.7 s after map start and 367 ms at a batch reload. S7.6 (lighter map polling) goes first.
- **Files:** apps/studio/src/features/map/surface/useSurfaceLayer.ts, api.ts, surface.worker.ts; packages/scene/src/engine.ts:83-84,600-620; apps/studio/src/features/intake/IntakeTray.tsx, BatchPage.tsx; apps/studio/src/features/map/WindowedArea.tsx
- **Check:** Re-running the S3.3 runner on the same kit shows 0 frames over 100 ms on the batch and map pages.
- **Tests:** pnpm --filter @ulpin/studio exec vitest run src/features/map/map-frames.test.tsx src/features/map/surface/useSurfaceLayer.test.tsx src/features/map/surface/parts.test.ts src/features/intake/IntakeTray.test.tsx src/features/intake/batch-page.test.tsx; pnpm --filter @ulpin/scene test (incremental.test.ts, base-incremental.test.ts); pnpm studio:typecheck; ui-design-check report

### S3.10 API connection pool: no 503 while the whole kit drops

Size M, this PC: runtime. After: S3.1, S3.8. **Status: open.**

- **What:** Only if S3.8's pool numbers show waiting above 0 for more than 5 s, or any 503. The API pool is max 8 with a 5 s connect timeout (db.ts:25-29), which matches REH15's 503 after about 5 s. Use S3.1's waiting counts and S3.8's request log to find which routes hold connections longest under the drop (uploads, the batch manifest read, event pages: events.ts:120-175). Shorten those holds, or keep long reads off the shared pool. Raising the pool size alone is not the fix.
- **Files:** packages/server/src/infrastructure/db.ts:22-60; packages/server/src/modules/usp/ingestion/events.ts:120-175; the upload and manifest routes named by S3.8
- **Check:** Re-run of the S3.3 runner on the practice kit: zero 503 responses and pool waiting stays under 5 s in every sample.
- **Tests:** tests/intake-api.test.ts; tests/intake-storage.test.ts; pnpm typecheck:backend

### S3.11 Practice-kit drop 2: measured and passing

Size M, this PC: Docker. After: S3.4, S3.5, S3.6, S3.7, S3.9, S3.10. **Status: open.**

- **What:** The step 3 done line: on a new empty ulpin-reh-05 and a quiet PC, at staging with S3.4 to S3.10 merged, drop the whole practice kit at once. The API and dispatcher never exit. Maps-and-tables files show first features within 60 s, with officer answer time listed separately. No frame over 100 ms. Files above a reader ceiling are kept with plain words. Record the result for the owner's report.
- **Files:** scripts/rehearsal/kit-drop.mjs; practice manifests; docs/evidence/step3/s3-11/result.json
- **Check:** result.json: exit files empty, max frame under 100 ms on both pages, and every maps-and-tables file with firstFeaturesSeconds 60 or less (officer time excluded and stated). No file without a verdict.
- **Tests:** pnpm platform:doctor --profile demo --runtime ulpin-reh-05


## Step 4: Understanding: the reading card

There is no per-file reading card today. Tables wait for a press before anything is profiled; judges' tables are refused for Sarvam while judges' GeoJSON is not gated at all (S4.1 closes this). Memory is empty on a fresh runtime, so rules and the officer carry understanding.

### S4.1 Owner switch for Sarvam on judges' files: one gate for tables and map layers

Size S, code only. After: none (wave 1; disjoint from S4.2 and S4.3). **Status: open.**

- **What:** Judges' tables are always refused, because tabularTeacherPolicy swaps in CASE_ORIGINAL_TEACHER_REFUSED. A judge's GeoJSON reaches Sarvam whenever the gateway is on, because proposeIntakeLayout calls adaptive.propose with no case-original check. Add one setting from ULPIN_TEACHER_CASE_ORIGINALS: absent or off means refuse, masked_profile means allow. Both paths obey it with the same code and plain words. When allowed, a table uses the real teacher with split unlabelled, but never for licence restricted or containsPersonalData yes. Document the owner's one-line step in DEMO-GATEWAY.md.
- **Files:** packages/server/src/infrastructure/config.ts:19-59 (getter beside dispatchMemoryMib); packages/server/src/modules/usp/ingestion/chunk-mapping-tabular.ts:103-112 tabularTeacherPolicy; intake-draft-worker.ts:92-103 proposeIntakeLayout; chunk-mapping-worker.ts:166-176 propose (manual-geojson branch); adaptive-mapping-service.ts:28-56; packages/contracts/src/usp/ingestion.ts:154-162 (provenance fields, read only); docs/backend/DEMO-GATEWAY.md (one section)
- **Check:** pnpm exec tsx --tsconfig apps/api/tsconfig.json --test tests/tabular-admission.test.ts packages/server/src/modules/usp/ingestion/intake-draft.test.ts
- Variable unset: the existing test at tabular-admission.test.ts:360 ('every case-original teacher callback refuses before the request builder is called') still passes. A new test shows a case GeoJSON never calls adaptive.propose and gets the officer question.
- masked_profile: the replay teacher is called once for lgd-gurugram.csv admitted as a case original, and zero times when its licence is restricted.
- Expected: all tests pass.
- **Tests:** tests/tabular-admission.test.ts; packages/server/src/modules/usp/ingestion/intake-draft.test.ts; tests/adaptive-mapping.test.ts; scripts/agent/mapping-routing.test.ts; pnpm typecheck:backend

### S4.2 Rules name clear field meanings before the student and the teacher

Size M, code only. After: none (wave 1). **Status: open.**

- **What:** Memory is empty on a fresh runtime and the student commits no correct field, so judge columns end unanswered. Add mapping-rules.ts: header rules (English and common Hindi words) plus the existing value shapes and declared unit, giving canonical targets each with a rule name. A quantity needs a stated unit, a storey count needs a count header, and no two columns may get one target. Call it in proposeMapping after memory and before callStudent, so only unmatched columns reach the student and teacher. Add source 'rule' and method rule:<name>@1 to the contracts and an optional ruleFields metric. Add Studio words for 'rule' and for the raw codes CASE_ORIGINAL_TEACHER_REFUSED and TEACHER_DATA_DENIED.
- **Files:** new packages/server/src/modules/usp/ingestion/mapping-rules.ts; mapping-teacher.ts:705-873 (RoutingOptions, FieldSourceKind 711, remainingTeacher 780-792, routedSources 801-813, routedResult 815-838, proposeMapping 841-873); chunk-mapping-agent.ts:95-109 chunkMetrics; column-profile.ts:151-215 (read only); packages/contracts/src/usp/chunk-mapping.ts:16-24 (source enum line 19); packages/contracts/src/canonical/mapping-plan.ts:48-51 MappingMethodSchema; packages/contracts/src/usp/ingestion-events.ts:11-17; packages/contracts/src/canonical/targets.ts:65-200 (read only); apps/studio/src/features/intake/table/model.ts:11-60; table/LearnerPanel.tsx:18-55
- **Check:** New mapping-rules.test.ts on real headers.
- fixtures/real-nyc/original.geojson properties, through profileGisAttributes: bin is building.sourceKey, name is building.name, height_roof is unknown (no unit stated).
- Baton Rouge footprint CSV headers copied into the test (NUMBER OF FLOORS, HEIGHT (FEET), ID, ID 2): building.storeyCount; building.heightM in ft; ID and ID 2 both unknown.
- Edmonton 'Building Address': building.addressLiteral.
- fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv: no building or parcel target.
- proposeMapping on the NYC profile: fieldSources is rule for those fields, and the student gets no input for them.
- **Tests:** scripts/agent/mapping-routing.test.ts; scripts/agent/a3e-unanswered.test.ts; scripts/agent/mapping-teacher.test.ts; tests/tabular-admission.test.ts; packages/server/src/modules/usp/ingestion/mapping-memory.test.ts; column-profile.test.ts; apps/studio/src/features/intake/table/model.test.ts; pnpm typecheck:backend && pnpm studio:typecheck

### S4.3 Reading card: contract, assembler and route for what a file is, what it holds and how it is drawn

Size M, code only. After: none (wave 1; sole writer of contracts usp/intake.ts while open). **Status: running codex since 24 Oct 2026.**

- **What:** The tray shows family, format, counts, CRS, extent and a reason, but never says in plain words what a file is or how it will be drawn. Add IntakeReadingSchema (intake-reading/1: what, holds[], fields[], drawing{as,words}, links[], question; each line has a basis: reader, memory, rule, sarvam or officer). Also add an optional one-line what on IntakeItem, computed from the row with no extra read. A new pure assembler builds what, holds, drawing and the open question from the row, its IntakeCard and source.inspection, reusing keptWords, zipParentWords and surfaceWords; fields and links stay empty here. Add GET cases/:caseId/intake/items/:itemId/reading under the item route's authority. The holds lines also show what the intake card already has but the Studio never shows (merged from the UI reader's S4.8): layers, geometry types, raster size and bands, point format and scale, format version, CRS words and extent. Unknown stays unknown; nothing is invented.
- **Files:** packages/contracts/src/usp/intake.ts:205-249 (IntakeItemSchema; new IntakeReadingSchema after it); new packages/server/src/modules/usp/ingestion/intake-reading.ts; intake-ledger.ts:122-153 intakeItem; intake-service.ts:221-230 one() (add reading()); apps/api/src/modules/ingestion/ingestion.controller.ts:76-81; intake-draft.ts:73-173 (export keptWords only); intake-surface.ts:534-556 (export surfaceWords only)
- **Check:** New intake-reading.test.ts. Run probeOriginal (intake-probe.ts:91) and then the assembler on fixtures/real-nyc/original.geojson, fixtures/real-area/original.geojson, lgd-gurugram.csv and a repo xlsx fixture.
- Each card names its kind and counts.
- Each card has a drawing line: outlines once the layer is answered; a table is drawn only after placement.
- None has 'Not known' in what or drawing.
- An unknown-kind file is kept with its reason.
- With the data drive present (skip as at intake-evidence.test.ts:35): nyc-10013-ortho-2018.tif reads as a raster overlay and nyc-10013-lidar-2017.laz as points.
- tests/nest-intake.test.ts passes for the new route.
- **Tests:** tests/intake-probe.test.ts; tests/intake-api.test.ts; tests/nest-intake.test.ts; packages/server/src/modules/usp/ingestion/intake-manifest.test.ts; intake-ledger.test.ts; apps/api/src/modules/ingestion/ingestion.controller.test.ts; openapi --check (the merger regenerates openapi.json and api-client types)

### S4.4 A teacher field whose only fault is its rationale keeps its target as a question

Size S, code only. After: S4.2 (same file mapping-teacher.ts, one writer). **Status: open.**

- **What:** LP6 refused both live mapping plans, all 16 fields on fields.N.rationale. One digit, EPSG or 'coordinate' fails the schema, and retainValidFields then drops the field. SV3 changed only the prompt, and nothing live has passed since. Keep the rule unchanged. A field failing only its rationale keeps target, operation and confidence, with a code-owned rationale ('Withheld: the explanation stated a literal.') and issue TEACHER_RATIONALE_WITHHELD. It stays a question for the officer, and no literal reaches the stored plan. The lead approves this first: it changes SV3's consequence, not its rule.
- **Files:** packages/server/src/modules/usp/ingestion/mapping-teacher.ts:86-109 (TeacherOutputSchema), 420-476 (unknownFields, validIsolatedField, retainValidFields), 557-562 acceptedResult; mapping-teacher-prompt.ts (read only); apps/studio/src/features/intake/table/model.ts:11-25 (one word line); docs/evidence/gf-ai/gateway/lp6/result.json (read only)
- **Check:** scripts/agent/mapping-teacher.test.ts gets a replayed LP6-shaped answer on the lgd-gurugram.csv profile: every field has a valid target and a rationale with a digit.
- Expected: each field is kept with the withheld rationale and issue TEACHER_RATIONALE_WITHHELD, state needs_input.
- The schema still refuses 'column 3', 'EPSG 4326' and 'coordinates', and still accepts 'the column header names a registration number'.
- **Tests:** scripts/agent/mapping-teacher.test.ts; scripts/agent/mapping-teacher-review.test.ts; scripts/agent/mapping-routing.test.ts; tests/model-gateway/diagnostics.test.ts

### S4.5 A dropped table is read and proposed without a press when its layout is certain

Size M, code only. After: S4.3 (keptWords export in intake-draft.ts) and S4.1 (teacher policy applies to the proposal). **Status: open.**

- **What:** A dropped CSV, TSV, XLSX or ODS rests as kept until the officer presses Read as a table. Its mapping jobs start from the browser, so its card has no field meanings until someone acts. When the selection is certain, queue the same server calls the press makes, from a job: tableFromOriginal, then StreamingVectorService.enqueue and ChunkMappingService.enqueue, as queueApprovedTabular does. Certain means a CSV or TSV (its only allowed header is row 1) or a one-sheet workbook with header row 1. A workbook with several sheets keeps the press, and its card names that question. The table section shows the read in progress instead of the press.
- **Files:** packages/server/src/modules/usp/ingestion/intake-draft.ts:147-173 (keptOnly, keptWords), 274-283 (route), 331-345 settleKeptTx; intake-draft-worker.ts:294-313 (job pattern); service.ts:677-700 tableFromOriginal; chunk-mapping-learning.ts:180-201 queueApprovedTabular (pattern, read only); packages/contracts/src/usp/ingestion.ts:136-146 (selection rule, read only); apps/studio/src/features/intake/BatchTableSection.tsx:36-80
- **Check:** packages/server/src/modules/usp/ingestion/intake-draft.test.ts with its fake client.
- Enrolling lgd-gurugram.csv queues one table read. It writes a manual-tabular/1 profile, then exactly one streaming-vector and one chunk-mapping job with the item's pins. No officer request is involved.
- A two-sheet workbook stays kept, with words naming the sheet question.
- Replaying the enrolment queues nothing new.
- **Tests:** packages/server/src/modules/usp/ingestion/intake-draft.test.ts; intake-manifest.test.ts; tests/tabular-admission.test.ts; tests/table-later-receipt.test.ts; apps/studio/src/features/intake/BatchTableSection.test.tsx

### S4.6 Reading card fields: each field's meaning and where it came from

Size M, code only. After: S4.2, S4.3. **Status: open.**

- **What:** Fill fields[] in the reading.
- A table: meanings come from its stored first chunk-mapping proposal (plan and fieldSources); an approved recipe wins as officer.
- A map layer: each property path of the stored profile becomes a gis_attributes column with no samples. Run it through memory and the S4.2 rules only; a read never calls the teacher.
- A stored adaptive proposal shows as Sarvam. The approved recipe's kind, key, name and height show as officer.
- Suggest a drawing kind from file or layer name words (building, footprint, parcel, plot, road, park), only when the geometry fits.
- Words come from CANONICAL_TARGETS; unknown stays not known.
- **Files:** packages/server/src/modules/usp/ingestion/intake-reading.ts (from S4.3); mapping-rules.ts (from S4.2, read only); mapping-memory.ts:84-100; chunk-mapping-tabular.ts:24-53, 76-88 (stored payload shape); intake-draft-worker.ts:119-135 preparedProposal, 177-190 origin; apps/studio/src/features/intake/question-model.ts:33-43 kindRefusal (rule to mirror); packages/contracts/src/canonical/targets.ts:65-200 (read only)
- **Check:** intake-reading.test.ts.
- The NYC footprints profile (fixtures/real-nyc/original.geojson): bin is 'Building source key, from a rule'; name is 'Building name, from a rule'; height_roof is 'not known'; the kind suggested is building.
- A stored lgd-gurugram.csv chunk payload: each column gets the basis its fieldSources state.
- With an approved recipe fixture, key and name show 'confirmed by the officer'.
- A fake gateway counts 0 teacher calls during reads.
- **Tests:** intake-reading.test.ts; scripts/agent/mapping-routing.test.ts; packages/server/src/modules/usp/ingestion/intake-draft.test.ts; mapping-memory.test.ts; tests/nest-intake.test.ts

### S4.7 Reading card holds lines for 3D models, IFC, PDFs and surfaces, from their stored readings

Size M, code only. After: S4.3; after S4.6 (same file intake-reading.ts). **Status: open.**

- **What:** The item already names its stored readings: native reader job for DXF, CityGML, CityJSON, glTF and OBJ; ifcJobId; the PDF's document reading; plan_ref.header for orthophotos and point clouds. Read these once in the reading route and turn them into holds and drawing lines: objects and types, storeys and spaces, pages and pages needing OCR, pixels, bands, points, stated CRS and vertical reference. Add the layers a conversion left out. Reuse the Studio's existing summary words where they exist; no reader runs again.
- **Files:** packages/server/src/modules/usp/ingestion/intake-reading.ts; intake-ledger.ts:144-150 (job ids on the item); intake-native-readers.ts; intake-native-omissions.ts; intake-ifc.ts; documents.ts readDocumentResult (read only); intake-surface.ts:534-556; apps/studio/src/features/intake/native/reading-model.ts:45-60 (read only)
- **Check:** intake-reading.test.ts with stored job results from the existing reader tests (intake-native-readers.test.ts, intake-ifc.test.ts).
- A DXF reading states its entity count and that it is kept as evidence, not placed.
- An IFC names its storey count.
- A PDF names its pages and how many need OCR.
- With the data drive present, Box.glb, 1_polylines.dxf and Building_and_garage_LOD2-EPSG25832.gml give cards with no 'Not known' in what or drawing.
- **Tests:** packages/server/src/modules/usp/ingestion/intake-native-readers.test.ts; intake-native-omissions.test.ts; intake-ifc.test.ts; intake-surface.test.ts; tests/intake-pdf-batch.test.ts

### S4.8 The batch screen shows each file's reading card

Size M, code only. After: S4.3 merged with openapi.json and api-client types regenerated by the merger; field lines fill in after S4.6. **Status: open.**

- **What:** Add ReadingCard.tsx and reading-model.ts with a useReading query, shown first in ItemDetail; the tray's Contents cell shows the one-line what. The card lists:
- what the file is and what it holds;
- each field's meaning, with its basis in words ('from a rule', 'from memory', 'from Sarvam, not confirmed', 'confirmed by you', 'not known');
- how it will be drawn, or why not;
- the one open question, with a button to the existing answer (View layout, Open the table, layer CRS, page choice).
Values come only from the reading. This is the single writer of ReadingCard.tsx. Each field's row shows its meaning and where it came from (memory, rule, Sarvam not confirmed, confirmed by you, not known); a Sarvam meaning carries Needs review until the officer confirms it; a file without links says so (merged from S4.8).
- **Files:** new apps/studio/src/features/intake/ReadingCard.tsx and reading-model.ts; BatchPage.tsx:108-122 ItemDetail; IntakeTray.tsx:25-48 (Contents cell 27-29); batch-queries.ts (one query, existing pattern); Batch.module.css
- **Check:** pnpm --filter @ulpin/studio exec vitest run src/features/intake/batch-page.test.tsx src/features/intake/reading-card.test.tsx
- An item with the NYC footprints reading shows what, holds, three field lines with their basis, and the layout question button.
- A kept unknown file shows its reason and no question.
- The tray row shows the one-line what.
- The $ui-design-check report is attached.
- **Tests:** apps/studio/src/features/intake/batch-page.test.tsx; IntakeTray.test.tsx; batch-model.test.ts; pnpm studio:typecheck && pnpm studio:test

### S4.9 The one officer question opens with the card's answers filled in

Size M, code only. After: S4.6, S4.8. **Status: open.**

- **What:** LayoutAnswer and the streamed answer start blank, and table placement assumes no EPSG. Fill them from the reading:
- identifier: the building.sourceKey field, if identifierPaths allows it;
- name: building.name, within namePaths;
- height: building.heightM, with its stated unit and meaning;
- kind: only when kindRefusal accepts the geometry;
- for a table: the lon/lat or WKT columns the rules found, and EPSG only when the file states one.
Each filled choice says where it came from. Nothing is sent until the officer presses the existing approve button.
- **Files:** apps/studio/src/features/intake/LayoutAnswer.tsx:40-76 (blank start at 44); StreamedLayoutAnswer.tsx:1-52; question-model.ts:9-18, 33-126 (kindRefusal, identifierPaths, namePaths, heightPaths, questionBody); PlaceOnMapDialog.tsx:40-100 (x/y or WKT at 72-79); packages/server/src/modules/usp/ingestion/table-geojson.ts:197 (no EPSG assumed, read only); reading-model.ts (from S4.8)
- **Check:** vitest question-model.test.ts and StreamedLayoutAnswer.test.tsx.
- Given the NYC footprints reading, the answer opens with kind building, identifier /features/*/properties/bin and name /features/*/properties/name.
- The approve body equals questionBody (question-model.ts:84-106) for the same choices made by hand.
- A reading with no rule answers opens blank, as today.
- **Tests:** apps/studio/src/features/intake/question-model.test.ts; layout-model.test.ts; StreamedLayoutAnswer.test.tsx; PlaceOnMapDialog.test.tsx; layout-command.test.ts

### S4.10 Live check: the mapping teacher returns a usable plan on two public tables

Size S, this PC: runtime. After: S4.4 merged into the served commit; the lead confirms the owner's Sarvam approval covers this spend; the only task needing this PC's runtime in its wave. **Status: open.**

- **What:** No live Sarvam mapping plan has validated since LP6, where both were refused on the rationale rule. After S4.4 is in the served commit, run live-proof --plan and --dry-run (expect providerDispatches 0). Then run --live for the mapping steps only: at most four calls, which at LP6's 107,370 to 134,610 micro-INR per call is under Rs 1. Record per field the target, its validation and whether the rationale was withheld. No demo code or policy change; ledger reads only.
- **Files:** scripts/agent/live-proof.ts:1160-1195 (modes), 230-245 (curve-file mapping steps); docs/evidence/gf-ai/gateway/lp6/result.json (method to repeat, read only); docs/backend/DEMO-GATEWAY.md
- **Check:** The live receipt shows at most 4 provider dispatches, all settled with HTTP 200. At least one mapping step ends candidate or keeps fields, not TEACHER_INVALID_PLAN on every field. Spend is under Rs 1, read from usp_model_calls as LP6 did.
- **Tests:** scripts/agent/live-proof.ts --plan and --dry-run (providerDispatches 0); tests/model-gateway/diagnostics.test.ts; scripts/agent/mapping-teacher.test.ts

### S4.11 A large file or cell batch with an already-approved layout needs only one confirmation

Size M, code only. After: S4.9. **Status: open.**

- **What:** A large GeoJSON's layout is officer-only: streamed recipes have no memory, while small files reuse approved recipes whose paths are contained. So every cell batch of a wide file and every converted layer asks the same question again. Reuse the containment check against the streamed profile paths to fill the streamed answer from the operator's newest approved recipe, shown as 'from memory'. Approval stays the officer's press. Cut candidate.
- **Files:** packages/server/src/modules/usp/ingestion/intake-draft-worker.ts:51-90 (export profileContained logic); streamed-mapping.ts:120-160; intake-large.ts:380-397 intakeLargePlan; intake-ledger.ts:98-110 (cell batches, read only); intake-reading.ts; apps/studio/src/features/intake/StreamedLayoutAnswer.tsx
- **Check:** intake-large.test.ts: two streamed profiles in one case with the same property paths.
- After the first recipe is approved, the second item's reading names the same key and name with basis memory, and StreamedLayoutAnswer opens filled.
- A profile missing the key path gets no memory answer.
- **Tests:** packages/server/src/modules/usp/ingestion/intake-large.test.ts; intake-large-steps.test.ts; intake-draft.test.ts; apps/studio/src/features/intake/StreamedLayoutAnswer.test.tsx

### S4.12 After the owner's yes, Sarvam names the remaining map-layer field meanings

Size M, code only. After: S4.1, S4.2, S4.6; switched on only after the owner's yes on PLAN Needs you 3. **Status: open.**

- **What:** Map layers reach Sarvam only through the building-key proposal, which takes only EPSG:4326 building polygons. Every other property stays unknown or rule-named. In the intake draft job, after memory and rules: profile the first 100 features as gis_attributes with masked samples, and call proposeMapping (teacher only under the S4.1 switch). Store the routed result in an operations row keyed by item and source revision. The reading shows those fields as Sarvam, not confirmed. Cut candidate.
- **Files:** packages/server/src/modules/usp/ingestion/intake-draft-worker.ts:119-135 preparedProposal; column-profile.ts:93-102 maskColumnSample, 255-265 profileGisAttributes; mapping-teacher.ts:841-873 (call only); adaptive-mapping.ts:148-150 (read only); intake-reading.ts (read the stored row)
- **Check:** intake-draft.test.ts with a replay gateway.
- The NYC footprints file makes exactly one teacher request, for the columns the rules left unknown.
- With the S4.1 switch off it makes none.
- The reading lists those fields with basis sarvam.
- A replayed draft job does not ask again.
- **Tests:** packages/server/src/modules/usp/ingestion/intake-draft.test.ts; scripts/agent/mapping-routing.test.ts; tests/tabular-admission.test.ts


## Step 5: Drawing every family

The map draws polygons only: lines, pins and table points are kept but never drawn (S5.1, S5.2). Reader ceilings are 8 to 128 MiB against the owner's 1 to 2 GB targets. 3D models and DXF are read but shown as words only.

### S5.1 Draw recorded and proposed lines and pins on the map

Size M, code only. After: S1 (int3-pre merged into staging). Parallel with S5.3, S5.4, S5.7, S5.8 (disjoint files). **Status: open.**

- **What:** The map draws polygons only. Road and utility layouts already accept lines and points, so KML paths and placemarks, road centrelines and lon/lat table rows become records the map never draws. Add optional lines and pins to BaseFeatureInput. Draw them in the existing base batches: one LineSegments object for lines and one Points object for pins, built in rebuildBaseLines, and include them in baseBounds. toBase should pass LineString, MultiLineString, Point and MultiPoint geometry for non-building kinds, and undrawnNote then counts only features that have no geometry. Display only: no picking or geometry change.
- **Files:** packages/scene/src/types.ts:45-58 (BaseFeatureInput); packages/scene/src/engine.ts:53-60 (BaseBatch), 554-705 (setBase, addBaseEntry, rebuildBaseLines, baseLines), 2081 (baseBounds), 2180-2200 (ringLines, lines); apps/studio/src/features/map/footprints.ts:45-83 (toBase, convertBase), 150-185 (polygonsOf, undrawnNote)
- **Check:** Take the 35 LineString features of fixtures/google-uttam/02-osm-road-centrelines.geojson (OSM, committed) as recorded road AreaFeatures. Expected: toBase returns 35 inputs, each with lines and no polygons. A scene engine test given them holds one base line object whose segment count equals the sum of (vertices minus 1) over the 35 lines. undrawnNote returns null.
- **Tests:** pnpm --filter @ulpin/scene test (base-incremental.test.ts, engine.test.ts); pnpm --filter @ulpin/studio test -- footprints map-frames; pnpm studio:typecheck; $ui-design-check report

### S5.2 The display window sends lines and pins

Size S, code only. After: S5.1 (BaseFeatureInput lines and pins). **Status: open.**

- **What:** Large areas are drawn through GET /api/v1/areas/{areaId}/display-window. Its outline() keeps polygons only, its feature schema has only polygons, and windowScene skips a feature with no polygons, so lines and pins vanish in window mode even after S5.1. Add optional lines and pins to AreaWindowFeatureSchema, fill them next to outline() from the same local GeoJSON, and pass them to the scene in windowScene. The merger regenerates openapi.json and the api-client.
- **Files:** packages/contracts/src/area.ts:356-365 (AreaWindowFeatureSchema); packages/server/src/modules/areas/area-display-window.ts:120-147 (row mapping, outline); apps/studio/src/features/map/areaWindow.ts:41-52 (windowScene)
- **Check:** New case in area-display-window.test.ts: a proposed road whose local geometry is a LineString of 4 vertices inside the window. Expected: the response returns lines holding those 4 positions and no polygons, and windowScene turns it into one base input with lines.
- **Tests:** tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/areas/area-display-window.test.ts packages/server/src/modules/areas/area-display-read.test.ts; pnpm --filter @ulpin/studio test -- areaWindow; pnpm typecheck:backend; openapi.ts --check

### S5.3 NDJSON and GeoJSON text sequences take the large GeoJSON path

Size L, code only. After: S1. Parallel with S5.1, S5.4, S5.7, S5.8. In intake-draft.ts it owns lines 222-310 only. **Status: open.**

- **What:** A batch NDJSON or RS-framed GeoJSON sequence is probed as a vector, but no reader takes it. Only geojson cards reach the streaming reader, the item rests on the words Drafting accepts only a retained GeoJSON recipe original, and the large step always asks for feature-collection framing. Add a geojson-lines framing (one Feature per LF-ended line) to the existing reader next to geojson-seq-rs. Route ndjson and geojson-seq vector cards to the large path with their framing. Let the sealed map receipt accept a sequence, using the RFC 7946 lon/lat reference already used for a collection with no crs member. A record that is not a Feature is quarantined with words. Add forecast words for .ndjson, .geojsonl and .geojsons. The merger regenerates openapi.json.
- **Files:** packages/contracts/src/usp/streaming-vector.ts:29 (StreamingVectorFramingSchema); packages/server/src/modules/usp/ingestion/streaming-vector-reader.ts:130-176 (readStreamingFeatures); streamed-map-receipt.ts:19-23, 63-67; streaming-vector-worker.ts:67-74, 174, 277-344 (receipt and holdCollection by framing); streaming-vector.ts:150-152; intake-large-worker.ts:136-141 (startReaders framing); intake-draft.ts:222-232 (intakeReaderRoute), 273-310 (queueIntakeDraftTx retainedGeojson); apps/studio/src/features/intake/upload-model.ts:83-115
- **Check:** In a test, rewrite fixtures/google-uttam/00-all-google-detections.geojson (91 Open Buildings polygons, committed) as NDJSON and as an RS sequence. Expected: probeOriginal names them ndjson and geojson-seq, family vector. intakeReaderRoute gives streamed_geojson. readStreamingFeatures returns 91 features whose parsed values equal the collection's features. sealedMapReceipt gives sourceCrs EPSG:4326 with the RFC 7946 evidence words.
- **Tests:** tsx --tsconfig apps/api/tsconfig.json --test tests/intake-probe.test.ts packages/server/src/modules/usp/ingestion/streaming-vector-reader.test.ts streaming-vector-worker.test.ts streamed-map-receipt.test.ts intake-draft.test.ts intake-large.test.ts; tests/upload-reader-limits.test.ts; pnpm --filter @ulpin/studio test -- upload-reader; openapi.ts --check

### S5.4 GeoParquet in a batch is converted to GeoJSON layers like a GeoPackage

Size M, this PC: data drive. After: S1. Parallel with S5.1, S5.3, S5.8. S5.5 follows it (same file, native_gis.py). **Status: open.**

- **What:** A batch GeoParquet is probed as a vector but falls into the GeoJSON drafting words. The existing GeoParquet reader runs only on a host profile that the runtime does not build. Make GeoParquet a native-derivative format. In native_gis.convert_native_file, read it in row batches with pyarrow, turn each row's WKB into GeoJSON with shapely, and write it into the existing _Derivative writer with the row index as its locator. Take the CRS from the file's geo metadata using native_geoparquet.json_metadata and profile; a layer with no CRS goes to the existing layer CRS question. Add pyarrow==21.0.0 to services/geo/requirements.txt. nativeDerivativeFormat returns geoparquet, and hasConvertedLayers and the forecast name it. A plain Parquet without geo metadata stays kept as a table.
- **Files:** services/geo/geo/native_gis.py:375-420 (_Derivative), 1157-1174 (convert_native_file), 1229-1270 (convert_native); services/geo/geo/native_geoparquet.py:197-297 (reuse json_metadata, profile, wkb_guard; no pin change); services/geo/requirements.txt; packages/server/src/modules/usp/ingestion/intake-draft.ts:45-56; intake-native-derivative.ts:90-92 (kinds); apps/studio/src/features/intake/native/reading-model.ts:36-43; upload-model.ts:96-104
- **Check:** New case in services/geo/tests/test_native_conversion.py on E:/BhuAayam-data/task-data/desktop-geoparquet-native/originals/example.parquet, using pyarrow from that folder's wheels. Expected: one layer converted, written plus not-written features equal the file's row count, the layer CRS comes from its geo metadata, and each sidecar line names its row. alltypes_plain.parquet in the same folder converts nothing and stays kept.
- **Tests:** python -m pytest services/geo/tests/test_native_conversion.py services/geo/tests/test_native_geoparquet.py; tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/usp/ingestion/intake-native-derivative.test.ts intake-draft.test.ts; pnpm --filter @ulpin/studio test -- NativeReading

### S5.5 Native GIS conversion takes originals up to 1 GiB

Size M, code only. After: S5.4 (same file, native_gis.py). **Status: open.**

- **What:** GeoPackage, shapefile (ZIP or loose set), KML and KMZ in a batch convert only up to 128 MiB of source and 128 MiB per derivative, and the server waits at most 10 minutes for a conversion, against the owner's 1 GB file and 500,000-feature layer. Raise the source and derivative bounds to STREAMING_VECTOR_LIMITS.sourceBytes (1 GiB). Scale the conversion request timeout with streamingReadMs of the source bytes, keeping the heartbeat. Update NATIVE_GIS_LIMITS and the tray and forecast words. Reading stays one window at a time. The words say layers enter the map path once the whole conversion ends.
- **Files:** services/geo/geo/native_gis.py:359-361, 1195-1200 (_pins), 1218-1219 (_set_parts); packages/contracts/src/upload-reader-limits.ts:16-17 (NATIVE_GIS_LIMITS); packages/server/src/modules/usp/ingestion/intake-native-derivative-worker.ts:21-30, 105-115; intake-native-derivative.ts:41, 265-275 (words); apps/studio/src/features/intake/upload-model.ts:96-100
- **Check:** New case in services/geo/tests/test_native_gis_shapefile.py: a test_only shapefile set above 128 MiB, written with pyshp into a temporary folder. Expected: it converts to one layer whose derivative bytes and sha256 match the written file, and the same set with the old bound would have been refused.
- **Tests:** python -m pytest services/geo/tests/test_native_gis_shapefile.py services/geo/tests/test_native_conversion.py services/geo/tests/test_native_kml.py; tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/usp/ingestion/intake-native-derivative.test.ts intake-shapefile-set.test.ts; tests/upload-reader-limits.test.ts

### S5.6 Processor image with GeoParquet and 1 GiB conversion, checked on reh-02

Size M, this PC: Docker. After: S5.4, S5.5, S2 (practice kit). The only runtime task while it runs. **Status: open.**

- **What:** The services/geo changes from S5.4 and S5.5 reach a runtime only through a new processor image pinned in scripts/platform/processor-image.json. Build the image from staging after both merge, pin it, and roll ulpin-reh-02 as REH16 did (its roll.json steps, doctor PASS). Then drop the practice kit's GeoParquet and its largest GeoPackage or shapefile above 128 MiB into one batch. Keep the old images. Roll back and stop reh-02 at the end. The demo is not touched.
- **Files:** scripts/platform/processor-image.json; scripts/platform/processor-image.mjs and processor-image-pin.mjs (use, no change expected); docs/evidence/5/s5.6/result.json
- **Check:** On ulpin-reh-02 serving the new image: both files show their converted layers in the tray, and after one layout answer each first layer has its first part on the map, with seconds recorded. Doctor PASS before and after, the image tag is recorded, and reh-02 is rolled back and stopped.
- **Tests:** node --test scripts/platform/processor-image.test.mjs scripts/platform/runtime-image.test.mjs

### S5.7 Decimal-comma coordinates can be placed when the officer states the mark

Size S, this PC: data drive. After: S1. Parallel with everything in this family (disjoint files). **Status: open.**

- **What:** A semicolon CSV with decimal commas is read, but its rows cannot be placed: coordinateText accepts only a decimal point, so every row is skipped as not_a_number. Add an officer-stated decimal mark to IntakeTablePlacementSchema (point by default, never guessed) and a choice for it in PlaceOnMapDialog. When the mark is comma, rowGeometry turns one comma per cell into a point before the existing exact-number check. WKT stays point-only. The merger regenerates openapi.json.
- **Files:** packages/contracts/src/usp/intake.ts:85-93 (IntakeTablePlacementSchema); packages/server/src/modules/usp/ingestion/wkt.ts:17-21 (coordinateText); table-geojson.ts:85-99 (rowGeometry), 34-41 (input schema); apps/studio/src/features/intake/PlaceOnMapDialog.tsx:60-90; table-placement-command.ts:10-40
- **Check:** New case in table-geojson.test.ts on E:/BhuAayam-data/task-data/reh14/act2/csv2-edmonton-heritage-semicolon-decimal-comma.csv (460 bytes, sha256 a71375bd...). Expected: with the mark stated as comma, 5 rows are placed as points whose coordinate text equals each cell with its comma made a point. With point stated, the same 5 rows are skipped as not_a_number, as today.
- **Tests:** tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/usp/ingestion/table-geojson.test.ts wkt.test.ts tabular-stream.test.ts; pnpm --filter @ulpin/studio test -- PlaceOnMapDialog TablePlacement; openapi.ts --check

### S5.8 A DXF is drawn in its own frame in its reading

Size M, this PC: data drive. After: S1. Parallel with S5.1, S5.3, S5.4 (disjoint files except the one forecast line in upload-model.ts). **Status: open.**

- **What:** A DXF is read by the pinned ezdxf inspection, but the Studio shows only its summary lines, so a plan drawing is never seen. In the item's reading, fetch the stored inspection through the existing GET .../dxf/jobs/{jobId}/native route. Draw LINE, LWPOLYLINE without bulges and POLYLINE vertices whose coordinates are WCS, or whose extrusion is absent or 0,0,1, as one SVG in the file's own units (say $INSUNITS as stated, or not stated). Add a line counting what is not drawn, by entity type: CIRCLE, ARC, INSERT, TEXT, OCS and bulged polylines. Display only: never placed on the map, and no scale or CRS inferred. Draw at most 50,000 segments and count the rest. Update the DXF forecast note.
- **Files:** apps/studio/src/features/intake/native/NativeReading.tsx:1-69; native/reading-model.ts:60-77 (readingView); native/useNativeReading.ts:8-30; services/geo/geo/native_dxf.py:210-265 and 440-465 (read only: entity fields, vertices, units); apps/studio/src/features/intake/upload-model.ts:93
- **Check:** Produce the inspection of the real E:/BhuAayam-data/task-data/desktop-dxf-native/sources/1_polylines.dxf (82,846 bytes, sha256 37f57491...) offline with read_dxf in the pinned env E:/BhuAayam-data/task-data/desktop-dxf-native/env. Write it under E:/BhuAayam-data/task-data/s5-8/, not committed. New NativeReading.test.tsx case on it. Expected: the SVG holds one path per drawn entity, drawn plus not-drawn counts equal the inspection's entity count, and the words say the drawing is not placed on the map.
- **Tests:** pnpm --filter @ulpin/studio test -- NativeReading; tsx --tsconfig apps/api/tsconfig.json --test tests/dxf-read-compatibility.test.ts; pnpm studio:typecheck; $ui-design-check report

### S5.9 PDFs above 16 MiB: page view and one-page OCR up to 1 GiB

Size L, this PC: runtime. After: S1, S2 (a scanned PDF above 16 MiB in the practice kit). Not in parallel with S5.6 (one runtime task at a time). **Status: open.**

- **What:** A batch PDF above 16 MiB is kept and not read. Page inspection and the document worker read the whole original into memory, and the OCR helper refuses above 16 MiB. Stream the original once per job into its private scratch file and pass the path to the page renderer and to one-page OCR. Raise the page and OCR original bound to 1 GiB. Keep the 10 MiB text-layer bound and say so in the item words and the forecast. Refresh the host document profile through the existing documents step. Split at the page-view / OCR seam if it grows past 400 lines.
- **Files:** packages/contracts/src/document-pages.ts:4-5 (DOCUMENT_PAGE_LIMITS); packages/contracts/src/usp/document-ingestion.ts:6-9; packages/server/src/modules/usp/ingestion/document-pages.ts:56-120 (original, inspectPrivateDocumentPages); document-worker.ts:44-60; document-ocr.ts:140-160; services/geo/geo/usp_document_candidates/docling_tesseract.py:23-24, 90-105; intake-draft.ts:364-415 (queueBatchPdfTx, textLayerUnread); apps/studio/src/features/intake/upload-model.ts:105-110; scripts/platform/demo-document-runtime.mjs (documents step, use)
- **Check:** On ulpin-reh-02, a real scanned PDF above 16 MiB from the practice kit. Expected: the batch item says which pages have no text layer, page 1 opens in the page viewer, and OCR of one chosen page gives passages citing the original's sha256, revision and page. The API working set stays under 1.5 GB throughout. Afterwards reh-02 is rolled back and stopped.
- **Tests:** tsx --tsconfig apps/api/tsconfig.json --test tests/document-pages.test.ts tests/document-ocr-boundary.test.ts tests/intake-pdf-batch.test.ts packages/server/src/modules/usp/ingestion/intake-evidence-citations.test.ts; python -m pytest tests/test_document_pages.py; pnpm --filter @ulpin/studio test -- BatchPdfSection; node --test scripts/platform/demo-document-runtime.test.mjs

### S5.10 A DOCX in a batch is read by the document reader

Size M, code only. After: S5.9 (same PDF section of intake-draft.ts). It may run before S5.9 if S5.9 has not started. **Status: open.**

- **What:** A DOCX is recognised, but it rests as kept-only with the words that no batch reader takes it, although the document reader already extracts DOCX text. Send a batch DOCX to queueBatchDocumentTx with its own format instead of the fixed pdf. Settle it with paragraph words, the way batchPdfSettlement does: a passage naming floors or rooms is a candidate cited to its paragraph. Show its passages in the batch item through BatchPdfSection, without pages or OCR. Add a forecast entry. This is cut-list item 5, so it goes last.
- **Files:** packages/server/src/modules/usp/ingestion/intake-draft.ts:109 (batchPdf), 156-174 (keptOnly, keptWords), 273-280, 364-460 (queue and settle); documents.ts:63-77 (queueBatchDocumentTx format); document-native.ts:64-80 (read only); apps/studio/src/features/intake/BatchPdfSection.tsx:15-25; pdf-reading.ts; upload-model.ts:83-115
- **Check:** New case in tests/intake-pdf-batch.test.ts: a DOCX built in the test the way services/geo/tests/test_area.py builds one. Expected: the batch item is queued to the document reader with DocumentOriginal format docx, and, given the reader's parts, it settles read with words naming its paragraph count and the paragraph that names floors.
- **Tests:** tsx --tsconfig apps/api/tsconfig.json --test tests/intake-pdf-batch.test.ts tests/t089-intake-routing.test.ts packages/server/src/modules/usp/ingestion/intake-draft.test.ts; pnpm --filter @ulpin/studio test -- BatchPdfSection upload-reader; $ui-design-check report

### S5.11 Raster reader reads a 2 GB GeoTIFF/COG as preview windows at a step

Size M, this PC: data drive. After: Step 1: the base rehearsal shows the act 1 TIF and LAZ getting raster-window and point-batch jobs (runtime proof of SA1 and LQ1). Can run in parallel with S5.12, S5.13 and S5.21. **Status: open.**

- **What:** raster_window.py refuses originals over 16 MiB and reads only full-resolution 256-px windows, downloading and hashing the whole original for every window. Accept originals up to 2 GiB and add an optional whole-number window `step`: the output stays at most 256 x 256 px covering width*step x height*step source pixels, read with rasterio out_shape so GDAL uses COG overviews, and a null window becomes the whole extent at the step that fits 256 px (one overview). Download and verify each original once into a bounded private cache keyed by SHA-256 (atomic rename, least-recently-used eviction, free-space floor), reused by later windows and by point_batch.py _source_path. Report each band's valid min/max as an optional metadata field, so stored results still parse.
- **Files:** services/geo/geo/raster_window.py:21-25 (bounds), 30-41 (_window), 54-151 (read; default window 92-93; download/hash 70-82); services/geo/geo/point_batch.py:39-58 (_source_path uses the shared cache helper); packages/contracts/src/usp/raster-window.ts:4-11 (originalBytes 16 MiB to 2 GiB, sourcePixels, RasterPixelWindowSchema x/y max 100,000, optional step), 31-49 (bands min/max optional; refine stays on output pixels); services/geo/tests/test_surface_readers.py
- **Check:** E:/BhuAayam-data/task-data/d3/geo-py311/Scripts/python.exe -I -m pytest services/geo/tests/test_surface_readers.py -k 'overview or cache'. Expected, exit 0: the real nyc-10013-ortho-2018.tif read with window null returns one window of at most 256 px whose nativeBounds equal the full source bounds and whose windowTransform pixel size is the source resolution times the step; a second window of the same source does no second download; a wrong byte receipt is still refused.
- **Tests:** services/geo/tests/test_surface_readers.py; services/geo/tests/test_point_batch.py; tests/raster-publication.test.ts; tests/raster-read-authority.test.ts; tests/registry-raster-citations.test.ts (drive fixtures; the reader is re-pinned); packages/server/src/modules/usp/ingestion/intake-surface.test.ts

### S5.12 Batch screen draws a kept raster or point cloud in its own frame when it is not on the map

Size M, code only. After: None: it works with today's readers. Can run in parallel with S5.11, S5.13 and S5.14 (Studio files only). **Status: open.**

- **What:** A surface with no batch area, outside the area or with no stated CRS is read but never drawn: frameTx returns not_placed and the map layer exists only for the area's site. Add a surface preview to the batch item detail. It reuses the existing parts page, display read, artifact routes and decode worker, draws raster parts as one canvas mosaic by their sourceCorners and point parts as a top-down scatter, and shows the not-placed words plus 'display only'. No new route; nothing is placed.
- **Files:** apps/studio/src/features/intake/BatchPage.tsx:115-117 (mount beside IfcStructure and NativeReading); apps/studio/src/features/map/surface/api.ts (browserSurfaceIo, reused), parts.ts:19-22 (isSurfaceItem), decode.ts, pixels.ts:68-73, las.ts:15-31; new apps/studio/src/features/intake/surface/SurfacePreview.tsx and its test
- **Check:** pnpm --filter @ulpin/studio exec vitest run src/features/intake/surface. Expected, exit 0: a raster item whose display reads state not_placed/no_batch_area draws its decoded parts on the preview canvas at their source-corner positions with the not-placed words; a point item draws its points; a placed item shows no preview. Include the $ui-design-check report for the batch screen.
- **Tests:** apps/studio/src/features/map/surface/parts.test.ts; apps/studio/src/features/map/surface/useSurfaceLayer.test.tsx; apps/studio/src/features/map/surface/tiff.test.ts; apps/studio/src/features/intake/batch-page.test.tsx

### S5.13 IFC reader configured on fresh demo and rehearsal runtimes

Size S, this PC: data drive. After: Owner prerequisite: a stable CPython 3.12 base on E: (downloading it needs the owner's yes). Otherwise use the codex-runtime interpreter the existing profile names (fragile). Can run in parallel with S5.11 and S5.12. **Status: open.**

- **What:** The batch queues an IFC reading (intake-ifc.ts:24-43), but no demo or rehearsal script sets ULPIN_IFC_PROFILE: demo-native-readers.mjs builds only dxf, citygml, gltf and obj on a Python 3.13 base, and ifcConfig needs a Python 3.12 runtime. Add an ifc entry with its own base interpreter and the pinned environment from E:/BhuAayam-data/task-data/desktop-ifc-native (wheels, dependencies.json). The roll's native-reader step then builds and checks five readers, and a fresh runtime reads an IFC instead of stopping with IFC_UNAVAILABLE.
- **Files:** scripts/platform/demo-native-readers.mjs:20-35 (defaultPython, readerSetup), the baseInterpreter check after line 40 (each reader's own Python version), build and check paths; scripts/platform/demo-native-readers.test.mjs; packages/server/src/modules/usp/ingestion/ifc-config.ts:30-46 (read only: profile rules); scripts/usp/ifc/profile.py (read); docs/backend/DEMO-RUNTIME.md (NP1 step words)
- **Check:** node scripts/platform/demo-native-readers.mjs check --paths <built native-reader-paths.json> reports ifc as verified beside the four existing readers, and an isolated ifcConfig() child accepts the profile. Then the IFC reader, run through that profile on E:/BhuAayam-data/task-data/paired-building-floor-sources-20261004-run01/originals/AC20-FZK-Haus.ifc, returns a summary whose structure state is read, with building, storey and space counts. Exit 0.
- **Tests:** scripts/platform/demo-native-readers.test.mjs; tests/ifc-authority.test.ts; tests/ifc-bytecode-profile.test.ts; packages/server/src/modules/usp/ingestion/intake-ifc.test.ts

### S5.14 Point reader: thinned batches from LAS/LAZ/COPC up to 1 GiB

Size M, this PC: data drive. After: S5.11 (shared verified-copy helper). Can run in parallel with S5.12, S5.13, S5.17 and S5.18. **Status: open.**

- **What:** point_batch.py refuses more than 16 MiB or 5 million points, so the real 74 MB NYC COPC (12,036,869 points) is kept, not drawn. Accept up to 1 GiB and 500 million points, and give the batch selection an optional `step`: it reads source points [start, start+count*step) with laspy's chunk iterator and keeps every step-th native record unchanged; batch null becomes a whole-cloud sample of at most 32,768 points. Batches grow to 32,768 points (artifactBytes 2 MiB) and the Studio LAS bound follows. It uses S5.11's verified cache.
- **Files:** services/geo/geo/point_batch.py:18-21, 27-37 (_batch), 61-70 (_validate_header), 107-129 (_read_native_batch), 132-151; packages/contracts/src/usp/point-batch.ts:5-7 (POINT_BATCH_LIMITS), 24-25 (PointBatchSelectionSchema, optional step); apps/studio/src/features/map/surface/las.ts:5 (LAS_LIMITS.points); services/geo/tests/test_point_batch.py
- **Check:** E:/BhuAayam-data/task-data/d3/geo-py311/Scripts/python.exe -I -m pytest services/geo/tests/test_point_batch.py -k thinned. Expected, exit 0: E:/BhuAayam-data/task-data/nyc-10013-multimodal/originals/20170504_980200.copc.laz read with batch null returns 32,709 native 30-byte records (every 368th point), all inside the header's sourceBounds, in under 150 s; nyc-10013-lidar-2017.laz with batch {start:0,count:8192} returns the same bytes as today.
- **Tests:** services/geo/tests/test_point_batch.py; services/geo/tests/test_surface_readers.py; tests/point-batch-formats.test.ts; tests/point-publication.test.ts; tests/registry-point-citations.test.ts; apps/studio/src/features/map/surface/las.test.ts

### S5.15 Surface plan: whole-extent overview first, then at most 64 preview parts, with honest words

Size M, this PC: data drive. After: S5.11 and S5.14 (contracts). Can run in parallel with S5.12, S5.13, S5.17, S5.18 and S5.19. **Status: open.**

- **What:** intake-surface.ts plans every full-resolution window or 8,192-point batch of the whole original, caps them at 32 or 611, and refuses more than 16 MiB. With S5.11 and S5.14, part 0 becomes the whole-extent overview. Rasters are tiled in 256-px tiles at the smallest power-of-two step that keeps the long side within 2,048 px; points are planned as at most 64 contiguous thinned batches of 32,768 at step ceil(points/2,097,152). Raise jobsPerSource to cover rereads, let part 0 be read before the batch area exists (the existing reread path reads it again under the area), keep legacy items' plans as they are, and say 'a preview at 1:s' or 'every s-th point' in the item words and the Studio forecast rows.
- **Files:** packages/server/src/modules/usp/ingestion/intake-surface.ts:41-67 (surfaceReader limits and words), 145-150 and 177 (waitsForAreaTx holds only parts after 0), 339-353 (rasterPlan, pointPlan), 376-388 (acceptedHeader), 410-431 (acceptIntakeSurfacePartTx, caps), 534-551 (surfaceWords); packages/contracts/src/usp/intake.ts:598 (INTAKE_SURFACE_LIMITS); packages/contracts/src/usp/raster-window.ts:7 and point-batch.ts:7 (jobsPerSource); apps/studio/src/features/intake/upload-model.ts:77-80, 114-117
- **Check:** pnpm exec tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/usp/ingestion/intake-surface.test.ts. Expected, exit 0: the first accepted read of the real NYC COPC (12,036,869 points) plans part 0 plus 62 batches at step 6, with words naming the preview; a stated 40,000 x 30,000-px first read plans 20 tiles at step 32; the NYC ortho still plans full-resolution windows; in a batch whose vector is still drafting, part 0 is queued and part 1 waits.
- **Tests:** packages/server/src/modules/usp/ingestion/intake-surface.test.ts; packages/server/src/modules/cases/processing.test.ts; tests/raster-point-later-receipt.test.ts; apps/studio/src/features/intake/upload-reader.test.tsx

### S5.16 Overview drawn under its tiles; all parts of a DEM or point cloud shaded on one range

Size M, code only. After: S5.15 (header and part 0 convention) and S5.11 (band min/max). The integrator regenerates openapi and the api-client. **Status: open.**

- **What:** Ground pictures share one render order with the depth test off, so S5.15's overview can be drawn over its finer tiles. Each DEM part is also shaded by its own range and each point batch coloured by Z rank within that batch, so neighbouring parts do not match. Give SurfacePartInput an `under` flag (lower render order) for part 0 of a multi-part item. Carry one value range in the display read (the overview's band min/max for one-band rasters; the header Z bounds as raw integers for points; both kept in the plan header at the first accepted read), shade every part with it, and fall back to today's behaviour when it is absent.
- **Files:** packages/scene/src/types.ts:95-103 (SurfacePartInput); packages/scene/src/engine.ts:2258-2288 (surfacePartObject); apps/studio/src/features/map/surface/parts.ts (part 0 flag, range pass-through), pixels.ts:41-73, las.ts:49-71, decode.ts; packages/server/src/modules/usp/ingestion/intake-surface.ts:376-388 (header range), 648-672 (surfacePartDisplayTx); packages/contracts/src/usp/intake.ts:617 (IntakeSurfaceDisplaySchema, optional valueRange)
- **Check:** pnpm --filter @ulpin/scene exec vitest run src/engine.test.ts && pnpm --filter @ulpin/studio exec vitest run src/features/map/surface. Expected, exit 0: an overview part renders below its tile parts; two adjacent one-band parts with different own ranges give the same grey for the same value under the stated range; two point batches give the same colour for the same Z. Include the $ui-design-check screenshot of the NYC DEM on the map.
- **Tests:** packages/scene/src/engine.test.ts; apps/studio/src/features/map/surface/parts.test.ts; apps/studio/src/features/map/surface/las.test.ts; apps/studio/src/features/map/surface/tiff.test.ts; packages/server/src/modules/usp/ingestion/intake-surface.test.ts

### S5.17 CityGML reader takes a real city tile within measured bounds

Size M, this PC: data drive. After: Step 2 practice kit holds a real CityGML tile. Can run in parallel with S5.18 and S5.19 (separate files). **Status: open.**

- **What:** native_citygml.py holds the whole file and stops at 32 MiB, 25,000 XML elements and 100,000 coordinate values, so a real LOD2 city tile is refused; only the 19 KB and 11 KB OGC samples have been read (CG1). On the practice kit's largest CityGML, measure peak memory and time, then raise the input, element, coordinate and output bounds and CITYGML_LIMITS to the largest values that stay inside the reader's 2 GiB and the worker deadline, up to 256 MiB. Anything larger stays kept, with words naming the limit. citygml_outline.py re-extracts the original in the processor and must take the same bounds.
- **Files:** services/geo/geo/native_citygml.py:43-64 (Limits), 148-200 (extract), 507-512 (encode_result); services/geo/geo/citygml_outline.py; packages/contracts/src/usp/citygml-ingestion.ts:4-6 (originalBytes, artifactBytes, workerMs, readMs); services/geo/tests/test_native_citygml.py, test_citygml_outline.py
- **Check:** With the CityGML reader environment (E:/BhuAayam-data/task-data/desktop-citygml-native/env), run python -m pytest services/geo/tests/test_native_citygml.py services/geo/tests/test_citygml_outline.py (exit 0). Then run once on the practice kit's largest CityGML: the read completes under the new bounds with peak memory under 2 GiB and time under the deadline, and the converter writes one outline per Building that has a ground surface (outline and Building counts in result.json).
- **Tests:** services/geo/tests/test_native_citygml.py; services/geo/tests/test_citygml_outline.py; tests/citygml-authority.test.ts; tests/citygml-read-compatibility.test.ts; tests/registry-citygml-citations.test.ts (journey pin, regenerated as CG2 did)

### S5.18 CityJSON reader takes a real tile and a CityJSONSeq file

Size M, this PC: data drive. After: Step 2 practice kit. Can run in parallel with S5.17 and S5.19. **Status: open.**

- **What:** native_cityjson.py stops at 8 MiB, 1,000 CityObjects, 100,000 vertices and 15 s, and reads CityJSON 2.0 only, so a typical 3DBAG tile is over its limits. A CityJSONSeq (.city.jsonl) is detected as cityjson by its first object but is not one JSON document; it is expected to fail (not run). Raise the bounds and CITYJSON_LIMITS to what the practice kit's CityJSON needs, as measured, and read a CityJSONSeq as its header plus each feature line through the existing CityJSONFeature path, so outlines with a declared EPSG reach the map path (B3D1).
- **Files:** services/geo/geo/native_cityjson.py:14-21 (bounds), 230-290 (envelopes and features, 249-267); services/geo/geo/cityjson_outline.py (read; change only if the sequence needs it); packages/server/src/modules/usp/ingestion/intake-signatures.ts:116-133 (jsonKind for the sequence); packages/contracts/src/usp/cityjson-ingestion.ts:4-5; services/geo/tests/test_native_cityjson.py, test_cityjson_outline.py
- **Check:** E:/BhuAayam-data/task-data/d3/geo-py311/Scripts/python.exe -I -m pytest services/geo/tests/test_native_cityjson.py services/geo/tests/test_cityjson_outline.py, exit 0. The practice kit's CityJSON (or its .city.jsonl) reads within the new bounds and writes its Building outlines with the stated EPSG basis (counts in result.json); E:/BhuAayam-data/task-data/reh15/act2/d1-3dbag-single-roof.city.json gives the same outline as today.
- **Tests:** services/geo/tests/test_native_cityjson.py; services/geo/tests/test_cityjson_outline.py; services/geo/tests/test_cityjson_processing.py; services/geo/tests/test_cityjson_processing_pins.py; tests/cityjson-authority.test.ts; packages/server/src/modules/usp/ingestion/intake-signatures.test.ts

### S5.19 IFC reading adds a storey outline in the file's own frame

Size L, this PC: data drive. After: S5.13 (to run live; the profile is re-pinned after this change). Can run in parallel with S5.15, S5.17 and S5.18. **Status: open.**

- **What:** The IFC reader is structure-only (native_ifc.py:1 and 617, GEOMETRY_NOT_INTERPRETED), but the plan's cut order still keeps an IFC 'summary and outline'. Add a bounded second pass using the pinned IfcOpenShell 0.8.5 geometry and shapely (dependencies.json): project each storey's IfcSlab shapes (else IfcSpace) to plan in the file's own frame and length unit, and join them into closed outline rings per storey. Store them in the accepted artifact with an outline count in the summary; the words say 'own frame, not placed', and a failed pass leaves the structure reading intact.
- **Files:** services/geo/geo/native_ifc.py:27-52 (Limits), 383-460 (pass 1), 590-630 (result and findings); packages/contracts/src/usp/ifc-ingestion.ts (optional summary and artifact outline fields); packages/server/src/modules/usp/ingestion/intake-ifc.ts:48-56 (intakeIfcReadWords); services/geo/tests/test_native_ifc.py
- **Check:** With the IFC environment (E:/BhuAayam-data/task-data/desktop-ifc-native/env), run python -m pytest services/geo/tests/test_native_ifc.py -k outline. Expected, exit 0: AC20-FZK-Haus.ifc (E:/BhuAayam-data/task-data/paired-building-floor-sources-20261004-run01/originals) gives one closed outline per storey that has slabs, in its own frame and stated unit; services/geo/tests/fixtures/ifc1-structure-ifc2x3.ifc and ifc1-structure-ifc4.ifc keep their structure results.
- **Tests:** services/geo/tests/test_native_ifc.py; tests/ifc-authority.test.ts; tests/ifc-read-compatibility.test.ts; tests/registry-ifc-citations.test.ts; packages/server/src/modules/usp/ingestion/intake-ifc.test.ts

### S5.20 IFC panel draws the storey outlines in their own frame

Size S, code only. After: S5.19 (artifact fields). **Status: open.**

- **What:** The IfcStructure panel shows only the building, storey and space tree. Read S5.19's outlines from the accepted IFC artifact through the existing .../ifc/jobs/{jobId}/native route and draw them as SVG in the file's own frame, one per storey, with words saying they are not placed on the map. This is display only.
- **Files:** apps/studio/src/features/intake/ifc/IfcStructure.tsx, structure-model.ts, useIfcStructure.ts, IfcStructure.module.css, IfcStructure.test.tsx
- **Check:** pnpm --filter @ulpin/studio exec vitest run src/features/intake/ifc. Expected, exit 0: an IFC artifact with two storey outlines draws two closed SVG paths with the own-frame words; an artifact without outlines shows the tree as today. Include the $ui-design-check report.
- **Tests:** apps/studio/src/features/intake/ifc/IfcStructure.test.tsx; apps/studio/src/features/intake/batch-page.test.tsx

### S5.21 glTF/GLB and OBJ drawn in their own frame in the reading panel

Size M, code only. After: None; can run in parallel with anything. Dispatch it last and drop it first: it is cut 1. **Status: open.**

- **What:** glTF and OBJ readings appear only as words ('kept as evidence, not on the map', intake-native-readers.ts:132, 207-223), although each accepted artifact already holds projected positions and indices (native_gltf.py:603-616; native_obj.py:200-207). Add a small own-frame mesh preview to packages/scene (three.js is already a dependency) and show it in the NativeReading panel from the existing .../gltf/jobs/{jobId}/native and .../obj/jobs/{jobId}/native routes. It is flat-lit and can be orbited, with words: own frame, axes and units as the reading states, not placed.
- **Files:** new packages/scene/src/model-preview.ts plus its export in packages/scene/src/index.ts; apps/studio/src/features/intake/native/NativeReading.tsx:17-48, useNativeReading.ts, reading-model.ts (positions and indices from the artifact); apps/api/src/modules/ingestion/gltf.controller.ts:70-77 and obj.controller.ts:70-72 (read only)
- **Check:** pnpm --filter @ulpin/studio exec vitest run src/features/intake/native && pnpm --filter @ulpin/scene exec vitest run. Expected, exit 0: a glTF artifact shaped as the Box.glb reading states (E:/BhuAayam-data/task-data/desktop-gltf-native/final-glb/gltf.json: 2 nodes, 1 primitive, 24 positions, 36 indices) gives a 12-triangle preview with the own-frame words; an OBJ artifact with two faces gives two polygons. Include the $ui-design-check report.
- **Tests:** apps/studio/src/features/intake/native/NativeReading.test.tsx; packages/scene/src/engine.test.ts; packages/scene/src/warm-programs.test.ts

### S5.22 Processor image and host reader profiles with the step 5 readers; practice-kit 3D and imagery files on reh-02

Size M, this PC: Docker. After: Step 1, the step 2 kit, and S5.11 to S5.20 accepted and integrated. This is the only runtime task in the area and needs a quiet PC. **Status: open.**

- **What:** The readers changed in S5.11 to S5.19 run in two places: the processor image (raster, point, CityJSON and both outline converters) and the host profiles built by the NP1 step (CityGML, glTF, OBJ, IFC). Build and pin the image from services/geo, roll ulpin-reh-02 to the integrated head with the native-reader step, and drop each practice-kit 3D and imagery file in its own batch, then all together. For each file, record the route, reader outcome, how it is drawn (map or own frame) or its words, and seconds to the first and last part. Fix configuration only; any code fault becomes a new task.
- **Files:** scripts/platform/processor-image.json; scripts/platform/demo-native-readers.mjs (run, not edited); docs/backend/DEMO-RUNTIME.md (roll steps); docs/evidence/5/s5-12/result.json
- **Check:** On reh-02, every practice-kit file of the 3D and imagery families is drawn (on the map or in its own frame) or kept with plain words; each surface's first part appears within 60 s of its drop (or of its area, when it has one); pnpm journey:check --case <act 1 case> passes its surfaces step.
- **Tests:** pnpm journey:check; node scripts/platform/demo-native-readers.mjs check


## Step 6: Linking

The only working link is an exact key the officer declares by hand (it works for the New York register). No address or place link and no suggestion exist yet.

### S6.1 The record panel lists a building's links to register rows and pages, with the reason

Size M, this PC: data drive. After: S4.3 merged (one writer at a time for contracts usp/intake.ts). **Status: open.**

- **What:** A building's register match shows only in the batch evidence list, or later as a citation. The map's record panel shows only geometry, height and ledger sources. Add an optional featureId filter to the evidence read, matched through candidate->'anchors'. Add a Links list to the inspector; per candidate it shows:
- the file, and the row or page in words;
- the key literal as written;
- the outcome in words;
- whether the officer confirmed it or it is cited on the record.
Read only. Verify first that the map feature id equals the target's featureId.
- **Files:** packages/contracts/src/usp/intake.ts:512-516 IntakeEvidenceQuerySchema (and 322-325 for the featureId meaning); packages/server/src/modules/usp/ingestion/intake-evidence.ts:581-622 readIntakeEvidence; apps/api/src/modules/ingestion/ingestion.controller.ts:290-305; apps/studio/src/features/map/inspector/BuildingInspector.tsx:120-150, inspector/evidence.ts; apps/studio/src/features/intake/evidence/model.ts:108-130 (reuse evidenceWords, buildingWords)
- **Check:** With the data drive present, intake-evidence.test.ts reads the LPC register and the NYC footprints sharing BINs (test at intake-evidence.test.ts:101).
- The feature filter returns only candidates whose anchors name that feature: one matched row for a matched BIN, and the group for a conflicting one.
- vitest BuildingCard.test.tsx renders: gpmc-yuvp.csv, CSV logical row N, key bin as written, matched, confirmed by the officer.
- **Tests:** packages/server/src/modules/usp/ingestion/intake-evidence.test.ts; intake-evidence-filter.test.ts; tests/intake-evidence-contract.test.ts; apps/api/src/modules/ingestion/ingestion.controller.test.ts; apps/studio/src/features/map/inspector/BuildingCard.test.tsx

### S6.2 The reading card suggests links by shared key, address and place

Size M, this PC: data drive. After: S4.6. **Status: open.**

- **What:** Links exist only after a hand-declared key, from a drafted map layer to tables or documents. There is no address or place linking for map or table items. Fill links[] from the case's other items:
- by key: the same identifier meaning (building.sourceKey, parcel.*, document.registrationNo or sanctionNo), or the same header as written;
- by address: both name building.addressLiteral;
- by place: lon/lat bounds that intersect.
Each is a suggestion with its reason. Nothing is recorded and no match count is guessed.
- **Files:** packages/server/src/modules/usp/ingestion/intake-reading.ts (links: one read of the case's items and stored profiles); intake-evidence.ts:51-63 keyLiteral/keyProperty (reuse); service.ts:580-588 and intake-ledger.ts:243-250 (where lon/lat bounds are stored, read only); intake-package-extent.ts:103-120 (read only); intake-surface.ts:558-574 (surface placement words, read only); packages/contracts/src/usp/intake.ts (links shape already added in S4.3; no new route)
- **Check:** intake-reading.test.ts with the data drive present. One case holds nyc-10013/files/buildings-original.geojson, nyc-10013-linked/nyc-landmarks-preservation-commission/gpmc-yuvp.csv and parks.geojson.
- Buildings to register: by key, bin here and bin there, both a building source key.
- Parks to buildings: by place, their extents overlap.
- No address link, because the footprints name no address.
- lgd-gurugram.csv alone gives no links.
- **Tests:** intake-reading.test.ts; packages/server/src/modules/usp/ingestion/intake-evidence.test.ts; tests/intake-evidence-contract.test.ts

### S6.3 A suggested key or address link is declared in one press

Size S, code only. After: S6.2, S4.8. **Status: open.**

- **What:** A key or address link on the card opens DeclareKey filled in:
- the map anchor and field, the table item, selection and column;
- kind integer when the map path is integerIdEligible, otherwise text;
- namespace words from the header and file.
The officer checks it and presses the existing declare button, and the existing reading then counts the outcomes. Address links say 'exact text only; a different spelling does not match'. Until buildings are drafted, the card says so.
- **Files:** apps/studio/src/features/intake/evidence/DeclareKey.tsx:15-60; EvidenceByKey.tsx:17-41; evidence/model.ts:58-106 (anchorItems, keyPaths, tableChoices, profileInput); ReadingCard.tsx (from S4.8); packages/server/src/modules/usp/ingestion/intake-evidence.ts:360 declareIntakeKeyProfile (unchanged, read only)
- **Check:** vitest evidence.test.tsx.
- NYC-shaped items with a bin-to-bin link open DeclareKey with the anchor, path, table, column 0 and kind integer filled.
- The posted key-profile body equals the one built by hand in act 1, apart from the namespace words.
- The button is disabled, with words, before buildings are drafted.
- **Tests:** apps/studio/src/features/intake/evidence/evidence.test.tsx; confirm.test.tsx; batch-page.test.tsx; pnpm studio:typecheck

### S6.4 The map can colour buildings by link outcome and count them

Size S, code only. After: S6.1. **Status: open.**

- **What:** Step 6 needs links shown on the map as well. Add a 'Link' option to the existing Colour by control, using FootprintInput.color as Colour by height does. Read the case's evidence page counts and candidate anchors (200 per page) and colour buildings by outcome: matched, several, conflicting, no match, none. The legend shows the counts as read, for example NYC act 1: 612 matched, 60 no match, 81 conflicting. Read only, no new route.
- **Files:** apps/studio/src/features/map/MapSidebar.tsx:77-92 (colour options, key list); MapWorkspace.tsx:260-340 (colourBy, legend), 500-512 (options); useBuildingScene.ts:18-60; heightBands.ts (pattern); apps/studio/src/state/selection.ts (ColourBy type); packages/scene/src/types.ts:26-42 (color field, read only); apps/studio/src/features/intake/evidence/api.ts (useEvidencePage, reuse)
- **Check:** vitest test beside heightBands.
- Three buildings with matched, conflicting and no-match candidates get three distinct colours; a building with none keeps the default.
- The legend shows the page counts exactly as given.
- **Tests:** apps/studio/src/features/map/map-frames.test.tsx; footprints.test.ts; useMapView.test.ts; pnpm studio:typecheck && pnpm studio:test


## Step 7: UI

Problems proven from code and rehearsal screenshots: the batch table breaks words at 1440 px, raw codes and developer words reach the judges' path, empty states and progress feedback are missing, and the map polls heavily while streaming. S7.11 to S7.14 wait for the owner's five worst problems.

### S7.1 Make ui-design-check scan the Studio

Size S, code only. After: none; parallel with S7.2, S7.3, S7.4, S7.5, S7.6, S7.7. **Status: done 24 Oct (with the apps/web removal).**

- **What:** The skill's scan diffs only apps/web, so every 'scan exit 0' reported for an apps/studio change checked nothing. Point it at apps/studio/src, packages/ui/src and packages/scene/src as well as apps/web, print counts per path, and fix SKILL.md (trigger and steps name apps/web). WORKING-RULES §4 requires this report for every step-7 merge, so it goes first.
- **Files:** .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs:1 (usage line), 12-19 (rules), 24 and 30 (the apps/web path), 48 (summary); .agents/skills/ui-design-check/SKILL.md:3, 12-15
- **Check:** On int3: node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs origin/staging prints a non-zero count of added lines for apps/studio (int3 is 209 commits ahead with Studio changes). On a scratch commit adding color: #fff to a Studio .module.css it exits 1 and names that file.
- **Tests:** none: it is a script; the check above is the test

### S7.2 Batch table rows that fit at 1440 px

Size M, code only. After: none; parallel with S7.1, S7.3, S7.4, S7.5, S7.6, S7.7 (disjoint files). **Status: sent back 24 Oct: the drop table upload progress still shows raw bytes.**

- **What:** Cut the table from 10 columns to 5: File (name, kind and format in words, size in KiB/MiB/GiB), Status (state and placement in one line, the reason below it as help text, part progress), Holds (features, rows, pages or points with a unit), Coordinates (crsWords only; the raw native extent moves to the reading card, S4.8) and Next step. Remove the min-width and overflow-wrap:anywhere that split words into letters. Give every format named in intake-signatures a plain name, use 'Unknown' rather than 'Not known', and in the drop table replace raw bytes and 'Not applicable' with sizeWords and empty cells. Every value stays read from the item.
- **Files:** apps/studio/src/features/intake/IntakeTray.tsx:24-49 (columns; keep NextStep 52-76); apps/studio/src/features/intake/batch-model.ts:45-99 (stateWords, countWords:64-66, formatWords:86-91, sizeClassWords); apps/studio/src/features/intake/Batch.module.css:31-59; apps/studio/src/features/intake/IntakeDropDialog.tsx:51-63 (DropOutcomes); reuse sizeWords in upload-model.ts:57-61; the format list is packages/server/src/modules/usp/ingestion/intake-signatures.ts:276-285
- **Check:** pnpm --filter @ulpin/studio exec vitest run src/features/intake/IntakeTray.test.tsx src/features/intake/batch-model.test.ts passes with two new cases. (1) The captured row docs/evidence/gf1/lq1a/controls-second.json items[0] renders at most 5 column headers, its size as KiB or MiB, and no 'bytes' or 'Not applicable'. (2) formatWords returns a plain name, never the raw token, for every key in the extensions map at intake-signatures.ts:276-285. The existing RF1 case ('a 2,100-feature ZIP member offers View layout') stays green.
- **Tests:** apps/studio/src/features/intake/IntakeTray.test.tsx, batch-model.test.ts, batch-page.test.tsx, layer-crs-command.test.tsx, upload-reader.test.tsx, retain-batch.test.ts

### S7.3 Batch page empty states

Size M, code only. After: none; parallel with S7.1, S7.2, S7.4, S7.5, S7.6, S7.7. **Status: done af28288d on task/int3-pre (24 Oct).**

- **What:** Four fixes. (1) While a drop is uploading, the page says 'No files are enrolled in this batch.' under 'Retaining files: File 1 of 4' (REH16 a03); while an upload is pending it should say the files are being kept. (2) For a batch with no drafted buildings, show the recording panel as one line ('No buildings are drafted from this batch yet; they appear after a map layout is used') instead of eight zero counts, Refresh, 'Choose the first 100 ready', the filter and the confirmation box (REH14 act2-nr-dxf.png). (3) Show the Confirm panel only when a package can be confirmed. (4) Show Evidence by key only once a map item has drafted buildings. Act 1 behaviour, where buildings exist, is unchanged.
- **Files:** apps/studio/src/features/intake/BatchPage.tsx:124-146 (BatchRecords, line 144); apps/studio/src/features/intake/run/IntakeRunPanel.tsx:17-57; apps/studio/src/features/intake/run/model.ts:43-45 (hasNoBuildings), countsLine; apps/studio/src/features/intake/evidence/EvidenceByKey.tsx:17-40 (its drafted rule at 37); the pending-upload state via batchUploadKey as read in BatchUploadProgress.tsx:16-19
- **Check:** vitest. (1) IntakeRunPanel given a TargetPage with all counts 0 and no packages renders the one line, and no 'Choose the first 100 ready' button and no textarea. (2) BatchPage with a pending upload in the batchUploadKey cache and an empty manifest does not contain 'No files are enrolled'. (3) The existing act-1 run tests still render the full panel when there are buildings.
- **Tests:** apps/studio/src/features/intake/run/model.test.ts, run/cards.test.ts, run/contract.test.ts, batch-page.test.tsx, batch-upload-progress.test.tsx, evidence/evidence.test.tsx, evidence/confirm.test.tsx

### S7.4 Plain words from the server on the judges' path

Size M, code only. After: none; parallel with S7.1, S7.2, S7.3, S7.5, S7.6, S7.7. **Status: open.**

- **What:** Rewrite four server strings in plain words, keeping every fact: licence unconfirmed, personal data unknown, how many features were left out and why, original unchanged. The strings are: the table-page limitations ('officer_supplied; licence unconfirmed; containsPersonalData unknown.', 'The D8 manifest omits held-out original hashes...'), the quarantine toast ('INVALID_GEOMETRY: Ring Self-intersection[...]'), the record-page 'canonical geometry qualification is unavailable' line, and the stop line that names an item UUID. Codes stay in their structured fields, not in the sentence. The table page's limitation list starts closed.
- **Files:** packages/server/src/modules/usp/ingestion/tabular-source.ts:199-209 (admissionLimitations); packages/server/src/modules/areas/gis-quarantine.ts:3-10; packages/server/src/modules/officer/register-missing.ts:9-19; packages/server/src/modules/usp/ingestion/intake-evidence.ts:690-698; apps/studio/src/features/intake/table/SourceHeader.tsx:45-48 (details open)
- **Check:** tsx --test packages/server/src/modules/areas/gis-quarantine.test.ts packages/server/src/modules/officer/register-missing.test.ts tests/registry-document-read-projections.test.ts tests/tabular-admission.test.ts passes. gis-quarantine.test.ts asserts the REH16 NYC case (1661 of 1662 accepted, one ring self-intersection) reads as a plain sentence with no upper-case code. rg -n 'D8 manifest omits|officer_supplied; licence|canonical geometry qualification is unavailable' packages/server/src -g '!*.test.ts' prints nothing.
- **Tests:** packages/server/src/modules/areas/gis-quarantine.test.ts, packages/server/src/modules/officer/register-missing.test.ts, packages/server/src/modules/usp/ingestion/tabular-stream.test.ts, table-geojson.test.ts, tests/registry-document-read-projections.test.ts, tests/tabular-admission.test.ts, tests/intake-upload-provenance.test.ts, apps/studio/src/features/intake/table/SourceHeader.test.tsx, apps/studio/src/features/intake/evidence/confirm.test.tsx; pnpm typecheck:backend

### S7.5 Plain words in readings, layouts and packages

Size M, code only. After: none; parallel with S7.1, S7.2, S7.3, S7.4, S7.6, S7.7. **Status: open.**

- **What:** Five fixes in the Studio: (1) Finding counts end in raw codes such as '(BOUNDARY_CONTACT)' (REH16 a16): drop the code. (2) Each package is headed by its UUID and 'Revision N' (a13): head it with its anchor item's file name (Package.anchorItemId to the manifest item name), with the id copyable in a caption. (3) The native reading prints nested values as JSON, 'Not stated (stored as null)' and 'result SHA-256', with tokens such as globalPlacement and axes (lead-queue NR4 note): show labelled lines and put hashes in closed details. (4) The layout lists 'This layout also states: version, mode...': drop that line and say the origin plainly. (5) 'Its review has not run yet.' and 'The package review has not run yet.' appear together (REH14 act2-mx1-keyed-layout.png): show the review line once.
- **Files:** apps/studio/src/features/intake/run/Packages.tsx:5-43 (findingWords 5-13, line 20, heading 29, revision 37, reasons 33-35); apps/studio/src/features/intake/native/reading-model.ts:116-150; apps/studio/src/features/intake/native/NativeReading.tsx:38-49; apps/studio/src/features/intake/layout-model.ts:13-48; apps/studio/src/features/intake/LayoutQuestion.tsx:57-77
- **Check:** vitest. (1) run/packages.test.ts: the findings list for {BOUNDARY_CONTACT:1694} renders '1694 · Boundary contact only...' with no upper-case code. (2) The package heading shows the anchor item's file name. (3) NativeReading.test.tsx: a summary with a nested object renders labelled lines and no '{' or 'null'. (4) layout-model.test.ts: layoutLines on a streamed receipt has no 'This layout also states' line. (5) review-words.test.ts: the not-run line appears once.
- **Tests:** apps/studio/src/features/intake/run/packages.test.ts, run/review-words.test.ts, native/NativeReading.test.tsx, layout-model.test.ts, StreamedLayoutAnswer.test.tsx, layout-command.test.ts

### S7.6 The map reads lightly while a package streams

Size M, code only. After: none; parallel with S7.1-S7.5, S7.7. **Status: open.**

- **What:** Today, while a package streams, the map downloads it every 700 ms, re-reads the whole area every 5 s and invalidates every query in the app when the import settles. Three changes: (1) Count features by kind from context.displayFeatures by proposalPackageId, and take state and quarantine from context.packages, which are already polled, instead of the 700 ms GET of the whole package (every feature with three geometries). (2) Stop the 5 s re-reads of the area context and the canonical area once the package leaves RECEIVED, even if ?package= stays in the URL. (3) When it settles, invalidate only this area's and this batch's keys. The demo-import path (isDemoId, demo-import.ts:110) keeps working.
- **Files:** apps/studio/src/features/map/ImportTray.tsx:16-66 (useSettled 17-24, poll 33-37, counts 43-48); apps/studio/src/features/map/MapWorkspace.tsx:71-75, 125, 397-401, 574-580 (MapImportTray); apps/studio/src/features/map/MapPage.tsx:39-43; apps/studio/src/api/queries.ts:228-260; apps/studio/src/features/map/canonicalScene.ts:66-80
- **Check:** A new vitest with a counting fetch and the real NYC context apps/studio/src/local/data/nyc-bronx-context.json. Over 30 simulated seconds with the package RECEIVED: 0 GETs of /api/v1/import-packages/{id} and at most 7 area-context reads. After the package turns COMMITTED: no further context or canonical reads. The tray's building count equals the context's building features for that package.
- **Tests:** apps/studio/src/features/map/map-frames.test.tsx, canonicalScene.test.ts, areaWindow.test.ts, demoDraw.test.ts, surface/useSurfaceLayer.test.tsx

### S7.7 Header area switcher names the right area

Size S, code only. After: none; parallel with S7.1-S7.6. **Status: ready 24 Oct: task file and worktree prepared; waits for the owner to start its chat session.**

- **What:** On batch and table pages the header names an unrelated area: REH15 'table page header named another case (Niagara Falls, Revision 0)', and REH16 act 1 the same. The switcher falls back to the remembered area or the first area on every route. Off map routes, show 'Choose an area' with no subtitle. Add the area's short id in mono to the subtitle and the menu, so two areas both named 'buildings original' (REH16 a03 against a09) can be told apart. A count of 0 shows as '0 features'.
- **Files:** apps/studio/src/app/Frame.tsx:114-181 (areaSubtitle 114-116, fallback 122-123, label 144); apps/studio/src/app/Frame.module.css (areaMeta)
- **Check:** New apps/studio/src/app/Frame.test.tsx using two areas both named 'buildings original', built from apps/studio/src/local/data/nyc-bronx-areas.json. Under MemoryRouter at /studio/work/cases/x/intake the button reads 'Choose an area'. At /studio/areas/<id> the two menu options' texts differ.
- **Tests:** new Frame.test.tsx; pnpm studio:typecheck

### S7.9 One way from the batch to the map, and a map that says it is drawing

Size M, code only. After: S7.6 (MapWorkspace.tsx) and S7.3 (BatchPage.tsx) merged first. **Status: open.**

- **What:** The table offers 'Open package' only when an item has plan.packageId, so there is no batch-level route to the map; the header Map link opens the last remembered area. Add one 'Open on the map' button in the batch header when a listed package names an areaId, or an item names existingAreaId. On the map, while ?package= is set and no footprint is drawn yet, show a floating line 'Drawing <file>: <n> features so far', using the S7.6 counts. That replaces the empty grey canvas in REH16 a09; today nothingToDraw is forced false whenever a package is set.
- **Files:** apps/studio/src/features/intake/BatchPage.tsx:79-87 (header); apps/studio/src/features/intake/batch-model.ts:19-23 (packagePath); apps/studio/src/features/intake/run/model.ts:7 (Package.areaId); apps/studio/src/features/map/MapWorkspace.tsx:145-148, 455-467; apps/studio/src/features/map/footprints.ts (drawnCountNote)
- **Check:** vitest. (1) The batch header renders 'Open on the map' linking to /studio/areas/<areaId>?package=<packageId> for a TargetPage that lists a package with an areaId, and renders no link without one. (2) The drawing-line words, computed from nyc-bronx-context.json before any footprint is drawn, read 'Drawing ...: N features so far'.
- **Tests:** apps/studio/src/features/intake/batch-page.test.tsx, run/packages.test.ts, apps/studio/src/features/map/footprints.test.ts, map-frames.test.tsx

### S7.11 Batch screen as a file list and one detail pane (wait for the owner's list)

Size M, code only. After: WAIT for the owner's five worst problems (PLAN Needs you 2); after S7.2, S7.3, S4.8. **Status: open.**

- **What:** BatchPage stacks about a dozen sections in one scroll: the file table, PDF buttons, banners, the upload table, waiting files, the chosen file's detail (up to 7 sections), Evidence by key and the recording panels. The detail renders below the whole table. At desktop width, show the file list on the left, and on the right the chosen file's reading card, its question and its readings (one inspector per selection, design-system README Principles). Keep the selection in ?item= so a reload keeps it. Put the recording panels below as one 'Record buildings' section, drop the separate 'View PDF reading' buttons, and stack to one column at 200 %. Layout only; no new data.
- **Files:** apps/studio/src/features/intake/BatchPage.tsx:67-146 (state 70-78, PDF nav 139-143); apps/studio/src/features/intake/Batch.module.css; apps/studio/src/features/intake/IntakeTray.tsx:20-76 (selecting a row)
- **Check:** vitest batch-page.test.tsx. With the captured multi-item manifest, choosing the second row renders its ReadingCard in the detail region and sets ?item=<itemId>. Rendering with ?item= keeps that row. Screenshots at 1440 and 720 CSS px are taken in S7.16.
- **Tests:** apps/studio/src/features/intake/batch-page.test.tsx, plan-reading.test.tsx, BatchPdfSection.test.tsx, add-files-continue.test.tsx, unfinished-uploads.test.tsx

### S7.12 ZIP and KML members listed under their file (wait for the owner's list)

Size S, code only. After: WAIT for the owner's list; after S7.11. **Status: open.**

- **What:** Members taken out of a ZIP or KML are separate rows, and only the reason text links them back ('Taken out of zp1-geojson-kml-csv.zip.', REH14 act2-zp1.png and REH15 zp2 words), although each item carries parentItemId. List members indented under their parent, collapsible above 10, with the parent's line giving how many files were taken out.
- **Files:** apps/studio/src/features/intake/IntakeTray.tsx; apps/studio/src/features/intake/batch-model.ts
- **Check:** IntakeTray.test.tsx: the existing 2,100-feature ZIP member case renders right after its parent and indented, still offering View layout. The parent's line states the member count.
- **Tests:** apps/studio/src/features/intake/IntakeTray.test.tsx, question-model.test.ts, retain-batch.test.ts

### S7.13 Add files: one dialog, a named batch, short forecasts (wait for the owner's list)

Size M, code only. After: WAIT for the owner's list; after S7.2 (IntakeDropDialog.tsx); forecast words follow step 5's drawing outcomes. **Status: open.**

- **What:** A drop passes two dialogs, and the second's primary button stays disabled until 'New case name' is typed under 'Source case: Create an unassigned source case' (REH16 a02-forecast.png). Forecasts run to three sentences of reader limits, and say that DXF, glTF and OBJ readings are 'kept as evidence, not placed on the map'. Four changes:
- Pre-fill an editable batch name from the first file name and today's date.
- Call it a batch, with the button 'Keep files and open batch'.
- Show one short forecast phrase per file, with the limits in details.
- Take the placed-or-not words from what step 5 actually ships.
The rehearsal steps click 'Retain files and open batch' and 'New case name' (E:/BhuAayam-data/task-data/reh16/steps/a03-retain.js), so the result lists every renamed label.
- **Files:** apps/studio/src/features/intake/IntakeDropDialog.tsx:10-49; apps/studio/src/features/intake/table/TableImportFields.tsx:6-38 (shared with the table import dialog); apps/studio/src/features/intake/upload-model.ts:63-142 (forecasts 73-122); apps/studio/src/features/intake/AddFilesDialog.tsx:222-238 (drop help text)
- **Check:** vitest. (1) upload-reader.test.tsx: each forecast's first sentence is at most 120 characters, and the limits sit in a separate details string. (2) retain-batch.test.ts: the dialog opens with a prefilled name and an enabled primary button. (3) TableImportDialog.test.tsx still passes.
- **Tests:** apps/studio/src/features/intake/upload-reader.test.tsx, upload.test.ts, retain-batch.test.ts, add-files-continue.test.tsx, file-route.test.ts, table/TableImportDialog.test.tsx

### S7.14 Map tools show only what the area holds (wait for the owner's list)

Size S, code only. After: WAIT for the owner's list; after S7.9 (MapWorkspace.tsx). **Status: open.**

- **What:** Every area gets the same building tools. The Tools panel always offers the Area, Building, Floors, Findings and Underground views and the None, Rights, Utilities and Height colours, disabled when absent, plus the gestures line and 'Retire area'. The search says 'Find building…' even for an area of imagery or points (REH16 a09). Hide the views and colours the area has no data for, name the search after what the area holds, and lead with the layers list when the area holds only surfaces.
- **Files:** apps/studio/src/features/map/MapWorkspace.tsx:470-520 (views 489-499, colourOptions 502-507); apps/studio/src/features/map/MapSidebar.tsx:1-130; apps/studio/src/features/map/BuildingSearch.tsx:65
- **Check:** vitest: MapSidebar rendered for an area with no buildings (nyc-bronx-context.json with its buildings filtered out) shows no Findings, Underground or Floors view and no Rights or Utilities colour. With the full context, every view is still listed.
- **Tests:** apps/studio/src/features/map/map-frames.test.tsx, useMapView.test.ts, floorState.test.ts

### S7.16 Screenshot set for the owner at 100 % and 200 %

Size S, this PC: runtime. After: S7.1-S7.9 merged (S7.11-S4.8 if done); step 2 practice kit; a free rehearsal runtime and a quiet PC. **Status: open.**

- **What:** Step 7 is done when the owner accepts the screenshots. Work on a fresh rehearsal runtime, never the demo: the table page starts jobs on its own (REH16 a06: 'Requesting raw-row and mapping jobs…'). Drop the practice kit and capture at 1440×900 and at 200 % (720×450 CSS px): the batch screen, one reading card per family, the map while drawing and when done, and the record page. Attach the S7.1 scan report and the dress.mjs frame numbers.
- **Files:** docs/evidence/7/S7.16/result.json plus at most 20 PNG files; reuse the REH16 presenter harness (E:/Projects/ulpin-wt/k3/docs/evidence/runtime/reh16/send.mjs, dress.mjs)
- **Check:** result.json lists each shot with its URL, viewport and file, the scan exit code and the frame numbers, and the owner accepts the set or names what to change.
- **Tests:** pnpm studio:typecheck && pnpm studio:test on the integrated head before capture; node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs origin/staging


## Step 8: Rehearsal 1 on the closed kit

Thursday 29. Only the rehearsal worker runs on the PC.

### S8.1 Rehearsal 1: drop the closed kit on a fresh runtime and list what fails

Size M, this PC: Docker. After: Steps 3 to 7 accepted, or as many of their tasks as are done by Thursday 29. **Status: open.**

- **What:** A rehearsal worker, the only agent running on the PC, creates a fresh empty runtime at the integration head with the S1.2 procedure, opens the closed kit for the first time, drops it all at once with the S3.3 runner, and runs act 1. It records, per file, points 1 to 4 of the plan's Done line, seconds to first features, frames over 100 ms and API exits. The session never builds, teaches or tunes afterwards.
- **Files:** scripts/rehearsal/kit-drop.mjs (S3.3); E:/BhuAayam-data/holdout/judge-kit-closed/; docs/backend/DEMO-RUNTIME.md fresh-runtime section. Write: docs/evidence/step-8/s8-1/result.json (verdicts by generic name only).
- **Check:** result.json has a verdict for every closed-kit file and for act 1, plus the exit and frame blocks. Demo doctor unchanged.
- **Tests:** pnpm platform:doctor --profile demo --runtime <fresh runtime>; pnpm journey:check


## Step 9: Fix, rehearsal 2, freeze

Friday 30 to Saturday 31.

### S9.1 Fix the failures rehearsal 1 found

Size M, code only. After: S8.1. **Status: open.**

- **What:** The lead turns each S8.1 failure into a task under the step it belongs to (S3 to S7), in the cut order of PLAN.md, and dispatches them. Nobody who saw the closed kit's contents works on these fixes; the failures are described by format and symptom only.
- **Files:** docs/evidence/step-8/s8-1/result.json; TASKS.md (new tasks added under their steps)
- **Check:** Every S8.1 failure has a task that is done, or is cut with its reason in TASKS.md.
- **Tests:** The tests named in each new task

### S9.2 Rehearsal 2, recorded, then freeze

Size M, this PC: Docker. After: S9.1. **Status: open.**

- **What:** As S8.1 on a new fresh runtime, twice if time allows. The second run is screen-recorded as the backup video. If Done holds, the lead rolls the demo runtime to the frozen commit (DEMO-RUNTIME.md roll procedure, owner informed), pushes staging, and freezes on Saturday evening: no change after that except a fix the owner asks for.
- **Files:** scripts/rehearsal/kit-drop.mjs; docs/backend/DEMO-RUNTIME.md; docs/STATUS.md; docs/evidence/step-9/s9-2/result.json
- **Check:** The plan's Done line holds on the recorded run, and the demo runtime serves the frozen commit with its doctor passing.
- **Tests:** pnpm platform:doctor --profile demo; pnpm journey:check


## Merged during the review

- ui S7.8: merged into S4.3 and S4.8
- ui S7.10: merged into S3.9
- ui S7.15: merged into S4.8 and S6.3
