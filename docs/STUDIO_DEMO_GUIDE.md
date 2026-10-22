# Studio live-demo presenter runbook

This replaces the September source-to-record walkthrough, its Lake View fictional example,
legacy local-app address, and old intake limits. It is not a prepared-record tour.

**Evidence boundary.** The owner wants a cleaned Studio, one drop of the NYC files, a cited card after
one officer confirmation, then judges' unknown files without a code change.
The committed rehearsal proves less. REH9 reached cards, but its register did not join the batch and its
surfaces were not placed. Its runtime was not empty. [H9]
REH10 is listed as running in STATUS; `docs/evidence/runtime/reh10/` has no committed files here.
There are no REH10 screen words, seconds or completion receipt to use. [Board]

R9 is the latest committed demo roll receipt in these sources. It predates the newer register, surface
and evidence-screen work listed in STATUS. Do not present those merges as a completed rehearsal. [R9] [Board]
The architecture describes the intended flow, not a receipt that every part works. [Arch]

## 1. Thirty minutes before — check, do not rebuild

### Check the actual presentation runtime

Ask the runtime owner to run these from `E:/Projects/ulpin-wt/demo`, not a worker checkout.
These are instructions for the owner; this documentation task did not execute them. [Runtime] [Guard] [Live]

```powershell
Set-Location E:/Projects/ulpin-wt/demo
pnpm platform:doctor --profile demo
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/platform/docker-guard.ps1 -Check
node scripts/platform/demo-gateway.mjs status
```

**Doctor PASS:** `Doctor: all checks passed (dispatcher liveness, not a job execution proof).`
R9 recorded **28 PASS, 0 FAIL**. Require these lines, not just a running browser: [After]

- `PASS Document runtimes`
- `PASS Model gateway state`
- `PASS Docker local Linux engine and context/socket`
- `PASS Processors run the pinned image, built from this checkout's services/geo`
- `PASS API native process ownership`
- `PASS Dispatcher process ownership (liveness only)`
- `PASS API /api/v1/health`
- `PASS DB migrations applied (API structural admission)`
- `PASS API bound to the inspected ulpin-demo database`

**Docker guard PASS:** the engine answers and the command exits successfully.
Its JSON lists container state and health. Engine silence is not PASS. [Guard]

**Gateway PASS for the live-teacher claim:** `enabled: true`, `providerKeyPresent: true`,
`mappingTeacherAdapter: sarvam`, `dailyCapPresent: true`, and the approved policy hash.
The named and present key counts must agree. R9 recorded **11 named and 11 present**. [After] [Live]
Status does not prove remaining credit or a successful model answer. [Gateway]
A healthy replay-only runtime is not proof of a live teacher. REH9 passed doctor with the gateway off. [Doctor]
If the state differs, ask the owner. Do not enable, replace keys, raise caps or run the paid proof as a preflight fix.

### The bounded recoveries

- **Docker stale sockets.** The backend log says `.sock.stale` or `The file cannot be accessed by the system`.
  Do not press Docker's factory reset. The runtime owner runs: [Guard]

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/platform/docker-guard.ps1 -Recover
  ```

  The guard moves both socket folders aside and starts Docker. It keeps the old folders and volumes.
  Read `demo.outcome` too: a recovered engine alone does not prove the API started.
  Respect `stopped_on_purpose`, `paused` or `opted_out`; ask the owner before resuming an intentional stop.

- **API down, engine up.** REH8 recorded health `000` and no native processes. [H8]
  The runtime owner resumes the existing demo, then runs doctor again: [Runtime] [Guard]

  ```powershell
  Set-Location E:/Projects/ulpin-wt/demo
  pnpm platform:start --profile demo
  pnpm platform:doctor --profile demo
  ```

- **Document profile, schema, processor pin or process identity fails.** Stop preflight and hand the exact
  words to the runtime owner. `api PID identity changed` occurred in REH9 after a reboot; the reviewed fix
  moved the stale process record aside. Do not kill a reused PID or remove its record by hand. [H9]
  A document-profile mismatch needs the deliberate rebuild in the authorised roll-out, not an on-stage patch.
  A schema or pin mismatch also needs that reviewed roll-out. [Runtime] [R9]
- **Gateway mismatch or refusal.** Continue only with an honestly named replay/manual path, or stop the
  live-teacher segment. The owner handles configuration. Do not turn a failed answer into a value. [Live] [Gateway]

Never reset, reseed, initialise replacement storage, use `--create`, `down -v`, remove volumes or prune.
Do not edit the serving checkout, runtime files or credentials. [Runtime] [Guard]

### Check the stage, without preloading the demonstration

Open the presentation Studio's configured bookmark at `/studio/work` and keep its batch address handy.
The demo API is `http://127.0.0.1:3194`; this is the backend address. [Runtime]
The rehearsed browser used a separate Studio dev server, not that API origin. Its recorded address is not
proof of today's presentation frontend URL. Have the runtime owner confirm the bookmark and API target. [Harness]

Ask the owner to confirm that the presentation data was cleaned through the approved process.
R9 preserved **38 sources, 7 import packages and 67 physical features**; it did not clean the demo. [R9]
If the Studio is not clean, say so and pause. Never erase records to manufacture an empty opening.

Have these originals ready for the single drop. Paths are copied from the retained file receipt;
this task did not open the originals. [Files]

```text
E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson
E:/BhuAayam-data/datasets/nyc-10013-linked/nyc-landmarks-preservation-commission/gpmc-yuvp.csv
E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload/nyc-10013-ortho-2018.tif
E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload/nyc-10013-lidar-2017.laz
```

## 2. Act 1 — our NYC files, click by click

Say: **“These are public NYC development inputs, labelled test_only. We keep each original,
show what it supports, and ask an officer before recording.”** [H9] [Arch]

The timings below are separate measured intervals, not a promised total.
REH9 dropped a larger mixed selection. There is no measured duration for just today's selected NYC drop. [H9]

### A. Work queue → retention dialog → batch

1. Choose **Add files**. Drop the NYC originals together. [H9]
2. In **Retain files**, use **Source case / New case name** to create an unassigned source case.
   Give the work an honest `test_only` name. Retain the files. [H8]
3. Watch which files are actually listed. REH9's dialog said:
   **“Other files stay separate. Continue with them from the batch after these files are retained.”**
   Its CSV and workbook were held back from retention. The dialog appeared after **0.03 s**;
   retention press to batch was **8.8 s**, for that mixed selection only. [H9]

Say: **“Receipt is not recording. The batch tells us which files entered and which still need a route.”**
Do not say the register entered the batch if the screen holds it back.
The newer batch-table route is listed in STATUS, but its complete browser rehearsal is missing here. [Board]

### B. Batch → footprint layout

4. Select `buildings-original.geojson`. REH9 showed **“Layout proposed”** and
   **“Remembered from an approved layout of the same columns”**.
   It proposed a building, identifier `bin`, no stated name or height, and a new area. [H9]
5. Inspect the proposal. Press **Approve layout** only if it matches the file. [H9]
   On a cleaned runtime there may be no remembered layout. If it says **“Needs an answer”**, answer
   **“What is each feature”** and **“Which field identifies each one”** from the source:
   a building; `bin`; name and height not stated. Press **Use this layout**. [H8] [Arch] (§13.1)
   That is a layout decision, separate from the final recording confirmation.
6. Watch the batch prepare the footprint package. REH9 measured **10.6 s** from approval to
   read-on-map state and **16.9 s** to all ready; it listed **1,661 ready**. [H9]

Say: **“The identifier comes from the file. No height is supplied here, so no height is invented.”**
A fresh layout's duration is not measured in this rehearsal. Do not silently promise the memory-path time.

### C. Batch → TIFF and LAZ holdings → map

7. Select the TIFF, then the LAZ. Read the holdings words before opening the batch's area map.
   The exact map-opening button label was not preserved in the committed REH9 result or harness.
   Use the visible area link; do not promise an unrecorded button name. [H9] [Harness]
8. In REH9 the TIFF said **“Read 9 of 9 windows”** and the LAZ said
   **“Read 211 of 211 batches”**. The TIFF finished in **under 107 s** from retention;
   the LAZ finished in **440 s**. These are background-read timings, not map-placement timings. [H9]
9. Both said **“Read but not placed: the batch area has no extent yet.”**
   Both also said **“Display only: no height, measurement or record is taken from it.”**
   The map drew buildings but no surface parts in that rehearsal. [H9]

Say: **“Read and placed are different. This display is not a surveyed height or a legal measurement.”**
If today's map draws the surface, describe only what is visible. Surface-placement changes are in STATUS,
not a completed REH10 receipt in this checkout. No rehearsed seconds for that newer drawing are available. [Board]
Do not wait for the LAZ to finish before explaining the ready footprint card.

### D. Register → evidence checkpoint

10. If offered, choose **Continue with other files** for `gpmc-yuvp.csv`. [H9]
    REH9 refused the batch destination with **“Choose an active, unassigned source case.
    This table cannot be attached to a site.”** It reached a separate table page after **1 s**
    from the import press, but that did not attach evidence to the buildings. [H9]
11. If today's build offers the newer in-batch table and evidence controls, inspect the exact key,
    source row, proposed matches and conflicts before any evidence confirmation. Never resolve a conflict
    by picking the convenient value. The intended review rule is in the architecture. [Arch]
    Exact newer control labels, click order and durations are **not recorded in REH9**;
    REH10 evidence is absent. Do not improvise API commands to fill that gap. [H9] [Board]

Say: **“A shared key proposes a link. Only reviewed evidence may be cited; an ambiguous match stays open.”**
If that screen is absent, name the gap and continue with a footprint-only card.
Do not claim that card quotes the LPC register. REH9's chosen building had no register row citation. [H9]

### E. Ready targets → officer confirmation → card → verification

12. Return to the batch's ready targets. Inspect the package scope and exceptions.
    Tick the building that should receive a card. REH9 selected feature **1002204**. [H9]
    That is a historical example, not a required live selection and not a register-linked example.
13. In **Your acknowledgement**, state the actual source, scope, selected feature and `test_only` purpose.
    The exact confirmation button is **Record packages and make chosen cards**. [H8]
    Read the warning: the packages are recorded; chosen buildings get cards; other ready buildings in those
    packages are recorded without cards. Recording is not limited to the ticked building. [Act8]
14. Press that button once, only after checking the full list. Do not press it again while work continues.
    REH9 measured **44.6 s** from confirmation to the selected NYC card. It reports **1,660 recorded**,
    distinct from its earlier **1,661 ready**; the result does not explain that difference. [H9]
    Read today's counts instead of correcting or promising them.
15. Open the resulting card and its verification link. REH9 retained a PDF and verified the card as
    **“Consistent, 6 of 6 checks passed”**, with signature **“not assessed (NO_TRUSTED_KEY_POLICY)”**. [H9]
    Exact card-opening, PDF-download and verification-link button labels were not preserved in the committed
    result. No separate click timings are recorded. Do not substitute the old guide's labels.
16. Point to the citation. REH9 printed **“buildings-original.geojson, feature 1002204”**,
    not an LPC row. Stop at whatever citation today's card actually carries. [H9]

Say: **“The officer confirmed this scope. The card cites the original feature.
Consistent means these recorded checks passed; it does not establish ownership or a trusted signature.”**

## 3. Act 2 — judges' unknown data, without a code change

Say first: **“We use the same Add files route. We will show what is read, what needs an answer,
what is kept unread, or why receipt is refused. We will not invent missing facts.”** [Arch]
Ask for provenance and permission honestly. If origin is not stated, do not invent an issuer or URL.
Private or restricted documents must not go to an external teacher. [Arch] (§§11–12, 13.1 row 26)

- **Read.** Point to the file, result and source locator.
  Say: **“This reader understood these parts. They remain candidates until the officer reviews them.”**
  A source read, a map observation and a registry record are different things. [Arch]
- **Read in parts.** Show the actual progress and any held parts.
  Say: **“The file is being read in bounded parts. This count is what has been read, not a claim of completeness.”**
  The HDB GeoJSON in REH9 reached its first package **39.3 s** after **Use this layout** and all ready
  after **351.9 s**. Its card took **174 s** after confirmation. These are examples, not a deadline
  for the judges' file. The same set was unseen in REH8; REH9 was a regression, no longer unseen. [H9] [H8]
- **Read in part, rest kept.** Show the actual limit and locator of what was not read.
  Say: **“This result covers only the stated portion. The remainder is kept, not silently treated as empty.”**
  `read_to_limit` is an architecture state, not proof that every format reaches it today. [Arch] (§9)
- **Kept but not read.** Show **“Not understood”** or **“Part could not be read”**.
  Point to the retained-original words.
  Say: **“We have kept this original. This reader has not established its contents, so no facts are recorded
  from the unread part.”** The PDF produced that outcome in the rehearsals. [H8] [H9]
- **Needs an answer.** Read the actual question.
  Say: **“The source does not settle this for the system. We need evidence or an officer's stated answer.”**
  Do not guess a CRS, a worksheet name, a floor or an identifier. [H8] [Arch]
- **Refused with words.** Read the exact reason and distinguish refusal from retention.
  Say: **“This route refused this receipt. We are not claiming these bytes were retained or their facts read.
  The reason is visible; other accepted files can continue.”** REH9 refused the large parcel upload and
  the HDB CSV. Those were limitations, not successful ingestion. [H9]

A refusal shows the safety boundary working. It does not prove the intended reader or capacity is complete.
No code change, secret change or runtime reconfiguration is part of this act.
If the teacher is unavailable, use the offered officer questions or keep the result unresolved. [Live] [Arch]

## 4. If something goes wrong mid-demo

These are observed failures and presenter moves, not promises that newer merges fixed them.
REH10 adds no committed observations here. Use the runtime owner for service recovery from section 1.

### Receipt and navigation

- **“This file is already the source of the area … nothing new is prepared from a second copy.”**
  Open the existing area only if demonstrating resume. Say the stage was not clean; do not rename bytes,
  duplicate records or call it fresh intake. [H8]
- **“Other files stay separate”**, missing **Continue with other files**, or a reload notice naming files
  already imported. Check holdings first. REH9 re-picked its workbook after the continuation vanished.
  Re-pick only a file actually still waiting; never announce the first drop completed every route. [H9]
- **“Uploads not finished … Resume / Cancel upload.”** Use **Resume** with the same original file.
  REH9 measured **3.1 s** from resume press to the item being added. Do not start a duplicate upload. [H9]
- **“The large-original/2 storage reservation is not configured on this service..”**
  Stop this file and continue accepted items. The **Try again** and **Cancel upload** path was tried in both
  rehearsals and did not clear the dialog. If it says **“Send the same request again to find the upload before
  cancelling it.”**, leave through **Batches**; preserve the failure for the runtime owner. Do not loop. [H8] [H9]
- **Batch missing from Batches.** Use the batch address saved when it opened. REH8 did this.
  Do not create another batch just to find the first one. [H8]

### Table and evidence

- **“Choose an active, unassigned source case. This table cannot be attached to a site.”**
  Say the table has not joined these buildings. A separate unassigned table case was the rehearsed workaround,
  not a linked-register success. If the evidence screen is absent, finish only the supported footprint path. [H9]
- **“The literal reader requires valid headers, at most 2,000 rows and 256 columns.”**
  Stop this import and preserve the error. Do not silently truncate the judges' table or claim all rows read. [H9]
- **“Exact sheet name. The API cannot list sheets. Enter the name from the workbook.”**
  Ask for the workbook's actual sheet name. If unavailable, leave it unanswered, as REH8 did.
  Do not copy the generated control workbook's answers into an unknown workbook. [H8] [H9]
- **“needs input · TABLE_WINDOWS_RECIPE_REQUIRED · No reason supplied by the server”**, or
  **“CASE_ORIGINAL_TEACHER_REFUSED”**. Say raw reading is not successful field mapping.
  Keep the unresolved result. No row-view or teacher success was established on that REH9 screen. [H9]

### Reading, map and card

- **“Part could not be read … The page reader stopped before it finished.”**
  Keep the original and show the failed part. Say the PDF has not supplied reviewed facts. [H9]
- **“Needs an answer. No approved layout matches this file.”**
  Answer only a supported kind and key. REH8 left unsupported layer kinds unanswered; it did not call them
  buildings to get past the question. [H8]
- **“Reading file”** without a count, or slow package preparation. Stay on the batch and narrate only visible
  progress. HDB took **351.9 s** to all ready in REH9 versus **164.9 s** to the last package in REH8.
  Do not promise a countdown or rerun an active read. [H9]
- **“Read but not placed: the batch area has no extent yet.”** Stay with the footprint/card path.
  Say the surface read succeeded but placement did not; do not supply a guessed frame or height. [H9]
- **“The buildings in view could not be read. A local service could not complete this operation.”**
  Return to the batch. REH8 saw a failed display read; it is not evidence that source buildings are absent. [H8]
- **“Choose an area with at most 10,000 display features.”** This is a map-context limit.
  Do not truncate the source. Use the batch's package and card results; move closer if the map offers it. [H8]
- **“Showing 15,000 buildings in view, the most drawn at once; move closer to see the rest.”**
  Say the view is bounded, not the source. Heavy-map stalls were observed with software WebGL. [Act8]
  Return to the batch if drawing stalls. REH9's map-load worst frame was **467 ms**; smooth batch streaming
  is not proof of a universally smooth map. [H9]
- **“Area: not supplied by the record”**, or buildings shown under an unexpected area name.
  Read the source citation; do not infer legal or geographical membership from that label. REH8 saw this. [H8]
- **“Property Card: Blocked: select a unit with an assigned proposed code”** despite a completed batch card.
  Use the card result and verification link from the batch. Do not invent a unit or assign a code to bypass it.
  REH8's card also printed **“Unavailable: Not supplied by the executed text/CSV profile”** for geometry;
  that wording did not establish geometry from its map source. [H8] [Act8]
- **Live connection churn or console warnings.** There may be no useful on-screen error.
  REH8 fell back to polling; REH9 logged **“Encountered two children with the same key”**.
  Stay on the batch if saved progress moves. Do not re-confirm or re-import to cure a display problem. [H8] [H9]
  REH9 also recorded a failed parts-list read, without presenter-facing words. If progress cannot be inspected,
  preserve the batch address and ask the runtime owner; do not call the invisible part complete. [H9]

For provider failures, do not invent a screen message. The rehearsal did not reach a live-teacher screen.
The gateway rules stop on rate limits, timeouts and unknown outcomes; the presenter uses manual/replay or names
the gap. Truncated or invalid model output is not a candidate fact to approve. [H9] [Live] [Board]

## 5. What not to claim

- Do not say M1 is closed. STATUS and the M1 audit leave it open. Later live gateway runs do not by themselves
  close the accuracy or blind-data gaps. [Board] [Audit]
- Do not claim held-out accuracy for today's intake, a positive learner takeover, or that teacher answers
  are truth. Blind positive evidence is insufficient for that claim. Holdouts never go to a teacher. [Audit]
- Do not say a remembered layout proves the student learned meaning or that paid calls fell.
  REH9 used remembered layout approval with the gateway off. [H9] [Audit]
- Do not claim full building recall, exact measured plan rooms, or Indian plan-model accuracy from a foreign
  evaluation. The audit distinguishes candidates, diagnostic areas and unmet model gates. [Audit]
- Geometry, a roof outline, a displayed surface and a consistent card do not establish ownership,
  rights, statutory acceptance or official parcel ULPIN issuance. [Arch] [Board]
- All model answers and proposed links are candidates. Officer review comes before a registry record.
  Unknown is not zero; no floor, height, unit, owner or right is invented to finish the show. [Arch]
- A building card does not prove a unit identity. The rehearsed card says identities are for recorded spaces.
  Rights remain **“Not assessed”**. [Act8]
- **“Consistent”** is the implemented verification result, not a trusted-signature verdict.
  Keep **“signature not assessed”** visible. [H9]
- Do not say “any format, any size”, “everything entered in one drop”, “nothing froze”,
  “empty start proved” or “LPC evidence on this card”.
  Only make a scoped claim that today's retained results establish.
  [H8] [H9]

Close with: **“We showed what the sources support, what the officer reviewed, and what remains unknown.
A kept file, a proposal and a recorded fact are deliberately different.”**

## Evidence key

[H9]: evidence/runtime/reh9/result.json
[H8]: evidence/runtime/reh8/result.json
[Act8]: evidence/runtime/reh8/act1.json
[Files]: evidence/runtime/reh9/act1-files.json
[Harness]: evidence/runtime/reh9/dress.mjs
[Doctor]: evidence/runtime/reh9/step-b7-doctor.json
[R9]: evidence/runtime/r9/result.json
[After]: evidence/runtime/r9/after.json
[Runtime]: backend/DEMO-RUNTIME.md
[Guard]: backend/DOCKER-GUARD.md
[Live]: backend/LIVE-PROOF.md
[Gateway]: backend/DEMO-GATEWAY.md
[Arch]: next-steps/INGESTION-ARCHITECTURE.md
[Board]: STATUS.md
[Audit]: evidence/m1/AUDIT.md
