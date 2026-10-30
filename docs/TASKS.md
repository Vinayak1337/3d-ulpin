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

Size M, this PC: Docker. After: none. **Status: done 24 Oct (4c704191 on int3-pre; test-only timing fixes; one non-reproduced native-reader timeout kept as a qualification).**

- **What:** Run the whole check recipe the INT2 integrator used, at 0aecb4f8. No full run exists at this head; the last one is INT2 (backend 2022 tests 0 failed, Studio 616 0 failed). Fix only failing tests or real bugs, one commit each, with a regression test for each real bug. Also run the PostgreSQL dispatcher controls that LQ1 skipped, against a disposable local Postgres container, never a runtime's database.
- **Files:** Read: docs/evidence/int2/result.json (checks[] has the exact commands and env: ULPIN_PROFILE_PYTHON=E:/BhuAayam-data/ml/venv-k3a-geo/Scripts/python.exe, --tsconfig docs/evidence/int2/tsconfig.tests.json); packages/server/src/modules/cases/processing.test.ts:349 (ULPIN_DISPATCH_TEST_DATABASE_URL); docs/evidence/lq1/result.json (skips). Change: only the failing test or source file. Worktree from 0aecb4f8.
- **Check:** Full backend command (pnpm exec tsx --tsconfig docs/evidence/int2/tsconfig.tests.json --test --test-concurrency=4 tests/*.test.ts packages/server/src/**/*.test.ts) exits 0 with 0 failed. pnpm --filter @ulpin/studio exec vitest run exits 0 with 0 failed. geo pytest exits 0. The processing.test.ts PostgreSQL cases run (not skipped) and pass.
- **Tests:** pnpm typecheck:backend; pnpm studio:typecheck; pnpm studio:test; openapi.ts --check; python scripts/api/check.py; python scripts/db/verify_extraction.py; services/geo pytest (INT2 command); node --test scripts/platform/*.test.mjs

### S1.1b Full check set again on int3-pre 41d7a1c7, fix only what fails

Size M, this PC: Docker (one disposable PostGIS container, no volume). After: S5.2a merged. **Status: done 25 Oct (merged into int3-pre, pins 5e447378): full backend 2389 pass, Studio 712 and 783 pass, geo and PostgreSQL controls pass; two real fixes (point publication followed the S5.14 step rule; CityGML readings stored under the old bounds are accepted); only the Studio decimalMark type error remains (S5.7b)**

- **What:** S1.1 passed at 4c704191; about 40 merges have landed since. Run the same check set (S1.1 evidence lists it) plus the three geo interpreters now needed (CityJSON and points, rasters, IFC) before S1.4 merges int3-pre into staging. Fix only failing tests or real bugs, one commit each; Studio source failures are reported, not fixed.

### S1.2 Fresh-runtime rehearsal part 1: create ulpin-reh-03 and run act 1 (proves SA1 and EV2 live)

Size L, this PC: Docker. After: S1.1, S3.1 merged onto int3-pre by the lead. **Status: failed 24 Oct (evidence 2cea614c on task/s1-2-rehearsal): SA1 passed (9 raster, 211 point jobs), but a 409 on one retain and no View layout with the S4.1 switch off blocked both cards and EV2. Fix S1.2a done 25 Oct (bea97a14 on task/int3-pre). Run 2 at aaa9d698 (evidence a2be0ff0): four retains with no 409, View layout answered, 1,661 recorded, both cards consistent, journey 8/8, SA1 passed, cited row matches. Open: the EV2 overlap was not produced (prepare took 3.3 s and ended before the confirmation; carried to S1.3 under load), and the map stalled while point parts drew (155 frames over 100 ms; diagnosis S1.2c).**

- **What:** Rehearse the newest head (0aecb4f8 plus S1.1 fixes and S3.1) on a new, empty runtime, not reh-02: reh-02 carried old point-batch items that polluted REH16. Procedure (DEMO-RUNTIME.md:272-311): git worktree add E:/Projects/ulpin-wt/ulpin-reh-03 <serve sha>; pnpm install --frozen-lockfile; pnpm platform:start --profile demo --create --runtime ulpin-reh-03; demo-document-runtime.mjs build; demo-native-readers.mjs build then check (four verified); platform:start; platform:doctor all PASS. The image stays ulpin-geo:git-dc5deb405fb9; services/geo is unchanged since the pin. Ports are 21031-21036 (API 21036). Then act 1 with the REH16 run-a order: confirm evidence while the package prepare runs. Both cards; journey 8/8 with surfaces and citation passing. Run the demo doctor before and after. Quiet PC: no other agent runs. Leave reh-03 stopped, never removed.
- **Files:** Read: docs/backend/DEMO-RUNTIME.md:272-311; _tasks/reh16.md, reh17.md; k3 branch task/reh16-rehearsal 8f7314b2 docs/evidence/runtime/reh16/{roll.json,launch.ps1,dress.mjs,journey.mjs,cards.mjs,citations.mjs,jobs.mjs,api-watch.ps1,act1-files.json} (copy with reh-03 ports and paths). Write: docs/evidence/step1/s1-2/result.json on its own branch.
- **Check:** pnpm journey:check --case <act 1 case> passes 8/8 with nothing skipped. The act 1 TIF and LAZ each get raster-window and point-batch jobs (SA1). The cited card is reached in the run-a order with at most one re-confirmation (EV2). Demo doctor before and after shows 4ffd801a, exit 0.
- **Tests:** pnpm platform:doctor --profile demo --runtime ulpin-reh-03; pnpm journey:check

### S1.2c Find why the map stalls while point parts draw (diagnosis only)

Size S, this PC: runtime. After: S1.2 run 2. **Status: done 25 Oct (evidence e8e854d8 on task/s1-2-rehearsal): cause (a), software WebGL in headless Chromium. On the RTX 3070 (D3D11) the same 45 s window had 3 frames over 100 ms, all in the first 5 s, and 0 after; per-part work was not supported as a cause. The Studio was a dev build; S3.3 serves a production build on the GPU from now on.**

- **What:** In run 2 the map had 155 frames over 100 ms (largest 467) and 208 long tasks while 186 of 211 point parts drew. One bounded comparison: the same 45 s map window on reh-03 in headless Chromium and with the PC GPU, with the WebGL renderer string, frames, long tasks and a CPU profile. It names the cause: software WebGL in headless, per-part main-thread work, both or neither. No product code; the fix is a later task.

### S1.2b A ZIP retain tolerates sibling reads like any other original

Size S, code only. After: S1.2a (merged). **Status: done 25 Oct (merged on task/int3-pre).**

- **What:** S1.2a let a new original be retained after a sibling arrival or a server table read had moved the case revision on; it still refuses a changed family revision and a changed access context. The ZIP archive retain in packages/server/src/modules/usp/ingestion/intake-zip-layers.ts:74 still demands the exact drop revision, so a ZIP dropped beside a CSV can meet the same 409. Apply the same rule there and nothing else.
- **Check:** a new test in tests/intake-zip-layers.test.ts: a ZIP retain sent with the drop revision after a sibling table read passes; a future revision and a changed access context still refuse, with no bytes stored.
- **Tests:** tests/intake-zip-layers.test.ts, retain-routing.test.ts; the section 5 server command

### S1.3 Fresh-runtime rehearsal part 2: our own act 2 files alone and under load, with timings

Size L, this PC: Docker. After: S1.2. **Status: S1.3aj to S1.3am merged; S1.3an running (after the reader code changed, Try again must read the file again; then the Halifax throughput window). Run 11 failed 27 Oct (evidence d82ef361 on task/s1-3-rehearsal, int3-pre 5f638148; reh-03 stopped with Halifax still preparing; demo 4ffd801a unchanged). 28 PASS, 3 FAIL, 4 not produced. Fixed since run 10: package reviews reached two at once, no stale Halifax cut, the semicolon table waited with two uploads open and started by itself, CityJSON queued 47.4 s (bound 60), run 10's Halifax ended before the load (46.7 a minute). Failed: Halifax 43.0 packages a minute, 1,325 in 30.8 minutes, no end: two reviews at once each took about twice as long (median 2.8 s, run 10 about 1.5 s) and the cut's destination step waited a median 0.7 s (was 2 ms), so reviews and cuts queue on one area: S1.3aj. The Halifax raw read was fenced twice on connect ETIMEDOUT before reading a byte and read on the third attempt (697 s); one intake-evidence and one point-batch attempt fenced with no cause: S1.3ak. Not produced: EV2 (accepted), every check within 120 s and table queue times (a per-file poll started late), every prepare job's times (export ended before the last ones). Run 10 failed 27 Oct (evidence 99d2b4b9 on task/s1-3-rehearsal, int3-pre 71184b95; reh-03 stopped with Halifax still preparing; demo 4ffd801a unchanged). 25 PASS, 3 FAIL, 4 not produced. Fixed since run 9b: the four run 3 table drafts ran and succeeded at start (S1.3af); run 9b's Halifax closed before the load; Halifax read again in one attempt (663 s); cut median 283 ms (S1.3ag); file b drawn at 36 and 51 s. Failed: Halifax prepared 1,266 packages in 30.8 minutes, 41.1 a minute (run 9b 28.1), of about 3,000, no end; 1,067 of its 1,874 s were waits after the eight-unreviewed pause (343 pauses, median 3.8 s) and 140 cuts were thrown away stale because two steps of the item ran at once: S1.3ah. 129 intake-large attempts were fenced with no cause (fail() stores none): S1.3ah. The CityJSON native vector job queued 64.8 s (bound 60; run 9b 39.3 s). Not produced: the semicolon slot wait (only one upload open at the drop; recorder), EV2 (prepare ended 23 s before the control enabled), every check within 120 s (one 131.9 s after a navigation interrupted the first Halifax hash), table queue times compared. Run 9b failed 27 Oct (evidence 1e220328 on task/s1-3-rehearsal, int3-pre 76eed374; reh-03 stopped with Halifax still preparing; demo 4ffd801a unchanged). 23 PASS, 1 FAIL, 5 not produced. Fixed since run 8: Halifax read in one attempt (667 s, 1,725 parts), file b drawn at 36 and 47 s by a WebGL pixel test (bounds 180 and 240), recorder closed in 0.8 s. Failed: Halifax prepared 863 packages in 30.7 minutes after its read, 28.1 a minute (run 7: 25.6), one cut every 1.6 to 4.7 s, no end; the target needs about 58 a minute: S1.3ag profiles the cut on the runtime. Not produced: the semicolon slot wait (the import dialog had no table control), EV2 (prepare ended before the control enabled), byte progress during the read, the early exit-file window, and the od2 table draft. Run 9 stopped at preflight 27 Oct (checkpoint 5772140c on task/s1-3-rehearsal): the brief forbade uploading a file already present, and all 24 act files are present from earlier runs, so no load ran (brief fault, lead's; 9b allows it as every run did). Its 45-minute drain found four run 3 intake-draft jobs queued since 25 Oct 07:31 that never dispatch: S1.3af. Recorder close timed out (90 s); CDP request ledger validated with no differences. Run 8 failed 27 Oct (evidence c4e391cb on task/s1-3-rehearsal, int3-pre 218fa836; reh-03 stopped, kept; demo 4ffd801a unchanged). 16 PASS, 1 FAIL, 8 not produced; the act ran only 28 minutes. Fixed since run 7: DXF and the orthophoto enrolled and read; no ERR_NO_BUFFER_SPACE, no 502. Not proven: Halifax's first raw read was reset by ECONNRESET six minutes in and started over (as in run 6), so no closure was measured: S1.3ae. Run 7's Halifax and run 3 table drafts resumed when reh-03 started and ran beside the act: run 9 must quiet earlier runs' work first. EV2 still produced no POST (prepare ended before the click); semicolon slot setup, paint caption and the request ledger still recorder gaps. Run 7 failed 27 Oct (evidence 18ef364a on task/s1-3-rehearsal, int3-pre e3140424; reh-03 stopped, kept; demo 4ffd801a unchanged). 17 CHECK lines PASS, 1 FAIL, 7 not produced. Fixed since run 6: no deadlocks (66 to 0), every failed attempt has a cause, no upload-list 503 (30 to 0), two pages instead of 24, no1 enrolled and read, the two migrations applied in 47 s, ZIP first drawn at 44 s (was 103). Failed: Halifax said Preparing packages after its read but had 647 packages and no end 25 minutes later (about 26 a minute; run 6 needed 1,563): S1.3ab. DXF enrolment failed with ERR_NO_BUFFER_SPACE and the orthophoto enrolment got a 502 from a timed-out upstream connect: S1.3ac. Not produced, recorder side (fix in the run 8 brief): EV2 locator matched two acknowledgement boxes, semicolon slot wait not set up, drawn-count caption, preview process samples. Run 6 failed 26 Oct (evidence 96667f92 on task/s1-3-rehearsal, int3-pre 41c04392, reh-03 stopped with containers and volumes kept; demo 4ffd801a unchanged, same API and dispatcher processes). The run stopped at 02:52 when every model account was out and was written up at 17:13 from what it recorded. Fixed since run 5: Halifax enrolled (201; the first raw attempt was cut by ECONNRESET and the retry succeeded), the semicolon table was queued and read instead of refused, both ZIP parts drew (first at 102.7 s, both at 190.5 s, inside the 180 and 240 s bounds), the API and dispatcher never exited, health and connection traces ran through the act. Failed: 66 intake-large attempts hit a PostgreSQL deadlock (40P01) during the act, 120 by close-out; 210 fenced intake-run attempts kept no cause; Halifax still showed Reading at the end although its layout was approved and its raw read and profile succeeded; the no1 case was created but its checking stalled at 0% with no intake item; 885 browser requests ended ERR_ABORTED and 30 upload-list reads answered 503, with their trigger not traced. Not produced: EV2 during prepare (83 samples, none enabled), the semicolon upload-slot wait (two slots were free, so it never had to wait), the after-run input hashes, and the batch jobs for c-encoding and d-wkt. The progress dump grew to 156 GB on E: because the runtime ran on overnight; it stays out of Git. Fixes next before run 7. Earlier: run 5 failed 25 Oct (evidence 7b8373f9 on task/s1-3-rehearsal, int3-pre bac06934, reh-03 on ulpin-geo:git-9a7424be7800; its preflight first stopped because platform:start never applies new migrations, so the lead had the S1.3g migration applied by the R9 method; S1.3q). Fixed since run 4: table drafts queue 0.3 to 0.9 s (were 410 to 433 s), the semicolon table waited for its upload slot with words and started by itself once, every failed attempt names its cause (one ZIP mapping attempt hit a PostgreSQL deadlock and recovered; S1.3s), ZIP and CityJSON vector queues 13.4 s and 1.9 s, no1 case created at once, DXF paged reading and all six KML children kept, every monitor wrote through the act. Failed: the Halifax enrolment request and one evidence read failed with a browser connection timeout after about 1 s, so Halifax was never read (S1.3t); the semicolon table's streaming import was refused STREAMING_CAPACITY because admission caps queued and running imports at 2 while the lane runs 4 (S1.3r); both ZIP packages captured blank at 46 to 52 s, before the map's area read had answered (the recorder captured once and retook once; run 6 polls the canvas until drawn, up to the 180 and 240 s bounds); one act 1 point batch ended POINT_INPUT_STALE (S1.3s). EV2 during prepare again not produced (prepare ends before the form is ready; accepted on the S1.3f tests). Run 6 after S1.3q to S1.3t. Run 4 failed 25 Oct (evidence 5972c394 on task/s1-3-rehearsal, int3-pre 1710369c, reh-03 on ulpin-geo:git-9a7424be7800). Fixed since run 3: the ZIP's first vector dispatch 17.6 s (was 35.6 s), CityGML 8.1 s and CityJSON 5.3 s (were about 31 s), 11 profiles admitted within 0.82 s, Halifax completed in 729 s with no STORAGE_TIMEOUT, all six KML children kept without a quota refusal, the paged DXF reading verified, first ZIP geometry at 63.9 s. Failed: the ZIP's second part was not visible (both captures framed wrongly: first part a speck at 1 km, second view at 20 m on empty ground; S1.3k); the semicolon table upload was refused because two upload receipts per person were open (S1.3j); the no1 case creation failed to fetch through the preview proxy (S1.3g step 4); generic worker errors on Halifax raw, the ZIP raw, its mapping and three profiles, all recovered on retry, cause not kept (S1.3g); three small table drafts waited 410 to 433 s for first dispatch (S1.3h); Halifax's first-part layout was rejected at closure, nothing drafted (S1.3i). Not produced: EV2 during prepare (prepare ended first; the control showed waiting words, then enabled), external API-watch and process proofs (Node-detached PowerShell launches ran nothing), whole-act frames (the recorder crashed on an unhandled waitForResponse and recovered serially). Run 5 after S1.3g to S1.3k, with monitors launched directly from the shell and the waitForResponse guarded. Run 3 failed (c5e7fb94). Run 1 failed 25 Oct (evidence e47274ed on task/s1-3-rehearsal; production build, RTX 3070 renderer). Passed: file f alone first map 183.5 s (REH15 738 s); no API or dispatcher exit; 426 health samples all healthy. Failed: under load eight large-file jobs ended on capacity refusals (429) instead of waiting, so file b under load drew no map; a LAZ upload was refused when sibling arrivals moved the case revision; four native readers refused TOOL_CHANGED on reh-03. EV2 overlap again not produced (prepare 3.9 s): accepted on intake-evidence-confirm tests and 0 re-confirmations in S1.2 run 2. Fix S1.3a merged 25 Oct; next run 2 with the native readers rebuilt and checked first.. Run 2 running 25 Oct on reh-03 at int3-pre 8bc550e6 (with S1.3a, S3.7, S5.13 and the a8c67f15 processor image). Run 2 failed 25 Oct (evidence ae2be0b0 on task/s1-3-rehearsal, int3-pre 8bc550e6): fixed since run 1: no job ended on a capacity refusal, the LAZ upload published 54/54 parts, five native readers verified, file b alone drew both parts in 33 s (run 1: 219 s), file f alone 181 s. Failed: under load the large Halifax file held both vector slots with its stream reader and its profile for 523 s, so every other vector job waited (the ZIP 460 s, CityGML and CityJSON conversions about 500 s); fix S1.3b. Not produced: paint timing (blank captures), EV2 during prepare, DXF live proof. PO1 page 3 is refused by the known whole-page OCR frame limit (above 2000 points a side). Run 3 after S1.3b, with the recorder fixes from run2/faults.json. Run 3 failed 25 Oct (evidence c5e7fb94 on task/s1-3-rehearsal, int3-pre 726bb2e8): fixed since run 2: the ZIP waits 12.8 s for its first reader (was 460 s), CityGML and CityJSON conversions 15 and 22 s (were about 500 s), every vector first dispatch under 60 s, DXF read live (229 records, 83 entities, declared metres). Failed: only one streamed profile may be active in the whole service, and Halifax held it, so the ZIP read its member but drew nothing in 900 s (S1.3c); Halifax raw passed its 10-minute read deadline under load and started again (S1.3d); two KML members of the ZIP were refused by the full receipt allowance (S1.3e); an enabled Record press during prepare sent no request (S1.3f); longest frame 189 ms with reh-02 also running. Run 4 after S1.3c to S1.3f.**

- **What:** On ulpin-reh-03, run REH16's act 2 list. First file b (the zp1 ZIP) alone, measuring LQ1: layout, first map, both parts. Then file f (Niagara 26 MB GeoJSON) alone. Then the load phase, each file in its own batch. Record per file: forecast and tray words, reader outcome, map yes/no, seconds. Record job queue, execution and retry split, any S3.1 exit lines, health pool numbers every 5 s, and host CPU. Fix the REH17 act2-list CityJSON path first; it points at a reh16 file that doesn't exist. Stop reh-03 at the end.
- **Files:** k3 docs/evidence/runtime/reh16/{act2-list.json,watch.mjs,jobs.mjs,checkpoint.json}; _tasks/reh17.md steps 4-5; E:/BhuAayam-data/task-data/reh16/act2 prepared inputs. Write: docs/evidence/step1/s1-3/result.json.
- **Check:** API and dispatcher exit files stay empty through the load phase. File b: first map within 180 s, both ZIP parts within 240 s, officer time excluded. File f alone: first map time recorded beside REH15's 738 s. A verdict line for every act 2 file.
- **Tests:** jobs.mjs read-only job timing; pnpm platform:doctor --profile demo --runtime ulpin-reh-03


### S1.3b A large file's stream readers no longer hold every vector slot

Size S, code only. After: S1.3 run 2. **Status: merged 25 Oct (int3-pre 511da8d4, pins 726bb2e8). streaming-vector and streamed-profile run in the stream lane (4 slots); vector keeps 2 for parts and conversions. The run 2 replay starts the ZIP within one tick (base: 522 s); two large files finish all four readers. A raw reader never waits on its profile, and at most one profile is active, so the pair cannot fill the lane. Server set 1045 pass.**

- **What:** In S1.3 run 2 the Halifax 108 MB GeoJSON ran its streaming-vector reader and its streamed-profile for 523 s. Both sit in the vector lane (concurrency 2), so no other vector job started for that time. Move the two long-lived stream readers into their own lane, stream, and keep vector for the bounded part and conversion jobs. A stream must never wait on its own profile for a slot. Memory, heap and scratch admission are unchanged. INGESTION-ARCHITECTURE.md section 8 names the new lane.
- **Files:** packages/server/src/modules/cases/dispatch-lanes.ts; processing-latency.test.ts, processing.test.ts, dispatch-heap.test.ts and dispatch-scratch.test.ts (lane assertions only); docs/design/INGESTION-ARCHITECTURE.md section 8
- **Check:** a replay test with run 2's shape: one streaming large file, then a ZIP-like item with 43 parts and one conversion. The small item's first vector job starts within one tick, where it waited for the whole stream on the base commit. Two large files whose four readers arrive interleaved all finish.
- **Tests:** processing-latency, processing, dispatch-heap and dispatch-scratch tests; pnpm typecheck:backend; the section 5 server command
### S1.3c One large file's profile no longer blocks every other file's profile

Size S, code only. After: S1.3 run 3. **Status: merged 25 Oct (int3-pre, task/s1-3c-profile-admission 898589a3; pins regenerated; section 5 set 1,058 tests, 0 failed). A profile with no ready chunk requeues before claiming; after a claim it publishes the ready chunks and yields without spending an attempt; the 12-minute wait is durable; the cap is 4. First pass (74e0707a) stopped as told: a waiting profile polls in process and holds a stream slot and 512 MiB for its whole wait. Resumed with the design: a profile with no ready chunk gives its slot back and is requeued, the 12-minute wait is measured durably, then the cap rises to 4. Second stop (24017374): every claim counts toward three attempts; resumed again with a narrow yield in jobs.ts that does not count as an attempt. Resumed once more after the 25 Oct session restart.**

- **What:** STREAMED_PROFILE_LIMITS.active is 1 across the service, so a large file's profile row stops every other file at profile admission. Raise it to 2, half the stream lane, keeping S1.3b's proof that profiles and raw readers cannot fill the lane; replays for a ZIP beside a long large file and for every profile waiting on raw.
- **Files:** packages/contracts/src/usp/streamed-profile.ts; streamed-profile tests; processing-latency.test.ts
- **Tests:** processing-latency.test.ts; the section 5 server set; pnpm typecheck:backend

### S1.3d Why the 108 MB raw read passed its deadline under load

Size S, code only (reh-03 read-only if needed). After: S1.3 run 3. **Status: merged 25 Oct (int3-pre, task/s1-3d-raw-deadline 835e6126; pins regenerated). First pass (b7735667): Halifax published all 923 parts with at most 16 s between them and timed out at 601 s because the whole-read bound counts serial publishing under load; the retry restarts at byte zero. Fixed with a 2-minute no-progress bound (source bytes or a newly published part) and a 30-minute-per-128-MiB outer bound, for the raw read only; other readers unchanged. A retry still starts at byte zero; the PB1 cause stays unknown.**

- **What:** The streaming read has one wall deadline (10 minutes per started 128 MiB) that also counts time held by backpressure; under load Halifax passed it and started again. Find where the read waited, then one bounded comparison; if the deadline counts waiting, bound lack of progress instead under a stated outer bound. Also say why the PB1 enrolment got 502 ETIMEDOUT through the preview proxy.
- **Files:** the streaming-vector reader and worker; packages/server/src/infrastructure/storage.ts (openObjectStream)
- **Tests:** the section 5 server set; streaming-vector-scale.test.ts

### S1.3e A ZIP member refused by a full receipt allowance waits for a free receipt

Size S, code only. After: S1.3 run 3. **Status: merged 25 Oct (int3-pre, task/s1-3e-zip-quota-wait 755c9fd7; pins regenerated; section 5 set 1,064 tests, 0 failed). First review sent back (b853e808). The waiting words and the 30-minute bound from archive retention are right, but the fan-out ran before any claim with no lease. Resumed 25 Oct on int3-pre with S1.3c merged: claim, fan out under the lease, and yield on a wait (the yield set gains intake-zip-layers); the waited seconds come from stored data, not from the words.**

- **What:** A member refused UPLOAD_QUOTA stays inside the archive until the officer enrols it again. The ZIP layer job requeues for the refusal's freesAt under one outer bound, and the member says it waits.
- **Files:** packages/server/src/modules/usp/ingestion/intake-zip-layers.ts, intake-zip-layers-worker.ts; tests/intake-zip-layers.test.ts
- **Tests:** tests/intake-zip-layers.test.ts; the section 5 server set

### S1.3f An enabled Record press during prepare sends its request or says why not

Size S, UI (Claude session). After: S1.3 run 3. **Status: merged 25 Oct (int3-pre 8720277e). Confirm the evidence and Accept every exact single match stay disabled while a retained source is still being read, with words naming it.**

- **What:** In run 3 the recorder pressed Record packages and make chosen cards while the package was being prepared; the button was recorded as enabled and no confirmation was sent. Name the cause; never an enabled button that does nothing.
- **Files:** apps/studio/src/features/intake/run/ (Confirm.tsx, useConfirmationCommand.ts, model.ts)
- **Tests:** pnpm studio:typecheck; pnpm studio:test; pnpm studio:build

### S1.3g Name and fix the generic worker errors under load

Size M, code only. After: S1.3 run 4. **Status: merged 25 Oct (int3-pre 0206219a, task/s1-3g-worker-errors cd7897f2; migration usp_job_failure_cause_001 added to the SQL audit; pins regenerated; server set 1,077 tests, 0 failed). Cause confirmed: the dispatcher's database pool held 8 connections while its lanes run up to 31 jobs, so under load a job waited more than 5 s for a connection and ended its attempt with a generic error. Fixed: the dispatcher sizes its pool from the lane table (33, inside the PostgreSQL default of 100 with the API's 8), a connection wait no longer spends an attempt, and each generic failure keeps a safe cause (class, code, a message only when it is a known connection message). Reviewed twice: writing the cause can never stop a retry, the dispatcher sets its pool size at startup, and a mapping's yields do not count as failures. The no1 case creation failure is not explained by this (the API keeps its own pool); it is checked again in run 5.**

- **What:** Under load the Halifax raw read, the ZIP raw read, its mapping and three profiles ended attempts on generic worker errors (any error that is not an AppError) and recovered on retry; the underlying error is kept nowhere. Keep a safe cause (class, SQLSTATE or errno, a scrubbed message) beside the code. Then test the lead's hypothesis: the dispatcher's one pg pool (max 8, 5 s acquire timeout) is smaller than the about 30 jobs its lanes run at once. If so, size the dispatcher pool from the lane table within max_connections, and make an acquire timeout a busy wait that spends no attempt. Also say whether this explains the no1 case POST that failed to fetch.
- **Files:** packages/server/src/infrastructure/db.ts; the catch blocks of the streaming-vector, streamed-profile, chunk-mapping, intake-large and intake-zip-layers workers; jobs.ts (cause write only)
- **Tests:** a new pool-pressure test that fails on 1710369c; pnpm typecheck:backend; the section 5 server set

### S1.3h Small table drafts no longer wait minutes behind a large file

Size S, code only. After: S1.3 run 4. **Status: merged 25 Oct (int3-pre 89c7e4d9, task/s1-3h-draft-queue b476b6a6; pins regenerated; server set 1,077 tests, 0 failed). Cause: not the pending query. Only one table mapping could run in the whole service, and a mapping waiting for its source held that slot (the table drafts waited 535 to 540 s in the replay). Fixed: four mappings may run, and a mapping whose source is not ready gives its slot back and waits without spending an attempt, ending after 12 minutes with no part. Found on the way: mapping history stops all mapping after 128 imports in the whole service, never freed (S1.3l).**

- **What:** Three small tables waited 410 to 433 s for their intake-draft job's first dispatch, then ran in milliseconds. Name the cause; the lead's lead candidate is the dispatcher's pending query taking only 12 ready jobs per tick, all from full lanes. Fix it so a job in a lane with room is never kept out by jobs that cannot start this tick, keeping file fairness, waves, layout-first and item FIFO.
- **Files:** packages/server/src/modules/cases/processing.ts (pending selection); processing-latency.test.ts
- **Tests:** a run 4 shaped replay that fails on 1710369c; processing, dispatch-heap, dispatch-scratch tests; the section 5 server set

### S1.3i Why Halifax's first-part layout was rejected when the whole file closed

Size S, code only. After: S1.3 run 4. **Status: merged 25 Oct (int3-pre d5758dc4, task/s1-3i-prefix-check 36a1d13b; pins regenerated; server set 1,072 tests, 0 failed). Cause: a false rejection by two guards. The sealed geometry-type set had to equal the prefix's (Halifax adds 36 MultiPolygons after the first part), and quarantined records counted as unknown values of the used fields; the normalizer also held later MultiPolygons as geometry drift. OBJECTID (all 172,409 safe integers) and the raw retry were ruled out. Fixed: a type in the approved prefix stays compatible, a new type is compatible when the approved conversion accepts it, quarantines stay counted but are not field drift, and a true rejection names the field or geometry type and the first record. Reviewed twice: approved set-aside points stayed compatible, and blank optional names stayed out of failures.**

- **What:** The officer approved OBJECTID as the key and the geometry on the first part; after the raw retry and 11 quarantined records the closure said a field changed or could not be read, and nothing was drafted. Name the rule that fired: a real bad value, a quarantined record, or a stale check key after the retry. Fix a wrong check; if the rule is right, make the words name the field and the first record that broke it.
- **Files:** intake-large.ts (prefix check), streamed-mapping.ts (seal check) and their tests
- **Tests:** a run 4 shaped test; pnpm typecheck:backend; the section 5 server set

### S1.3l Lifetime ingestion caps become renewable quotas, starting with mapping

Size M, code only. After: S1.3h. **Status: merged 25 Oct (int3-pre e86869b2, task/s1-3l-renewable-caps fb11b947; pins regenerated; server set 1,080 tests, 0 failed). Fixed: a mapping counts toward the 128 only while it holds work or is the current mapping of its source; failed, stale and superseded mappings are kept but no longer count, and the refusal says how many count and what frees one. The doctor now prints every ingestion bound (14 lines, counts only, warning at 75 percent, read only). Inventory: the streaming history is already per case; the profile history (128 in the whole service, never freed) and finished mappings in old cases still fill the service quota (S1.3n); the raster and point 64-source budgets also bound retained bytes and need their own task. The doctor query has not yet run against a live database; run 5 reads it.**

- **What:** Mapping admission refuses every table and large map layer once 128 mapping imports exist in the whole service, of any state, and nothing frees one; one act 1 and act 2 run makes about 8, so a runtime used for rehearsals fills it. Design item B2 decided quotas instead of lifetime caps. List every lifetime cap B2 names (what it counts, whether anything frees it), make the mapping count only rows that hold work or are the current mapping of their source, add a read-only doctor line per cap with a warning at 75 percent, and say which other caps the same rule fits. No row is deleted and the other caps do not change in this task.
- **Files:** packages/server/src/modules/usp/ingestion/chunk-mapping.ts (admission count) and its tests; scripts/platform/doctor and a new ingestion-quotas.mjs with its test
- **Tests:** 200 superseded plus 10 live rows admit, 128 live rows refuse; the doctor test prints counts only; pnpm typecheck:backend; the section 5 server set

### S1.3m The a3b agent wiring test passes again

Size S, code only. After: S1.3h. **Status: merged 25 Oct (int3-pre 068c1da7, task/s1-3m-a3b-wiring f25db1d3, plus the lead's fix keeping its control artifacts on E:; a3b 8 of 8; server set 1,080 tests, 0 failed). Causes, all stale test doubles, no product fault: the source double ignored the manual-profile filter added in e165cf2f (new on int3-pre); the XLSX test never set its geo interpreter (also on staging); the storage double returned no stream body (also on staging). The learner step now uses an offline stand-in that still checks one partial fit and checkpoint recovery. It fits the section 5 set (under 12 s, offline) but is not added yet.**

- **What:** scripts/agent/a3b-wiring.test.ts fails 3 of 8 on int3-pre and 2 of 8 on staging; it last changed 11 Oct and is not in the section 5 set, so nothing caught it. Name each cause (stale test double or real fault), update stale doubles without weakening an assertion, and stop on a real fault.
- **Files:** scripts/agent/a3b-wiring.test.ts and its own fixtures
- **Tests:** the a3b test 8 of 8; pnpm typecheck:backend; the section 5 server set

### S1.3n Profile and mapping history are kept per case

Size S, code only. After: S1.3l. **Status: merged 25 Oct (int3-pre 9b9bcf12, task/s1-3n-case-history 31a9602b; pins regenerated; server set 1,088 tests, 0 failed). Profile and mapping history now count only the requesting case's live or current rows (a profile is current while sealed and not superseded by a newer raw, reader or profiler pin); refusals name the case and what frees a slot, with {limit, freesAt:null}. The doctor reports the busiest case for both, with parity tests against the admission SQL. Global active limits (4 and 4) unchanged.**

- **What:** The profile history refuses every large file once 128 profiles exist in the whole service, and nothing frees one; finished mappings in old cases still fill the mapping quota. Count both per case, as the streaming history already is, and count only live or current rows; the global active limits stay.
- **Files:** streamed-profile.ts and chunk-mapping.ts (admission count and words); their quota tests; scripts/platform/ingestion-quotas.mjs and its test
- **Tests:** 128 in case A do not stop case B; 128 live in one case refuse; failed rows do not count; pnpm typecheck:backend; the section 5 server set

### S1.3o Per-format retained-source budgets are kept per case

Size M, code only. After: S1.3l. **Status: merged 25 Oct (int3-pre 9e863382, task/s1-3o-case-retention 3d7e2e15, resumed once; pins regenerated; server set 1,093 tests, 0 failed). The ten direct-retain budgets (same 64 sources and 256 MiB, CityJSON 128 MiB) now count the requesting case only, through one helper (retention-budget.ts) called on one line in each format; superseded revisions still count; each 429 code kept with {limit, freesAt:null}. No service total, by the lead's decision. Doctor lines follow in S1.3p.**

- **What:** Ten direct-retain paths (raster, point, KML, CityGML, CityJSON, DXF, GeoParquet, glTF, IFC, OBJ) refuse a new original once the whole service holds 64 sources or 256 MiB of that format, never freed; one rehearsal ZIP retains six KML. Count each per case with the same numbers through one shared helper, and stop if nothing then bounds the service total.
- **Files:** the ten format modules (budget lines only), one helper, retention-budget.test.ts
- **Tests:** 64 in case A do not stop case B; 64 in one case refuse; the byte limit per case; pnpm typecheck:backend; the section 5 server set

### S1.3p The doctor reports each format's busiest case and kept bytes against free disk

Size S, code only. After: S1.3o. **Status: merged 25 Oct (int3-pre bf9bccbc, task/s1-3p-doctor-retention db3868f7; platform tests 124 pass, server set 1,093 tests, 0 failed). Ten busiest-case lines and one storage line, read only, counts only; the format numbers are copied with a parity test against the helper. Found on the way: scripts/platform/processes.test.mjs had failed since S1.3g (its sandbox lacked the new dispatcher pool names, and it is not in the section 5 set); the lead added the two names. Not yet run against a live database or object store; run 5's doctor reads it.**

- **What:** Ten doctor lines (busiest case per format, sources and MiB against the per-case budget, warning at 75 percent), replacing S1.3l's whole-service raster and point lines, and one storage line: kept original bytes against the object store's free bytes, warning below 20 GiB or below the kept bytes.
- **Files:** scripts/platform/ingestion-quotas.mjs and its test; scripts/platform/doctor (one call); demo-config.mjs (one free-bytes helper if needed)
- **Tests:** node --test scripts/platform/*.test.mjs; pnpm typecheck:backend; the section 5 server set

### S1.3j A file dropped while two uploads are open waits for a free slot

Size S, UI (Claude session). After: S1.3 run 4. **Status: merged 25 Oct into int3-pre 3c3e474f (branch a00174c0). A file refused for a full upload slot waits with words, retries with a backoff from 2 s to 30 s that uses freesAt, starts by itself in drop order, and stops after 30 minutes with Retry upload; every other refusal keeps its words. Studio 760 pass. Gap: a waiting file has no Cancel yet.**

- **What:** The server allows two open large-original receipts per person; a third file dropped during the load phase was refused with 429 UPLOAD_QUOTA and a Retry upload button, and the officer had to notice. Studio keeps the file, says it waits for a free upload slot, and starts the upload itself when a receipt frees (poll the upload status, bounded by the refusal's freesAt and an outer bound), as S1.3e did for ZIP members on the server.
- **Files:** apps/studio/src/features/intake/upload-api.ts, upload-model.ts, table/TableImportDialog.tsx and the map drop path that uploads
- **Tests:** pnpm studio:typecheck; pnpm studio:test; pnpm studio:build

### S1.3k After an import, the map frames the imported features so they are visible

Size S, UI (Claude session). After: S1.3 run 4. **Status: merged 25 Oct into int3-pre bac06934 (branch 776aee3a). Cause of the first miss: the camera framed the whole area (2,100 footprints over 5.3 by 11.1 km), not the package. Each package now frames its own drawn features (a readable box of about 80 footprints, densest window when spread), and a package never moves a camera the officer moved during the import. The second package's blank capture was the starting camera with nothing drawn yet; why nothing was drawn is not proven, so run 5 records the drawn count and the area read state at each capture. Studio 761 pass, scene 71 pass, build 0.**

- **What:** In run 4 the ZIP's first package (2,000 NYC footprints) showed as a speck at 1 km scale, and the second package (66 features) at 20 m scale on empty ground (run4/b-first.png, b-second-blank.png). Name why the frame misses each package, and fix the framing so each package's features fill the view after import.
- **Files:** apps/studio/src/features/ map and import view framing; packages/scene camera fit
- **Tests:** pnpm studio:typecheck; pnpm studio:test; pnpm studio:build

### S1.3q Starting an existing runtime applies its pending additive migrations

Size S, code only. After: S1.3 run 5. **Status: merged 25 Oct into int3-pre c94aa654 (branch 996afeb5). resume() reads the schema after the stores start, applies the existing additive migrations only when something is missing, reads it again and refuses to launch with the missing names; the doctor's migration line names pnpm platform:start. Platform tests 128 pass. Live proof: run 6 start on reh-03.**

- **What:** resume() in scripts/platform/demo.mjs starts the stores, reads database readiness, applies the existing additive migrations (db:migrate, demo-schema.ts) with postgres, minio and redis up when any are missing, reads readiness again, and refuses to launch the API and dispatcher with words if anything is still missing. No seed, create or reset.
- **Files:** scripts/platform/demo.mjs and its tests; doctor migration line words
- **Tests:** node --test scripts/platform/*.test.mjs; pnpm typecheck:backend

### S1.3r A streaming import started while the lane is busy waits instead of being refused

Size S, code only. After: S1.3 run 5. **Status: merged 26 Oct into int3-pre 998cd525 (branch 8c1618e9). Admission no longer counts running imports; the dispatcher's stream lane bounds them. A queue of 16 per case and 64 per service refuses 429 STREAMING_CAPACITY only past it, with plain words; queued jobs still cancel and supersede. The doctor prints queued, busiest-case queued and running against their bounds. Server set 1098 pass, platform 129 pass. Studio words for a queued import deferred (it shows the queued state today).**

- **What:** streaming-vector.ts admission refused at 2 queued plus running imports while the stream lane runs 4. Admission queues the job; the lane bounds running; a named per-case and service queue limit refuses only past it; the doctor shows queued and running against their bounds.
- **Files:** packages/server/src/modules/usp/ingestion/streaming-vector.ts; dispatch-lanes.ts (one constant); scripts/platform/ingestion-quotas.mjs
- **Tests:** pnpm typecheck:backend; the section 5 server set; node --test scripts/platform/*.test.mjs; openapi.ts --check

### S1.3s The chunk-mapping deadlock under load; the stale point batch

Size S, code only. After: S1.3 run 5. **Status: merged into int3-pre 26 Oct (pins aa9a0518). Chunk mapping and the streaming publication now lock the case and source before the job, in one order; a lock-model test shows the old order deadlocks. A non-stale 409 in a point batch gets its own code (POINT_ATTEMPT_CHANGED, POINT_PUBLICATION_CHANGED). The live absence of 40P01 is checked in run 6.**

- **What:** Name the two transactions behind run 5's 40P01 in chunk mapping, reproduce it in a test and fix the lock order (no retry added). List every 409 that point-batch-worker.ts maps to POINT_INPUT_STALE and give a non-stale one its own code.
- **Files:** chunk-mapping.ts, chunk-mapping-worker.ts, the other transaction reordered, point-batch-worker.ts
- **Tests:** pnpm typecheck:backend; the section 5 server set

### S1.3t Why browser requests time out under load (diagnosis first)

Size S, code only. After: S1.3 run 5. **Status: diagnosis merged 26 Oct into int3-pre 0c8d4ade (branch d6cc59f4); cause not proven, no setting changed. Offline, through the real Vite proxy and a stub API, one in 33 requests failed ERR_CONNECTION_TIMED_OUT and one upstream connect timed out with no API work behind it: local TCP connects fail on this PC under load. The proxy opens a new upstream connection per request (26 upload connections against 4 with keep-alive), but keep-alive did not change the failure count in one comparison. The test runs hit out-of-memory starts while other projects' tests ran, and run 5's CPU averaged 48 percent (run 4: 19). Run 6 applies the recorder patch (run6-recorder.patch: timing, in-flight list and health error codes) and samples TCP state counts, memory and commit every 5 s, so a failure is classed as no accept, upstream connect failure, API stall or recorder lag before any fix.**

- **What:** Run 5's Halifax enrolment POST and one evidence GET failed net::ERR_CONNECTION_TIMED_OUT after about 1 s, and one health fetch left a 10 s gap (run 4: no1 failed to fetch). Line them up with the load, reproduce offline through vite preview against a stub API, and fix vite.config.ts or the API server settings with a failing-first test, or name the recorder change or the runtime check needed.
- **Files:** apps/studio/vite.config.ts; the API bootstrap server settings
- **Tests:** pnpm studio:build; pnpm typecheck:backend

### S1.3u The intake-large enqueue deadlock; a cause for every fenced intake-run attempt

Size S, code only. After: S1.3 run 6. **Status: merged 26 Oct (int3-pre 9ed2e8e5, branch 7eeb7134; pins refreshed). All 623 run 6 deadlock reports fall in one cycle with three shapes: a transaction holding the case row FOR UPDATE waits on another's uncommitted intake-large job or outbox stream row, which waits for the case row in its foreign-key check. Every enqueuing transaction that did not lock the case now takes FOR KEY SHARE before its first write (readers still share it). Two-connection PostgreSQL test on a throwaway database: 40P01 on 41c04392, none after. A fenced intake-run attempt now keeps its safe cause. Server set 1109 pass. Live check in run 7.**

- **What:** Run 6 had 120 intake-large attempts end on 40P01. The reh-03 PostgreSQL log shows two transactions inserting the same stable intake-large job id: one holds the case row FOR UPDATE and waits on the other's uncommitted job row, the other waits for the case row in its foreign-key check (draftCut takes no case lock); the outbox stream insert races the same way. Reproduce it with two clients, take the case lock before the first write in every enqueuing transaction (weakest lock that removes the cycle), and record a cause for every fenced intake-run attempt (210 had none).
- **Files:** intake-large.ts, intake-large-worker.ts, intake-run-worker.ts, source-case-lock.ts, outbox.ts, events.ts, the queueIntakeLargeTx callers (lock line only)
- **Tests:** pnpm typecheck:backend; the section 5 server set

### S1.3v Why one 103 MiB GeoJSON took 4.5 hours to close (diagnosis first)

Size M, code only (reh-03 database read-only if needed). After: S1.3 run 6. **Status: diagnosis merged 26 Oct (int3-pre c537e208, branch 444d377e; no product change). Where the 4.5 hours went: at least 4,886 of 5,543 intake-large jobs were obsolete before they ran, queued behind their own step while it kept folding (161,294 s of summed queue); and unfinishedIntakePackagesTx reads the review fields of every earlier package body (2,778 bodies, 517 MiB) at 658 ms a count, at least four times per cut. The 8-package pressure stop never bound (0 to 4 unfinished). In the SQL replay a narrow review column cuts closure from 18.1 s to 1.7 s and dropping stale work to 7.7 s. The row said Reading file because the draft phase projects reading (intakeLargeProjection, publishIntakePartTx); it should say Preparing packages with the packages prepared and records read. Fixes: S1.3x, then the row words S1.3y.**

- **What:** Halifax's raw read finished in 14 minutes but its 8,324 jobs ran until 00:02 UTC, 4.5 hours, and its row said Reading file while 116,416 buildings were ready in 1,563 packages. Name where every hour went from the recorded rows (queue, the one-step chain, the 8-package pressure stop, retries, step cost), say why the row said Reading, replay offline, and fix the top cause if it is bounded or write the design.
- **Files:** intake-large, intake-part-draft and intake-run files; dispatch-lanes.ts for a limit only; the Studio row words if they change
- **Tests:** pnpm typecheck:backend; the section 5 server set

### S1.3w The stalled no1 upload, the 503 upload-list reads and the aborted requests (diagnosis first)

Size S, code only. After: S1.3 run 6. **Status: merged 26 Oct (int3-pre c9c2591f, branch fbe4311a; pins refreshed). The no1 check sat in hashFile, before any request: its hashing worker script was never fetched (file f waited about six minutes for the same fetch, then went on). Every one of the 30 upload-list 503s was a PostgreSQL deadlock on the list's own case FOR UPDATE; the list now reads one read-only snapshot with no case lock and turns a transient database error into DB_UNAVAILABLE with words. An upload with no progress for 2 minutes now stops and says what to do; 0 bytes shows as 0 KiB. The API filter logs the class and code of an untyped error. The 883 aborts were not traced to a trigger. Studio 777 pass, server set 1104 pass. Follow-up S1.3z: the check must not wait on a fetch.**

- **What:** The no1 upload sat at Checking the file: 0% for the rest of run 6 with no intake item; 30 upload-list reads answered the filter's fallback 503 with no cause kept; 885 requests ended ERR_ABORTED. Name the step and cause of each from the recorded requests and logs, then make a stalled upload continue or stop with words, keep a safe cause for untyped API errors, and type the transient database errors.
- **Files:** upload-command.ts, upload-model.ts, api-exception.filter.ts, the upload-list server function
- **Tests:** pnpm typecheck:backend; pnpm studio:typecheck; pnpm studio:test

### S1.3x Large-file closure cost: a stored review flag and no obsolete intake-large jobs

Size M, code only. After: S1.3v. **Status: merged 26 Oct (int3-pre 2a923998, branch eb0d1e61; pins refreshed). Migration usp_import_package_review_001 adds a stored generated review_current (2.2 s and an exclusive lock for 3,431 packages and 517 MiB in PGlite); the count reads it with a key join and no package body. A folding step queues its wake-up once at completion; wake-ups from other transactions are unchanged. SQL replay 21.8 s to 1.37 s; a three-cut fold makes one job, not three. Server set 1113 pass. Full closure time is measured in run 7.**

- **What:** Add the additive migration usp_import_package_review_001, a stored generated review_current on import_packages, and count unfinished packages from it with a key join instead of reading every package body. A step that keeps folding queues one wake-up when it completes, not one per cut; wake-ups from other transactions stay. Rerun the S1.3v replay before and after.
- **Files:** intake-ledger.ts, intake-large.ts, intake-large-worker.ts, usp/migrations.ts, database/manifest.json
- **Tests:** pnpm typecheck:backend; the section 5 server set; the runtime-migrations test

### S1.3y A large file's row says Preparing packages once its read is done

Size S, code and UI. After: S1.3x (same files). **Status: merged 27 Oct (int3-pre 23b55211, branch c93ce09b; pins a8e10e6c). New item state preparing for the compare and draft phases, kept on part publish, with an additive migration (usp_intake_preparing_001) widening the state check. The map follows and draws a preparing file as a reading one; the row says Preparing packages with the packages prepared and records read; an approved layout says Approved. Lead fix b1697f09: a batch with no area still waits for it while a file prepares its packages (waitsForAreaTx).**

- **What:** While a large file's packages are still being drafted after its read, the row says Preparing packages, On the map, with the packages prepared and records read, not Reading file; the layout says Approved without the file is being read. A stored phase decides it; nothing is inferred from approval.
- **Files:** intake-large.ts (intakeLargeProjection), intake-ledger.ts (publishIntakePartTx), the contract state if one is needed, Studio batch-model.ts and layout-model.ts
- **Tests:** pnpm typecheck:backend; the section 5 server set; pnpm studio:test

### S1.3z The file check must not wait on a network fetch

Size S, UI. After: S1.3w. **Status: merged 26 Oct (int3-pre c2a32c8e, branch dac8bc7e). hashFile now uses an inline worker built into the bundle; a test fails if the worker script would be fetched; the build has no separate hash worker script. Run 6 count (lower bound, all 24 recorder pages on one origin): up to 35 requests open at once and six or more for 6,363 s; both stalled checks began inside such stretches. Chrome shares six connections per origin across all pages, so the recorder's many pages add to it. Follow-up S1.3aa: fewer long-lived requests.**

- **What:** hashFile starts a new module worker per file, so the check waits for the worker script to be fetched; under load that fetch waited minutes or never came. Build the worker inline or create one reusable worker at start, prove with a test that no request is made, and count from the run 6 log how many requests the page held open to the Studio origin each second (Chrome allows six per origin over HTTP/1.1).
- **Files:** hash-file.ts, file-hash.worker.ts, file-hash.ts, vite.config.ts if needed
- **Tests:** pnpm studio:typecheck; pnpm studio:test; pnpm studio:build

### S1.3aa Fewer long-lived requests from the Studio

Size S, UI. After: S1.3y (shares readPreview.ts). **Status: merged 27 Oct (int3-pre e3140424, branch 0f44094d). Table fallback polls stop once their job has ended; the map preview makes no read while its page is hidden and reads each followed file once on return. Sharing the case stream with the table was dropped: the table replays from cursor=0, the shared stream tails the head (design in docs/evidence/step-1/s1-3aa/result.json). The recorder's one page per act goes into the rehearsal 7 brief.**

- **What:** Fold the table EventSource (table/useTableStream.ts) into the case subscription, pause polls in hidden pages and stop settled ones (table/queries.ts fallback jobs, map/preview/readPreview.ts), so one Studio page holds at most a few open requests to its origin; and have the rehearsal recorder use one page per act instead of 24.
- **Files:** apps/studio/src/features/intake/table/useTableStream.ts, case-subscription.ts, table/queries.ts, map/preview/readPreview.ts; the rehearsal dress script
- **Tests:** pnpm studio:typecheck; pnpm studio:test

### S1.3ab Halifax prepares its packages fast enough to close within 30 minutes of its read

Size M, code. After: S1.3 run 7. **Status: diagnosis done 27 Oct (branch df493879, evidence only, not merged). 99.06 percent of Halifax's 1,519 s after its read was intake-large execution: serial cuts of about 2.3 s per package, 25.6 packages a minute; queueing 10 s, reviews and the pressure stop nil. The 17 unfinished jobs were queued wake-ups, not failures. 824 of 975 jobs were obsolete before they ran. Next: S1.3ad profiles one cut.**

### S1.3ad Profile one package cut and fix its largest stage

Size M, code. After: S1.3ab. **Status: merged 27 Oct (int3-pre 218fa836 with pins, branch e1933c3f). Per cut on public NYC features with the real normalize, medians before then after: 266 features 589 to 297 ms, 2000 features 4,273 to 2,155 ms; the per-feature draft writes (329 to 37 ms for 266) are now batched inserts, existing rows keep their per-row updates. Of the 824 obsolete jobs, 579 came from review completion; reviews now wake a fold only when it paused at eight unreviewed, and every completed step still queues its current key. Next largest: the Python normalize (160 ms of 297); a scratch vectorised transform gave 36 percent with identical output, a services/ change for later with its own image rehearsal.**

### S1.3ac The Studio proxy reuses its API connections

Size S, UI tooling. After: S1.3 run 7. **Status: merged 27 Oct (int3-pre 40756027, branch 45e78df5). One keep-alive agent (16 sockets) for the Vite dev and preview proxy: 48 parallel requests open 16 upstream connections instead of 48; an event stream and an upload pass while held. At the run 7 failures the PC had up to 2,203 client sockets in TIME_WAIT. Words: 1 package prepared, 1 record read.**

### S1.3ae The Halifax raw read survives a connection reset without starting over

Size M, code. After: S1.3 run 8. **Status: merged 27 Oct into int3-pre 76eed374 (worker 10302807, lead guard 3cc52aeb). A GeoJSON raw read cut by a connection error reopens by Range from the byte after the last sealed part, at most 3 times per attempt, with the ETag pinned (a changed object or 412 refuses); parts and hashes byte-identical at four cut offsets; 41 streaming tests pass. The reset's sender is not named: the object store's log and the worker log were empty for 21:47 to 21:51 UTC and run 8 traced no store socket; a loopback stub showed a server idle write timeout during a backpressure pause gives exactly this ECONNRESET. Run 9 records the store connection.**

### S1.3af Queued table drafts that never dispatch

Size S, code. After: S1.3 run 9. **Status: merged 27 Oct into int3-pre 71184b95 (worker 66833141, lead fix 1543b156: capacity waits do not count). Selection was not the cause: prepareIntakeTable caught every STALE_REVISION before claim and waited 2 s forever, so a draft stayed queued with no words. Now a saved raw read with an old reader pin or reading is read again with current pins; superseded work ends only its own job with TABLE_DRAFT_SUPERSEDED; a revision refusal retries at most 3 times, then ends with TABLE_ADMISSION_STALE_REVISION_EXHAUSTED; a capacity wait still waits until a slot frees (the worker had bounded it too, which would have failed tables under load; the lead reverted that). Which cause held run 9's four jobs: run 10 records what they do once reh-03 starts.**

### S1.3ah Cut the eight-unreviewed pause wait, stop stale cuts, keep fenced causes

PLAN step 1. Task file E:/Projects/ulpin-wt/_tasks/s1-3ah.md; branch task/s1-3ah-pressure-wait at int3-pre 71184b95. From run 10: split the 3.8 s pause wait, fix its largest part with the cap of eight unreviewed unchanged, keep one fold per item at a time, store a cause on every fenced intake-large attempt, and replay a Halifax-shaped fold on PGlite before and after. **Status: merged 27 Oct (int3-pre f9a3a5c3; lead removed the in-place pressure wait, b87c0894). Kept: one fold per file at a time (claim refuses while another step of the file holds a live attempt; the second wake retries in 2 s), and every fenced step stores a cause (AppError code and words; processor detail withheld). Found: each package's review (intake-run, prepare) ran one at a time, median 1.56 s, queued 8.6 s, so reviews cap Halifax near 40 a minute; the worker's 2 s in-place wait gave 42.32 to 42.35 a minute on a replay with 24,058 extra reads, so it was dropped.**

### S1.3ai Make Halifax package reviews keep pace with the cuts

PLAN step 1. Task file E:/Projects/ulpin-wt/_tasks/s1-3ai.md; branch task/s1-3ai-review-pace at int3-pre f9a3a5c3. Why only one review ran at a time in a lane of two, the review's largest stage, one bounded fix, and a replay aiming at 100 packages a minute. **Status: merged 27 Oct (int3-pre 5f638148). Cause: two operation-wide gates (processing.ts intakeRunWorker and dispatch-lanes.ts unavailableOperations) let only one intake-run run in the whole service. Package reviews (phase prepare) now run by id up to the link lane's two; ordered work keeps its serial chain and goes first. Each review logs intake_run_prepare stage times. PGlite replay 42.3 to 79.3 packages a minute (target 100 not met there); the review itself (reviewPackage) is the largest stage. Run 11 measures it live.**

### S1.3aj Time the package review on the runtime and shorten what holds the area

PLAN step 1. Task file E:/Projects/ulpin-wt/_tasks/s1-3aj.md; branch task/s1-3aj-review-area at int3-pre 5f638148; owns reh-03. Stage timing inside reviewPackage, 10 minutes of the pending Halifax on reh-03, then one bounded change to what reviews and cuts wait on (lock order kept), measured before and after. **Status: merged 27 Oct (int3-pre 7503a24c, pins e240fa8f; evidence docs/evidence/step-1/s1-3aj). Under the area lock a review no longer reads its context again when no qualified feature exists anywhere (the fingerprint compares the same inputs): the locked read fell from 1,480 to 4 ms, the cut's destination wait from 917 to 2 ms, and Halifax reached 48 packages a minute on reh-03 (later cuts were smaller, so not a matched comparison). Still about half the 100 needed: the review's first context read takes 1.5 s: S1.3al.**

### S1.3al Make the review's context read fast

PLAN step 1. Task file E:/Projects/ulpin-wt/_tasks/s1-3al.md; branch task/s1-3al-context-read at int3-pre e240fa8f; owns reh-03. EXPLAIN the two context queries for three Halifax packages on reh-03, name the plan node that visits the area's 670,000 features, change the queries (or add one missing index) so the same rows and counts come back from the extent first, and measure packages a minute before and after. **Status: merged 27 Oct (int3-pre fd9fcb0e, pins f59fb694; evidence docs/evidence/step-1/s1-3al). The context read visited every draft of the area; drafts never enter a review's context, so two partial GiST indexes on recorded features (revision above 0) and one scan for the rows and both counts replace it: about 1.2 s to about 1 ms on three Halifax packages, same rows and counts (a test). The indexes are a new area migration file, applied by the migration command (not by platform:start; S1.3q). Throughput not measured: the pending Halifax preparation failed three attempts with STALE_REVISION, A sealed part of this file is unavailable: S1.3am.**

### S1.3am Why a sealed part of the Halifax file is unavailable

PLAN step 1. Task file E:/Projects/ulpin-wt/_tasks/s1-3am.md; branch task/s1-3am-sealed-part at int3-pre f59fb694; owns reh-03. Find which of the conditions in pairedChunk (intake-large-worker.ts) failed for which chunk and why, make the failure name its chunk and condition, fix the cause with a failing-first test, then run the 10-minute Halifax window with the S1.3al indexes applied and give packages a minute before and after. **Status: merged 27 Oct (int3-pre 7e676217; evidence docs/evidence/step-1/s1-3am). Cause: every streaming import pins the digest of the reader code; S1.3ak changed streaming-vector-reader.ts (the raw-open retry), so once reh-03 moved to newer code all 1,725 sealed Halifax chunks read as not current (reader_changed, first at chunk 1553); bytes intact. The conflict now names the chunk, each failing condition and the reasons, and a code-pin change stops the item after one attempt instead of three. Try again still cannot recover such an item (the streamed profile rejects the changed pin), and any file mid-intake during a code move would stick the same way: S1.3an.**

### S1.3an After the reader or converter code changes, Try again reads the file again

PLAN step 1. Task file E:/Projects/ulpin-wt/_tasks/s1-3an.md; branch task/s1-3an-reread-after-code-change at int3-pre 7e676217; owns reh-03. Every pin stays strict: Try again on an item stopped for reader_changed or converter_changed starts a new read of the retained original with the current code, the old jobs kept as history; the approved layout applies only if the new profile hashes match. Then on reh-03 Try again on Halifax, and the 10-minute window beside S1.3aj (48 a minute). **Status: merged 27 Oct (int3-pre cf35f4f8, pins; branch 75b879ff). Try again on an item stopped while its stored reader or mapping jobs carry an older reader or converter digest starts a new read generation of the retained original with the current code; old jobs, parts and drafts stay as history; every pin stays strict. An approved layout applies to the new read only when its raw and profile jobs and exact profile hash match; Halifax's profile hash changed, so the stored answer was given again through the product route. Halifax on reh-03 read again and made packages: 23.0 a minute in the window (S1.3aj 48), not a matched comparison: CPU median 96.5 percent with five workers and the lead's full test runs on this PC. A quiet matched window is next (S1.3ao); reh-03 stopped; demo 4ffd801a unchanged.**

### S1.3ak Retry a connect timeout before the first byte; causes on intake-evidence and point-batch fences

PLAN step 1. Task file E:/Projects/ulpin-wt/_tasks/s1-3ak.md; branch task/s1-3ak-connect-causes at int3-pre 5f638148; PGlite only. **Status: merged 27 Oct (int3-pre 9839a0f1). A connection error before the first byte (ECONNRESET, ETIMEDOUT, ECONNREFUSED and kin) reopens within the attempt at most 3 times after 1, 2 and 4 s, ETag kept; later cuts keep the S1.3ae resume. Intake-evidence and point-batch fences store a cause. The run 11 timeout was a native TCP connect timeout; its deeper network cause is not proven.**

### S1.3ao The area normalize transforms coordinates in arrays, with byte-identical output

PLAN step 1. Task file E:/Projects/ulpin-wt/_tasks/s1-3ao.md (resumes r1, r2); branch task/s1-3ao-vector-transform. From S1.3ad: normalize_area is the largest cut stage; pass whole coordinate arrays to pyproj and Shapely instead of a Python callback per coordinate; every output digest equal before and after on the first 266 and 2,000 features of the retained NYC export. A services/ change: the processor image carries it at the next image rehearsal. **Status: merged 28 Oct (int3-pre dee55fc8). Output identical: 40 of 40 normalized digests equal on the first 266 and 2,000 features of the retained NYC export; medians 4,549 to 2,146 ms at 2,000 and 153 to 229 ms at 266 on a loaded PC (wide spread, not a matched comparison; S1.3ad's quieter trial gave 36 percent). Reaches a runtime with IMG7.**

### S1.3ag Where a Halifax package cut spends 2.1 s on the runtime

Size M, code and runtime (reh-03). After: S1.3 run 9b. **Status: merged 27 Oct into int3-pre dcd78b8d (worker 06942d37). On reh-03 the destination lookup took 1,586 ms of each cut: it counted every feature of every area (getArea) to read one area's frame. It now reads the one map_areas row (0.55 ms); a missing area still refuses. Halifax preparation on reh-03: 31.3 to 62.7 packages a minute over two 10-minute windows; each cut logs one intake_large_cut line with its stage times (no source values). Remaining cut p90 1.0 s including chunk reads. The end within 30 minutes is for run 10 to prove.**

### S1.3a Under load, busy readers wait their turn and a long upload survives sibling arrivals

Size M, code only. After: S1.3. **Status: done 25 Oct (merged into task/int3-pre at 5ec9f884, pins 7861c386). Busy readers (429) and sibling revision races (STALE_REVISION) wait without spending attempts, up to 30 minutes; uploads tolerate a case revision that moved on. Server set 921 pass, 4 skipped. Live proof is S1.3 run 2.**

- **What:** S1.3 faults 1 and 2. A 429 capacity refusal (STREAMING_CAPACITY, STREAMED_PROFILE_CAPACITY, MAPPING_CAPACITY) from the intake-large worker's reader, profiler or mapper enqueue makes the job wait about 2 s without spending an attempt, as the table path does, bounded at 30 minutes. A large upload that appends a new original tolerates sibling arrivals moving the case revision, with the S1.2a rule. It also lists every other strict case-revision check an automatic job reaches under load, for a later task.
- **Files:** intake-large-worker.ts, large-original.ts and their tests; docs/evidence/step-1/s1-3a/result.json

### S1.4 Lead: merge task/int3-pre into staging and regenerate pins

Size S, code only. After: S1.1, S1.3 (verdict), S3.1, S3.2. **Status: done 27 Oct. int3-pre 861249a1 merged into staging (52fc7910, no conflicts: staging-only commits touched docs); every check passed on the merge (both typechecks, API check, Studio tests, server set 1,145 pass, 0 fail). Old main kept on studio-demo (14fc0b9c). The owner merged PR 17 (main e96f56a7, staging as at 7a10b9c0); PR 18 brings the 637 integrated commits to main and is the owner's to merge.**

- **What:** Lead-only integration, done when S1.1 is green and S1.2/S1.3 give no reason to fall back to staging. The step 0 paperwork is already on staging and was merged into task/int3-pre on 23 October. Merge task/int3-pre (with the S1.1, S3.1 and S3.2 commits) into staging, then regenerate docs/api/source-pins.json, openapi and the api-client types (WORKING-RULES section 4). Point the comment at packages/server/src/modules/cases/dispatch-lanes.ts:5 to docs/design/INGESTION-ARCHITECTURE.md in the same merge, since the pins are regenerated anyway. Push staging. From then on tasks are cut from staging. Fallback if the rehearsal fails: stay on staging and fix only the failing item on int3.
- **Files:** E:/Projects/3d-ulpin (staging); scripts/api/check.py:130-138 (docs/api/*.md link check); scripts/api/refresh-contract.ts; docs/api/source-pins.json; packages/server/src/modules/cases/dispatch-lanes.ts:5
- **Check:** On staging after the merge, python scripts/api/check.py, openapi.ts --check and pnpm typecheck:backend exit 0. git log shows int3 0aecb4f8 as an ancestor of staging. Every new commit's author and message pass the no-attribution grep.
- **Tests:** python scripts/api/check.py; pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/scripts/openapi.ts --check; pnpm typecheck:backend; pnpm studio:typecheck


## Step 2: The judge kits

Reuse the real public files already on the data drive; acquire only what is missing (a large aerial photo and height map, a laser scan over 300 MB, a vector file near 1 GB, real CityJSON, CityGML, DXF and DOCX). The closed kit lives outside Git under `E:/BhuAayam-data/holdout/judge-kit-closed/`; only its manifest hash is committed.

### S2.1 Practice kit part 1: pick about 8 real public files already on the data drive

Size S, this PC: data drive. After: none (step 0 is done). **Status: done 24 Oct (merged on int3-pre; 8 files, 4 families, hashes match; gaps: NYC and Baton Rouge have no sibling receipt, and a native-text DQ1 PDF stands in for the RERA scan, so no scanned plan yet).**

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

Size M, this PC: data drive. After: S2.1. **Status: done 24 Oct (merged on int3-pre: Indian COG 402 MB, USGS DEM 346 MB, 2.2M-feature NDJSON 800 MB, Berlin LOD2 CityGML, DXF, DOCX, 59 MB scanned PDF; gaps: no LAZ above 300 MB (USGS HTTP 429), no CityJSON or OBJ, no surveyed DXF floor plan).**

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

Size M, this PC: data drive. After: none for the fetch; catalogue entry after S2.2 merged. **Status: done 25 Oct (merged on task/int3-pre): 12 sealed files, 4 families, 1.24 GB; largest 735 MB.**

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

Size S, code only. After: none (parallel with S1.1, S3.1; disjoint files). **Status: done on task/int3-pre (24 Oct).**

- **What:** dispatchMemoryBudgetMiB defaults to half of RAM, 16,231 MiB here (dispatch-lanes.ts:141-143). Every in-process worker shares one Node heap with heap_size_limit 4,288 MiB, and REH16 saw the dispatcher at 3,018 MB. Keep the machine budget for jobs the processor container runs. Add a second budget for in-process holds (rows without processor:true): v8 heap_size_limit less a stated reserve. Admit an in-process job only when both budgets fit. Never raise a lane cap.
- **Files:** packages/server/src/modules/cases/dispatch-lanes.ts:104-143 (dispatchInProcessOperations, dispatchCost, dispatchMemoryBudgetMiB), 168-225 (fits, DispatchReservations.admit); packages/server/src/modules/cases/processing.ts:366-369 (budget call)
- **Check:** New test in dispatch-scratch.test.ts (or a new dispatch-lanes test). With a 4,288 MiB heap stub and no stated budget, in-process holds stop at 4,288 minus the reserve, while a processor-run job (inspect, build) still fits under the machine budget. The existing processing-latency replay still shows LQ1's member dispatch result.
- **Tests:** pnpm exec tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/cases/dispatch-scratch.test.ts packages/server/src/modules/cases/processing.test.ts packages/server/src/modules/cases/processing-latency.test.ts; pnpm typecheck:backend

### S3.3 Kit-drop runner under scripts/rehearsal, served from a production Studio build

Size M, this PC: runtime. After: S3.1 (exit and pool fields); runtime check after S1.3 frees reh-03. **Status: code part merged 25 Oct (int3-pre, scripts/rehearsal; dry run and 10 tests pass); the live run needs a green Studio build, which waits on S5.7b, and runs alone**

- **What:** Move REH16's rehearsal scripts out of docs/evidence: presenter with frame recorder, read-only job timing, intake watch, process watch. Put them in scripts/rehearsal/ as one runner parameterised by --runtime ulpin-reh-NN, --kit <manifest> and --out. Serve the Studio from pnpm studio:build plus vite preview on 5189 (vite.config.ts:37 has the proxy) so frame times match the finale, not the dev server. Launch Chromium on the PC GPU (ANGLE D3D11, headed if headless cannot) and write the WebGL renderer string into result.json; a SwiftShader renderer marks the frame numbers as not a smoothness verdict (S1.2c, 25 Oct: SwiftShader 164 slow frames, RTX 3070 D3D11 3, all at startup). The runner drops every kit file in one Add files action. It records per file: retain, layout shown, first and last part on the map, card or limit words. It also records frames per page (max, over 100 ms, longest task), queue/exec/retry per job, S3.1 exit lines and pool numbers. Output is one compact result.json.
- **Files:** Source: k3 task/reh16-rehearsal 8f7314b2 docs/evidence/runtime/reh16/{dress.mjs,jobs.mjs,watch.mjs,api-watch.ps1,launch.ps1}. Write: scripts/rehearsal/*. Read: apps/studio/vite.config.ts:7-37.
- **Check:** node scripts/rehearsal/kit-drop.mjs --runtime ulpin-reh-03 --kit <two-file mini manifest: NYC buildings-original.geojson + Tweed gpkg> writes result.json with both files' moments, a frames block for the batch and map pages, and jobs and process blocks.
- **Tests:** node --check on each script; one node --test for the manifest reader and result shape

### S3.4 Large batch files: ask the layout from the first profile part, map while the reader continues

Size L, code only. After: S1.4 (cut from merged staging), or from int3-pre if the merge is late. **Status: done 25 Oct (merged into task/int3-pre, contract and pins e9728a87; server set 940 pass, 4 skipped). A large GeoJSON asks its layout from the first published profile part (IntakeItem.layoutProfile says provisional or sealed), maps under the prefix approval while reading, and at closure drafts with no second question only if every used path still matches and no used path was held; otherwise it asks again over the complete file. Whole-file and duplicate-key drafting guards unchanged. Studio answer: S3.6.**

- **What:** The batch path waits for the whole file to be read and the profile sealed before asking the layout (intake-large.ts:133-135). That is up to 80 min for 1 GiB (streaming-vector.ts:11-17), so first features in 60 s is impossible. Reuse the existing prefix route; no new format.
1. Confirm with a test what prefix admission does with chunks after the observed prefix.
2. Return question once the first provisional generation is published.
3. Start mapping with prefixAdmissionVersion after a prefix approval.
4. When the profile seals, compare it to the approved prefix plan. If a path the layout uses changed type or completeness, stop with plain words and ask again. Never carry an approval across.
- **Files:** packages/server/src/modules/usp/ingestion/intake-large.ts:126-160,421-432; intake-large-worker.ts:360-375 (startMapping); streamed-mapping.ts:36-80,121-210; chunk-mapping.ts:70-110,130-145,240-270; streamed-profile-worker.ts:100-130; apps/api/src/modules/ingestion/streamed-profile.controller.ts:70-96
- **Check:** New intake-large test with a 5-chunk GeoJSON fixture: the item reaches needs_answer after chunk 1 while the reader is still running. After a prefix approval, chunk-mapping publishes part 1 before the reader seals. A sealed profile whose key path loses completeness stops with words and re-asks.
- **Tests:** pnpm exec tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/usp/ingestion/intake-large.test.ts intake-large-steps.test.ts streamed-layout.test.ts streamed-mapping-basis.test.ts layout-approval.test.ts streaming-vector-worker.test.ts tests/intake-api.test.ts tests/intake-zip-layers.test.ts; pnpm typecheck:backend; openapi.ts --check

### S3.5 Large batch files: drafts follow mapped parts so the first part reaches the map early

Size M, code only. After: S3.4 (same files; sequential). **Status: done 25 Oct (merged into task/int3-pre; display-only preview of the outlines read so far; S3.5d draws it on both area maps as a dashed edge, int3-pre 62df84dc)**

- **What:** Drafting starts only in the draft phase, after every chunk is mapped (intake-large.ts:136-141; intake-large-worker.ts:370-372). REH15 measured approve-to-first-map at 310 s. Let the draft step consume each mapped part as it is published, under the existing INTAKE_UNFINISHED_PACKAGE_LIMIT. partsDone and partsPlanned stay truthful while mapping continues, and the end projection still waits for the sealed mapping.
- **Lead note (25 Oct, from S3.4 run 1):** drafting today needs whole-file closure: assertClosedMappingTx (intake-part-draft.ts:26-50) wants closed raw and mapped jobs with matching counts, and a key duplicated anywhere keeps both copies out of a package; loadPartFeatures and prepareProvedAreaPartTx (proved-area-part.ts:100-140) want the closed original and its sealed receipt. The rule for parts drafted before the seal: they are drawn on the map as provisional and cannot be confirmed until the mapping closes; at the close, a package holding a key that a later chunk duplicated is withdrawn with plain words and its other features are cut again. Add intake-part-draft.ts and proved-area-part.ts to the files.
- **Files:** packages/server/src/modules/usp/ingestion/intake-large.ts:130-160 (intakeLargePhase, intakeLargeNumbers); intake-large-worker.ts:230-300,360-375 (draft, writeEndTx)
- **Check:** intake-large test: with mapping at part 1 of 5, one package is drafted and the item shows partsDone 1. Final counts after all 5 equal the sealed reader's.
- **Tests:** pnpm exec tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/usp/ingestion/intake-large.test.ts intake-large-steps.test.ts intake-large-geometry.test.ts tests/intake-api.test.ts; pnpm typecheck:backend

### S3.6 Studio: answer a prefix layout question, with words that say it covers the first part

Size M, code only. After: S3.4 (question shape). **Status: done 25 Oct (merged into task/int3-pre at 7d85438a; no pins changed; Studio intake tests 311 pass). A first-part question reads the pinned provisional generation (number and hash must match), authors and approves on the prefix-recipes routes, and says the layout is taken from the first N features read; a re-ask shows the item's changed-field words. Gap: the server's re-ask words do not name the changed field.**

- **What:** StreamedLayoutAnswer posts only to sealed recipes (streamed-queries.ts:21). When the item's question names a provisional profile, author and approve through the prefix-recipes routes. Words: the layout is taken from the first N features read; the rest is checked as it arrives. On a re-ask after the profile seals, show what changed.
- **Files:** apps/studio/src/features/intake/StreamedLayoutAnswer.tsx; streamed-queries.ts; streamed-question-model.ts; question-model.ts; layout-command.ts
- **Check:** StreamedLayoutAnswer.test.tsx: a provisional question posts to .../prefix-recipes then .../approve and shows the prefix words. A re-ask shows the changed path.
- **Tests:** pnpm --filter @ulpin/studio exec vitest run src/features/intake/StreamedLayoutAnswer.test.tsx src/features/intake/question-model.test.ts src/features/intake/layout-command.test.ts src/features/intake/batch-page.test.tsx; pnpm studio:typecheck; pnpm studio:api-types; ui-design-check report

### S3.7 Vector-lane readers start up to the lane cap, not one per process

Size M, code only. After: S3.2 (same file dispatch-lanes.ts); dispatch only if S1.3 still shows vector-lane queue time above execution time. **Status: done 25 Oct, merged into task/int3-pre (pins 3b83c535). Streaming-vector, streamed-profile, chunk-mapping and intake-large start one per job up to the lane cap and heap budget; offline 12-file replay: two vector starts in one tick, summed first dispatch 165,302 to 155,172 ms; PostgreSQL controls 46 pass. The live effect is measured in S1.3 run 2**

- **What:** streaming-vector, streamed-profile, chunk-mapping and intake-large each have one module slot (processing.ts:46-50, 391, 475, 489, 547), although the vector lane allows 2 (dispatch-lanes.ts:27). unavailableOperations blocks a second start of a held operation (dispatch-lanes.ts:235-240). REH15 under load: queue 1,559.5 s against 15.1 s of execution. Replace those four singletons with per-operation sets bounded by the lane concurrency and the S3.2 heap budget. Fencing and attempts are unchanged.
- **Files:** packages/server/src/modules/cases/processing.ts:45-50,385-395,475-500,545-552; packages/server/src/modules/cases/dispatch-lanes.ts:232-241
- **Check:** processing-latency.test.ts replay with a 12-file job mix: two streaming-vector jobs start in one tick, and the total time to every file's first dispatch drops against the current replay. A memory refusal still blocks the second.
- **Tests:** pnpm exec tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/cases/processing.test.ts packages/server/src/modules/cases/processing-latency.test.ts packages/server/src/modules/cases/dispatch-scratch.test.ts; PostgreSQL controls as in S1.1

### S3.8 Practice-kit drop 1 on a fresh runtime: measure and list what fails

Size M, this PC: Docker. After: S1.4, S2.1, S2.2, S3.1, S3.2, S3.3. **Status: done 27 Oct, merged into task/int3-pre 9be57f90 (evidence docs/evidence/step-3/s3-8/). All 17 files kept (hashes matched); 16 show their words; none reached the map, because the two GeoJSON layout questions stayed unanswered and with no layout answered the batch has no map area, so rasters, the point cloud and tables wait at part 1. API health 1,080 of 1,080 samples; pool waiting never above 0; no 503. Batch page: 3,499 of 312,414 frames over 100 ms, worst 1,084 ms, longest task 111 ms. Failed jobs: the BCA XLSX streaming-vector and chunk-mapping; CityGML citygml-native on the ZIP member (180 s) and the .gml (21 s). The 800 MB NDJSON was kept but no job ran for it. The .gz says its bytes are not a recognised kind (no gzip reader). Runner gaps go to S3.12, frames to S3.9, reader failures to S3.13. ulpin-reh-04 stopped, volumes kept.**

- **What:** Create ulpin-reh-04 empty with S1.2's procedure, at staging after S1.4 plus S3.1 and S3.2. Drop the whole practice kit at once with the S3.3 runner on a quiet PC. This is a measurement run: produce the failure list against the plan's done line (API never exits; first features within 60 s; no frame over 100 ms) and the kept-not-drawn list caused by the 16 to 32 MiB reader ceilings. Stop reh-04 at the end.
- **Files:** scripts/rehearsal/kit-drop.mjs (S3.3); docs/evidence/step2/s2-1 and s2-2 manifests; docs/backend/DEMO-RUNTIME.md:296-311. Write: docs/evidence/step3/s3-8/result.json.
- **Check:** result.json gives every practice file a verdict (drawn, kept with words, or failed) and seconds to first features. Exit files and pool peaks are recorded, plus frames over 100 ms per page. Demo doctor unchanged.
- **Tests:** pnpm platform:doctor --profile demo --runtime ulpin-reh-04

### S3.9 Fix the long frames the practice-kit drop records

Size M, this PC: runtime. After: S3.8. **Status: measured 27 Oct, no Studio change (int3-pre 85bcd063; evidence docs/evidence/step-3/s3-9). The settled S3.8 batch page drew 0 frames over 100 ms in 4 windows of 12 captures (max 44 ms), with and without the runner reading every row, so the S3.8 slow frames came during the drop itself (uploads, live changes, CPU up to 100 %). S3.12 now captures frames every 10 s, so S3.11 can name them. Diagnosis E:/ulpin-tmp/s3-9/diagnosis.json: XLSX jobs TABULAR_ROW_LIMIT; CityGML .xml member CITYGML_INTERRUPTED at its 180 s lease; .gml CITYGML_OUTPUT_LIMIT (known stop); the NDJSON item probed and undecided with nameDisagrees, no job. ulpin-reh-04 stopped.**

- **What:** Take the worst long tasks from S3.8's frame log, measured on the production build, and remove them by spreading work across frames or moving it to the existing workers (surface.worker.ts, imagery.worker.ts). Known suspects:
- REH13 put 7 of 10 long frames 16.5 to 18.9 s after map open, right after the first surface part and raster window
- batch page up to 850 ms in REH13
- scene budgets of 4 ms (engine.ts:83-84) Method (merged from S3.9): record one browser performance trace each of a map open (the 1,661 NYC footprints) and a batch reload, name the function behind each long task before changing code, fix the top one, measure again. REH15 showed 500 ms 0.7 s after map start and 367 ms at a batch reload. S7.6 (lighter map polling) goes first.
- **Files:** apps/studio/src/features/map/surface/useSurfaceLayer.ts, api.ts, surface.worker.ts; packages/scene/src/engine.ts:83-84,600-620; apps/studio/src/features/intake/IntakeTray.tsx, BatchPage.tsx; apps/studio/src/features/map/WindowedArea.tsx
- **Check:** Re-running the S3.3 runner on the same kit shows 0 frames over 100 ms on the batch and map pages.
- **Tests:** pnpm --filter @ulpin/studio exec vitest run src/features/map/map-frames.test.tsx src/features/map/surface/useSurfaceLayer.test.tsx src/features/map/surface/parts.test.ts src/features/intake/IntakeTray.test.tsx src/features/intake/batch-page.test.tsx; pnpm --filter @ulpin/scene test (incremental.test.ts, base-incremental.test.ts); pnpm studio:typecheck; ui-design-check report

### S3.10 API connection pool: no 503 while the whole kit drops

Size M, this PC: runtime. After: S3.1, S3.8. **Status: not needed by S3.8 (pool waiting 0 in all 1,080 samples, no 503); re-check in S3.11.**

- **What:** Only if S3.8's pool numbers show waiting above 0 for more than 5 s, or any 503. The API pool is max 8 with a 5 s connect timeout (db.ts:25-29), which matches REH15's 503 after about 5 s. Use S3.1's waiting counts and S3.8's request log to find which routes hold connections longest under the drop (uploads, the batch manifest read, event pages: events.ts:120-175). Shorten those holds, or keep long reads off the shared pool. Raising the pool size alone is not the fix.
- **Files:** packages/server/src/infrastructure/db.ts:22-60; packages/server/src/modules/usp/ingestion/events.ts:120-175; the upload and manifest routes named by S3.8
- **Check:** Re-run of the S3.3 runner on the practice kit: zero 503 responses and pool waiting stays under 5 s in every sample.
- **Tests:** tests/intake-api.test.ts; tests/intake-storage.test.ts; pnpm typecheck:backend

### S3.12 Kit-drop runner: every row, a frame timeline, queue depth, proof of no exit

Size M, code only. After: S3.8. **Status: merged 27 Oct (int3-pre ae6772f6, branch d965e2f4 with a lead fix counting only queued and running jobs; 21 rehearsal and process tests pass). The S3.1 hook file scripts/platform/exit-record.cjs now writes a start line, so exitHook present with no exit line after the drop proves no exit.**

- **What:** Match tray rows by exact name (the NDJSON matched its .gz sibling and got no words); observe ZIP-derived items; 10 s frame captures; 10 s read-only job queue counts; a start line from the S3.1 exit hooks so an absent exit line proves no exit.
- **Files:** scripts/rehearsal/*; apps/api/src/main.ts and scripts/dispatcher.ts (start line only); scripts/platform/processes.test.mjs
- **Check:** rehearsal and processes tests for each gap; dry run on a two-file kit.

### S3.13 Reader failures from the practice-kit drop

Size M, code only. After: S3.8, S3.9 step 2 (diagnosis export). **Status: done 27 Oct as two tasks. S3.13a merged (int3-pre 34e5ff97, branch 2ac08c6b, pins refreshed; server 1,176 pass, 0 fail): the BCA XLSX has 825 rows but 10,366 cells, past the 2,000-cell whole-file reader, so case-original XLSX now takes the bounded window reader as ODS did; newline GeoJSON (ndjson bytes, Feature lines) named .geojsonl, .geojsons, .ndjson or .jsonl no longer disagrees, and intake-large accepts it (it required format geojson, so no job ever started); gzip is recognised and kept with the words Compressed (gzip): kept, not read. S3.13b merged 27 Oct (int3-pre, branch 189d8eab, pins refreshed; server 1,166 pass, 0 fail): the .xml member and the .gml are byte-identical; a CityGML stop was recorded with a 2 s default deadline, so under case-lock contention the known OUTPUT_LIMIT stop was lost and the job aged out as INTERRUPTED, which queues no outline read. Terminal bookkeeping now has the remaining 150 s total, with 15 s reserved inside it.**

- **What:** The BCA XLSX streaming-vector and chunk-mapping jobs failed; citygml-native failed on the Berlin LoD2 ZIP member (180 s) and the .gml (21 s) while its words were written; the 800 MB NDJSON was kept with no job; a gzip file is described as not a recognised kind.
- **Files:** named from the diagnosis.

### S3.14 The kit-drop runner answers listed layout questions as the rehearsal officer

Size S, code only. After: S3.12. **Status: merged 27 Oct (int3-pre fd416ab6, branch 729c9535 with a lead fix: a timed-out answer whose form was not ready is tried again up to five times, never after Use this layout was pressed). 25 rehearsal and process tests pass.**

- **What:** Owner, 27 Oct: the runner may answer GeoJSON layout questions as the officer in a rehearsal runtime, from answers the lead writes from each file's own field names, recorded as rehearsal officer answers. --answers reads rehearsal-officer-answers/1 (test_only, ulpin-reh-NN only); the runner sets kind and identifier through the Studio form, presses Use this layout and Approve layout, and records officer seconds apart from first-feature time. Answers: Niagara building by OBJECTID, Halifax building by BL_ID, no name field. The Microsoft NDJSON has only height and confidence, so it has no identifier and stays unanswered.
- **Files:** scripts/rehearsal/*; docs/evidence/step-3/s3-14/rehearsal-officer-answers.json

### S3.15 Adding large files keeps every frame under 100 ms

Size M, code only (browser with a mocked API). After: S3.9. **Status: done 28 Oct, evidence only (int3-pre). Mocked 1.4 GiB drop: upload-path work under 14 ms a frame; 95 percent of captures had no frame over 100 ms; the frames over 250 ms ran no page script (browser, GPU or shared-PC load). No code change.**

- **What:** S3.9 found the settled batch page clean, so S3.8's 3,499 slow frames came from the drop itself. Drop synthetic 800, 300 and small files into a production Studio build with page.route answering the API, trace the longest frames, fix the top causes in the upload, hash and progress path.

### S3.16 The kit-drop runner survives a slow or failed API poll and records it

Size S, code only. After: S3.11b. Task file E:/Projects/ulpin-wt/_tasks/s3-16.md; branch task/s3-16-runner-polls. A failed or slow intake or targets poll is recorded (at, path, ms, error) and the pass skipped, with a 15 s poll timeout; an error in one file's observation is recorded on that file and the loop goes on. **Status: merged 28 Oct (int3-pre). Polls recorded in result.process.polls (15 s timeout); per-file errors in file.watchErrors; 21 rehearsal tests pass.**


### S3.16b The exit-record hook test matches the hook that writes a start and an exit record

Size S, code only. After: IMG7 found it. Task file E:/Projects/ulpin-wt/_tasks/s3-16b.md; branch task/s3-16b-exit-record-test. d965e2f4 made scripts/platform/exit-record.cjs write a start line before its exit line; exit-record.test.mjs still expects one record and fails 7 of 8. Only the test changes. **Status: merged 28 Oct (int3-pre; platform suite 131 pass, 0 fail, 2 skipped).**

### S3.11d Find why 10 of 17 practice files never entered the drop 2 batch, and why Halifax BL_ID was refused

Size S, this PC: runtime (ulpin-reh-06, read only). After: S3.11c. Task file E:/Projects/ulpin-wt/_tasks/s3-11d.md; branch task/s3-11d-drop-diagnosis. A stop point with evidence for each missing file, the Halifax rule with its file and line, and the smallest fix for each; no code change. **Status: done 28 Oct (evidence merged into int3-pre). All 10 files were never uploaded: View layout during retention changed the search, the upload blocker turned it into a document reload (BatchUploadProgress.tsx useUploadNavigation) and the queue in the old page was lost; the runner took the hidden heading for finished. Halifax BL_ID is null in 26,493 of 172,409 features and repeats in 4,156 groups; the Studio offered it because it checks type only. Fixes: S7.29, S4.14, S3.16c.**

### S3.16c The kit-drop runner says uploads finished only when every file is a batch item, and can answer Position in the file

Size S, code only. After: S3.11d. Task file E:/Projects/ulpin-wt/_tasks/s3-16c.md; branch task/s3-16c-runner-enrolment. Uploads finished needs every kit file listed as an item; a reload during retention is recorded; an answer may pick Position in the file, and the Halifax rehearsal answer does. **Status: merged 28 Oct (int3-pre 45e8de5f; rehearsal tests 26 pass). Lead fix: a file enrolled after the 180 s window is still seen and watched.**

### S3.16d The rehearsal runner sees a package drawn on the map, and names the cause of every slow frame

Size S, code only. After: S3.11e. Task file E:/Projects/ulpin-wt/_tasks/s3-16d.md; branch task/s3-16d-map-moment. The map moment waits for a drawn-package signal instead of the removed words features · unrecorded proposals; every frame over 100 ms is recorded with its long-animation-frame scripts, or not_script, and matched to runner activity. **Status: round 1 done 28 Oct (538882e0, rehearsal tests 32 pass): the runner half. Round 2 (s3-16d-r1.md) puts data-drawn-packages on the map canvas when the open package has drawn. Merged 28 Oct (int3-pre cc32dc14; rehearsal 32 pass, map tests 160 pass, UI scan clean).**

### S3.16e The rehearsal runner never blocks its own clock, so a slow read it reports is the server's

Size S, code only. After: S5.31. Task file E:/Projects/ulpin-wt/_tasks/s3-16e.md; branch task/s3-16e-async-sampling. The runner's read-only job queries ran through spawnSync with a 30 s timeout, freezing its fetch timers and health sampler; both 30 s readings of drop 2 run 3 sit at that limit. Queries become asynchronous and runner event-loop delay is recorded, with each sample marked runnerBlocked when it overlaps one. **Status: merged 28 Oct (int3-pre 0f8daf12; rehearsal tests 40 pass).** 

### S3.16f The last-part map moment is captured, and the not-script slow frames are tied to what the PC was doing

Size S, code only. After: S3.11f. Task file E:/Projects/ulpin-wt/_tasks/s3-16f.md; branch task/s3-16f-last-part. Find whether Studio draws the last package of a 21-package area within 15 s and draw the package named in the URL first; tie each over-100 ms frame to the nearest CPU sample and flag frames that stall both pages at once. **Status: merged 28 Oct (int3-pre 07088b47). The windowed view (over 15,000 buildings) never set data-drawn-packages and read only the first 15,000 identifiers, so the last of 21 packages was never drawn; it now reads from the named package's first identifier, wraps once, and sets the attribute from drawn buildings. 44 of the 50 slow frames stalled both pages at once, every 5 minutes at hh:m1:30 and hh:m6:30, at CPU 4 to 69 % and not at the 83 % peak: a fixed timer, not load. The runner now samples CPU and the top five processes every 5 s and marks browser_wide frames. Studio map 162 pass, rehearsal 43 pass.**

### S5.31 The batch targets read answers in under 2 s on a drop-sized case, and health in under 1 s, while jobs run

Size M, code only (read-only queries on the stopped ulpin-reh-07 database). After: S3.11e. Task file E:/Projects/ulpin-wt/_tasks/s5-31.md; branch task/s5-31-targets-read. Two targets reads took 29.6 s and 22.3 s and /health peaked at 30.2 s during drop 2 run 3; find whether a plan, a lock wait or the pool did it, and fix it with the answers unchanged. **Status: merged 28 Oct (evidence only, int3-pre). Cause not shown offline: no lock conflict (plain MVCC reads), but the targets read costs 1.2 s warm on an idle database, 1.0 s of it package facts detoasting each package body several times, 155 ms the drafted OR EXISTS; HeadBucket in /health has no deadline. Fixes S5.32 and S3.16e.**

### S5.32 The batch targets read costs under 150 ms on the drop 2 case, and the storage health probe has a deadline

Size M, code only (read-only queries on the stopped ulpin-reh-07 database). After: S5.31. Task file E:/Projects/ulpin-wt/_tasks/s5-32.md; branch task/s5-32-targets-cost. Package facts read each body once or not at all, drafted uses indexes, same answers; checkStorage gets a 3 s deadline. **Status: merged 28 Oct (int3-pre 9180d490 with pins). Facts plus drafted median 2,017 ms to 100 ms on the drop 2 case (jsonb_to_record reads each body once; UNION ALL in place of OR EXISTS), same rows; HeadBucket aborts after 3 s. Server 1,226 pass, Studio 949 pass, rehearsal 40 pass at 9180d490.**
### S5.33 One failed byte part never stops a drop

Size M, code only. After: S3.11f. Task file E:/Projects/ulpin-wt/_tasks/s5-33.md; branch task/s5-33-part-retry. Studio reconciles a failed part and resends it by itself with refreshed guards; a file stopped for the officer no longer blocks later files; an idle large-original/2 receipt frees the one v2 slot after 10 minutes; why a part store fails under load. **Status: merged 28 Oct (int3-pre 72b0aab7 with pins). A failed part send reads the receipt status and goes again by itself (same key, hash and bytes, refreshed guards; 2, 5, 15 s; up to the part attempt limit) after a 5xx, a timeout, no answer, a busy part or a stale revision; a refusal that stays still waits for the officer. A file stopped for the officer lets the next file start and keeps its own Try again and Cancel. A large-original/2 receipt with no part activity for 10 minutes frees the one v2 slot and stays resumable; the doctor counts the same way. v2 part storage uses its 60 s limit, not 30 s. Why part 36 failed is not proven offline. Server 1,231 pass, Studio intake 493 pass, quotas 10 pass.**

### S5.34 The 800 MB India GeoJSON-lines file is read past 500,000 features and its field inventory finishes

Size M, code only. After: S3.11f. Task file E:/Projects/ulpin-wt/_tasks/s5-34.md; branch task/s5-34-india-lines. Reproduce the profile error at raw chunk 4098 on the original and fix it; route a geojson-lines file over the feature ceiling to cell files or keep the remainder with words; record the message of an unexpected job error. **Status: merged 28 Oct (int3-pre b3542754 with pins). The profile failure was a schema limit: the stopped ulpin-reh-08 attempts record a ZodError too_big on change.generation, because the streamed-profile.generation event still allowed at most generation 4097 after parts rose to 5000; the event now allows every generation a 5000-part read seals (contracts ingestion-events.ts, with a test). recordUspJobFailure keeps an ordinary error's name and first 300 characters. The file holds 2,224,797 features (counted read-only). The route past the ceiling goes to S5.34b. Server 1,234 pass.**

### S5.34b A GeoJSON-lines file over 500,000 features is read to its limit

Size M, code only. After: S5.34, S5.35. Task file E:/Projects/ulpin-wt/_tasks/s5-34b.md; branch task/s5-34b-lines-limit. At the feature ceiling a geojson-lines read stops parsing, hashes the rest and counts its lines; the 500,000 read are sealed, mapped and packaged; the item ends read_to_limit with words naming both counts (design line 182), never failed. **Status: merged 28 Oct (int3-pre d2db7cd8 with pins). Past the ceiling the reader stops parsing, hashes the rest and counts its nonblank lines; the 500,000 read seal, map and package as a complete read; usp_streaming_vector_imports.lines_beyond_limit (migration streaming-vector-lines-limit.sql, admitted to the SQL audit) holds the count; the item ends read_to_limit with words 500,000 of 2,224,797 features read; the rest is kept, not read. A FeatureCollection over the ceiling still fails. India read-only: 500,000 read, 1,724,797 beyond, 30.4 s, full hash matched. Server 1,250 pass.**

### S5.36 The cell files of an answered large file take the parent's approved layout

Size M, code only. After: S5.34b. Task file E:/Projects/ulpin-wt/_tasks/s5-36.md; branch task/s5-36-cell-carry. Halifax's 24 cell files each waited for a layout answer already given on the parent (run 4). A cell child with the parent's cellDerivative lineage and every parent column carries the parent's press (origin parent_file), valid while the press holds; anything else asks as today (design line 11, rows 10 and 21). **Status: merged 28 Oct (int3-pre fe77d595 with pins). A cell child carries the parent's press only when its cellDerivative lineage names the parent's current revision and hash, the parent recipe is officer-approved (not itself carried), every parent column is in the child with the same types, coordinate system and geometry types, and the parent's layout compiles on the child; the carried approval is rechecked at execute and refuses with RECIPE_APPROVAL if the parent press changes. Works for both small cells (manual GeoJSON) and large cells (streamed). The item plan shows origin parent_file with the parent source; Studio words Approved on the file this cell was cut from (added at integration; the worker missed the Studio type). Server 1,256 pass, Studio 961 pass. Measured on Halifax in the next drop.**

### S5.35 A GeoJSON layer reads fast enough that its first part reaches the map within 60 s

Size M, code only. After: S3.11f. Task file E:/Projects/ulpin-wt/_tasks/s5-35.md; branch task/s5-35-stream-speed. Profile the Niagara read (about 180 features a second), fix the largest cost with the same answers, and let the first sealed chunks map and package while the rest streams if the design allows. **Status: merged 28 Oct (int3-pre f5d3ed64 with pins). The cost was four scalar PostGIS round trips per accepted feature (167,248 for Niagara), not parsing: geometry checks now run as one query per part of up to 100 features, with the per-feature check as fallback when any geometry in the batch is malformed, so no neighbour is quarantined for it. Modelled Niagara read 257 s to 5.5 s at 1 ms per statement, first part 29 ms, same counts and chunk hashes. Mapping already starts on sealed chunks; the package cut waits for the closed read by design (section 11 row 12). Live timing is measured in S3.11g. Server 1,242 pass.**

### S3.11g Practice-kit drop 2, fifth run

Size M, this PC: Docker. After: S5.33, S5.34, S5.35, S3.16f. Task file E:/Projects/ulpin-wt/_tasks/s3-11g.md; branch task/s3-11g-kit-drop-2. Fresh ulpin-reh-09 at int3-pre f5d3ed64, the same kit and rehearsal officer answers; adds part retries, Niagara read seconds against run 4's 236 s, frames by cause with CPU, Halifax cell batch states. **Status: done 28 Oct (evidence merged int3-pre f66ad1ee, docs/evidence/step-3/s3-11/result-g.json). 90 minutes, no API or dispatcher exit, no read over 1 s (polls max 403 ms, health max 613 ms), 135 jobs all succeeded. Only 8 of 17 files enrolled: the Raichur TIF (401.6 MB, large-original/2) received parts 1 to 12, part 13 was failed by the server within 6 s of its claim (attempts 1, PART_INTERRUPTED_OR_REJECTED, cause not recorded), Studio never sent it again and the nine files after it never started (S5.39). Niagara read 47 s (run 4: 236 s), but its first part reached the map at 289.6 s: profile 110 s, mapping 200 s, and its intake-large steps waited up to 197 s behind Halifax's 24 cell files on the two-slot vector lane (S5.37, S5.38). Halifax cells still asked (S5.36 came after this build). 68 slow frames, 66 browser_wide: every one within 2 s of hh:m1:30 or hh:m6:30, the minutes the scheduled task ULPIN Docker guard watch runs (every 5 minutes from 02:46:28, about 2 s each, all runs engine_answers); a hand-run guard check on the idle PC caused no stall, so it shows only under drop load; measured again next drop.**

### S3.11h Practice-kit drop 2, sixth try, on the newest code

Size M, this PC: Docker. After: S5.36, S5.34b, S5.37, S5.38, S5.39. Task file E:/Projects/ulpin-wt/_tasks/s3-11h.md; branch task/s3-11h-kit-drop-2. Fresh ulpin-reh-10 at int3-pre df9b805a, the same kit and rehearsal officer answers; records resent parts and receipt words, Halifax cells carried or asked, Niagara read, profile and mapping seconds, intake-large queue waits, upload rows and console errors, and the Docker guard run times beside the ten slowest frames. **Status: done 28 Oct (evidence merged 2a0f576a).** 90 minutes, no API or dispatcher exit, 8 of 17 enrolled. Niagara first part on the map at 177.7 s (run 5: 289.6 s); read 32.6 s, profile 34.4 s, mapping 51.0 s (run 5: 47, 110, 200 s); intake-large queue wait average 2.8 s, maximum 64.0 s (run 5: 11 s, 238 s). Two slow frames (292.8 and 127.8 ms, script), none browser_wide. Found: (1) the nine files after the first eight were refused at receipt creation with This source case is now associated with a package or property, because the batch case holds its own draft packages from 08:47:31 (the first part on the map); the same refusal stopped Raichur part 13 in run 5 and India part 36 in run 4 (S5.40). (2) 21 of 24 Halifax cells did not carry the parent's layout: the rule wanted equal types, a cell sees a subset (Polygon only; HGTSOURCE null throughout) (S5.41). ulpin-reh-10 stopped, data kept.

### S5.42 A streamed GeoJSON's first part reaches the map within 60 s

Size M, code only. After: S3.11h. Task file E:/Projects/ulpin-wt/_tasks/s5-42.md; branch task/s5-42-first-part. Run 6 Niagara: two intake-large steps of about 30 s each between the sealed profile and the mapping start, and the first cut queued only when the whole 51 s mapping completed; name each step, measure offline, queue mapping on approval and each cut from its published mapped chunk. **Status: merged 28 Oct (int3-pre 359274ab; server 1349 pass, Studio exit 0).** Mapping starts on approval; each cut follows published mapped chunks; one undispatched wake per file (Niagara jobs offline 446 to 25); the prefix compare reads every raw chunk (500,000 India features: 30.0 s, 490 MiB). Modelled first part 58.6 s, or 70.9 s with run 6's dispatcher cost: the live figure decides. The lead merged it beside S5.46 (draft returns the cell wait after the closing cut) and aligned two S5.46 tests with the one-wake rule.

### S3.16g The rehearsal runner records every file's parts, cell files included

Size S, code only. After: S3.11h. Task file E:/Projects/ulpin-wt/_tasks/s3-16g.md; branch task/s3-16g-item-timeline. Run 6 timed only the opened map; from the intake polls it already makes, keep per item a timeline and first-part and all-parts times, and poll each cell case every 10 s. **Status: merged 28 Oct (c279a0f8; rehearsal 48 pass).** Each file and cell gets state, placement, parts, words, a change-only timeline, firstPartAt and allPartsAt with seconds from the add press; at most 30 child cases, one poll each per 10 s; page row words kept apart as rowWords.

### S5.43 An idle dispatcher always admits a ready job

Size S, code only. After: R-INGEST-1. Task file E:/Projects/ulpin-wt/_tasks/s5-43.md; branch task/s5-43-dispatch-reach. The job the head-of-line rule waits for is always inside the selected window; S5.38's first-part priority and one step per item stay. **Status: merged 28 Oct (int3-pre b607bc67; server 1327 pass, Studio exit 0).** Each lane's oldest refused job is selected ahead of first-part promotion, and only refusals inside the selected window can hold later jobs back; the fairness fixture keeps 112 s to the first intake-run and a 24 s longest wait.

### S5.44 A geojson-lines read at the feature limit keeps its lease while it counts the rest

Size S, code only. After: R-INGEST-1. Task file E:/Projects/ulpin-wt/_tasks/s5-44.md; branch task/s5-44-tail-lease. The tail drain renews the fenced attempt by bytes or time, without parsing the tail. **Status: merged 28 Oct (int3-pre; server 1314 pass).** The reader yields every 64 KiB of tail to the worker's existing pulse (at most one heartbeat per 30 s); counts and hashes unchanged.

### S5.45 A draft package cannot commit between batch admission and an original's publication

Size S, code only. After: R-INGEST-1. Task file E:/Projects/ulpin-wt/_tasks/s5-45.md; branch task/s5-45-commit-race. One lock order between the workspace check and a package commit. **Status: merged 28 Oct (int3-pre 74af80b9; server 1317 pass).** commitPackage takes the package's case FOR SHARE after the recording lock; workspace keeps the case FOR UPDATE through publication. Residual: lockBuildingMetadataTx takes case then recording, so three writers on one case can meet in a deadlock that PostgreSQL detects and aborts (one retry), not a hang.

### S3.16h The rehearsal runner records every database lock wait over 5 s with what holds it

Size S, code only. After: S5.46. Task file E:/Projects/ulpin-wt/_tasks/s3-16h.md; branch task/s3-16h-lock-waits. Every 5 s one read-only sample of lock waits over 5 s with each blocker's state, transaction start and query text (no bind values), saved change-only beside the result with a summary per blocker. **Status: merged 28 Oct (int3-pre a1fed760; rehearsal 55 pass).** The lead ran it on ulpin-reh-12 read-only: an advisory-lock wait was recorded with its holder's query.

### R-INGEST-2 Second review of the ingestion changes since run 7

Size S, review only. After: S7.31b. Task file E:/Projects/ulpin-wt/_tasks/r-ingest-2.md; branch task/r-ingest-2-review. A fresh reader checks S5.42 to S5.48, S7.30, S7.31 and S7.31b for lost fences, races, missed wakes, duplicate keys through the open-mapping path, leaked or double-freed slots and lock-order deadlocks, each finding proved; no code change. **Status: done 29 Oct (evidence merged into int3-pre 503f4521).** All 17 merges reviewed. Two defects proven offline: F1, a cut from an open mapping holds the mapping job and later upgrades its case lock to FOR UPDATE while binding the site, so a mapping publication or a package commit can deadlock with it; F2, comparePrefix reads eight raw chunks between heartbeats, so slow reads can expire the attempt lease. One unproven note (cell receipt waits use freesAt only). Fix: S5.49, after S5.48c.

### R-INGEST-1 Second review of the ingestion changes since run 5

Size S, review only. After: S3.16g. Task file E:/Projects/ulpin-wt/_tasks/r-ingest-1.md; branch task/r-ingest-1-review. A fresh reader checks S5.34b to S5.41 and S7.20b for lost fences, races, half commits, wrong admissions and unbounded reads, each finding proved by a test or an exact path; no code change. **Status: done 28 Oct (evidence merged into int3-pre).** All 11 merges reviewed; three defects reproduced: F1 the S5.38 first-part order can leave an older memory-refused job outside the 12-job window so an idle dispatcher admits nothing (S5.43); F2 the S5.34b tail drain never renews the reader lease, so a tail over 180 s cannot seal (S5.44); F3 a draft package can commit between the S5.40 admission check and an original's publication (S5.45).

### S3.11j Practice-kit drop 2, seventh try again after the pause

Size M, this PC: Docker. After: S3.11i paused. Task file E:/Projects/ulpin-wt/_tasks/s3-11j.md; branch task/s3-11j-kit-drop-2. Fresh ulpin-reh-12 at int3-pre 8454b17d, the same kit, answers and measurements as S3.11i. **Status: done 28 Oct (evidence result-j.json merged into int3-pre; the worker stopped on a pool error after the drop and S3.11j-r1 wrote the evidence from the recorded run).** 13/17 enrolled (run 6: 8/17), so S5.40 works. Failed: Niagara first part 260.5 s (run 6: 177.7 s), 27 frames over 100 ms, intake-large queue wait average 16.9 s (maximum 304 s). Other code tests ran on the PC during the drop (esbuild near 100% CPU), so the times are not a quiet-PC measure. Blocker: the Halifax cell write held a lock from about 12:07 to 12:20:54 UTC; the GML and DXF creates waited behind it, the Studio gave up after 2 minutes, the server then opened both receipts with no part ever sent, and they held both of the officer's large-original/1 slots for 24 h. Halifax then failed with UPLOAD_QUOTA (no cells), and the Berlin member, DOCX and PDF never got a slot. Fixes: S5.46 and S7.30.

### S3.11k Practice-kit drop 2, eighth try, on a quiet PC

Size M, this PC: Docker. After: S5.42 to S5.46, S7.30 and S3.16h merged. Task file E:/Projects/ulpin-wt/_tasks/s3-11k.md; branch task/s3-11k-kit-drop-2. Fresh ulpin-reh-13 at int3-pre a1fed760, the same kit and answers, no other worker on the PC, lock waits recorded with their holders. **Status: done 28 Oct (evidence result-k.json merged into int3-pre a53cb700).** 17/17 enrolled (run 7: 13/17); 2 frames over 100 ms (run 7: 27); 1 console error (run 7: 136); no receipt left receiving with no parts. Failed: Niagara and Halifax stopped on STALE_REVISION (the cut gate in intake-part-draft.ts refuses a mapping that has not closed, but S5.42 now cuts from the first mapped chunk; three attempts in 33 s, nothing queued after mapping completed). Also seen: Niagara's layout question came 177 s after the add (one pre-question step queued 30 s and ran 87 s), chunk-mapping ran 98 s, 49 lock waits over 5 s (longest 50.6 s) on the batch case row and advisory locks with holders idle in transaction, and uploads ran one file at a time so the last started 9 minutes after the add. Fixes: S5.42c, S5.47, S5.48, S7.31.

### S5.42c A streamed GeoJSON cuts from a published mapped chunk once the whole-file key check matched

Size S, code only. After: S3.11k. Task file E:/Projects/ulpin-wt/_tasks/s5-42c.md; branch task/s5-42c-open-mapping-cut. draftIntakePartTx accepts an open mapping only with a matched prefix seal check for the current recipe, profile and mapping, cut features below next_publish_index and no conflict index; the sealed path is unchanged; a cut that comes before its chunk ends the step without spending an attempt. Tests against the real gate. **Status: merged 28 Oct (int3-pre e0f6a055; server 1374 pass).** Run 8's sealed-plan path now cuts from published chunks; offline the gate admits Niagara's first cut 3.05 s after mapping start. A prefix-approved plan is still refused downstream in proved-area-part.ts: S5.42d.

### S5.42d A prefix-approved streamed GeoJSON also drafts from a published chunk of an open mapping

Size S, code only. After: S5.42c. Task file E:/Projects/ulpin-wt/_tasks/s5-42d.md; branch task/s5-42d-prefix-open-cut. prepareProvedAreaPartTx's prefix block accepts an open mapping on S5.42c's rule; the closed form unchanged; the S5.42c bench rerun through the real downstream path. **Status: merged 28 Oct (int3-pre 387ad708; server 1410 pass).** Offline Niagara's first 2,000-feature package persists 5.7 s after mapping start, with 49 of 423 chunks mapped.

### S5.47 Niagara's layout question within 60 s of the add, its mapping under 30 s

Size M, code only. After: S3.11k. Task file E:/Projects/ulpin-wt/_tasks/s5-47.md; branch task/s5-47-niagara-steps. Explain run 8's 30 s queue wait and 87 s run of the pre-question step and the 98 s mapping from the stopped ulpin-reh-13 (read only), the worker logs and the lock record; measure offline; fix. **Status: merged 29 Oct (int3-pre 757c3b55; server 1437 pass).** First pass: the 30 s queue wait and at least 38 s of the 87 s step were lock waits (S5.48); the question itself costs milliseconds. Mapping fell offline from 61.6 s to 13.3 s by publishing 16 parts per transaction, but that held the batch case row FOR SHARE across storage reads, normalization and writes, so the lead did not merge it; the rework prepares parts outside any transaction and publishes them in one short checked transaction. Rework: a read-only snapshot of pins and up to 16 ready slots, raw reads, normalization and mapped writes outside any transaction, then one short publish that rechecks pins, attempt, pointer, raw slots and keys (a changed key set redoes the group). Offline Niagara mapping 4.8 s at 1 ms per statement (before 14.7 s), same hashes and counts; storage calls under a transaction 1,269 to 0; locked scope 44 statements, 22 ms undelayed (96 ms at 1 ms per statement, no I/O).

### S5.48 No transaction holds the batch case row or a shared advisory lock for more than 5 s

Size M, code only. After: S3.11k. Task file E:/Projects/ulpin-wt/_tasks/s5-48.md; branch task/s5-48-case-lock-hold. Rebuild run 8's lock-wait chains to their root holders (several idle in transaction), name each code path and move slow work out of the locked transaction without changing lock order. **Status: merged 28 Oct (int3-pre a7ae4e42; server 1386 pass).** Roots named: the streamed profile read, hashed and folded up to eight raw chunks inside one locked transaction (now one chunk read outside, then a short checked publish); IFC and CityGML hashed the Python tool tree and read their result artifacts under the case gate, and documents read their result there (now before the lock). Offline the longest locked scope fell from 202 ms to 1.6 ms per profile window. Three roots sit in files other tasks hold: chunk-mapping window reads (S5.47), assertObservedCut reading chunks on other connections while the draft holds case and item locks, and comparePrefix reading raw chunks in pinned scopes: S5.48b after S5.42d and S5.47.

### S5.48b The mapping window, the draft cut check and the prefix compare read storage outside their locks

Size S, code only. After: S5.42d, S5.47. Task file E:/Projects/ulpin-wt/_tasks/s5-48b.md; branch task/s5-48b-draft-compare-locks. assertObservedCut's chunk reads and comparePrefix's raw reads move before their locks, with short rechecks inside; the mapping window root goes to the S5.47 rework. **Status: merged 29 Oct (int3-pre 26a741e3; server 1423 pass).** Offline a 2,000-feature cut's locked scope fell from 126 ms to 4 ms with no storage call under the lock. Left: the proved part reads raw chunks under the same lock (S5.48c).

### S5.48c A proved part reads its raw chunks and source ranges before the cut's locks

Size S, code only. After: S5.48b. Task file E:/Projects/ulpin-wt/_tasks/s5-48c.md; branch task/s5-48c-proved-part-reads. loadPartFeatures reads every raw chunk of a cut and proves every feature under the case-wide cut lock; pre-read with a witness and recheck slot hashes inside, as S5.48b. **Status: merged 29 Oct (int3-pre 2dfd76f0; server 1445 pass).** draftCut reads and proves the cut's features before the locks; inside, the raw import must be closed and every slot hash, the input hash and the source pins unchanged. Locked time for a 2,000-feature cut over 20 chunks fell from 460 ms to 36 ms with no storage call under the lock; callers without a witness keep the old read.

### S5.49 A cut never upgrades its case lock late, and long storage reads keep their job lease

Size S, code only. After: S5.48c, R-INGEST-2. Task file E:/Projects/ulpin-wt/_tasks/s5-49.md; branch task/s5-49-cut-lock-order. The cut takes the case row in its final mode before any job, mapping, area or site row; the binder locks the case only to write site_id; an open mapping is not held FOR SHARE across the cut; heartbeats run between storage reads. The three R-INGEST-2 reproductions become passing tests. **Status: merged 29 Oct (int3-pre a7d215bf; server 1456 pass).** The cut and draftIntakePartTx take the case FOR UPDATE first, so the binder's lock is never an upgrade; the binder reads plainly and locks only to write site_id; a cut from an open mapping locks only the raw import and source, so a mapping publication waits at most one short cut on the case row (offline locked cut 37.9 ms for 2,000 features in 20 chunks, no storage call under the lock). Heartbeats run after every storage read in comparePrefix, rawFeatures, the observed and proved pre-reads and the mapping group (8 reads of 23 s keep the lease). The three R-INGEST-2 reproductions pass as repository tests. The lead added the heartbeat inside the proved-part read loop (proved-area-part.ts), which the task did not own.

### S3.11l Practice-kit drop 2, ninth try, on a quiet PC

Size M, this PC: Docker. After: S5.42c, S5.42d, S5.47, S5.48 to S5.48c, S5.49, S7.31 and S7.31b merged. Task file E:/Projects/ulpin-wt/_tasks/s3-11l.md; branch task/s3-11l-kit-drop-2. Fresh ulpin-reh-14 at int3-pre a7d215bf, the same kit and rehearsal officer answers, no other worker on the PC; per file upload overlap, first and last part on the map, Niagara question and mapping times, lock waits with their holders. **Status: done 29 Oct (evidence result-l.json merged into int3-pre d6c25ae2).** 17/17 enrolled; Niagara drew (21 packages, first part 288 s after the add) and Halifax drew (107 packages, all 24 cells carried the parent layout), with no STALE_REVISION or other refusal; uploads overlapped; no receipt left receiving with no parts; API and dispatcher never exited. Failed: first part within 60 s (Niagara 288 s: read 71 s, profile 80 s, mapping 60 s); 60 frames over 100 ms (run 8: 2; 56 browser-wide with no script, longest 697 ms); 37 lock waits over 5 s (longest 29.9 s) behind cuts holding the batch case; 24 console errors (19 are the 429 answers of uploads waiting for a slot); Tweed's converted layer refused with UPLOAD_QUOTA; the last file started 420 s after the add. Fixes: S5.50 (upload side), R-RUN9 (the rest).

### S5.50 Uploads wait for a slot without failing, never lock the case row per part, and a converted layer waits for its slot

Size M, code only. After: S3.11l. Task file E:/Projects/ulpin-wt/_tasks/s5-50.md; branch task/s5-50-upload-admission. A slot-full answer is not a failed request; upload part and status calls do not take the case row FOR UPDATE and the quota lock is short; a converted layer refused only for a busy slot waits and enrols by itself. No limit raised. **Status: merged 29 Oct (int3-pre 1ac52bbf; server 1468 pass; contract gains a 202 waiting answer on upload create).** A busy slot answers 202 waiting with its limit and freesAt (byte, disk and attempt limits keep their 429 refusals); the Studio keeps drop order and the 30 s re-ask. Upload create, part, status and receipt steps take the case row FOR KEY SHARE and the quota lock only after the case and upload rows, held briefly; publishing a retained original still takes the case FOR UPDATE first. A converted layer refused only for a busy slot shows waiting words and enrols by itself within 30 minutes, its job lease renewed. Live upload timing is measured in rehearsal 1.

### R-RUN9 Explain run 9's slow first part, its lock chains and its slow frames

Size S, review only. After: S3.11l. Task file E:/Projects/ulpin-wt/_tasks/r-run9.md; branch task/r-run9-review. Niagara's critical path from add to first package, every lock-wait chain to its root, the ten slowest frames with their nearest load, and a fix plan ranked by seconds saved for rehearsal 1. No code change. **Status: done 29 Oct (evidence merged into int3-pre a079bc02).** Niagara: after the raw read closed (75 s) and the profile (84 s), one comparePrefix pass re-read all 423 raw chunks one at a time with 108 case-locking pins for 193.7 s, two thirds of the 288 s; fix S5.51. Locks: batch-wide case FOR UPDATE requests convoy uploads, cuts and destination-gate callers; only 5 of 37 chains reach a visible root (the sampler should record roots); upload side is S5.50. Frames: the ten slowest (600 to 697 ms) are browser-wide with no script and no job running, each 0.7 to 1.8 s after a run of the ULPIN Docker guard scheduled task (52 of 60 within 2 s of one), so they are most likely host pauses from that task, not drawing. The two 503s were an India upload part retried and kept; the two 502 URLs were not captured.

### S5.51 The whole-file key check is done by the time the raw read closes

Size M, code only. After: R-RUN9. Task file E:/Projects/ulpin-wt/_tasks/s5-51.md; branch task/s5-51-compare-follows-read. The intake-large check follows published raw chunks once the layout is approved and keeps resumable progress, so at closure only the tail remains; reads run up to 8 at a time, slots are read per group and read-only pins take the case row in KEY SHARE. Same keys, conflicts, seal record and words. **Status: merged 29 Oct (int3-pre edff4fbc; server 1484 pass).** The worker took the fallback: slots read per group of eight in one statement, up to eight raw reads at a time, read-only pins in KEY SHARE (the first pin takes the case FOR SHARE before the attempt, as the profile loaders need), and a final recheck of every slot before the seal check is recorded. Offline Niagara closure-to-seal 112.3 s to 23.5 s with identical keys and seal record. Still after closure, with no resumable progress; following the read as it publishes is a later task if rehearsal 1 needs it.

### S7.31 A multi-file add keeps every open-receipt slot busy

Size S, code only. After: S3.11k. Task file E:/Projects/ulpin-wt/_tasks/s7-31.md; branch task/s7-31-upload-slots. Run 8 uploaded one file at a time with 10 to 30 s gaps (last file started 9 minutes after the add); the Studio starts the next file as soon as the server admits it, in drop order, never raising a server limit. Target: the last file starts within 180 s. **Status: merged 28 Oct (int3-pre 61470dbe; Studio 992 pass).** The first pass found the cause in retain-batch.ts (each file waited for the previous file's whole send, finish and enrolment); the rerun admits files in drop order and overlaps them; modelled last-file start 165 to 220 s. Follow-up S7.31b.

### S7.31b An upload waiting for a slot asks again at least every 30 s

Size S, code only. After: S7.31. Task file E:/Projects/ulpin-wt/_tasks/s7-31b.md; branch task/s7-31b-slot-reask. A slot freed with no local event left a file waiting up to 30 minutes; the lead's 30 s cap failed six tests that share module-level waiting tickets. Cap the wait, end every ticket with its command, isolate the tests. **Status: merged 29 Oct (int3-pre fdf2377d; Studio 998 pass).**

### S5.46 An upload create never waits behind a cell write, and an emptied receipt frees its slot

Size M, code only. After: S3.11j. Task file E:/Projects/ulpin-wt/_tasks/s5-46.md; branch task/s5-46-receipt-slots. Name and prove the lock, keep no create or part lock across cell bytes, free an idle large-original/1 slot after 10 minutes as large-original/2 does, and keep a quota-refused cell waiting instead of failing its job. **Status: merged 28 Oct (int3-pre; server 1340 pass).** An idle large-original/1 receipt stops holding a slot after 10 minutes and reserves again on its next part or finish; a cell refused UPLOAD_QUOTA leaves bounded waiting words and a later step writes it (30 minutes from the parent's retention). The lead aligned scripts/platform/ingestion-quotas.mjs. Not found: the lock holder from 12:07 to 12:20:54. The code holds no create or part lock across cell bytes, and the run had no lock-wait log, so the next drop samples pg_locks and pg_stat_activity every 5 s.

### S7.30 A create that goes quiet is asked again with the same request key

Size S, code only. After: S3.11j. Task file E:/Projects/ulpin-wt/_tasks/s7-30.md; branch task/s7-30-create-replay. A silent create is resent with the same requestKey (the server replays its receipt) within the 30-minute slot window, so a slow create never leaves an orphaned receipt. **Status: merged 28 Oct (int3-pre; Studio exit 0).** The silent request is aborted before the replay; the row says the server has not answered yet. Each replay can leave one more server request waiting on the same lock until it frees.

### S3.11i Practice-kit drop 2, seventh try, with batch admission and cell carry

Size M, this PC: Docker. After: S5.40, S5.41. Task file E:/Projects/ulpin-wt/_tasks/s3-11i.md; branch task/s3-11i-kit-drop-2. Fresh ulpin-reh-11 at int3-pre 8454b17d, the same kit, answers and measurements as S3.11h. **Status: paused 28 Oct by the owner, mid-drop.** Runner, worker and ulpin-reh-11 stopped (data kept); to resume, start the drop again on a fresh runtime.

### S5.40 The files after the first one in an add are admitted after the first file reaches the map

Size M, code only. After: S3.11h. Task file E:/Projects/ulpin-wt/_tasks/s5-40.md; branch task/s5-40-batch-admission. The package rule in service.ts workspace refuses every new receipt and part once the batch case holds its own draft packages; a case whose every package is a draft of its own intake items admits as an empty case, a property link or an outside package still refuses. **Status: merged 28 Oct (8454b17d).** A package counts as the batch's own when it is NEEDS_INPUT, READY_FOR_REVIEW or REVIEWED and every source in body.sourceRevisionIds is an intake item of the case; in run 6's data all 95 packages qualify. Any other state, an empty source list or an outside source closes the case with the existing words.

### S5.41 Every cell file carries the parent's layout, also when the cell sees fewer types

Size S, code only. After: S3.11h. Task file E:/Projects/ulpin-wt/_tasks/s5-41.md; branch task/s5-41-cell-subset. cellProfileContains takes a subset of the parent's geometry types and path types instead of equal sets. **Status: merged 28 Oct (45d0b255).** A child with a path, a path type or a geometry type the parent never had, or another coordinate system, still asks; tests cover the run 6 shape.

### S5.37 A streamed GeoJSON is mapped and profiled fast enough for a first part within 60 s

Size M, code only. After: S3.11g. Task file E:/Projects/ulpin-wt/_tasks/s5-37.md; branch task/s5-37-mapping-speed. Niagara chunk-mapping 200 s and profile 110 s in run 5; measure off-runtime the S5.35 way, fix the largest cost with the same answers, target 3 times faster and a first mapped chunk within 10 s. **Status: merged 28 Oct (df9b805a).** Key reservations are one statement per chunk, the converter digest is read once per file change, and the profile publishes up to eight ready parts per transaction, each in its own savepoint. Niagara offline at 1 ms per statement: mapping 141.6 s to 44.5 s (3.18 times), profile 3.37 times faster, first mapped part 0.12 s; statements 81,634 to 23,748. Same mapped records and hashes; the live first-part time is measured in drop 2 run 6.

### S5.38 The intake-large queue is fair per file

Size M, code only. After: S3.11g. Task file E:/Projects/ulpin-wt/_tasks/s5-38.md; branch task/s5-38-fair-queue. 169 intake-large steps on a two-slot lane waited up to 238 s; a step of an item with no part on the map goes first, no item holds both slots while another waits; replay run 5's shape before and after. **Status: merged 28 Oct (59f8aaa7).** Vector lane 6 slots (6 x 426 MiB within the 3,072 MiB heap), one intake-large step per item at a time, an item with no part on the map first. Replay: first file's first intake-run 221 s to 112 s, queueing 155 s to 46 s, longest step wait 87 s to 24 s; the 60 s first-file target is not met in the replay, live check in drop 2 run 6.

### S5.39 A byte part the server fails is resent by itself and the files after it start

Size M, code only. After: S3.11g. Task file E:/Projects/ulpin-wt/_tasks/s5-39.md; branch task/s5-39-part-failure. failPart records why; Studio replays each failure answer for a mid part and resends or releases the next file; the runner records upload rows and console errors. **Status: merged 28 Oct (7b73ae3f).** The receipt keeps the failing error's code and first 200 characters (lastError shows it); a part the status shows failed is resent within the attempt limit whatever the send's answer (409, 422, 400 and 413 used to stop for the officer). Fifteen replays, none hung before or after, so the live 83-minute stall is not reproduced; the runner now samples upload rows every 10 s to show it next drop.

### IMG7 Processor image for int3 dee55fc8

Size S, this PC: Docker build only. After: S5.25, S5.27, S1.3ao. Task file E:/Projects/ulpin-wt/_tasks/img7.md; branch task/img7-processor-image. Build ulpin-geo:git-<12 hex> from services/geo at 7580d766 by IMG6's method, smoke test, pin in scripts/platform/processor-image.json. **Status: merged 28 Oct (int3-pre 2b72f962). ulpin-geo:git-7580d7661c31 built from services/geo at 7580d766 (999 MB, both labels, five smoke imports pass, fitz absent); the demo and the old pinned image unchanged. The platform suite fails 7 of 132 on an exit-record test left behind by d965e2f4 (S3.16b).**

### S3.11 Practice-kit drop 2: measured and passing

Size M, this PC: Docker. After: S3.4, S3.5, S3.6, S3.7, S3.9, S3.10. **Status: running 27 Oct. S3.11a done (f33d54b3 on task/s3-11-kit-drop-2: ulpin-reh-05 created at 34e5ff97, five readers verified, doctor 52 PASS, a start line each from the API and dispatcher, stopped). S3.11b drop 1 of this entry ended after 3 minutes (E:/ulpin-tmp/s3-11/run-1/result.json): one 4.5 s read of the case intake timed out and the runner stopped the whole observation; the Halifax View layout press was covered by the sticky File reading panel. Niagara's answer was used. Fixes S3.16 and S7.27 running; S3.11c reruns the drop after them. S3.11c (28 Oct, ulpin-reh-06 at 2b72f962, evidence merged 5a624a44, docs/evidence/step-3/s3-11/result-c.json): the full 90 minutes ran with no API or dispatcher exit, but only 7 of 17 files became batch items (the LAZ, both TIFs, the India pair, the LoD2 ZIP and GML, the DXF, the DOCX and the Hodgson PDF never appeared), the Halifax BL_ID answer was refused (Source identity must be complete, unique, nonempty literal text), and the map page blocked the main thread for 1.4 to 3.1 s every few seconds from 13 minutes on. S3.11d diagnosed it; S7.29, S4.14, S3.16c and S7.28 fixed it. S3.11e ran drop 2 a third time on a fresh ulpin-reh-07 at int3-pre d7baef36 (28 Oct, evidence merged 1edcba44, docs/evidence/step-3/s3-11/result-e.json): all 17 files became items in 377 s with no reload and no API or dispatcher exit; 15 read or were kept with words (Niagara 21 of 21 parts, LAZ 63 of 63, TIFs 33 and 37). Failed: the India geojsonl and its CSV twin (intake-large ZodError, 3 attempts; fix S5.29) and the Berlin GML and its ZIP member (CITYGML_OUTPUT_LIMIT, output over 16 MiB; fix S5.30). Halifax was unanswered: the lead answer said Position while complete fields exist; the answer is now BLPOLY_ID (complete and distinct in all 172,409 features; int3 771b5b81, 3ca0d121). Both map moments timed out because the runner waits for words the map no longer shows, and 62 slow-frame captures have no cause recorded (fix S3.16d). The /targets read took up to 29.6 s twice. Drop 2 runs again after S5.29, S5.30 and S3.16d. S3.11f ran drop 2 a fourth time on a fresh ulpin-reh-08 at int3-pre 9180d490 (28 Oct, evidence merged 68d7a174, docs/evidence/step-3/s3-11/result-f.json): 90 minutes with no API or dispatcher exit, no slow read (polls max 505 ms, health max 571 ms, runner loop max 142 ms), but only 11 of 17 files became items. The 800 MB India geojsonl upload failed at part 36 of 96 (part store failed once on a busy PC; the server bumped the receipt revision, Studio resent with the old revision, was refused and paused for an officer), and the five files after it never started; the paused receipt also holds the only large-original/2 slot (fix S5.33). The India gzip twin was read as NDJSON: the stream stopped at the 500,000-feature ceiling after 1,947 s and the field inventory threw an unrecorded error at raw chunk 4098 (fix S5.34). Niagara read 21 of 21 parts but its first part reached the map 263.5 s after the add press: the 26.7 MB read took 236 s (about 180 features a second) and mapping waited for the whole read (fix S5.35); the last-part map moment timed out. 50 frames over 100 ms (max 806 ms), all with no script, the slowest at the same instant on both pages (fix S3.16f). Halifax went to 24 cell batches, each waiting for an answer. Berlin was not reached. Drop 2 runs again after S5.33, S5.34, S5.35 and S3.16f.**

- **What:** The step 3 done line: on a new empty ulpin-reh-05 and a quiet PC, at staging with S3.4 to S3.10 merged, drop the whole practice kit at once. The API and dispatcher never exit. Maps-and-tables files show first features within 60 s, with officer answer time listed separately. No frame over 100 ms. Files above a reader ceiling are kept with plain words. Record the result for the owner's report.
- **Files:** scripts/rehearsal/kit-drop.mjs; practice manifests; docs/evidence/step3/s3-11/result.json
- **Check:** result.json: exit files empty, max frame under 100 ms on both pages, and every maps-and-tables file with firstFeaturesSeconds 60 or less (officer time excluded and stated). No file without a verdict.
- **Tests:** pnpm platform:doctor --profile demo --runtime ulpin-reh-05


## Step 4: Understanding: the reading card

There is no per-file reading card today. Tables wait for a press before anything is profiled; judges' tables are refused for Sarvam while judges' GeoJSON is not gated at all (S4.1 closes this). Memory is empty on a fresh runtime, so rules and the officer carry understanding.

### S4.1 Owner switch for Sarvam on judges' files: one gate for tables and map layers

Size S, code only. After: none (wave 1; disjoint from S4.2 and S4.3). **Status: done 24 Oct (merged on int3-pre; default off: a judge GeoJSON or table without approved memory gets the officer question until the owner sets ULPIN_TEACHER_CASE_ORIGINALS=masked_profile; batch GeoJSON has no licence or personal-data marks, so only tables can refuse on them).**

- **What:** Judges' tables are always refused, because tabularTeacherPolicy swaps in CASE_ORIGINAL_TEACHER_REFUSED. A judge's GeoJSON reaches Sarvam whenever the gateway is on, because proposeIntakeLayout calls adaptive.propose with no case-original check. Add one setting from ULPIN_TEACHER_CASE_ORIGINALS: absent or off means refuse, masked_profile means allow. Both paths obey it with the same code and plain words. When allowed, a table uses the real teacher with split unlabelled, but never for licence restricted or containsPersonalData yes. Document the owner's one-line step in DEMO-GATEWAY.md.
- **Files:** packages/server/src/infrastructure/config.ts:19-59 (getter beside dispatchMemoryMib); packages/server/src/modules/usp/ingestion/chunk-mapping-tabular.ts:103-112 tabularTeacherPolicy; intake-draft-worker.ts:92-103 proposeIntakeLayout; chunk-mapping-worker.ts:166-176 propose (manual-geojson branch); adaptive-mapping-service.ts:28-56; packages/contracts/src/usp/ingestion.ts:154-162 (provenance fields, read only); docs/backend/DEMO-GATEWAY.md (one section)
- **Check:** pnpm exec tsx --tsconfig apps/api/tsconfig.json --test tests/tabular-admission.test.ts packages/server/src/modules/usp/ingestion/intake-draft.test.ts
- Variable unset: the existing test at tabular-admission.test.ts:360 ('every case-original teacher callback refuses before the request builder is called') still passes. A new test shows a case GeoJSON never calls adaptive.propose and gets the officer question.
- masked_profile: the replay teacher is called once for lgd-gurugram.csv admitted as a case original, and zero times when its licence is restricted.
- Expected: all tests pass.
- **Tests:** tests/tabular-admission.test.ts; packages/server/src/modules/usp/ingestion/intake-draft.test.ts; tests/adaptive-mapping.test.ts; scripts/agent/mapping-routing.test.ts; pnpm typecheck:backend

### S4.2 Rules name clear field meanings before the student and the teacher

Size M, code only. After: none (wave 1). **Status: done 24 Oct after one send-back (merged on int3-pre;  Studio part limited to model.ts words; a Rule fields column in LearnerPanel is left for a UI task).**

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

Size M, code only. After: none (wave 1; sole writer of contracts usp/intake.ts while open). **Status: done 24 Oct (d583ea12, after one send-back).**

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

Size S, code only. After: S4.2 (same file mapping-teacher.ts, one writer). **Status: done 25 Oct (merged into task/int3-pre at 713a979a, pins c504eb64). A field failing only on its explanation keeps target, operation and confidence with code-owned withheld words and TEACHER_RATIONALE_WITHHELD; the plan stays needs_input; the teacher text reaches no plan, log or recording. Not yet live (S4.10).**

- **What:** LP6 refused both live mapping plans, all 16 fields on fields.N.rationale. One digit, EPSG or 'coordinate' fails the schema, and retainValidFields then drops the field. SV3 changed only the prompt, and nothing live has passed since. Keep the rule unchanged. A field failing only its rationale keeps target, operation and confidence, with a code-owned rationale ('Withheld: the explanation stated a literal.') and issue TEACHER_RATIONALE_WITHHELD. It stays a question for the officer, and no literal reaches the stored plan. The lead approves this first: it changes SV3's consequence, not its rule.
- **Files:** packages/server/src/modules/usp/ingestion/mapping-teacher.ts:86-109 (TeacherOutputSchema), 420-476 (unknownFields, validIsolatedField, retainValidFields), 557-562 acceptedResult; mapping-teacher-prompt.ts (read only); apps/studio/src/features/intake/table/model.ts:11-25 (one word line); docs/evidence/gf-ai/gateway/lp6/result.json (read only)
- **Check:** scripts/agent/mapping-teacher.test.ts gets a replayed LP6-shaped answer on the lgd-gurugram.csv profile: every field has a valid target and a rationale with a digit.
- Expected: each field is kept with the withheld rationale and issue TEACHER_RATIONALE_WITHHELD, state needs_input.
- The schema still refuses 'column 3', 'EPSG 4326' and 'coordinates', and still accepts 'the column header names a registration number'.
- **Tests:** scripts/agent/mapping-teacher.test.ts; scripts/agent/mapping-teacher-review.test.ts; scripts/agent/mapping-routing.test.ts; tests/model-gateway/diagnostics.test.ts

### S4.5 A dropped table is read and proposed without a press when its layout is certain

Size M, code only. After: S4.3 (keptWords export in intake-draft.ts) and S4.1 (teacher policy applies to the proposal). **Status: server part done 24 Oct (merged on int3-pre); the BatchTableSection change (read in progress instead of the press) waits for a UI chat session.**

- **What:** A dropped CSV, TSV, XLSX or ODS rests as kept until the officer presses Read as a table. Its mapping jobs start from the browser, so its card has no field meanings until someone acts. When the selection is certain, queue the same server calls the press makes, from a job: tableFromOriginal, then StreamingVectorService.enqueue and ChunkMappingService.enqueue, as queueApprovedTabular does. Certain means a CSV or TSV (its only allowed header is row 1) or a one-sheet workbook with header row 1. A workbook with several sheets keeps the press, and its card names that question. The table section shows the read in progress instead of the press.
- **Files:** packages/server/src/modules/usp/ingestion/intake-draft.ts:147-173 (keptOnly, keptWords), 274-283 (route), 331-345 settleKeptTx; intake-draft-worker.ts:294-313 (job pattern); service.ts:677-700 tableFromOriginal; chunk-mapping-learning.ts:180-201 queueApprovedTabular (pattern, read only); packages/contracts/src/usp/ingestion.ts:136-146 (selection rule, read only); apps/studio/src/features/intake/BatchTableSection.tsx:36-80
- **Check:** packages/server/src/modules/usp/ingestion/intake-draft.test.ts with its fake client.
- Enrolling lgd-gurugram.csv queues one table read. It writes a manual-tabular/1 profile, then exactly one streaming-vector and one chunk-mapping job with the item's pins. No officer request is involved.
- A two-sheet workbook stays kept, with words naming the sheet question.
- Replaying the enrolment queues nothing new.
- **Tests:** packages/server/src/modules/usp/ingestion/intake-draft.test.ts; intake-manifest.test.ts; tests/tabular-admission.test.ts; tests/table-later-receipt.test.ts; apps/studio/src/features/intake/BatchTableSection.test.tsx

### S4.5b The table section shows the automatic read instead of the Read as a table press

Size S, UI. After: S4.5. Task file E:/Projects/ulpin-wt/_tasks/s4-5b.md; branch task/s4-5b-table-reading. While the server reads a certain table (state reading), BatchTableSection shows the item's own words, not the press; the profile read is fetched again when the item changes. **Status: merged 28 Oct (int3-pre). While the server reads a CSV or one-sheet workbook the section shows the record's words as one status line; the profile read is asked again when the item's state or update time changes.**

### S4.6 Reading card fields: each field's meaning and where it came from

Size M, code only. After: S4.2, S4.3. **Status: done 25 Oct (merged on task/int3-pre).**

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

Size M, code only. After: S4.3; after S4.6 (same file intake-reading.ts). **Status: done 25 Oct (merged into task/int3-pre at d09138cb, pins 023d143b). Holds and drawing lines for DXF, CityGML, CityJSON, glTF, OBJ, IFC, PDF, raster and point readings from stored, hash-checked results; nested values as labelled lines; unstated stays not stated.**

- **What:** The item already names its stored readings: native reader job for DXF, CityGML, CityJSON, glTF and OBJ; ifcJobId; the PDF's document reading; plan_ref.header for orthophotos and point clouds. Read these once in the reading route and turn them into holds and drawing lines: objects and types, storeys and spaces, pages and pages needing OCR, pixels, bands, points, stated CRS and vertical reference. Add the layers a conversion left out. Reuse the Studio's existing summary words where they exist; no reader runs again.
- **Files:** packages/server/src/modules/usp/ingestion/intake-reading.ts; intake-ledger.ts:144-150 (job ids on the item); intake-native-readers.ts; intake-native-omissions.ts; intake-ifc.ts; documents.ts readDocumentResult (read only); intake-surface.ts:534-556; apps/studio/src/features/intake/native/reading-model.ts:45-60 (read only)
- **Check:** intake-reading.test.ts with stored job results from the existing reader tests (intake-native-readers.test.ts, intake-ifc.test.ts).
- A DXF reading states its entity count and that it is kept as evidence, not placed.
- An IFC names its storey count.
- A PDF names its pages and how many need OCR.
- With the data drive present, Box.glb, 1_polylines.dxf and Building_and_garage_LOD2-EPSG25832.gml give cards with no 'Not known' in what or drawing.
- **Tests:** packages/server/src/modules/usp/ingestion/intake-native-readers.test.ts; intake-native-omissions.test.ts; intake-ifc.test.ts; intake-surface.test.ts; tests/intake-pdf-batch.test.ts

### S4.8 The batch screen shows each file's reading card

Size M, code only. After: S4.3 merged with openapi.json and api-client types regenerated by the merger; field lines fill in after S4.6. **Status: merged 27 Oct (int3-pre c13d2e6f, no pin change). The card shows What, Holds, Fields, Drawing, Links and the question with an Answer button that moves focus to the existing answer section; Sarvam lines say Needs review; the tray's Contents shows the what line only from readings already loaded. Dropped from the task: formatWords from INTAKE_FORMAT_NAMES (the contract map lacks docx and shapefile-index).**

- **What:** Add ReadingCard.tsx and reading-model.ts with a useReading query, shown first in ItemDetail; the tray's Contents cell shows the one-line what. The card lists:
- what the file is and what it holds;
- each field's meaning, with its basis in words ('from a rule', 'from memory', 'from Sarvam, not confirmed', 'confirmed by you', 'not known');
- how it will be drawn, or why not;
- the one open question, with a button to the existing answer (View layout, Open the table, layer CRS, page choice).
Values come only from the reading. This is the single writer of ReadingCard.tsx. Each field's row shows its meaning and where it came from (memory, rule, Sarvam not confirmed, confirmed by you, not known); a Sarvam meaning carries Needs review until the officer confirms it; a file without links says so (merged from S4.8).
- **Lead note (24 Oct):** once S4.3 adds INTAKE_FORMAT_NAMES to the contracts, make batch-model.ts formatWords use it and drop the Studio copy of the map that S7.2 added, so the server and the Studio name formats from one list.
- **Files:** new apps/studio/src/features/intake/ReadingCard.tsx and reading-model.ts; BatchPage.tsx:108-122 ItemDetail; IntakeTray.tsx:25-48 (Contents cell 27-29); batch-queries.ts (one query, existing pattern); Batch.module.css
- **Check:** pnpm --filter @ulpin/studio exec vitest run src/features/intake/batch-page.test.tsx src/features/intake/reading-card.test.tsx
- An item with the NYC footprints reading shows what, holds, three field lines with their basis, and the layout question button.
- A kept unknown file shows its reason and no question.
- The tray row shows the one-line what.
- The $ui-design-check report is attached.
- **Tests:** apps/studio/src/features/intake/batch-page.test.tsx; IntakeTray.test.tsx; batch-model.test.ts; pnpm studio:typecheck && pnpm studio:test

### S4.9 The one officer question opens with the card's answers filled in

Size M, code only. After: S4.6, S4.8. **Status: merged 27 Oct (int3-pre b2e3da5f, types 63d57cee). The reading's field lines carry their target in the contract; the map and streamed layout answers open with the proposed kind (only when kindRefusal accepts it), identifier, name and height (only paths the question offers), each with a basis badge; an officer edit or a receipt wins; nothing is sent before approve. Table placement unchanged: the targets have no longitude, latitude or WKT role yet (later task).**


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

Size M, code only. After: S4.9. **Status: done 25 Oct, merged into task/int3-pre (contract and pins c27d1094; sent back once: dates, field names and the reading card fallback). A read-only layout-memory route and the reading card basis memory; server set 982 pass. The UI step is met through the reading: StreamedLayoutAnswer prefills from the reading's memory lines (StreamedLayoutAnswer.test.tsx, basis memory; lead check 27 Oct), so the Studio needs no call to the route.**

- **What:** A large GeoJSON's layout is officer-only: streamed recipes have no memory, while small files reuse approved recipes whose paths are contained. So every cell batch of a wide file and every converted layer asks the same question again. Reuse the containment check against the streamed profile paths to fill the streamed answer from the operator's newest approved recipe, shown as 'from memory'. Approval stays the officer's press. Cut candidate.
- **Files:** packages/server/src/modules/usp/ingestion/intake-draft-worker.ts:51-90 (export profileContained logic); streamed-mapping.ts:120-160; intake-large.ts:380-397 intakeLargePlan; intake-ledger.ts:98-110 (cell batches, read only); intake-reading.ts; apps/studio/src/features/intake/StreamedLayoutAnswer.tsx
- **Check:** intake-large.test.ts: two streamed profiles in one case with the same property paths.
- After the first recipe is approved, the second item's reading names the same key and name with basis memory, and StreamedLayoutAnswer opens filled.
- A profile missing the key path gets no memory answer.
- **Tests:** packages/server/src/modules/usp/ingestion/intake-large.test.ts; intake-large-steps.test.ts; intake-draft.test.ts; apps/studio/src/features/intake/StreamedLayoutAnswer.test.tsx

### S4.12 After the owner's yes, Sarvam names the remaining map-layer field meanings

Size M, code only. After: S4.1, S4.2, S4.6; switched on only after the owner's yes on PLAN Needs you 3. **Status: done 25 Oct, merged into task/int3-pre (pins after 2f27790c; sent back once: the step must never fail a draft and must not replace the layout proposal). A bounded GeoJSON layer (16 MiB, 2,000 features) with the S4.1 switch on sends its rule-unknown columns, at most five masked samples each and no contact line, through proposeMapping once; the result is kept in operations by item and source revision, and the reading lists those fields as candidates. Server set 1046 pass. A live Sarvam check rides on S4.10**

- **What:** Map layers reach Sarvam only through the building-key proposal, which takes only EPSG:4326 building polygons. Every other property stays unknown or rule-named. In the intake draft job, after memory and rules: profile the first 100 features as gis_attributes with masked samples, and call proposeMapping (teacher only under the S4.1 switch). Store the routed result in an operations row keyed by item and source revision. The reading shows those fields as Sarvam, not confirmed. Cut candidate.
- **Files:** packages/server/src/modules/usp/ingestion/intake-draft-worker.ts:119-135 preparedProposal; column-profile.ts:93-102 maskColumnSample, 255-265 profileGisAttributes; mapping-teacher.ts:841-873 (call only); adaptive-mapping.ts:148-150 (read only); intake-reading.ts (read the stored row)
- **Check:** intake-draft.test.ts with a replay gateway.
- The NYC footprints file makes exactly one teacher request, for the columns the rules left unknown.
- With the S4.1 switch off it makes none.
- The reading lists those fields with basis sarvam.
- A replayed draft job does not ask again.
- **Tests:** packages/server/src/modules/usp/ingestion/intake-draft.test.ts; scripts/agent/mapping-routing.test.ts; tests/tabular-admission.test.ts


### S4.13 A table whose meanings are ready says so and asks the officer

Size S, code only. After: S3.8. **Status: merged 28 Oct (int3-pre with pins). A table read settles read and needs_answer with words: meanings ready for review, no proposer, or failed with its code; Needs you shows. S4.13b (cancel) merged 28 Oct with a lead fix: an older payload that no longer parses is still cancelled.**

- **What:** In S3.8 both tables kept the words their field meanings are being proposed, with the chip Kept only, for 90 minutes: settleTable writes them once and nothing updates them. The words and the one pending-action rule follow the proposal state (ready, failed, no proposer), and the chip says Needs you.

## Step 5: Drawing every family

The map draws polygons only: lines, pins and table points are kept but never drawn (S5.1, S5.2). Reader ceilings are 8 to 128 MiB against the owner's 1 to 2 GB targets. 3D models and DXF are read but shown as words only.

### S4.13b A cancelled table meanings job leaves the table asking the officer

Size S, code only. After: S4.13. Task file E:/Projects/ulpin-wt/_tasks/s4-13b.md. cancelUspJob settles a tabular chunk-mapping job's item as failed with JOB_CANCELLED under S4.13's guards. **Status: merged 28 Oct (int3-pre dee55fc8).**


### S4.14 A large file's layout question offers as identifier only fields that are complete in the inventory

Size S, UI. After: S3.11d. Task file E:/Projects/ulpin-wt/_tasks/s4-14.md; branch task/s4-14-complete-identifiers. The Studio applies the server's completeness rule before offering an identifier, so Halifax is offered Position in the file. **Status: merged 28 Oct (int3-pre 81e0f5ae; intake 483 pass). Lead fix: both callers pass the chosen kind.**
### S5.1 Draw recorded and proposed lines and pins on the map

Size M, code only. After: S1 (int3-pre merged into staging). Parallel with S5.3, S5.4, S5.7, S5.8 (disjoint files). **Status: merged 27 Oct (int3-pre 64ced664 with a lead fix). Non-building LineString, MultiLineString, Point and MultiPoint features draw as base lines and pins (not pickable, inside the batch bounds); buildings stay polygon-only. Lead fix: a building recorded as a line and a geometry the map cannot draw are counted as not drawn again. Window mode: S5.2b.**

- **What:** The map draws polygons only. Road and utility layouts already accept lines and points, so KML paths and placemarks, road centrelines and lon/lat table rows become records the map never draws. Add optional lines and pins to BaseFeatureInput. Draw them in the existing base batches: one LineSegments object for lines and one Points object for pins, built in rebuildBaseLines, and include them in baseBounds. toBase should pass LineString, MultiLineString, Point and MultiPoint geometry for non-building kinds, and undrawnNote then counts only features that have no geometry. Display only: no picking or geometry change.
- **Files:** packages/scene/src/types.ts:45-58 (BaseFeatureInput); packages/scene/src/engine.ts:53-60 (BaseBatch), 554-705 (setBase, addBaseEntry, rebuildBaseLines, baseLines), 2081 (baseBounds), 2180-2200 (ringLines, lines); apps/studio/src/features/map/footprints.ts:45-83 (toBase, convertBase), 150-185 (polygonsOf, undrawnNote)
- **Check:** Take the 35 LineString features of fixtures/google-uttam/02-osm-road-centrelines.geojson (OSM, committed) as recorded road AreaFeatures. Expected: toBase returns 35 inputs, each with lines and no polygons. A scene engine test given them holds one base line object whose segment count equals the sum of (vertices minus 1) over the 35 lines. undrawnNote returns null.
- **Tests:** pnpm --filter @ulpin/scene test (base-incremental.test.ts, engine.test.ts); pnpm --filter @ulpin/studio test -- footprints map-frames; pnpm studio:typecheck; $ui-design-check report

### S5.2 The display window sends lines and pins

Size S, code only. After: S5.1 (BaseFeatureInput lines and pins). **Status: server half S5.2a merged 25 Oct (int3-pre 41d7a1c7; server set 1037 pass). Studio half S5.2b merged 27 Oct (int3-pre 2df798ef): the display window draws non-building lines and pins.**

- **What:** Large areas are drawn through GET /api/v1/areas/{areaId}/display-window. Its outline() keeps polygons only, its feature schema has only polygons, and windowScene skips a feature with no polygons, so lines and pins vanish in window mode even after S5.1. Add optional lines and pins to AreaWindowFeatureSchema, fill them next to outline() from the same local GeoJSON, and pass them to the scene in windowScene. The merger regenerates openapi.json and the api-client.
- **Files:** packages/contracts/src/area.ts:356-365 (AreaWindowFeatureSchema); packages/server/src/modules/areas/area-display-window.ts:120-147 (row mapping, outline); apps/studio/src/features/map/areaWindow.ts:41-52 (windowScene)
- **Check:** New case in area-display-window.test.ts: a proposed road whose local geometry is a LineString of 4 vertices inside the window. Expected: the response returns lines holding those 4 positions and no polygons, and windowScene turns it into one base input with lines.
- **Tests:** tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/areas/area-display-window.test.ts packages/server/src/modules/areas/area-display-read.test.ts; pnpm --filter @ulpin/studio test -- areaWindow; pnpm typecheck:backend; openapi.ts --check

### S5.3 NDJSON and GeoJSON text sequences take the large GeoJSON path

Size L, code only. After: S1. Parallel with S5.1, S5.4, S5.7, S5.8. In intake-draft.ts it owns lines 222-310 only. **Status: done 25 Oct (merged into task/int3-pre, contract and pins b7f119f7; sent back twice: the sealed receipt now takes any GeoJSON framing, and line numbers live in StreamingVectorRecord.sequencePosition, never in issueCode). geojson-lines framing; ndjson and geojson-seq cards take the large path, seal on the RFC 7946 basis and preview. The officer words naming a set-aside line: S5.3a (merged 25 Oct, contract and pins 70e4f1b3: up to five line or record numbers, first at when more); upload forecast words for .ndjson, .geojsonl and .geojsons (UI step).**

- **What:** A batch NDJSON or RS-framed GeoJSON sequence is probed as a vector, but no reader takes it. Only geojson cards reach the streaming reader, the item rests on the words Drafting accepts only a retained GeoJSON recipe original, and the large step always asks for feature-collection framing. Add a geojson-lines framing (one Feature per LF-ended line) to the existing reader next to geojson-seq-rs. Route ndjson and geojson-seq vector cards to the large path with their framing. Let the sealed map receipt accept a sequence, using the RFC 7946 lon/lat reference already used for a collection with no crs member. A record that is not a Feature is quarantined with words. Add forecast words for .ndjson, .geojsonl and .geojsons. The merger regenerates openapi.json.
- **Files:** packages/contracts/src/usp/streaming-vector.ts:29 (StreamingVectorFramingSchema); packages/server/src/modules/usp/ingestion/streaming-vector-reader.ts:130-176 (readStreamingFeatures); streamed-map-receipt.ts:19-23, 63-67; streaming-vector-worker.ts:67-74, 174, 277-344 (receipt and holdCollection by framing); streaming-vector.ts:150-152; intake-large-worker.ts:136-141 (startReaders framing); intake-draft.ts:222-232 (intakeReaderRoute), 273-310 (queueIntakeDraftTx retainedGeojson); apps/studio/src/features/intake/upload-model.ts:83-115
- **Check:** In a test, rewrite fixtures/google-uttam/00-all-google-detections.geojson (91 Open Buildings polygons, committed) as NDJSON and as an RS sequence. Expected: probeOriginal names them ndjson and geojson-seq, family vector. intakeReaderRoute gives streamed_geojson. readStreamingFeatures returns 91 features whose parsed values equal the collection's features. sealedMapReceipt gives sourceCrs EPSG:4326 with the RFC 7946 evidence words.
- **Tests:** tsx --tsconfig apps/api/tsconfig.json --test tests/intake-probe.test.ts packages/server/src/modules/usp/ingestion/streaming-vector-reader.test.ts streaming-vector-worker.test.ts streamed-map-receipt.test.ts intake-draft.test.ts intake-large.test.ts; tests/upload-reader-limits.test.ts; pnpm --filter @ulpin/studio test -- upload-reader; openapi.ts --check

### S5.4 GeoParquet in a batch is converted to GeoJSON layers like a GeoPackage

Size M, this PC: data drive. After: S1. Parallel with S5.1, S5.3, S5.8. S5.5 follows it (same file, native_gis.py). **Status: done 25 Oct, merged into task/int3-pre (pins 5cac94f3; sent back once: an answered CRS question now converts, and GeoParquet 1.0.0 is read). One layer per file from the primary geometry column, cited by row; an absent crs in 1.0.0 or 1.1.0 takes the specification CRS84 with basis words. Open: pyarrow in the processor image (S5.6); reading card and forecast words (UI step); other geometry columns are named only in the sidecar header.**

- **What:** A batch GeoParquet is probed as a vector but falls into the GeoJSON drafting words. The existing GeoParquet reader runs only on a host profile that the runtime does not build. Make GeoParquet a native-derivative format. In native_gis.convert_native_file, read it in row batches with pyarrow, turn each row's WKB into GeoJSON with shapely, and write it into the existing _Derivative writer with the row index as its locator. Take the CRS from the file's geo metadata using native_geoparquet.json_metadata and profile; a layer with no CRS goes to the existing layer CRS question. Add pyarrow==21.0.0 to services/geo/requirements.txt. nativeDerivativeFormat returns geoparquet, and hasConvertedLayers and the forecast name it. A plain Parquet without geo metadata stays kept as a table.
- **Files:** services/geo/geo/native_gis.py:375-420 (_Derivative), 1157-1174 (convert_native_file), 1229-1270 (convert_native); services/geo/geo/native_geoparquet.py:197-297 (reuse json_metadata, profile, wkb_guard; no pin change); services/geo/requirements.txt; packages/server/src/modules/usp/ingestion/intake-draft.ts:45-56; intake-native-derivative.ts:90-92 (kinds); apps/studio/src/features/intake/native/reading-model.ts:36-43; upload-model.ts:96-104
- **Check:** New case in services/geo/tests/test_native_conversion.py on E:/BhuAayam-data/task-data/desktop-geoparquet-native/originals/example.parquet, using pyarrow from that folder's wheels. Expected: one layer converted, written plus not-written features equal the file's row count, the layer CRS comes from its geo metadata, and each sidecar line names its row. alltypes_plain.parquet in the same folder converts nothing and stays kept.
- **Tests:** python -m pytest services/geo/tests/test_native_conversion.py services/geo/tests/test_native_geoparquet.py; tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/usp/ingestion/intake-native-derivative.test.ts intake-draft.test.ts; pnpm --filter @ulpin/studio test -- NativeReading

### S5.5 Native GIS conversion takes originals up to 1 GiB

Size M, code only. After: S5.4 (same file, native_gis.py). **Status: done 25 Oct, merged into task/int3-pre (pins 3e7c6615). Source and derivative bounds 1 GiB, shared with STREAMING_VECTOR_LIMITS; the conversion wait is streamingReadMs of the source (sum of a set's parts); 146 MB generated shapefile converted in test. Open: runtime proof with the image (S5.6); forecast words (UI step).**

- **What:** GeoPackage, shapefile (ZIP or loose set), KML and KMZ in a batch convert only up to 128 MiB of source and 128 MiB per derivative, and the server waits at most 10 minutes for a conversion, against the owner's 1 GB file and 500,000-feature layer. Raise the source and derivative bounds to STREAMING_VECTOR_LIMITS.sourceBytes (1 GiB). Scale the conversion request timeout with streamingReadMs of the source bytes, keeping the heartbeat. Update NATIVE_GIS_LIMITS and the tray and forecast words. Reading stays one window at a time. The words say layers enter the map path once the whole conversion ends.
- **Files:** services/geo/geo/native_gis.py:359-361, 1195-1200 (_pins), 1218-1219 (_set_parts); packages/contracts/src/upload-reader-limits.ts:16-17 (NATIVE_GIS_LIMITS); packages/server/src/modules/usp/ingestion/intake-native-derivative-worker.ts:21-30, 105-115; intake-native-derivative.ts:41, 265-275 (words); apps/studio/src/features/intake/upload-model.ts:96-100
- **Check:** New case in services/geo/tests/test_native_gis_shapefile.py: a test_only shapefile set above 128 MiB, written with pyshp into a temporary folder. Expected: it converts to one layer whose derivative bytes and sha256 match the written file, and the same set with the old bound would have been refused.
- **Tests:** python -m pytest services/geo/tests/test_native_gis_shapefile.py services/geo/tests/test_native_conversion.py services/geo/tests/test_native_kml.py; tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/usp/ingestion/intake-native-derivative.test.ts intake-shapefile-set.test.ts; tests/upload-reader-limits.test.ts

### S5.6 Processor image with GeoParquet and 1 GiB conversion, checked on reh-02

Size M, this PC: Docker. After: S5.4, S5.5, S2 (practice kit). The only runtime task while it runs. **Status: folded into S5.22 (one image from the integrated head carries S5.4 and S5.5); its GeoParquet and 1 GiB checks run on reh-02 with S5.22**

- **What:** The services/geo changes from S5.4 and S5.5 reach a runtime only through a new processor image pinned in scripts/platform/processor-image.json. Build the image from staging after both merge, pin it, and roll ulpin-reh-02 as REH16 did (its roll.json steps, doctor PASS). Then drop the practice kit's GeoParquet and its largest GeoPackage or shapefile above 128 MiB into one batch. Keep the old images. Roll back and stop reh-02 at the end. The demo is not touched.
- **Files:** scripts/platform/processor-image.json; scripts/platform/processor-image.mjs and processor-image-pin.mjs (use, no change expected); docs/evidence/5/s5.6/result.json
- **Check:** On ulpin-reh-02 serving the new image: both files show their converted layers in the tray, and after one layout answer each first layer has its first part on the map, with seconds recorded. Doctor PASS before and after, the image tag is recorded, and reh-02 is rolled back and stopped.
- **Tests:** node --test scripts/platform/processor-image.test.mjs scripts/platform/runtime-image.test.mjs

### S5.7 Decimal-comma coordinates can be placed when the officer states the mark

Size S, this PC: data drive. After: S1. Parallel with everything in this family (disjoint files). **Status: done 25 Oct: server part (contract and pins 685e5210) and UI part S5.7b (int3-pre a8c67f15: the officer states point or comma for x/y columns; WKT uses point). Studio type check, tests and build pass**

- **What:** A semicolon CSV with decimal commas is read, but its rows cannot be placed: coordinateText accepts only a decimal point, so every row is skipped as not_a_number. Add an officer-stated decimal mark to IntakeTablePlacementSchema (point by default, never guessed) and a choice for it in PlaceOnMapDialog. When the mark is comma, rowGeometry turns one comma per cell into a point before the existing exact-number check. WKT stays point-only. The merger regenerates openapi.json.
- **Files:** packages/contracts/src/usp/intake.ts:85-93 (IntakeTablePlacementSchema); packages/server/src/modules/usp/ingestion/wkt.ts:17-21 (coordinateText); table-geojson.ts:85-99 (rowGeometry), 34-41 (input schema); apps/studio/src/features/intake/PlaceOnMapDialog.tsx:60-90; table-placement-command.ts:10-40
- **Check:** New case in table-geojson.test.ts on E:/BhuAayam-data/task-data/reh14/act2/csv2-edmonton-heritage-semicolon-decimal-comma.csv (460 bytes, sha256 a71375bd...). Expected: with the mark stated as comma, 5 rows are placed as points whose coordinate text equals each cell with its comma made a point. With point stated, the same 5 rows are skipped as not_a_number, as today.
- **Tests:** tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/usp/ingestion/table-geojson.test.ts wkt.test.ts tabular-stream.test.ts; pnpm --filter @ulpin/studio test -- PlaceOnMapDialog TablePlacement; openapi.ts --check

### S5.8 A DXF is drawn in its own frame in its reading

Size M, this PC: data drive. After: S1. Parallel with S5.1, S5.3, S5.4 (disjoint files except the one forecast line in upload-model.ts). **Status: merged 27 Oct (int3-pre 64ced664 with a lead fix). A completed DXF reading draws LINE, LWPOLYLINE without bulges and WCS or unit-extrusion POLYLINE as one SVG in the file's own frame from the stored inspection (size and SHA-256 checked, pages verified), with the stated units, a not-drawn count by type and the not-on-the-map line; on 1_polylines.dxf 52 drawn, 31 not drawn (22 ARC, 9 TEXT). Lead fix: page, page-byte and entity bounds read DXF_LIMITS. Browser check not run.**

- **What:** A DXF is read by the pinned ezdxf inspection, but the Studio shows only its summary lines, so a plan drawing is never seen. In the item's reading, fetch the stored inspection through the existing GET .../dxf/jobs/{jobId}/native route. Draw LINE, LWPOLYLINE without bulges and POLYLINE vertices whose coordinates are WCS, or whose extrusion is absent or 0,0,1, as one SVG in the file's own units (say $INSUNITS as stated, or not stated). Add a line counting what is not drawn, by entity type: CIRCLE, ARC, INSERT, TEXT, OCS and bulged polylines. Display only: never placed on the map, and no scale or CRS inferred. Draw at most 50,000 segments and count the rest. Update the DXF forecast note.
- **Files:** apps/studio/src/features/intake/native/NativeReading.tsx:1-69; native/reading-model.ts:60-77 (readingView); native/useNativeReading.ts:8-30; services/geo/geo/native_dxf.py:210-265 and 440-465 (read only: entity fields, vertices, units); apps/studio/src/features/intake/upload-model.ts:93
- **Check:** Produce the inspection of the real E:/BhuAayam-data/task-data/desktop-dxf-native/sources/1_polylines.dxf (82,846 bytes, sha256 37f57491...) offline with read_dxf in the pinned env E:/BhuAayam-data/task-data/desktop-dxf-native/env. Write it under E:/BhuAayam-data/task-data/s5-8/, not committed. New NativeReading.test.tsx case on it. Expected: the SVG holds one path per drawn entity, drawn plus not-drawn counts equal the inspection's entity count, and the words say the drawing is not placed on the map.
- **Tests:** pnpm --filter @ulpin/studio test -- NativeReading; tsx --tsconfig apps/api/tsconfig.json --test tests/dxf-read-compatibility.test.ts; pnpm studio:typecheck; $ui-design-check report

### S5.9 PDFs above 16 MiB: page view and one-page OCR up to 1 GiB

Size L, this PC: runtime. After: S1, S2 (a scanned PDF above 16 MiB in the practice kit). Not in parallel with S5.6 (one runtime task at a time). **Status: code part S5.9a merged 25 Oct (int3-pre 6d9c05a5; a 1 GiB test PDF lists, renders and reads one page by OCR in 2 to 4 s, full page request 6.9 s); S5.9b merged 25 Oct (int3-pre 036ecff8; the Studio says 10 MiB and 1 GiB from the contract limits); the live check on reh-02 remains**

- **What:** A batch PDF above 16 MiB is kept and not read. Page inspection and the document worker read the whole original into memory, and the OCR helper refuses above 16 MiB. Stream the original once per job into its private scratch file and pass the path to the page renderer and to one-page OCR. Raise the page and OCR original bound to 1 GiB. Keep the 10 MiB text-layer bound and say so in the item words and the forecast. Refresh the host document profile through the existing documents step. Split at the page-view / OCR seam if it grows past 400 lines.
- **Files:** packages/contracts/src/document-pages.ts:4-5 (DOCUMENT_PAGE_LIMITS); packages/contracts/src/usp/document-ingestion.ts:6-9; packages/server/src/modules/usp/ingestion/document-pages.ts:56-120 (original, inspectPrivateDocumentPages); document-worker.ts:44-60; document-ocr.ts:140-160; services/geo/geo/usp_document_candidates/docling_tesseract.py:23-24, 90-105; intake-draft.ts:364-415 (queueBatchPdfTx, textLayerUnread); apps/studio/src/features/intake/upload-model.ts:105-110; scripts/platform/demo-document-runtime.mjs (documents step, use)
- **Check:** On ulpin-reh-02, a real scanned PDF above 16 MiB from the practice kit. Expected: the batch item says which pages have no text layer, page 1 opens in the page viewer, and OCR of one chosen page gives passages citing the original's sha256, revision and page. The API working set stays under 1.5 GB throughout. Afterwards reh-02 is rolled back and stopped.
- **Tests:** tsx --tsconfig apps/api/tsconfig.json --test tests/document-pages.test.ts tests/document-ocr-boundary.test.ts tests/intake-pdf-batch.test.ts packages/server/src/modules/usp/ingestion/intake-evidence-citations.test.ts; python -m pytest tests/test_document_pages.py; pnpm --filter @ulpin/studio test -- BatchPdfSection; node --test scripts/platform/demo-document-runtime.test.mjs

### S5.10 A DOCX in a batch is read by the document reader

Size M, code only. After: S5.9 (same PDF section of intake-draft.ts). It may run before S5.9 if S5.9 has not started. **Status: done 25 Oct (merged into task/int3-pre, pins e49effbc; server part). A batch DOCX is queued with DocumentOriginal format docx and settles with paragraph and table-cell counts, floor or room passages cited to their paragraph or cell, and the reader limits in words. Studio step S5.10a merged 27 Oct (int3-pre dcd727e3, lead fix 220767f9 bounds the DOCX part pages by the document part limit): a batch DOCX lists its cited passages and its paragraph and cell counts, with no page viewer or OCR.**

- **What:** A DOCX is recognised, but it rests as kept-only with the words that no batch reader takes it, although the document reader already extracts DOCX text. Send a batch DOCX to queueBatchDocumentTx with its own format instead of the fixed pdf. Settle it with paragraph words, the way batchPdfSettlement does: a passage naming floors or rooms is a candidate cited to its paragraph. Show its passages in the batch item through BatchPdfSection, without pages or OCR. Add a forecast entry. This is cut-list item 5, so it goes last.
- **Files:** packages/server/src/modules/usp/ingestion/intake-draft.ts:109 (batchPdf), 156-174 (keptOnly, keptWords), 273-280, 364-460 (queue and settle); documents.ts:63-77 (queueBatchDocumentTx format); document-native.ts:64-80 (read only); apps/studio/src/features/intake/BatchPdfSection.tsx:15-25; pdf-reading.ts; upload-model.ts:83-115
- **Check:** New case in tests/intake-pdf-batch.test.ts: a DOCX built in the test the way services/geo/tests/test_area.py builds one. Expected: the batch item is queued to the document reader with DocumentOriginal format docx, and, given the reader's parts, it settles read with words naming its paragraph count and the paragraph that names floors.
- **Tests:** tsx --tsconfig apps/api/tsconfig.json --test tests/intake-pdf-batch.test.ts tests/t089-intake-routing.test.ts packages/server/src/modules/usp/ingestion/intake-draft.test.ts; pnpm --filter @ulpin/studio test -- BatchPdfSection upload-reader; $ui-design-check report

### S5.11 Raster reader reads a 2 GB GeoTIFF/COG as preview windows at a step

Size M, this PC: data drive. After: Step 1: the base rehearsal shows the act 1 TIF and LAZ getting raster-window and point-batch jobs (runtime proof of SA1 and LQ1). Can run in parallel with S5.12, S5.13 and S5.21. **Status: merged 25 Oct into int3-pre (706a5f87, pins 31f0896b; USGS whole extent at step 43, Raichur at step 242; one verified copy per original; server set 991 pass).**

- **What:** raster_window.py refuses originals over 16 MiB and reads only full-resolution 256-px windows, downloading and hashing the whole original for every window. Accept originals up to 2 GiB and add an optional whole-number window `step`: the output stays at most 256 x 256 px covering width*step x height*step source pixels, read with rasterio out_shape so GDAL uses COG overviews, and a null window becomes the whole extent at the step that fits 256 px (one overview). Download and verify each original once into a bounded private cache keyed by SHA-256 (atomic rename, least-recently-used eviction, free-space floor), reused by later windows and by point_batch.py _source_path. Report each band's valid min/max as an optional metadata field, so stored results still parse.
- **Files:** services/geo/geo/raster_window.py:21-25 (bounds), 30-41 (_window), 54-151 (read; default window 92-93; download/hash 70-82); services/geo/geo/point_batch.py:39-58 (_source_path uses the shared cache helper); packages/contracts/src/usp/raster-window.ts:4-11 (originalBytes 16 MiB to 2 GiB, sourcePixels, RasterPixelWindowSchema x/y max 100,000, optional step), 31-49 (bands min/max optional; refine stays on output pixels); services/geo/tests/test_surface_readers.py
- **Check:** E:/BhuAayam-data/task-data/d3/geo-py311/Scripts/python.exe -I -m pytest services/geo/tests/test_surface_readers.py -k 'overview or cache'. Expected, exit 0: the real nyc-10013-ortho-2018.tif read with window null returns one window of at most 256 px whose nativeBounds equal the full source bounds and whose windowTransform pixel size is the source resolution times the step; a second window of the same source does no second download; a wrong byte receipt is still refused.
- **Tests:** services/geo/tests/test_surface_readers.py; services/geo/tests/test_point_batch.py; tests/raster-publication.test.ts; tests/raster-read-authority.test.ts; tests/registry-raster-citations.test.ts (drive fixtures; the reader is re-pinned); packages/server/src/modules/usp/ingestion/intake-surface.test.ts

### S5.12 Batch screen draws a kept raster or point cloud in its own frame when it is not on the map

Size M, code only. After: None: it works with today's readers. Can run in parallel with S5.11, S5.13 and S5.14 (Studio files only). **Status: merged 25 Oct (521b2fda).**

- **What:** A surface with no batch area, outside the area or with no stated CRS is read but never drawn: frameTx returns not_placed and the map layer exists only for the area's site. Add a surface preview to the batch item detail. It reuses the existing parts page, display read, artifact routes and decode worker, draws raster parts as one canvas mosaic by their sourceCorners and point parts as a top-down scatter, and shows the not-placed words plus 'display only'. No new route; nothing is placed.
- **Files:** apps/studio/src/features/intake/BatchPage.tsx:115-117 (mount beside IfcStructure and NativeReading); apps/studio/src/features/map/surface/api.ts (browserSurfaceIo, reused), parts.ts:19-22 (isSurfaceItem), decode.ts, pixels.ts:68-73, las.ts:15-31; new apps/studio/src/features/intake/surface/SurfacePreview.tsx and its test
- **Check:** pnpm --filter @ulpin/studio exec vitest run src/features/intake/surface. Expected, exit 0: a raster item whose display reads state not_placed/no_batch_area draws its decoded parts on the preview canvas at their source-corner positions with the not-placed words; a point item draws its points; a placed item shows no preview. Include the $ui-design-check report for the batch screen.
- **Tests:** apps/studio/src/features/map/surface/parts.test.ts; apps/studio/src/features/map/surface/useSurfaceLayer.test.tsx; apps/studio/src/features/map/surface/tiff.test.ts; apps/studio/src/features/intake/batch-page.test.tsx

### S5.13 IFC reader configured on fresh demo and rehearsal runtimes

Size S, this PC: data drive. After: Owner prerequisite: a stable CPython 3.12 base on E: (downloading it needs the owner's yes). Otherwise use the codex-runtime interpreter the existing profile names (fragile). Can run in parallel with S5.11 and S5.12. **Status: done 25 Oct, merged into task/int3-pre (8bc550e6): IFC is the fifth native reader on its own unzip-only CPython 3.12.10 base (receipt beside it), with a fresh hash-locked offline environment per build; dry run: five verified; AC20-FZK-Haus reads 1 building, 2 storeys, 7 spaces**

- **What:** The batch queues an IFC reading (intake-ifc.ts:24-43), but no demo or rehearsal script sets ULPIN_IFC_PROFILE: demo-native-readers.mjs builds only dxf, citygml, gltf and obj on a Python 3.13 base, and ifcConfig needs a Python 3.12 runtime. Add an ifc entry with its own base interpreter and the pinned environment from E:/BhuAayam-data/task-data/desktop-ifc-native (wheels, dependencies.json). The roll's native-reader step then builds and checks five readers, and a fresh runtime reads an IFC instead of stopping with IFC_UNAVAILABLE.
- **Files:** scripts/platform/demo-native-readers.mjs:20-35 (defaultPython, readerSetup), the baseInterpreter check after line 40 (each reader's own Python version), build and check paths; scripts/platform/demo-native-readers.test.mjs; packages/server/src/modules/usp/ingestion/ifc-config.ts:30-46 (read only: profile rules); scripts/usp/ifc/profile.py (read); docs/backend/DEMO-RUNTIME.md (NP1 step words)
- **Check:** node scripts/platform/demo-native-readers.mjs check --paths <built native-reader-paths.json> reports ifc as verified beside the four existing readers, and an isolated ifcConfig() child accepts the profile. Then the IFC reader, run through that profile on E:/BhuAayam-data/task-data/paired-building-floor-sources-20261004-run01/originals/AC20-FZK-Haus.ifc, returns a summary whose structure state is read, with building, storey and space counts. Exit 0.
- **Tests:** scripts/platform/demo-native-readers.test.mjs; tests/ifc-authority.test.ts; tests/ifc-bytecode-profile.test.ts; packages/server/src/modules/usp/ingestion/intake-ifc.test.ts

### S5.14 Point reader: thinned batches from LAS/LAZ/COPC up to 1 GiB

Size M, this PC: data drive. After: S5.11 (shared verified-copy helper). Can run in parallel with S5.12, S5.13, S5.17 and S5.18. **Status: merged 25 Oct into int3-pre (pins 739c8da0; NYC COPC whole-cloud sample of 32,709 exact records at step 368 in 3.8 s).**

- **What:** point_batch.py refuses more than 16 MiB or 5 million points, so the real 74 MB NYC COPC (12,036,869 points) is kept, not drawn. Accept up to 1 GiB and 500 million points, and give the batch selection an optional `step`: it reads source points [start, start+count*step) with laspy's chunk iterator and keeps every step-th native record unchanged; batch null becomes a whole-cloud sample of at most 32,768 points. Batches grow to 32,768 points (artifactBytes 2 MiB) and the Studio LAS bound follows. It uses S5.11's verified cache.
- **Files:** services/geo/geo/point_batch.py:18-21, 27-37 (_batch), 61-70 (_validate_header), 107-129 (_read_native_batch), 132-151; packages/contracts/src/usp/point-batch.ts:5-7 (POINT_BATCH_LIMITS), 24-25 (PointBatchSelectionSchema, optional step); apps/studio/src/features/map/surface/las.ts:5 (LAS_LIMITS.points); services/geo/tests/test_point_batch.py
- **Check:** E:/BhuAayam-data/task-data/d3/geo-py311/Scripts/python.exe -I -m pytest services/geo/tests/test_point_batch.py -k thinned. Expected, exit 0: E:/BhuAayam-data/task-data/nyc-10013-multimodal/originals/20170504_980200.copc.laz read with batch null returns 32,709 native 30-byte records (every 368th point), all inside the header's sourceBounds, in under 150 s; nyc-10013-lidar-2017.laz with batch {start:0,count:8192} returns the same bytes as today.
- **Tests:** services/geo/tests/test_point_batch.py; services/geo/tests/test_surface_readers.py; tests/point-batch-formats.test.ts; tests/point-publication.test.ts; tests/registry-point-citations.test.ts; apps/studio/src/features/map/surface/las.test.ts

### S5.15 Surface plan: whole-extent overview first, then at most 64 preview parts, with honest words

Size M, this PC: data drive. After: S5.11 and S5.14 (contracts). Can run in parallel with S5.12, S5.13, S5.17, S5.18 and S5.19. **Status: merged 25 Oct into int3-pre (pins b5f0ed48; server plan and words; the Studio forecast words are S5.15b, a UI step; server set 996 pass).**

- **What:** intake-surface.ts plans every full-resolution window or 8,192-point batch of the whole original, caps them at 32 or 611, and refuses more than 16 MiB. With S5.11 and S5.14, part 0 becomes the whole-extent overview. Rasters are tiled in 256-px tiles at the smallest power-of-two step that keeps the long side within 2,048 px; points are planned as at most 64 contiguous thinned batches of 32,768 at step ceil(points/2,097,152). Raise jobsPerSource to cover rereads, let part 0 be read before the batch area exists (the existing reread path reads it again under the area), keep legacy items' plans as they are, and say 'a preview at 1:s' or 'every s-th point' in the item words and the Studio forecast rows.
- **Files:** packages/server/src/modules/usp/ingestion/intake-surface.ts:41-67 (surfaceReader limits and words), 145-150 and 177 (waitsForAreaTx holds only parts after 0), 339-353 (rasterPlan, pointPlan), 376-388 (acceptedHeader), 410-431 (acceptIntakeSurfacePartTx, caps), 534-551 (surfaceWords); packages/contracts/src/usp/intake.ts:598 (INTAKE_SURFACE_LIMITS); packages/contracts/src/usp/raster-window.ts:7 and point-batch.ts:7 (jobsPerSource); apps/studio/src/features/intake/upload-model.ts:77-80, 114-117
- **Check:** pnpm exec tsx --tsconfig apps/api/tsconfig.json --test packages/server/src/modules/usp/ingestion/intake-surface.test.ts. Expected, exit 0: the first accepted read of the real NYC COPC (12,036,869 points) plans part 0 plus 62 batches at step 6, with words naming the preview; a stated 40,000 x 30,000-px first read plans 20 tiles at step 32; the NYC ortho still plans full-resolution windows; in a batch whose vector is still drafting, part 0 is queued and part 1 waits.
- **Tests:** packages/server/src/modules/usp/ingestion/intake-surface.test.ts; packages/server/src/modules/cases/processing.test.ts; tests/raster-point-later-receipt.test.ts; apps/studio/src/features/intake/upload-reader.test.tsx

### S5.16 Overview drawn under its tiles; all parts of a DEM or point cloud shaded on one range

Size M, code only. After: S5.15 (header and part 0 convention) and S5.11 (band min/max). The integrator regenerates openapi and the api-client. **Status: merged 27 Oct (int3-pre, merge of a9ae6cee with the api-client regenerated). The display read carries an optional valueRange from the first accepted read (one-band raster: band valid min and max; points: LAS header Z bounds as raw integers); every part shades on it, clamped, and falls back to its own range without it; part 0 of a multi-part item draws under its tiles. Visual check on a runtime still to do.**

- **What:** Ground pictures share one render order with the depth test off, so S5.15's overview can be drawn over its finer tiles. Each DEM part is also shaded by its own range and each point batch coloured by Z rank within that batch, so neighbouring parts do not match. Give SurfacePartInput an `under` flag (lower render order) for part 0 of a multi-part item. Carry one value range in the display read (the overview's band min/max for one-band rasters; the header Z bounds as raw integers for points; both kept in the plan header at the first accepted read), shade every part with it, and fall back to today's behaviour when it is absent.
- **Files:** packages/scene/src/types.ts:95-103 (SurfacePartInput); packages/scene/src/engine.ts:2258-2288 (surfacePartObject); apps/studio/src/features/map/surface/parts.ts (part 0 flag, range pass-through), pixels.ts:41-73, las.ts:49-71, decode.ts; packages/server/src/modules/usp/ingestion/intake-surface.ts:376-388 (header range), 648-672 (surfacePartDisplayTx); packages/contracts/src/usp/intake.ts:617 (IntakeSurfaceDisplaySchema, optional valueRange)
- **Check:** pnpm --filter @ulpin/scene exec vitest run src/engine.test.ts && pnpm --filter @ulpin/studio exec vitest run src/features/map/surface. Expected, exit 0: an overview part renders below its tile parts; two adjacent one-band parts with different own ranges give the same grey for the same value under the stated range; two point batches give the same colour for the same Z. Include the $ui-design-check screenshot of the NYC DEM on the map.
- **Tests:** packages/scene/src/engine.test.ts; apps/studio/src/features/map/surface/parts.test.ts; apps/studio/src/features/map/surface/las.test.ts; apps/studio/src/features/map/surface/tiff.test.ts; packages/server/src/modules/usp/ingestion/intake-surface.test.ts

### S5.17 CityGML reader takes a real city tile within measured bounds

Size M, this PC: data drive. After: Step 2 practice kit holds a real CityGML tile. Can run in parallel with S5.18 and S5.19 (separate files). **Status: done 25 Oct, merged into task/int3-pre (contract and pins after S5.17; sent back three times: CityGML 1.0 read as stated, the 219 MB inventory kept out of the API, outlines still read on inventory overflow). Measured on the Berlin LoD2 1.0 tile: 244,832 elements, 1.36 GB peak; input bound 33 MiB (memory decides), inventory artifact 16 MiB, outline path 5.8 s and 802 MB. Open: the Berlin tile stays unplaced on its literal urn:adv CRS; the reading card does not yet say the inventory was too large (intake-reading.ts, intake-service.ts); host reader profiles repinned at S5.22.**

- **What:** native_citygml.py holds the whole file and stops at 32 MiB, 25,000 XML elements and 100,000 coordinate values, so a real LOD2 city tile is refused; only the 19 KB and 11 KB OGC samples have been read (CG1). On the practice kit's largest CityGML, measure peak memory and time, then raise the input, element, coordinate and output bounds and CITYGML_LIMITS to the largest values that stay inside the reader's 2 GiB and the worker deadline, up to 256 MiB. Anything larger stays kept, with words naming the limit. citygml_outline.py re-extracts the original in the processor and must take the same bounds.
- **Files:** services/geo/geo/native_citygml.py:43-64 (Limits), 148-200 (extract), 507-512 (encode_result); services/geo/geo/citygml_outline.py; packages/contracts/src/usp/citygml-ingestion.ts:4-6 (originalBytes, artifactBytes, workerMs, readMs); services/geo/tests/test_native_citygml.py, test_citygml_outline.py
- **Check:** With the CityGML reader environment (E:/BhuAayam-data/task-data/desktop-citygml-native/env), run python -m pytest services/geo/tests/test_native_citygml.py services/geo/tests/test_citygml_outline.py (exit 0). Then run once on the practice kit's largest CityGML: the read completes under the new bounds with peak memory under 2 GiB and time under the deadline, and the converter writes one outline per Building that has a ground surface (outline and Building counts in result.json).
- **Tests:** services/geo/tests/test_native_citygml.py; services/geo/tests/test_citygml_outline.py; tests/citygml-authority.test.ts; tests/citygml-read-compatibility.test.ts; tests/registry-citygml-citations.test.ts (journey pin, regenerated as CG2 did)

### S5.17a Reading card says when a CityGML inventory was too large to list

Size S, code only. After: S5.17. **Status: merged 25 Oct (int3-pre be375bb6; server set 999 pass)**

- **What:** A CityGML above the 16 MiB inventory bound still has its outlines read, but its reading card is silent about the inventory. Load the failed native job code CITYGML_OUTPUT_LIMIT as one fact and say in one line that the element inventory is larger than the reader lists, outlines being read from the unchanged original.

### S5.18 CityJSON reader takes a real tile and a CityJSONSeq file

Size M, this PC: data drive. After: Step 2 practice kit. Can run in parallel with S5.17 and S5.19. **Status: merged 25 Oct into int3-pre (sequence part only, db2b80e9: cjval cube_20_1.jsonl reads, line pointers /N; bounds wait for a real CityJSON tile).**

- **What:** native_cityjson.py stops at 8 MiB, 1,000 CityObjects, 100,000 vertices and 15 s, and reads CityJSON 2.0 only, so a typical 3DBAG tile is over its limits. A CityJSONSeq (.city.jsonl) is detected as cityjson by its first object but is not one JSON document; it is expected to fail (not run). Raise the bounds and CITYJSON_LIMITS to what the practice kit's CityJSON needs, as measured, and read a CityJSONSeq as its header plus each feature line through the existing CityJSONFeature path, so outlines with a declared EPSG reach the map path (B3D1).
- **Files:** services/geo/geo/native_cityjson.py:14-21 (bounds), 230-290 (envelopes and features, 249-267); services/geo/geo/cityjson_outline.py (read; change only if the sequence needs it); packages/server/src/modules/usp/ingestion/intake-signatures.ts:116-133 (jsonKind for the sequence); packages/contracts/src/usp/cityjson-ingestion.ts:4-5; services/geo/tests/test_native_cityjson.py, test_cityjson_outline.py
- **Check:** E:/BhuAayam-data/task-data/d3/geo-py311/Scripts/python.exe -I -m pytest services/geo/tests/test_native_cityjson.py services/geo/tests/test_cityjson_outline.py, exit 0. The practice kit's CityJSON (or its .city.jsonl) reads within the new bounds and writes its Building outlines with the stated EPSG basis (counts in result.json); E:/BhuAayam-data/task-data/reh15/act2/d1-3dbag-single-roof.city.json gives the same outline as today.
- **Tests:** services/geo/tests/test_native_cityjson.py; services/geo/tests/test_cityjson_outline.py; services/geo/tests/test_cityjson_processing.py; services/geo/tests/test_cityjson_processing_pins.py; tests/cityjson-authority.test.ts; packages/server/src/modules/usp/ingestion/intake-signatures.test.ts

### S5.18b CityJSON reader bounds measured on a real 3DBAG tile

Size S, this PC: data drive. After: S5.18. **Status: done 28 Oct, bounds unchanged (int3-pre 8e022628, evidence and receipt rows). Official tile 9-696-496 (21.3 MB CityJSON, 8,048 objects, CC BY 4.0, test_only) receipted in the practice kit. It reads in 17.9 s against the 15 s budget, a second encode adds 6.5 s against the 20 s child deadline, and the reading is 79.5 MB against the 32 MiB output bound because it carries the whole source document; at that ratio the output bound admits about 8.5 MiB, so 8 MiB stays. A tile above 8 MiB is kept with words (INPUT_LIMIT). Lead decision: a reading that points into the stored original instead of copying it waits until after the freeze.**

- **What:** S5.18 kept the 8 MiB bounds because no real CityJSON tile existed. Acquire one official 3DBAG tile (CC BY 4.0, test_only) into the practice kit with its receipt, measure the reader on it, and set the bounds from the numbers with a stated margin, as S5.17 did for CityGML.

### S5.19 IFC reading adds a storey outline in the file's own frame

Size L, this PC: data drive. After: S5.13 (to run live; the profile is re-pinned after this change). Can run in parallel with S5.15, S5.17 and S5.18. **Status: merged 25 Oct into int3-pre (pins 4e1c7690; AC20-FZK-Haus 2 outlines; bounds measured on a test_only 99,766-entity model, 13 s; host profile repinned after S5.13).**

- **What:** The IFC reader is structure-only (native_ifc.py:1 and 617, GEOMETRY_NOT_INTERPRETED), but the plan's cut order still keeps an IFC 'summary and outline'. Add a bounded second pass using the pinned IfcOpenShell 0.8.5 geometry and shapely (dependencies.json): project each storey's IfcSlab shapes (else IfcSpace) to plan in the file's own frame and length unit, and join them into closed outline rings per storey. Store them in the accepted artifact with an outline count in the summary; the words say 'own frame, not placed', and a failed pass leaves the structure reading intact.
- **Files:** services/geo/geo/native_ifc.py:27-52 (Limits), 383-460 (pass 1), 590-630 (result and findings); packages/contracts/src/usp/ifc-ingestion.ts (optional summary and artifact outline fields); packages/server/src/modules/usp/ingestion/intake-ifc.ts:48-56 (intakeIfcReadWords); services/geo/tests/test_native_ifc.py
- **Check:** With the IFC environment (E:/BhuAayam-data/task-data/desktop-ifc-native/env), run python -m pytest services/geo/tests/test_native_ifc.py -k outline. Expected, exit 0: AC20-FZK-Haus.ifc (E:/BhuAayam-data/task-data/paired-building-floor-sources-20261004-run01/originals) gives one closed outline per storey that has slabs, in its own frame and stated unit; services/geo/tests/fixtures/ifc1-structure-ifc2x3.ifc and ifc1-structure-ifc4.ifc keep their structure results.
- **Tests:** services/geo/tests/test_native_ifc.py; tests/ifc-authority.test.ts; tests/ifc-read-compatibility.test.ts; tests/registry-ifc-citations.test.ts; packages/server/src/modules/usp/ingestion/intake-ifc.test.ts

### S5.20 IFC panel draws the storey outlines in their own frame

Size S, code only. After: S5.19 (artifact fields). **Status: done 25 Oct, merged into task/int3-pre (b5f93a8e): each storey outline drawn beside its storey in the file's own frame, from the accepted artifact checked by size and SHA-256; display only**

- **What:** The IfcStructure panel shows only the building, storey and space tree. Read S5.19's outlines from the accepted IFC artifact through the existing .../ifc/jobs/{jobId}/native route and draw them as SVG in the file's own frame, one per storey, with words saying they are not placed on the map. This is display only.
- **Files:** apps/studio/src/features/intake/ifc/IfcStructure.tsx, structure-model.ts, useIfcStructure.ts, IfcStructure.module.css, IfcStructure.test.tsx
- **Check:** pnpm --filter @ulpin/studio exec vitest run src/features/intake/ifc. Expected, exit 0: an IFC artifact with two storey outlines draws two closed SVG paths with the own-frame words; an artifact without outlines shows the tree as today. Include the $ui-design-check report.
- **Tests:** apps/studio/src/features/intake/ifc/IfcStructure.test.tsx; apps/studio/src/features/intake/batch-page.test.tsx

### S5.21 glTF/GLB and OBJ drawn in their own frame in the reading panel

Size M, code only. After: None; can run in parallel with anything. Dispatch it last and drop it first: it is cut 1. **Status: merged 25 Oct (ee82d217).**

- **What:** glTF and OBJ readings appear only as words ('kept as evidence, not on the map', intake-native-readers.ts:132, 207-223), although each accepted artifact already holds projected positions and indices (native_gltf.py:603-616; native_obj.py:200-207). Add a small own-frame mesh preview to packages/scene (three.js is already a dependency) and show it in the NativeReading panel from the existing .../gltf/jobs/{jobId}/native and .../obj/jobs/{jobId}/native routes. It is flat-lit and can be orbited, with words: own frame, axes and units as the reading states, not placed.
- **Files:** new packages/scene/src/model-preview.ts plus its export in packages/scene/src/index.ts; apps/studio/src/features/intake/native/NativeReading.tsx:17-48, useNativeReading.ts, reading-model.ts (positions and indices from the artifact); apps/api/src/modules/ingestion/gltf.controller.ts:70-77 and obj.controller.ts:70-72 (read only)
- **Check:** pnpm --filter @ulpin/studio exec vitest run src/features/intake/native && pnpm --filter @ulpin/scene exec vitest run. Expected, exit 0: a glTF artifact shaped as the Box.glb reading states (E:/BhuAayam-data/task-data/desktop-gltf-native/final-glb/gltf.json: 2 nodes, 1 primitive, 24 positions, 36 indices) gives a 12-triangle preview with the own-frame words; an OBJ artifact with two faces gives two polygons. Include the $ui-design-check report.
- **Tests:** apps/studio/src/features/intake/native/NativeReading.test.tsx; packages/scene/src/engine.test.ts; packages/scene/src/warm-programs.test.ts

### S5.22 Processor image and host reader profiles with the step 5 readers; practice-kit 3D and imagery files on reh-02

Size M, this PC: Docker. After: Step 1, the step 2 kit, and S5.11 to S5.20 accepted and integrated. This is the only runtime task in the area and needs a quiet PC. **Status: image part S5.22a merged 25 Oct (int3-pre 87634448). Live run 25 Oct on reh-02 at int3-pre 9acfe29f failed (evidence on task/s5-22-reh02-files 3a1a5d32): glTF, OBJ, IFC, DOCX, PDF and the LAZ draw or read; both rasters and the 800 MB GeoJSON sequence are refused because the large-original/2 storage reservation is not set on any runtime (S5.22b); the 4.5 MB WikiHouse DXF stops at the 10,000-entity bound (S5.8a); a LAZ in a mixed batch has no row action, so its preview cannot open (S5.22c); the LAZ alone stopped at 4 of 54 parts with no queued job (cause unproven, before S1.3b: S1.3 run 3 watches it). CityGML output limit, GeoParquet countries with no kind and no GIS file above 128 MiB in the kit are as designed or not produced. Runs again after S5.22b, S5.8a and S5.22c.**

- **What:** The readers changed in S5.11 to S5.19 run in two places: the processor image (raster, point, CityJSON and both outline converters) and the host profiles built by the NP1 step (CityGML, glTF, OBJ, IFC). Build and pin the image from services/geo, roll ulpin-reh-02 to the integrated head with the native-reader step, and drop each practice-kit 3D and imagery file in its own batch, then all together. For each file, record the route, reader outcome, how it is drawn (map or own frame) or its words, and seconds to the first and last part. Fix configuration only; any code fault becomes a new task.
- **Files:** scripts/platform/processor-image.json; scripts/platform/demo-native-readers.mjs (run, not edited); docs/backend/DEMO-RUNTIME.md (roll steps); docs/evidence/5/s5-12/result.json
- **Check:** On reh-02, every practice-kit file of the 3D and imagery families is drawn (on the map or in its own frame) or kept with plain words; each surface's first part appears within 60 s of its drop (or of its area, when it has one); pnpm journey:check --case <act 1 case> passes its surfaces step.
- **Tests:** pnpm journey:check; node scripts/platform/demo-native-readers.mjs check


### S5.22b Every demo-profile runtime starts with the large-original/2 storage reservation set

Size S, this PC: code. After: S5.22 run 1. **Status: merged 25 Oct (int3-pre b0053538, no pin change). Every demo-profile start sets the reservation from the contract (22 GiB); the doctor prints it beside the object-storage volume free bytes and fails below it. Live proof in the S5.22 rerun.**

- **What:** large-original.ts refuses every large-original/2 upload with 503 UPLOAD_CAPACITY_UNCONFIGURED while ULPIN_LARGE_ORIGINAL_V2_CAPACITY_BYTES is unset, and no platform script sets it. The platform start environment sets it to the contract's maxStoredBytesIncludingTemporaryCopies; the doctor reports it beside the free bytes of the storage disk and fails below it.
- **Files:** scripts/platform/demo-config.mjs; the platform start and doctor scripts; their tests; docs/backend/DEMO-RUNTIME.md
- **Tests:** node --test on the platform tests; scripts/agent/a3c-demo-paths.test.ts; pnpm typecheck:backend

### S5.8a DXF count bounds measured on real drawings

Size S, this PC: data drive. After: S5.22 run 1. Before: S5.8. **Status: closed 25 Oct by S5.8b (merged): the measurement showed no single 16 MiB result can hold a real drawing, so the reading moved to bounded pages. Earlier record:** running 25 Oct (codex, task/s5-8a-dxf-bounds from 726bb2e8). First pass (2fe1c41c) measured WikiHouse: 25,064 entities, 253,681 tags; the 16 MiB output is full after 28 percent because each tag is written up to three times. Resumed with inspection profile 2 (each tag value once, readers accept 1 and 2), then bounds from the output budget. Profile 2 (5fc1c2ed) still fills 16 MiB after 37 percent of WikiHouse. Measured in full (74ae89b1, merged into int3-pre as evidence): 60.1 MB in profile 1, 45.6 MB in profile 2, 32.5 MB even without sourceTags; about 3 s and 0.59 GB peak. No single 16 MiB result can hold the drawing, so the bounds move to S5.8b.**

- **What:** The practice-kit WikiHouse drawing (4,519,566 bytes) stops at MAX_ENTITIES 10,000. Measure it and 1_polylines.dxf with test-only raised counts, then set entity, record, point and tag bounds so a 16 MiB drawing stays inside the unchanged memory, time and output budgets with a stated margin, as S5.17 did. DXF_LIMITS follow exactly.
- **Files:** services/geo/geo/native_dxf.py (bounds); packages/contracts/src/usp/dxf-ingestion.ts (limits); services/geo/tests/test_native_dxf.py
- **Tests:** pytest test_native_dxf.py in the pinned DXF env; tests/dxf-read-compatibility.test.ts; pnpm typecheck:backend

### S5.8b A DXF reading is stored in bounded pages

Size M, this PC: data drive. After: S5.8a. Before: S5.22 rerun. **Status: merged 25 Oct (int3-pre, task/s5-8b-dxf-pages 9a7424be; contract, client types and pins regenerated; new route for one page; processor image ulpin-geo:git-9a7424be7800 built and pinned at 1710369c). WikiHouse reads 25,064 entities in 6 pages (largest 8.37 MB, head 112 KB) in 2.1 s at 358 MB peak. Bounds from memory per entity with a 20 percent reserve: 60,000 entities, 65,000 records, 60,000 points, 600,000 tags, 20 pages. Readings stored by the earlier reader say the tool changed and need an explicit retry. Server set 1,065 tests, 0 failed; DXF Python 8 passed.**

- **What:** Profile 2 (each tag value once) as a head of at most 16 MiB plus entity pages of at most 8 MiB, ordinals global, each page its own pinned private object. Count bounds come from the measured memory per entity with a 20 percent reserve; input, memory, seconds and threads stay. One reader loads only the pages that hold the asked ordinals; fusion, citations and the native download use it, and stored profile 1 artifacts still read and cite.
- **Files:** services/geo/geo/native_dxf.py; scripts/usp/desktop-dxf-read.py; packages/contracts/src/usp/dxf-ingestion.ts; the DXF reader, processor, worker, fusion and citation files in packages/server; apps/api dxf.controller.ts
- **Tests:** test_native_dxf.py in the pinned DXF env; tests/source-fusion-dxf.test.ts; tests/registry-dxf-citations.test.ts; tests/dxf-read-compatibility.test.ts; the section 5 server set

### S5.12c The SurfacePreview mosaic test passes under full-suite load

Size XS, UI (Claude session). **Status: merged 25 Oct (int3-pre, c7385735). Cause: every published view shared the same part objects, so a picture decoded later reached an earlier frame and drew a third time. Each view now keeps its own copy; two deterministic tests cover a late decode. Studio 755 passed twice under worker load.**

- **What:** The mosaic test sees three drawImage calls instead of two under the full Studio run and passes alone; it failed in three full runs on 25 Oct. Name the cause and fix it so each part is drawn once per settled state, with a deterministic regression test; never loosen the assertion.
- **Files:** apps/studio/src/features/intake/surface/
- **Tests:** pnpm studio:typecheck; pnpm studio:test three times; pnpm studio:build

### S5.22c A surface row in a batch has a View the surface action

Size XS, UI (Claude session). After: S5.12. **Status: merged 25 Oct (int3-pre 350a8e06).**

- **What:** IntakeTray NextStep offers no action for a raster or point cloud not on the map, so in a batch of several files its preview never opens. Add a View the surface button when opensPreview(item).
- **Files:** apps/studio/src/features/intake/IntakeTray.tsx; IntakeTray.test.tsx
- **Tests:** pnpm studio:typecheck; pnpm studio:test; pnpm studio:build

### S5.24 The Add files forecast names every kind the batch reads

Size S, code only. After: S5.3, S5.4, S5.10 (the readers it names). **Status: merged 27 Oct (int3-pre, pins 3a466043). Eleven extensions forecast with the bound the server enforces: line-framed GeoJSON 1 GiB, GeoParquet and shapefile members 1 GiB, DOCX 10 MiB (the native reader), ZIP 7 GiB (the upload ceiling; members have their own bounds).**

- **What:** The name-based forecast in upload-model.ts says Kind not known yet for ZIP, DOCX, GeoParquet, ndjson and jsonl, RS-framed GeoJSON sequences and the shapefile set members, although the batch reads them. Add a row for each with the bound the server enforces, from a shared contract constant.

### S5.25 A CityGML that states an AdV coordinate system name is placed by its sourced EPSG equivalent

Size S, code only. After: S3.8. **Status: merged 27 Oct (int3 6dceb972).** Source: AdV Produkt- und Qualitätsstandard für 3D-Gebäudemodelle v2.6 (2025-03-26), page 5 sections 3.4.1 and 3.4.2, hashes and rows in docs/evidence/step-5/s5-25/result.json. Table holds ETRS89_UTM32 → EPSG:25832, ETRS89_UTM33 → EPSG:25833 and DE_DHHN2016_NH → EPSG:7837 (vertical, recorded only); DE_DHHN92_NH stays unplaced (the source pairs no EPSG code with it). The Berlin tile places 546 outlines by EPSG:25833. The server control test now uses an AdV name the list does not hold.

- **What:** The Berlin LoD2 tile states urn:adv:crs:ETRS89_UTM33*DE_DHHN2016_NH, so its outlines stay unplaced. A small table of AdV names with the AdV source cited (the worker stops if no source states the equivalence) places it by the horizontal EPSG part; the vertical part is only recorded.

### S5.29 The 763 MiB India newline GeoJSON and its CSV twin prepare instead of stopping after repeated errors

Size M, code only (read-only queries on the stopped ulpin-reh-07 database). After: S3.11e. Task file E:/Projects/ulpin-wt/_tasks/s5-29.md; branch task/s5-29-india-ndjson. Both intake-large jobs failed 3 of 3 attempts with a ZodError whose detail is withheld; find the refusing schema and value, fix it at its source, and record zod issue paths (never values) in failure_cause. **Status: merged 28 Oct (int3-pre 2484e460 with pins; server 1,222 pass). Cause: the combined reader status enum lacked geojson-lines, so admitting the newline reader rolled back on every attempt; it now takes the vector framing options plus tabular. failure_cause keeps up to 20 zod issue paths and codes. The whole 763 MiB file is proven only by the next drop.**

### S5.30 A Berlin LoD2 CityGML of 26.7 MiB converts to layers instead of stopping at the 16 MiB output cap

Size M, code only. After: S3.11e. Task file E:/Projects/ulpin-wt/_tasks/s5-30.md; branch task/s5-30-citygml-output. CITYGML_LIMITS allows a 33 MiB original but a 16 MiB output; measure the Berlin output and either shrink it without losing stated values or raise the cap to a bound that holds for a 33 MiB original, with every downstream reader checked. **Status: round 1 done 28 Oct (28e25099): the native inventory of the Berlin tile is 209 MiB (7.84 times the original), so admitting it needs 384 MiB, 1.37 GB per job, a new image and wider wrapper and fusion limits. The layer conversion failed separately on the 200-character crsBasis bound against the cited AdV explanation. Lead decision: keep the inventory at 16 MiB with its limit words, widen crsBasis, prove the 546 outlines draw from the original (round 2, s5-30-r1.md). Merged 28 Oct (int3-pre with pins): the inventory stays at 16 MiB with its words, crsBasis takes 1,000 characters, and both Berlin forms give 546 accepted outlines in server tests; no services/geo change, no image.**

### S5.28 A ZIP or gzip member above 128 MiB is kept as a derived original on the large-original/2 receipt

Size M, code only. After: S5.26. Task file E:/Projects/ulpin-wt/_tasks/s5-28.md; branch task/s5-28-large-members. Members above the large-original/1 maximum (128 MiB) and within the v2 maximum and their reader bound are received on the v2 receipt with the same zip-layer/1 lineage; a v2 admission wait retries with words. **Status: merged 28 Oct (int3-pre ca2bf696 with pins; server 1219 pass, 0 fail). A member above 128 MiB from a zip-layer/1 parent is received on large-original/2 with its lineage checked against the admitted bytes and hash; a v2 receipt still finalizing keeps the member waiting with words and is resumed by lineage, never aborted.**

### S5.26 A gzip file gives out the one file inside it as its own batch item

Size M, code only. After: S3.13a. **Status: merged 27 Oct (int3-pre with pins, branch fdad8195; server 1189 pass). The gzip item queues one member job through the ZIP member path; the member is a derived original (zip-layer/1 lineage, parent sha256, crc32, member sha256) bounded at 128 MiB decompressed (the large-original/1 derived receipt ceiling, the same as ZIP members) and 100:1; a corrupt stream keeps words. The Microsoft member (about 800 MB) will stop at the 128 MiB bound with words; reading it needs derived originals on the large-original/2 receipt.**

- **What:** Through the ZIP member path: the gunzipped stream becomes a derived original pointing back to the gzip item, within the large-original ceiling and the ZIP ratio bound, then probed like any file.

### S5.27 A map file with no identifying field can be answered by each feature's position in the file

Size M, code only. After: S3.13a. **Status: merged 28 Oct (int3-pre with pins). feature_position@1 on feature.sourceKey with the geometry path; key position:<n> from the same counter as the locator (line number for line-delimited files); Studio offers Position in the file only when no field qualifies. The Microsoft file still exceeds the streaming feature ceiling.**

- **What:** Microsoft footprints hold only height and confidence, so their layout question can never be answered. A conversion feature_position@1 makes the source key position:n, equal to the feature's locator in the unchanged original (lead decision, 27 Oct: a locator, not an invented identifier), offered in the identifier select.

## Step 6: Linking

The only working link is an exact key the officer declares by hand (it works for the New York register). No address or place link and no suggestion exist yet.

### S5.23 The standard server test set runs on this PC, and its 16 standing failures pass or are named

PLAN step 5. Task file E:/Projects/ulpin-wt/_tasks/s5-23.md; branch task/s5-23-server-suite at int3-pre 8aa2bf36. The section 5 tsx line exits 1 on Windows (command-line length) before any test runs; workers fall back to a direct launcher that shows the same 16 failures before and after every change. One runner in batches, the cause of the 16 fixed without weakening a test, and the section 5 line replaced. **Status: merged 27 Oct (int3-pre 861249a1; evidence docs/evidence/step-5/s5-23). scripts/test-server.mjs runs the same 118 files in batches under the command-line limit and sums the counts; section 5 now names it. The 16 failures were test fixtures that copied worker code into scratch folders where @ulpin/contracts did not resolve; they now resolve it before copying and use the OS temp folder. On the integrated head: 1,145 pass, 0 fail, 13 skip.**
### S6.1 The record panel lists a building's links to register rows and pages, with the reason

Size M, this PC: data drive. After: S4.3 merged (one writer at a time for contracts usp/intake.ts). **Status: done 25 Oct: server half S6.1a (int3-pre 3d595027) and UI half S6.1b (int3-pre 38fac8aa): the Evidence tab lists each link with its file, row or page, key as written, outcome and review, read only**

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

Size M, this PC: data drive. After: S4.6. **Status: done 25 Oct (merged into task/int3-pre, pins 695029f2). Links by key (same identifier meaning, or the same header with no meaning), address and intersecting stored extents, each with its reason; nothing recorded, no counts; up to 64 items compared, 20 shown. Place links need stored extents: S6.2a.**

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

### S6.2a Place links work for kept GeoJSON files, and link words carry no codes

Size S, code only. After: S6.2. **Status: done 25 Oct (merged into task/int3-pre, pins fc671fe6). Every kept GeoJSON with stored, valid intakeExtent bounds cites them on its card; a CRS conflict still clears them; link words name the meaning and its basis, no code.**

- **What:** citeIntakeReceipt copies the stored measured extent into the card only for wide files, so a kept GeoJSON that fits one area never gets a place link. Copy it for every kept GeoJSON with a stored intakeExtent (cited, never measured anew), and drop the bracketed target code from the link words.
- **Files:** intake-ledger.ts (citeIntakeReceipt); intake-reading.ts (fieldReason); tests/intake-ledger.test.ts; intake-reading.test.ts

### S6.3 A suggested key or address link is declared in one press

Size S, code only. After: S6.2, S4.8. **Status: merged 27 Oct (int3-pre 8aa2bf36; evidence docs/evidence/step-6/s6-3). Each key or address link on the reading card has Declare, which opens Evidence by key with DeclareKey filled (anchor, map path, table, column, kind integer when the path is integerIdEligible, namespace from the two headers); disabled until buildings are drafted; nothing is posted before the officer declares. Known weakness: the link carries its two field names only inside its words, so the client reads them from that exact phrasing (any other wording leaves the form blank): S6.3a gives the link its field names as data once S4.9 has merged (same contract file).**

### S6.3a A reading link carries its two field names as data

PLAN step 6. After S4.9 (both change the reading contract). The contract's reading link gains the field name on each side; intake-reading.ts fills them; declareFromLink reads them instead of matching the words, and the Declare request passes through component state instead of the query cache. **Status: merged 27 Oct (int3-pre 7e53e067). Each key or address link carries fields { here, there } (null for a place link); declareFromLink reads them instead of matching words; the Declare request moves through BatchPage state, not the query cache.**

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

Size S, code only. After: S6.1. **Status: merged 25 Oct (77e48638); an area whose buildings come from several batches is coloured from one batch only.**

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

Size M, code only. After: none; parallel with S7.1, S7.3, S7.4, S7.5, S7.6, S7.7 (disjoint files). **Status: done 11e779fc on task/int3-pre (24 Oct).**

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

Size M, code only. After: none; parallel with S7.1, S7.2, S7.3, S7.5, S7.6, S7.7. **Status: done 25 Oct (merged into task/int3-pre, pins cba6685f; section 5 server set 956 pass, 4 skipped). Tabular limitations, GIS quarantine, missing-register lines and evidence stops in plain words, naming the file; exact codes stay in the structured fields. The SourceHeader line stays for a UI step.**

- **What:** Rewrite four server strings in plain words, keeping every fact: licence unconfirmed, personal data unknown, how many features were left out and why, original unchanged. The strings are: the table-page limitations ('officer_supplied; licence unconfirmed; containsPersonalData unknown.', 'The D8 manifest omits held-out original hashes...'), the quarantine toast ('INVALID_GEOMETRY: Ring Self-intersection[...]'), the record-page 'canonical geometry qualification is unavailable' line, and the stop line that names an item UUID. Codes stay in their structured fields, not in the sentence. The table page's limitation list starts closed.
- **Files:** packages/server/src/modules/usp/ingestion/tabular-source.ts:199-209 (admissionLimitations); packages/server/src/modules/areas/gis-quarantine.ts:3-10; packages/server/src/modules/officer/register-missing.ts:9-19; packages/server/src/modules/usp/ingestion/intake-evidence.ts:690-698; apps/studio/src/features/intake/table/SourceHeader.tsx:45-48 (details open)
- **Check:** tsx --test packages/server/src/modules/areas/gis-quarantine.test.ts packages/server/src/modules/officer/register-missing.test.ts tests/registry-document-read-projections.test.ts tests/tabular-admission.test.ts passes. gis-quarantine.test.ts asserts the REH16 NYC case (1661 of 1662 accepted, one ring self-intersection) reads as a plain sentence with no upper-case code. rg -n 'D8 manifest omits|officer_supplied; licence|canonical geometry qualification is unavailable' packages/server/src -g '!*.test.ts' prints nothing.
- **Tests:** packages/server/src/modules/areas/gis-quarantine.test.ts, packages/server/src/modules/officer/register-missing.test.ts, packages/server/src/modules/usp/ingestion/tabular-stream.test.ts, table-geojson.test.ts, tests/registry-document-read-projections.test.ts, tests/tabular-admission.test.ts, tests/intake-upload-provenance.test.ts, apps/studio/src/features/intake/table/SourceHeader.test.tsx, apps/studio/src/features/intake/evidence/confirm.test.tsx; pnpm typecheck:backend

### S7.5 Plain words in readings, layouts and packages

Size M, code only. After: none; parallel with S7.1, S7.2, S7.3, S7.4, S7.6, S7.7. **Status: merged 25 Oct (de44073c).**

- **What:** Five fixes in the Studio: (1) Finding counts end in raw codes such as '(BOUNDARY_CONTACT)' (REH16 a16): drop the code. (2) Each package is headed by its UUID and 'Revision N' (a13): head it with its anchor item's file name (Package.anchorItemId to the manifest item name), with the id copyable in a caption. (3) The native reading prints nested values as JSON, 'Not stated (stored as null)' and 'result SHA-256', with tokens such as globalPlacement and axes (lead-queue NR4 note): show labelled lines and put hashes in closed details. (4) The layout lists 'This layout also states: version, mode...': drop that line and say the origin plainly. (5) 'Its review has not run yet.' and 'The package review has not run yet.' appear together (REH14 act2-mx1-keyed-layout.png): show the review line once.
- **Files:** apps/studio/src/features/intake/run/Packages.tsx:5-43 (findingWords 5-13, line 20, heading 29, revision 37, reasons 33-35); apps/studio/src/features/intake/native/reading-model.ts:116-150; apps/studio/src/features/intake/native/NativeReading.tsx:38-49; apps/studio/src/features/intake/layout-model.ts:13-48; apps/studio/src/features/intake/LayoutQuestion.tsx:57-77
- **Check:** vitest. (1) run/packages.test.ts: the findings list for {BOUNDARY_CONTACT:1694} renders '1694 · Boundary contact only...' with no upper-case code. (2) The package heading shows the anchor item's file name. (3) NativeReading.test.tsx: a summary with a nested object renders labelled lines and no '{' or 'null'. (4) layout-model.test.ts: layoutLines on a streamed receipt has no 'This layout also states' line. (5) review-words.test.ts: the not-run line appears once.
- **Tests:** apps/studio/src/features/intake/run/packages.test.ts, run/review-words.test.ts, native/NativeReading.test.tsx, layout-model.test.ts, StreamedLayoutAnswer.test.tsx, layout-command.test.ts

### S7.6 The map reads lightly while a package streams

Size M, code only. After: none; parallel with S7.1-S7.5, S7.7. **Status: merged 25 Oct (9acfe29f; sent back once for a cached context read as settled).**

- **What:** Today, while a package streams, the map downloads it every 700 ms, re-reads the whole area every 5 s and invalidates every query in the app when the import settles. Three changes: (1) Count features by kind from context.displayFeatures by proposalPackageId, and take state and quarantine from context.packages, which are already polled, instead of the 700 ms GET of the whole package (every feature with three geometries). (2) Stop the 5 s re-reads of the area context and the canonical area once the package leaves RECEIVED, even if ?package= stays in the URL. (3) When it settles, invalidate only this area's and this batch's keys. The demo-import path (isDemoId, demo-import.ts:110) keeps working.
- **Files:** apps/studio/src/features/map/ImportTray.tsx:16-66 (useSettled 17-24, poll 33-37, counts 43-48); apps/studio/src/features/map/MapWorkspace.tsx:71-75, 125, 397-401, 574-580 (MapImportTray); apps/studio/src/features/map/MapPage.tsx:39-43; apps/studio/src/api/queries.ts:228-260; apps/studio/src/features/map/canonicalScene.ts:66-80
- **Check:** A new vitest with a counting fetch and the real NYC context apps/studio/src/local/data/nyc-bronx-context.json. Over 30 simulated seconds with the package RECEIVED: 0 GETs of /api/v1/import-packages/{id} and at most 7 area-context reads. After the package turns COMMITTED: no further context or canonical reads. The tray's building count equals the context's building features for that package.
- **Tests:** apps/studio/src/features/map/map-frames.test.tsx, canonicalScene.test.ts, areaWindow.test.ts, demoDraw.test.ts, surface/useSurfaceLayer.test.tsx

### S7.7 Header area switcher names the right area

Size S, code only. After: none; parallel with S7.1-S7.6. **Status: done 25 Oct (merged on task/int3-pre).**

- **What:** On batch and table pages the header names an unrelated area: REH15 'table page header named another case (Niagara Falls, Revision 0)', and REH16 act 1 the same. The switcher falls back to the remembered area or the first area on every route. Off map routes, show 'Choose an area' with no subtitle. Add the area's short id in mono to the subtitle and the menu, so two areas both named 'buildings original' (REH16 a03 against a09) can be told apart. A count of 0 shows as '0 features'.
- **Files:** apps/studio/src/app/Frame.tsx:114-181 (areaSubtitle 114-116, fallback 122-123, label 144); apps/studio/src/app/Frame.module.css (areaMeta)
- **Check:** New apps/studio/src/app/Frame.test.tsx using two areas both named 'buildings original', built from apps/studio/src/local/data/nyc-bronx-areas.json. Under MemoryRouter at /studio/work/cases/x/intake the button reads 'Choose an area'. At /studio/areas/<id> the two menu options' texts differ.
- **Tests:** new Frame.test.tsx; pnpm studio:typecheck

### S7.9 One way from the batch to the map, and a map that says it is drawing

Size M, code only. After: S7.6 (MapWorkspace.tsx) and S7.3 (BatchPage.tsx) merged first. **Status: merged 27 Oct (int3-pre 6b29c3fb). The batch header has Open on the map (the first listed package with an area, else an item's existing area; none otherwise). While ?package= is set and nothing of it is drawn, the map shows Drawing <file>: N features so far, gone at the first drawn footprint. Lead fix: no placeholder name when the file name is unknown.**

- **What:** The table offers 'Open package' only when an item has plan.packageId, so there is no batch-level route to the map; the header Map link opens the last remembered area. Add one 'Open on the map' button in the batch header when a listed package names an areaId, or an item names existingAreaId. On the map, while ?package= is set and no footprint is drawn yet, show a floating line 'Drawing <file>: <n> features so far', using the S7.6 counts. That replaces the empty grey canvas in REH16 a09; today nothingToDraw is forced false whenever a package is set.
- **Files:** apps/studio/src/features/intake/BatchPage.tsx:79-87 (header); apps/studio/src/features/intake/batch-model.ts:19-23 (packagePath); apps/studio/src/features/intake/run/model.ts:7 (Package.areaId); apps/studio/src/features/map/MapWorkspace.tsx:145-148, 455-467; apps/studio/src/features/map/footprints.ts (drawnCountNote)
- **Check:** vitest. (1) The batch header renders 'Open on the map' linking to /studio/areas/<areaId>?package=<packageId> for a TargetPage that lists a package with an areaId, and renders no link without one. (2) The drawing-line words, computed from nyc-bronx-context.json before any footprint is drawn, read 'Drawing ...: N features so far'.
- **Tests:** apps/studio/src/features/intake/batch-page.test.tsx, run/packages.test.ts, apps/studio/src/features/map/footprints.test.ts, map-frames.test.tsx

### S7.11 Batch screen as a file list and one detail pane (wait for the owner's list)

Size M, code only. After: S7.2, S7.3, S4.8 (the owner left the UI list to the lead on 24 Oct; the list is in STATUS.md). **Status: merged 27 Oct (int3-pre 3e10a106). File list and step strip on the left, the chosen file's reading in a sticky pane on the right, one column at 720 px; the selection lives in ?item=; the PDF readings nav is gone. Browser and 200 % checks wait for S7.16.**

- **What:** BatchPage stacks about a dozen sections in one scroll: the file table, PDF buttons, banners, the upload table, waiting files, the chosen file's detail (up to 7 sections), Evidence by key and the recording panels. The detail renders below the whole table. At desktop width, show the file list on the left, and on the right the chosen file's reading card, its question and its readings (one inspector per selection, design-system README Principles). Keep the selection in ?item= so a reload keeps it. Put the recording panels below as one 'Record buildings' section, drop the separate 'View PDF reading' buttons, and stack to one column at 200 %. Layout only; no new data.
- **Files:** apps/studio/src/features/intake/BatchPage.tsx:67-146 (state 70-78, PDF nav 139-143); apps/studio/src/features/intake/Batch.module.css; apps/studio/src/features/intake/IntakeTray.tsx:20-76 (selecting a row)
- **Check:** vitest batch-page.test.tsx. With the captured multi-item manifest, choosing the second row renders its ReadingCard in the detail region and sets ?item=<itemId>. Rendering with ?item= keeps that row. Screenshots at 1440 and 720 CSS px are taken in S7.16.
- **Tests:** apps/studio/src/features/intake/batch-page.test.tsx, plan-reading.test.tsx, BatchPdfSection.test.tsx, add-files-continue.test.tsx, unfinished-uploads.test.tsx

### S7.12 ZIP and KML members listed under their file (wait for the owner's list)

Size S, code only. After: S7.11 (UI list in STATUS.md, 24 Oct). **Status: merged 27 Oct (int3-pre 14ccc230, pins and client types regenerated; Studio 917 passed, server 1,163 passed, 0 failed). Items carry archiveItemId (optional, so earlier recorded manifests still validate); the tray lists members right under their ZIP or KMZ, indented, with a count, collapsed above 10 unless a member is selected or waits.**

- **What:** Members taken out of a ZIP or KML are separate rows, and only the reason text links them back ('Taken out of zp1-geojson-kml-csv.zip.', REH14 act2-zp1.png and REH15 zp2 words), although each item carries parentItemId. List members indented under their parent, collapsible above 10, with the parent's line giving how many files were taken out.
- **Files:** apps/studio/src/features/intake/IntakeTray.tsx; apps/studio/src/features/intake/batch-model.ts
- **Check:** IntakeTray.test.tsx: the existing 2,100-feature ZIP member case renders right after its parent and indented, still offering View layout. The parent's line states the member count.
- **Tests:** apps/studio/src/features/intake/IntakeTray.test.tsx, question-model.test.ts, retain-batch.test.ts

### S7.13 Add files: one dialog, a named batch, short forecasts (wait for the owner's list)

Size M, code only. After: S7.2 (IntakeDropDialog.tsx; UI list in STATUS.md, 24 Oct); forecast words follow step 5's drawing outcomes. **Status: S7.13b merged 27 Oct (int3-pre f6cd8ff0, with a lead fix routing TSV as a table): one reader phrase of at most 60 characters per file, the column is Reader, the unreachable table import and TableImportDialog removed. S7.13a merged 27 Oct (int3-pre): a table the batch reads joins the batch, nothing blocks Continue outside the NYC profile, the dialog is Add files with Add N files and Keeping the original, file names in the body font; the presenter and the demo guide follow (322a4e2b). The name prefill came with S7.20. Open: shorter forecasts; and the Add files table-import path is now reached by no format (TableImportDialog opener, tablesJoin, Continue with other files): remove or keep.**

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

Size S, code only. After: S7.9 (MapWorkspace.tsx; UI list in STATUS.md, 24 Oct). **Status: merged 27 Oct (int3-pre, lead fix 3a466043 keeps a layer's read failure visible under its row). Views, colours and the building search show only what the area holds (levels are known once a register is loaded); each layer is one row with an icon, count, switch and an About button for its sentence.**

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


### S7.17 Step strip and a Needs-you box on the batch page (UX review 1 and 2)

Size M, code only. After: none; before S7.11 (same page). **Status: batch page merged 27 Oct (int3-pre 5780ddb0, no pin change). A step strip (Files, Reading, Your answers, Confirm, Cards) with counts from the loaded records, the current step marked, each step moving focus to its section; a Needs-you box with one button per pending answer, evidence key or package confirmation, or one status line when nothing waits. Open: the Batches list Stage and Needs-you columns need the work queue to state intakeSummary.currentStep and pendingOfficerActionCount (server field, not cut yet).**

- **What:** [UX review](design/UX-REVIEW-2026-10-24.md) findings 1 and 2. A step strip (Files, Reading, Your answers, Confirm, Cards) with counts from the records, and a Needs-you box listing each pending action with one button, or what the system is doing when nothing waits. A test: every item in a Needs-you state renders exactly one visible action. The Batches list gains Stage and Needs-you columns.
- **Files:** apps/studio/src/features/intake/BatchPage.tsx, IntakeTray.tsx, batch-model.ts; the Batches list page.
- **Check:** a test per state with record fixtures; the S1.2 case (planned, needs_answer, no plan) shows one button.

### S7.18 Every disabled control says why and links to what unblocks it (UX review 5)

Size S, code only. After: none. **Status: merged 27 Oct (int3-pre f0551620, branch 0e8cfb51 with a lead fix; Studio 910 passed, 2 skipped). A shared reason line (DisabledReason) under each blocked control in the evidence and recording panels, linked by aria-describedby, with Try again or a focus link where another control clears it.**

- **What:** Finding 5: each disabled button in the batch, evidence and confirmation panels gets its one failing condition beside it and a link to the action that clears it.
- **Check:** a test lists every disabled control in those panels and finds a reason next to each.

### S7.19 Confirmation summary, filled acknowledgement and a Done panel (UX review 7)

Size M, code only. After: S4.9 if it is running at the same time (same panel); otherwise none. **Status: merged 27 Oct (int3-pre ff98d775, lead fix dfae5fbf: the acknowledgement refills after a stored confirmation, and Done shows only once progress exists; Studio set 864 pass).**

- **What:** Finding 7: a one-line summary with counts, three bullets (recorded, not recorded, cannot be undone), an editable acknowledgement filled from those facts, a button naming the count, then progress and a Done panel with Open the card, Verify and See on the map.

### S7.20 Batches can be told apart; news when work ends (UX review 9 and 10)

Size S, code only. After: S7.17 (Batches list). **Bound S7.20a merged 27 Oct (int3-pre, pins 3a466043): a repeat poll reads a per-case stamp of row ids and versions and summarises only the cases that changed plus the page; 220 test cases: first 52 ms, repeat 24 ms. The stamp read still grows with row counts (jobs, parts). Status: merged 27 Oct (int3-pre e7e4855f, lead fix cb282d5d keeps the 4 s processing poll). The work-queue answer gains waitingBatches for the tab dot; a toast says Reading done with Open; a new batch name starts from the file name and time, with a warning on a duplicate. Follow-up: waitingBatches reads every case the officer may open on each poll (64 ms on the 21-case fixture); bound it before large registers. S7.20b started 29 Oct (task file E:/Projects/ulpin-wt/_tasks/s7-20b.md; branch task/s7-20b-stamp-bound): measure the stamp at drop size and make the repeat poll follow changed cases. Merged 29 Oct (int3-pre 77a6d951): a poll with unchanged database visibility reuses its stamps (median 93.8 to 14.2 ms at drop size) and the fallback hashes rows without sorting; polls during active writes still scan row versions.**

- **What:** Findings 9 and 10: a suggested unique batch name at drop with a warning on a duplicate; a dot on the Batches tab when something needs you; a toast when a reading finishes or stops, with Open.

### S7.20b The Batches tab dot reads only what changed

Size S, code only. After: S7.20. Task file E:/Projects/ulpin-wt/_tasks/s7-20b.md; branch task/s7-20b-waiting-bound. waitingBatches builds a full summary of every case on each 4 s poll; keep a per-case waiting count keyed by the S7.20a stamp so a repeat poll recomputes only changed cases, with the same count. **Status: merged 28 Oct (2c2fcb94).** Repeat poll at 200 cases 29.0 to 7.4 ms median with no intake metadata read; full summaries only for the page; source counts and table ids read for page rows only; the count equals the old one in every fixture state.

### S7.21 A first-time start and focus that follows the work (UX review 12)

Size S, code only. After: S7.17. **Status: focus half S7.21a merged 27 Oct (int3-pre): after an answer saves, focus moves to the next Needs-you button, never while the officer types or has moved on. The empty-page How it works and sample files wait for the owner: three steps of explanation is helper text (owner, 25 Oct), and serving the NYC kit from the Studio needs a decision.**

- **What:** Finding 12: How it works on the empty Batches page with Try our sample files (our NYC kit, test_only); after an answer, focus moves to the next Needs-you action.

### S7.22 The map scene reads clearly: light, edges, fog and a drawn outline first (UX review V1 and V2)

Size M, code only. After: S7.6 and S7.9 if they run at the same time (MapWorkspace.tsx); packages/scene is free. **Status: merged 27 Oct (int3-pre, no pin change; evidence docs/evidence/step-7/s7-22 with before and after screenshots). Sun 1.6 over fill 0.8 from the south-west at 45 degrees, edges darkened toward ink to at least 3:1 (measured 4.2 to 4.8:1), wall to ground 1.65 to 1.74:1, fog starts at 1.1 framed reaches, flat horizon (sky gradient removed), the area extent drawn dashed until the first building. Waits on the owner's look: the after picture is darker overall (dark lower fill, the enhanced pad no longer light).**

- **What:** [UX review](design/UX-REVIEW-2026-10-24.md) V1 and V2. Measured today: building fill on ground 1.2:1, edges on ground 1.8:1; fog in the ground colour from 1.4 spans; hemisphere 1.6 and sun 1.35 both white; a sky gradient the design system forbids. Make the sun the key light (about 2 : 1 over the fill, south-west at 45°), building edges at least 3:1 against the rendered wall, fog starting past the framed area and a step lighter than the ground, a flat horizon in both looks. When the area context arrives and nothing is drawn, draw its extent as a dashed parcel-line outline and frame on it. Token values stay as the design system sets them.
- **Files:** packages/scene/src/engine.ts:244-262 (lights, fog, sky), 312-332 (looks), 1959-1980 (fitFog, ground), look.ts, palette.ts (read only); apps/studio/src/features/map/MapWorkspace.tsx (extent outline only)
- **Check:** a new packages/scene test renders the real NYC fixture offscreen and samples pixels: sunlit wall against ground at least 1.5:1, edge against wall at least 3:1, a building at the far edge of the framed area not fogged; the engine has no sky gradient. Before and after screenshots at 1440x900 of the same camera.
- **Tests:** packages/scene engine.test.ts, look.test.ts, camera.test.ts, incremental.test.ts; apps/studio map-frames.test.tsx


### S7.22a Brighten the map's fill light a little

PLAN step 7. Task file E:/Projects/ulpin-wt/_tasks/s7-22a.md; branch task/s7-22a-fill-light at int3-pre f59fb694. The owner kept the S7.22 look (27 Oct) and asked for a brighter fill: one fill constant at 1.0 (key : fill 1.6 : 1), every contrast bound kept, NYC render before and after. **Status: merged 27 Oct (int3-pre 613f5c7b; evidence docs/evidence/step-7/s7-22a). Fill 1.0, key : fill 1.6 : 1; shaded walls lighter (plain 82 to 91, enhanced 76 to 85 of 255); sunlit wall to ground 1.69 (plain) and 1.79 (enhanced), edge to lit wall 5.1 and 4.5.**
### S7.25 One status chip for files and batches (UX review V3)

Size S, code only. After: S7.26. **Status: merged 27 Oct (int3-pre, lead fix: a batch at Files shows its step word). itemChip and batchChip in status-chip.ts, StatusChip draws Badge; the Batches Step cell shows Needs you, Reading or Ready. Open: the tray's Status cell uses StatusChip once S7.12 merges (IntakeTray.tsx).**


S7.25b merged 27 Oct (int3-pre 750243fd; Studio 932 passed, 2 skipped): the tray Status cell shows the chip with the part progress and reason under it; useRetainTable removed, tableFormat private. Left: table/retain.ts tableSelection is now used only by its test.
### S7.26 The Batches list shows each batch's step and how many actions wait

PLAN step 7. Task file E:/Projects/ulpin-wt/_tasks/s7-26.md; branch task/s7-26-batch-summary at int3-pre f59fb694. The work queue gains intakeSummary (step and waiting count, batch-wide, by the manifest's own state rules, as S7.17's evidence named); the Batches list shows Step and Needs you columns. **Status: merged 27 Oct (int3-pre 573a3b4a; evidence docs/evidence/step-7/s7-26). One batched read per queue page computes intakeSummary {step, waiting} with the manifest's own item projection; Batches shows Step and Needs you (blank for 0 or null). The server repeats the batch page's pending-action rules in its own code: S7.26a makes both use one rule.**

### S7.26a One pending-action rule for the batch page and the work queue

PLAN step 7. The per-item pending-action rules live twice: apps/studio/src/features/intake/needs-model.ts and packages/server/src/modules/officer/work-queue.ts (intakeSummary). Move them into one pure function over the contract's intake item in packages/contracts, used by both, with one test table. **Status: merged 27 Oct (int3-pre 525127b9 with a lead fix). packages/contracts/src/usp/intake-needs.ts holds itemPendingKinds and batchStep; needs-model and the work queue both use them, with a parity test. Lead fix: the server's INTAKE_LARGE_STOPPED is now the shared stoppedReason, so the sentence the server writes and the one the rules match cannot drift.**
### S7.27 On the batch page the files table never runs under the sticky reading panel

Size S, UI. After: S3.11b. Task file E:/Projects/ulpin-wt/_tasks/s7-27.md; branch task/s7-27-files-overlap. At 1440 by 900 the files table ran under section#intake-reading and its View layout press could not be clicked; keep the table inside its column at every width from 721 px and at 200 percent zoom. **Status: merged 28 Oct (int3-pre 3336d0d4). The left column is its own track and long names wrap; no overlap at 1440, 1280, 1024, 721 and 200 percent zoom; every row button clickable. Follow-up S7.27b: at 1440 the action buttons sit in the table's sideways scroll, and the reading panel never sticks (.page overflow).**

### S7.27b At 1440 wide every files-table action shows without sideways scroll, and the reading panel sticks

Size S, UI. After: S7.27. Task file E:/Projects/ulpin-wt/_tasks/s7-27b.md. Lead's choice: the files column takes the larger share at wide screens; the reading panel sticks to the scrolling area. **Status: merged 28 Oct (int3-pre 10d57e6a; intake 477 pass). From 1280 wide the files take 3fr to 2fr: at 1440x900 the files table shows all 826 px with no sideways scroll; the reading panel stays in view at every width (at 1280x800 the table still scrolls 65 px in its tray).**


### S7.28 The map page stops freezing for seconds every few seconds once a large area has drawn

Size M, UI. After: S3.11c found it. Task file E:/Projects/ulpin-wt/_tasks/s7-28.md; branch task/s7-28-map-long-task. On the Niagara area (21 packages) the main thread held tasks of 1.4 s growing to 3.1 s from 13 minutes on, while a batch kept changing. Reproduce with a synthetic fixture, name the function, stop unchanged packages being rebuilt. **Status: merged 28 Oct (int3-pre d7baef36). Cause: Niagara is over the 10,000-feature display read, so the map draws by window; each 5 s re-read came back refused with no answer, MapPage showed the skeleton and remounted the windowed map, rebuilding 15,000 buildings (the owner recording: 5 s drawn, 1.4 s blank). Now the windowed map stays mounted. Fixture, 5 minutes: tasks over 100 ms 2,214 to 224, longest 1,030 to 226 ms. Left: 15,000 separate meshes cost 100 to 230 ms a render (S7.28b); the refused re-read still repeats on the server.**


### S7.28b A windowed area of 15,000 buildings renders a frame in under 100 ms

Size M, UI. After: S7.28. Task file E:/Projects/ulpin-wt/_tasks/s7-28b.md; branch task/s7-28b-batched-buildings. Buildings drawn in merged batches with a per-building index for picking, selection and outcome colours; the look unchanged. **Status: merged 28 Oct (int3-pre 2e489eba; studio 947 pass, scene 84). Fixture at 15,000 buildings on the RTX 3070: draw calls 39,172 to 181, one render 90 to 5.5 ms, a 2-minute orbit 196 tasks over 100 ms to 0; screenshots at rest, hovered and selected identical to the pixel. Left: batch buffers grow by doubling (about 50 MB at 15,000); see-through looks blend in vertex order inside a batch.**
### S7.29 Choosing a file while a drop is still uploading never reloads the page or drops the unsent files

Size S, UI. After: S3.11d. Task file E:/Projects/ulpin-wt/_tasks/s7-29.md; branch task/s7-29-upload-navigation. The upload blocker stops only a change of page, not a change of the chosen item. **Status: merged 28 Oct (int3-pre; intake tests pass). Choosing a file or a hash change keeps the queue in the same page; a real departure still asks.**
### S7.23 Visual hierarchy on the batch, verify and dialog screens (UX review V4 and V6)

Size S, code only. After: S7.17 and S7.11 (same pages). **Status: S7.23a merged 27 Oct (int3-pre 7b0eee5c; Studio 922 passed): the batch title is the batch name, one primary press outside dialogs (needs-model primaryPress: layout, table or record), Evidence by key starts closed with its count, verify titles ul-title. S7.23b merged 27 Oct (int3-pre 39406d3d; Studio 928 passed): the current step and the chosen page-image label carry a 2 px primary underline instead of the primary variant; exactly one primary in every batch page state and every Add files view.**

- **What:** V4 and V6. One studio-title per screen (the batch name), panel titles studio-heading; History and Evidence by key start collapsed with their count; one primary button per view, the rest secondary; file, batch and building names in Noto Sans, mono only for identifiers, hashes and coordinates; on the verify page the name first and the ID under it at id-code size.
- **Check:** node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs origin/staging passes; a test counts at most one primary button per rendered view of BatchPage, VerifyPage and AddFilesDialog.

### S7.24 Cut taglines, helper text and secondary labels on every screen (owner, 25 Oct)

Size M, UI (Claude CLI workers, six disjoint parts). After: S1.3 run 5 (the rehearsal runs alone); before the other S7 tasks, which then follow the same rule. **Status: all six parts merged into int3-pre 26 Oct (head 41c04392; Studio 770 tests pass, build passes). Each was reviewed line by line and sent back once to put back what the rule keeps: accessible names, values, record gaps, errors with their next step, disabled reasons, and the short lines that say what a public record legally is or what a press stores or removes (not a title document; no issuance implied; screening only, not a dig clearance; Prepare stores a snapshot, a plan and a packet; retire deletes nothing). Follow-up, folded into the next Studio task: remove the two pieces no screen reads now, readinessWords in intake/run/model.ts and the help, accepted and placeholder fields of local/requestKinds.ts (the Toggle hints show state, the DataTable caption is the table name, and the workbook words are the server's).**

- **Owner's words:** Cut taglines, helper text and secondary labels. If a screen needs them to make sense, fix the layout instead. Lets rectify this for all pages, statuses, UIs, pop-ups etc.
- **What:** Cut ledes, subtitles, explanatory sentences, hint props, captions that repeat a heading and smaller second labels. Where a screen would then be unclear, fix the layout (a shorter heading or label, grouping, order, column names, a section the officer opens), never move the sentence into a tooltip or collapsed help. State stays in its shortest form: a value and its label, a status, an error with what to do, an empty line, a value's state word (candidate, estimated, unknown), why a control is disabled, accessible names.
- **Parts (one writer per file):** S7.24a app frame, portal and the shared UI kit's own words; S7.24b intake except tables; S7.24c intake tables; S7.24d map and inspectors; S7.24e review; S7.24f register, identity, evidence, verify, manage, batches and placeholder.
- **Check:** each part writes docs/evidence/step-7/s7-24x/strings.json (every visible string with its verdict and totals); no tagline, helper sentence or secondary label left in its files; tests updated to the state or layout, none of a state, error or accessible name deleted.
- **Tests:** pnpm studio:typecheck; pnpm studio:test; pnpm studio:build
- **Follow-up:** once all six merge, remove the packages/ui props no caller passes (Toggle hint, DataTable caption) in one small task.

## Step 8: Rehearsal 1 on the closed kit

Thursday 29. Only the rehearsal worker runs on the PC.

### S8.1 Rehearsal 1: drop the closed kit on a fresh runtime and list what fails

Size M, this PC: Docker. After: Steps 3 to 7 accepted, or as many of their tasks as are done by Thursday 29. Task file E:/Projects/ulpin-wt/_tasks/s8-1.md; branch task/s8-1-rehearsal-1. Fresh ulpin-reh-15 at int3-pre edff4fbc; the rehearsal worker opens the closed kit for the first time, writes the GeoJSON layout answers as the rehearsal officer from each file's own field names, drops it all at once, runs act 1, and records results by generic file name only. **Status: first start stopped 29 Oct 06:36 before the drop (branch task/s8-1-rehearsal-1, b99edaf7, not merged): ulpin-reh-15 started with doctor 52 PASS and all 12 originals matched their sealed size and hash, but the drop runner refuses every holdout path (Protected path refused). Nothing reached the product; ulpin-reh-15 stopped with its volumes kept. Fix S8.1a; second start S8.1b on a fresh ulpin-reh-16 after it merges.**

### S8.1a The drop runner admits the sealed closed kit, and nothing else under holdout

Size S, code only (rehearsal scripts). After: S8.1. Task file E:/Projects/ulpin-wt/_tasks/s8-1a.md; branch task/s8-1a-closed-kit-admission. kit-drop.mjs --closed-kit accepts only the sealed manifest in the closed-kit folder, after its SHA-256 and file count match the step 2 seal, for a rehearsal runtime, with every entry inside that folder; every other protected path stays refused; the worker never opens the folder. **Status: merged 29 Oct (int3-pre 703f285c; rehearsal tests 55 to 66 pass).** With the flag, the console prints counts only and errors never name a kit file.

### S8.1b Rehearsal 1, second start, on a fresh ulpin-reh-16

Size M, this PC: Docker. After: S8.1a. Task file E:/Projects/ulpin-wt/_tasks/s8-1b.md; branch task/s8-1b-rehearsal-1. As S8.1 at int3-pre 703f285c with --closed-kit; results by generic file name only. **Status: done 29 Oct, merged as evidence (int3-pre cf8324b2).** All 12 originals kept and downloaded with their sealed hash and size; the API and dispatcher never exited; demo unchanged. Failed: nothing reached the map in 90 minutes (the batch had no map area: its only vector, a GeoJSON layer converted from a model, waited for a layout answer); two small CSVs stopped at the probe with a bare code; a workbook asked which sheet; a medium CityGML stopped at the coordinate limit; one large GeoTIFF refused for more than four bands, another failed a window (RASTER_UNSUPPORTED); 29 batch-page frames over 100 ms, each 1 to 2.5 s after a Docker guard run; act 1 not measured (its scratch driver waited for the old tables page). Fixes: S9.1a to S9.1h.

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

### S9.1a A small CSV never stops at the probe; a probe that stops says why

Size M, code only, from rehearsal 1 (step 3 reading). After: S8.1b. Task file E:/Projects/ulpin-wt/_tasks/s9-1a.md; branch task/s9-1a-csv-probe, at int3-pre cf8324b2. Failure described by format and symptom only; the worker never saw the kit. **Status: merged 29 Oct (int3-pre 0318b20d; server 1523 pass).** Common CSV and TSV variants read as tables; a stopped probe stores a closed reason and says it in one sentence; a refused zip member keeps its code in words (lead fix).

### S9.1b A workbook with several sheets is read without asking which sheet

Size M, code only, from rehearsal 1 (step 4 tables). After: S8.1b. Task file E:/Projects/ulpin-wt/_tasks/s9-1b.md; branch task/s9-1b-workbook-sheets, at int3-pre 089fe594. Failure described by format and symptom only; the worker never saw the kit. **Status: first pass stopped at a checkpoint (fbbcca1f, not merged): sheet profiling and header choice done, but per-sheet sources cannot share the workbook object (sources.object_key UNIQUE). Lead decision: each sheet becomes its own derived CSV object with lineage, enrolled like a converted layer; continued as S9.1b2 (task file s9-1b2.md) on the same branch. Merged 29 Oct as S9.1b2 (int3-pre 033a1a9d; server 1554 pass).** Each visible sheet with a candidate header is exported by a bounded reader to its own CSV, retained with its own SHA-256 and lineage to the workbook, sheet and header row, waits for an upload slot by itself, then enrolled as its own table item; an officer's header answer queues a new export and earlier CSVs stay unchanged. The lead kept S9.1a's header confirmation rule in the merge.

### S9.1c A medium CityGML is read whole, without the coordinate-count stop

Size M, code only, from rehearsal 1 (step 7 models). After: S8.1b. Task file E:/Projects/ulpin-wt/_tasks/s9-1c.md; branch task/s9-1c-citygml-medium, at int3-pre 0318b20d. Failure described by format and symptom only; the worker never saw the kit. **Status: merged 29 Oct (int3-pre 44f116ba; server 1544 pass; CityGML tests 45 pass per worker).** The coordinate allowance follows the input byte limit; coordinate values are decoded on demand instead of one record per number, so four 33 MiB test models convert whole within 2 GiB and 60 s; the outline converter spools buildings to a temp file. The lead kept S9.1e's converter layout in the merged header. Needs the processor image (IMG8) and the host CityGML profile rebuilt at runtime creation.

### S9.1d A GeoTIFF with more than four bands or an unusual layout is read and shown

Size M, code only, from rehearsal 1 (step 6 imagery). After: S8.1b. Task file E:/Projects/ulpin-wt/_tasks/s9-1d.md; branch task/s9-1d-raster-bands, at int3-pre cf8324b2. Failure described by format and symptom only; the worker never saw the kit. **Status: merged 29 Oct (int3-pre 9fdbadf3).** No band cap; display bands chosen by colour interpretation; any common sample type, codec and layout render as a display-only RGBA preview stretched per window; every refusal has its own code. Needs the processor image rebuilt before rehearsal 2. Known gap: per-window stretch can show seams between windows.

### S9.1e A GeoJSON layer the product converted carries its converter layout and asks nothing

Size M, code only, from rehearsal 1 (step 5 drawing). After: S8.1b. Task file E:/Projects/ulpin-wt/_tasks/s9-1e.md; branch task/s9-1e-converter-layout, at int3-pre cf8324b2. Failure described by format and symptom only; the worker never saw the kit. **Status: merged 29 Oct (int3-pre 298eccf8; server 1543 pass).** A converter that writes a GeoJSON layer records its layout pinned to the derivative bytes, converter version and original; small and streamed drafting accept it as converter_recorded (no officer subject, never in layout memory, rechecked at every use) and ask nothing; a lead fix makes the reading card show it as a rule, never as confirmed. Officer confirmation at the card stays.

### S9.1f A batch with no vector layer gets its map area from its first part with a stated CRS

Size M, code only, from rehearsal 1 (step 5 drawing). After: S8.1b. Task file E:/Projects/ulpin-wt/_tasks/s9-1f.md; branch task/s9-1f-area-from-part, at int3-pre cf8324b2. Failure described by format and symptom only; the worker never saw the kit. **Status: merged 29 Oct (int3-pre 089fe594; server 1490 pass).** The first published part with a resolvable EPSG CRS creates the batch area under the case lock, once.

### S9.1g The drop runner records every failed request and answers a converted layer question

Size M, code only, from rehearsal 1 (step 8 runner). After: S8.1b. Task file E:/Projects/ulpin-wt/_tasks/s9-1g.md; branch task/s9-1g-runner-requests, at int3-pre 0318b20d. Failure described by format and symptom only; the worker never saw the kit. **Status: merged 29 Oct (int3-pre e1df727a; rehearsal tests 81 pass).** Failed requests recorded by method, route template, status and error code only; officer answers may name a converted layer by parent and layer.

### S9.1h Act 1 has a driver in Git that follows the current Studio to the cited card

Size M, code only, from rehearsal 1 (act 1). After: S8.1b. Task file E:/Projects/ulpin-wt/_tasks/s9-1h.md; branch task/s9-1h-act1-driver, at int3-pre cf8324b2. Failure described by format and symptom only; the worker never saw the kit. **Status: merged 29 Oct (int3-pre f5349cd9; rehearsal tests 73 pass).** scripts/rehearsal/act1.mjs drives act 1 through the current Studio on ulpin-reh-17 up to the card, where the product stopped: stage 4 USP_JOB_ATTEMPTS, so journey:check found no cited card. Fix S9.1i.

### S9.1i Act 1 reaches its cited card: fix the card job that stops at its attempt limit

Size M, this PC: Docker. After: S9.1h. Task file E:/Projects/ulpin-wt/_tasks/s9-1i.md; branch task/s9-1i-act1-card, at int3-pre f5349cd9. Reads the failed case on ulpin-reh-17, fixes the root cause with a test, proves act 1 to the cited card on a fresh ulpin-reh-18. **Status: merged 29 Oct (int3-pre 0dd1c39b; server 1525 pass).** Root cause: the card job captured its snapshot and published progress in one repeatable-read transaction, so concurrent case events raised 40001 on every attempt until the attempt limit. Capture stays repeatable; progress publishes in a fresh fenced transaction. Act 1 on ulpin-reh-18 reached its cited card, journey:check 8 of 8. A first run hit a Studio Missing queryFn alert: S9.1j.

### S9.1j Reading a table inline never raises Missing queryFn

Size S, code only (Studio). After: S9.1i. Task file E:/Projects/ulpin-wt/_tasks/s9-1j.md; branch task/s9-1j-reading-query, at int3-pre e1df727a. **Status: merged 29 Oct (int3-pre bbf8f816; Studio 135 test files pass).** Cache-only observers used skipToken, which replaced the reading, manifest and evidence fetchers, so a later refresh had no fetcher. Shared query options keep the real fetcher; passive observers are disabled instead.

### S9.1k All display windows of one GeoTIFF share one colour stretch

Size S, code only. After: S9.1d. Task file E:/Projects/ulpin-wt/_tasks/s9-1k.md; branch task/s9-1k-raster-stretch, at int3-pre e1df727a. uint8 RGB shown as stored; other types stretched once per source. **Status: merged 29 Oct (int3-pre febedb64; server 1543 pass; geo tests 66 pass per worker).** The first window computes a 2 to 98 percentile stretch from the whole-source overview and records it on the source as a display-only header; every later window reads under that pinned stretch, and a reader that does not use it is refused. Interpreted uint8 RGB and grey stay byte-exact. A lead fix records the header on a source whose inspection is still empty. Needs the processor image rebuilt.

### S9.1m No case-row lock wait over 5 s while a kit drops

Size M, code only. From rehearsal 1 (lockWaits: 6.45 s on the case row, blocker appending a case event). Task file E:/Projects/ulpin-wt/_tasks/s9-1m.md; branch task/s9-1m-case-lock-hold, at int3-pre 033a1a9d. List every transaction that holds the case row and appends a case event, reproduce the longest offline, shorten it keeping the case-first order. **Status: merged 29 Oct (int3-pre 44085482; server 1562 pass).** A streamed cut now prepares its normalization (the processor call) in a short read transaction before the cut takes the case lock, and the locked publication checks a pin of the same proof, mapping and destination; offline hold 5.318 s to 0.193 s. Rehearsal 2 run 1 (before this) still saw one 5.35 s wait between two case-lock holders.

### S9.1n The Studio test suite runs in half the time

Size S, code only (test configuration). Task file E:/Projects/ulpin-wt/_tasks/s9-1n.md; branch task/s9-1n-studio-test-speed, at int3-pre 033a1a9d. pnpm studio:test takes about 390 s, 93 percent module import; same tests, same counts, at most half the time. **Status: Started 29 Oct.**

### S9.1l The drop runner and act 1 driver record video

Size S, code only. After: S9.1g, S9.1h. Task file E:/Projects/ulpin-wt/_tasks/s9-1l.md; branch task/s9-1l-runner-video, at int3-pre febedb64. A --video flag on kit-drop.mjs and act1.mjs records each browser page with Playwright's bundled ffmpeg into the run's output folder, for the plan's backup video. **Status: merged 29 Oct (int3-pre a3822b33; rehearsal tests 90 pass).** Contexts close before the browser so the WebM is complete after a failure or timeout; result.json lists relative video paths and sizes; --video is refused before any runtime call when ffmpeg is missing.

### IMG8 Processor image for int3 44f116ba

Size S, this PC: Docker build only. After: S9.1d, S9.1e, S9.1k, S9.1c. Task file E:/Projects/ulpin-wt/_tasks/img8.md; branch task/img8-processor-image. Build ulpin-geo:git-<12 hex> from services/geo at a156988d by IMG7's method, smoke test, pin in scripts/platform/processor-image.json. **Status: merged 29 Oct (int3-pre 05f97fb3). ulpin-geo:git-a156988dee58 built (999 MB, labels match, six smoke imports pass, fitz absent); the demo and the previous pinned image unchanged; platform suite 132 pass. The host native reader profiles are rebuilt and checked when the rehearsal runtime is created.**

### IMG9 Processor image for int3 46ed75bf

Size S, this PC: Docker build only. After: S9.3e, S9.3g, S9.3e2. Task file E:/Projects/ulpin-wt/_tasks/img9.md; branch task/img9-processor-image. Build ulpin-geo:git-<12 hex> from services/geo at 54ba6adc by IMG8's method, smoke test, pin in scripts/platform/processor-image.json. **Stat**Status: merged 30 Oct (int3-pre c21b7899). ulpin-geo:git-54ba6adc74b0 built (999 MB, labels match, six smoke imports pass, fitz absent, the three changed modules hash-match the checkout); the demo and previous pinned images unchanged; platform suite 132 pass. No native reader file changed since IMG8; the host profiles are checked when the rehearsal runtime is created.**

### S9.2 Rehearsal 2, recorded, then freeze

Size M, this PC: Docker. After: S9.1. **Status: open. S9.2a (run 1, task file E:/Projects/ulpin-wt/_tasks/s9-2a.md; branch task/s9-2a-rehearsal-2; fresh ulpin-reh-19; closed kit with --closed-kit, then act1.mjs and journey:check on the same runtime; evidence docs/evidence/step-9/s9-2/result-a.json) started 29 Oct alone on the PC at int3-pre 033a1a9d. Run 2, recorded with --video, follows on another fresh runtime. 30 Oct: S9.2b (run 2, task file s9-2b.md; branch task/s9-2b-rehearsal-2-run-2; fresh ulpin-reh-20 at int3-pre 6bed83a0 with every S9.3 fix and IMG9; recorded with --video; evidence result-b.json, which also records the cause of any file that misses the map) started alone on the PC on a Claude worker. S9.2b done 30 Oct (evidence on branch task/s9-2b-rehearsal-2-run-2, result-b.json): 12 of 12 originals kept and hash-matched, act 1 and journey 8 of 8 passed, no API or dispatcher exit, no failed request (run 1 had 70); but nothing was witnessed on the map. Better: the two CSVs read whole with positional names; the three GeoTIFFs read every window; the converted city layer is on the map in 98 s. Still failing: the GeoTIFFs are held outside the batch area (the area came from the converted city layer); the medium city model closed stale (its job pinned the case context before the first part created the batch area); 10 workbook sheets ended WORKBOOK_SHEET_UNAVAILABLE with the error not stored, 2 still ask; the runner never opened the map (it witnesses only packages). Done not met. Fixes S9.4. 30 Oct evening: S9.2c (run 3, task file s9-2c.md; branch task/s9-2c-rehearsal-2-run-3; fresh ulpin-reh-21 at int3-pre 4fc65d11 with every S9.4 fix; recorded with --video; evidence result-c.json) started alone on the PC on a Claude worker. 30 Oct night: S9.2d (run 4, task file s9-2d.md; branch task/s9-2d-rehearsal-2-run-4; fresh ulpin-reh-22 at int3-pre 326e5cc2 with every S9.5 fix and IMG10; recorded with --video; evidence result-d.json) started alone on the PC on a Claude worker. 30 Oct night: S9.2e (run 5, task file s9-2e.md; branch task/s9-2e-rehearsal-2-run-5; fresh ulpin-reh-24 at int3-pre 9a30659f with S9.6a, c, d and e; recorded with --video, 30-minute observation; evidence result-e.json) started alone on the PC on a Claude worker. S9.2d done 30 Oct (merged int3-pre d39f438f, result-d.json): 12 of 12 originals kept and hash-matched, 12 of 12 understood (the workbook sheets, the medium city model and its converted layer, all three GeoTIFFs read whole), act 1 and journey 8 of 8 passed, no API exit; the small city model on the map at 58.5 s and every GeoTIFF part drawn. Still failing point 3: the GeoTIFFs first drawn at 138 to 179 s (their uploads end at 124 s and 177 s), and the medium model's own area answers GET areas/:areaId/canonical with 403 REGISTRY_SOURCE_DENIED, so it never draws; 4 frames over 100 ms (one before the Add press). The drop wrapper was stopped by a 2-hour command limit while the videos encoded, after the 90-minute observation was saved. Done not met. Fixes S9.6. S9.2c done 30 Oct (merged int3-pre 7f588e9a, result-c.json): 12 of 12 originals kept and hash-matched, act 1 and journey 8 of 8 passed, no API exit, all 12 workbook sheets read; the small city model's converted layer reached the map for the first time, but at 93 s (over 60 s). Still failing: the three rasters (S9.4d's own-area step reads a name column the intake items table lacks, SQLSTATE 42703, so every admission tick rolls back; its tests used a fake database), the medium city model (native output over 16 MiB, CITYGML_OUTPUT_LIMIT; its partial layer lies over 50 km from the batch area, AREA_PROCESSING), the workbook draft job closed stale once and was never queued again; 9 frames over 100 ms; one 502 on the work queue. Done not met. Fixes S9.5. S9.2a done 29 Oct (evidence merged int3-pre 77a6d951, docs/evidence/step-9/s9-2/result-a.json): 12 of 12 originals kept and hash-matched; act 1 reached its cited card, journey 8 of 8; no API or dispatcher exit; but no map drew in 90 minutes. Two small CSVs stayed kept (Open the table); the workbook asked a header row for every sheet; the converted city layer stopped on repeated STALE_REVISION; the medium city model hit the 16 MiB inventory and its stated CRS was not accepted as EPSG; one large GeoTIFF timed out and one hit RASTER_DIMENSIONS; the small GeoTIFF stalled at 1 of 2 with SURFACE_ADMISSION_FAILED. 25 batch frames over 100 ms (max 815 ms), the slowest at the Docker guard runs again. Fixes S9.3.**

- **What:** As S8.1 on a new fresh runtime, twice if time allows. The second run is screen-recorded as the backup video. If Done holds, the lead rolls the demo runtime to the frozen commit (DEMO-RUNTIME.md roll procedure, owner informed), pushes staging, and freezes on Saturday evening: no change after that except a fix the owner asks for.
- **Files:** scripts/rehearsal/kit-drop.mjs; docs/backend/DEMO-RUNTIME.md; docs/STATUS.md; docs/evidence/step-9/s9-2/result.json
- **Check:** The plan's Done line holds on the recorded run, and the demo runtime serves the frozen commit with its doctor passing.
- **Tests:** pnpm platform:doctor --profile demo; pnpm journey:check


### S9.3 Fix the failures rehearsal 2 run 1 found

Size M, code only except S9.3a. After: S9.2a. Generic names only; fixers never see the kit. **Status: started 29 Oct. S9.3a (task file s9-3a.md; runtime ulpin-reh-19 read-only) records the exact stored reason and input shape per failed file. S9.3c (s9-3c.md) fixes the converted layer's STALE_REVISION loop. S9.3e (s9-3e.md) makes a large GeoTIFF's first window and stretch fit their deadline without the total-pixel refusal. CSV, workbook, city-model CRS and small-raster fixes follow S9.3a. Owner 29 Oct: the Docker guard task stays on during rehearsal drops; results keep naming the nearest guard run for each slow frame. S9.3a done 29 Oct (evidence merged int3-pre a0ff08e0, docs/evidence/step-9/s9-3a/result.json): both CSVs have header cells with no name (INTAKE_HEADER_CONFIRMATION); the workbook sheets state no header row (2 text and 10 numeric cells a row, six with one title row); the converted layer's STALE_REVISION is not a revision race but the proved cut requiring an officer subject on a converter approval (subject null); the medium city model names its CRS as a compound-style URN with one EPSG part; one large GeoTIFF is a 792-band float64 stripped cube that hit the 100 s native deadline, the other a 30-gigapixel 2-bit tiled raster refused by the pixel cap; the small GeoTIFF's area creation passes a number array to a jsonb column (SQLSTATE 22P02) on every tick; the 422 is the table profile asked before one exists, the 404 URL was not captured and the 69 events rows are stream aborts. S9.3c relaunched with the exact cause (s9-3c.md). Started 29 Oct beside it: S9.3b CSV empty header cells named by position (s9-3b.md), S9.3d headerless workbook sheets (s9-3d.md), S9.3f the area extent stored as JSON plus the SQLSTATE kept on the admission issue (s9-3f.md), S9.3g the one-component compound URN (s9-3g.md), S9.3h no profile request before a profile exists and the runner's request capture (s9-3h.md). S9.3e2 (the many-band cube and the 2-bit raster) follows S9.3e. 30 Oct: every codex account hit its limit at 17:52 on 29 Oct and the running workers stopped; codex-2 and codex-3 sign-ins had also expired. Owner: remove every account except codex-4 (done). S9.1n done (merged int3-pre 9066012a): the icon package is pre-bundled, Studio tests about 77 percent faster, same counts. S9.3e done (merged 66e10879): the display stretch comes from internal overviews or a bounded spread of blocks (new basis source_sample_percentile_2_98) and the Python total-pixel refusal is gone; a generated 3.6-gigapixel tiled raster drew in 7 s. S9.3g done (merged 5793e7a5): a one-component compound-style URN is read as its EPSG code; an unknown form now says so. Pins refreshed, int3-pre fe524e31 pushed, server 1563 pass. S9.3b, S9.3c, S9.3d and S9.3f resumed on codex-4 from their uncommitted work; S9.3e2 (s9-3e2.md: the 792-band cube read in one pass, a sampled first window for a huge no-overview source, the server pixel keep removed) started; S9.3h waits for room on the account; then started on a Claude worker (owner: Claude workers allowed). S9.3b done (merged int3-pre, pins a305cbc1, server 1571 pass): one helper names a header cell with no name column_N by position (collision-safe), used by the probe, the column profile, the head reader and the streamed CSV reader; duplicate names and leading lines still ask. S9.3f done (merged, pins e1a9076d, server 1583 pass): the area extent is stored as JSON and a database refusal keeps its SQLSTATE on the admission issue. S9.3d done (merged, pins d1128079): a workbook sheet whose body rows all share one shape is read with columns named by position, up to 3 title rows skipped. S9.3h done (merged 31ce37b1 plus a lead fix restoring the ask-again on a state change): no table profile is asked before one exists; the runner keeps the request URL and status of console errors and counts event-stream ends apart. S9.3c done (merged 0225e1ef): a converter-recorded layout is approved with no officer subject, so the converted layer no longer loops on STALE_REVISION. S9.3e2 done (merged bced902c, pins 46ed75bf pushed, server 1601 pass, geo raster 84 pass): the 792-band cube reads its display bands in one pass, a huge source without overviews gets a sampled first window, the server pixel keep is gone. 30 Oct started: S9.3e3 (s9-3e3.md, codex-4) the raster contract accepts the sampled overview, the display-bands-only band list and a far window; S9.3d2 (s9-3d2.md, codex-4) a headerless sheet with a few irregular rows still reads and the reading line stops asking; IMG9 (img9.md, Claude worker) the processor image for 46ed75bf. S9.3i (s9-3i.md, Claude worker): the batch page rereads a source record once when its item changes and it has no table profile yet, so a table the server read by itself shows without a reload. S9.3d2 done (merged int3-pre, pins 4957d491; lead fix: a blank row between the titles and the body is accepted): a sheet whose body rows share one shape in at least 90 percent of rows reads with positional columns, and the reading line no longer asks for it. S9.3e3 done (merged 4710b8ef): the raster contract accepts the sampled overview, a display-bands-only band list and window offsets up to the GeoTIFF bound; the per-window sampling marker stays out of the shared source header. S9.3i done (merged a6030fd1). int3-pre 6bed83a0 pushed: server 1605 pass, platform 132 pass, both typechecks clean.**

### S9.4 Fix the failures rehearsal 2 run 2 found

Size M, code only except S9.4a. After: S9.2b. Generic names only; fixers never see the kit. **Status: started 30 Oct. S9.4a (s9-4a.md, Claude worker; ulpin-reh-20 read-only, the kit only to classify shapes and run our scripts): where each raster lies against the batch area by distance class, and the workbook export error by exception class and our code frames. S9.4b (s9-4b.md, codex-4): a native model job that went stale is queued again under current pins when its source is unchanged, at most twice. S9.4c (s9-4c.md, Claude worker): the runner witnesses surface parts and converted layers on the map and takes an empty answers list. S9.4c done (merged int3-pre 816d4530; rehearsal tests 98 pass): the map canvas lists the items whose surface parts are drawn, the runner witnesses surface items and converted layers, an empty answers list is valid. S9.4a done (merged bb3bc4f9, docs/evidence/step-9/s9-4a/result.json): the rasters lie over 500 km from the batch area and from each other group, every corner transforms; the batch area came from a small city model whose local coordinates sit at its projection origin; the workbook sheets export fine but the sheet receipt sends media type text/csv, which the upload contract refuses, and the catch drops the error; 2 sheets ask because of a few formula or error cells; the 404 is most likely the browser tab icon. Started: S9.4d (s9-4d.md, Claude worker) a far raster or point cloud gets its own map area under the batch site, the Studio draws each area's own parts and the runner follows them; S9.4e (s9-4e.md, Claude worker) the sheet receipt sends a media type the contract accepts, the catch keeps the error kind, and a sheet with at most 2 percent formula or error cells reads with those cells left empty and counted. S9.4e done (merged int3-pre 6f42378b; server 1,619 pass, workbook python 34 pass): the sheet receipt sends octet-stream, a failed sheet keeps its error kind (seconds limit, receipt, export, unavailable), and a sheet with at most 2 percent formula or error cells reads with those cells left empty and counted. S9.4d done (merged c9520dd4; server 1,623, Studio surface tests and rehearsal 99 pass): a raster or point cloud whose parts meet no batch area gets one map area of its own (its own site, as map_areas.site_id is unique; UTM, else EPSG:3857 when too wide), the map draws only the parts placed in the area shown, the batch page links to it with ?case=, and the runner opens it there. Not yet proved on PostGIS; an own area opened from the area list draws no parts. S9.4f done (merged 4fc65d11, docs/evidence/step-9/s9-4f/result.json): no closed-kit table holds a coordinate pair, projected pair, geometry text, address or shared key; two name places by text or code only, with no position anywhere in the kit; tables are judged on Done point 2 and point 3 does not apply. S9.4b done (merged 5c1cdb81).**

### S9.5 Fix the failures rehearsal 2 run 3 found

Size M, code only except S9.5d. After: S9.2c. Generic names only; fixers never see the kit. **Status: started 30 Oct evening, all four on Claude workers (codex-4 at its limit), at int3-pre 7f588e9a. S9.5a (s9-5a.md): the own-area step reads the item name the way the manifest does, its SQL is proved in a gated PostgreSQL test on a throwaway container, and a converted vector layer beyond the batch area's 50 km rule gets its own map area. S9.5b (s9-5b.md): a CityGML native reading over 16 MiB is written in several parts within the limit (or read to the limit, not failed). S9.5c (s9-5c.md): an intake draft job that closed stale is queued again under the current case revision, at most twice. S9.5d (s9-5d.md, rehearsal class, ulpin-reh-21 read-only): the stage timeline of the 93 s to the first map, the 502 and the script slow frames, with three ranked changes. Done: S9.5d (merged afcfef7e): of the 93 s, the CityGML job took 41.5 s on a 1.4 MB file, about 25 s of it the tool inventory hashed about 13 times per job; the layer's mapping waited 8.7 s behind two table mappings; the 502 was a keep-alive socket the API closed after 5 s. S9.5c (merged da502e95): a stale intake draft is queued again under the current case revision at most twice; the run-3 workbook draft most likely ended stale in a completion race while its sheets were already settled, which this does not change. S9.5a (merged fff8e8da; gated PostgreSQL test 7 of 7): the own-area step reads the source name; a far converted layer gets its own area before its first cut, but areas.ts still refuses saving it there (S9.5g). S9.5b (merged 67812b79): a CityGML reading past 16 MiB keeps whole members in source order and ends READ_TO_LIMIT instead of failing; source fusion takes six findings (lead). S9.5e (merged 67812b79): the CityGML tool inventory is hashed once per process, later checks 0.3 s instead of 1.3 to 1.9 s; API keep-alive 65 s, preview proxy idle sockets 30 s; server tests no longer write Python bytecode into the pinned checkout (lead). S9.5f (merged 67812b79; gated PostgreSQL test): a map file's first mapping goes ahead of table mappings and keeps one table-lane slot while it waits. S9.5g (merged 8c7f5942; gated PostgreSQL test 8 of 8): a far converted layer's parts are saved in its own area without binding the batch case to that site, and the quarantine check, display proposals and namespace holders accept it; the recorded-building ledger and register reads still assume one site (after the freeze). IMG10 (merged 326e5cc2): ulpin-geo:git-3e210d8410d5 from services/geo 3e210d84, smoke imports pass.**

### S9.6 Fix the failures rehearsal 2 run 4 found

Size M, code only except S9.6b. After: S9.2d. Generic names only; fixers never see the kit. **Status: started 30 Oct night at int3-pre d39f438f. S9.6a (s9-6a.md, Claude worker): a converted layer's own map area reads and draws (the canonical area read and its citation checks accept a source that owns that area), proved in the gated PostgreSQL test. S9.6b (s9-6b.md, Claude worker, rehearsal class, ulpin-reh-22 read-only): where each GeoTIFF spent its seconds from the drop to the map, the upload of every file by stage, and three ranked changes. S9.6c (s9-6c.md, Claude worker, new ulpin-reh-23 with the mini kit only): no frame over 100 ms when a batch opens after Add, when the map code loads, or at a layer's first draw. S9.6d (s9-6d.md, codex-4): the runner tries a timed-out map witness again (at most 4 attempts, 20 s apart) and presses Add only on a settled page; frames before the press are reported apart. Added: S9.6e (s9-6e.md, Claude worker): a batch starts its smallest file first and a file waiting for an upload slot lets the next start; S9.6f (s9-6f.md, Claude worker): two surface-read jobs at once. Done: S9.6a (merged dafd7e9a; gated PostgreSQL test 9 of 9): the canonical area and building reads accept a source that owns the area; the ledger and register still assume one site (after the freeze). S9.6b (merged dafd7e9a): the GeoTIFFs lost their time at upload, not in the read: the 735 MB GeoTIFF sent its last byte at 62.6 s and the server took 57.2 s to assemble and verify it; the 459 MB GeoTIFF waited about 94 s for the single large-upload slot; the 12 KB GeoTIFF waited 123 s only because files started in drop order. At the best measured rate (16.7 MB/s) the 735 MB file cannot reach the map within 60 s while a whole file is stored before it is read. S9.6d (merged eb44f703; rehearsal tests 107 of 107). S9.6e (merged fca9a9ef). S9.6c (merged 9a30659f): the first model draw went from about 150 ms to under 60 ms and the first surface draw under 50 ms; the batch page no longer loads the 3D code; the map code load (105 to 230 ms, the shared contracts evaluated at page start) and the frame after Add (89 to 250 ms, cause not found) remain. S9.6f held on its branch (1e97be4f), not merged before the freeze: the processor reads one window at a time behind its verified-cache lock, so the gain is small, and it would start surface reads beside the first map mappings.**

## Merged during the review

- ui S7.8: merged into S4.3 and S4.8
- ui S7.10: merged into S3.9
- ui S7.15: merged into S4.8 and S6.3

