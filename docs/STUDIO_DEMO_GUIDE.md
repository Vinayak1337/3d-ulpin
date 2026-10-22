# Studio live-demo presenter runbook

> **Which runbook to use.** This version follows REH11's rehearsal of staging `065a323f` and later. While the demo
> still serves `8d6e19fa` (check `git -C E:/Projects/ulpin-wt/demo log --oneline -1`), use the earlier runbook:
> `git show c610922f:docs/STUDIO_DEMO_GUIDE.md`, where Act 1 imports the CSV separately and the footprint card is
> proven (REH9).

This replaces the September source-to-record walkthrough, its Lake View fictional example,
legacy local-app address, and old intake limits. It is not a prepared-record tour.

**Evidence boundary.** The owner wants a cleaned Studio, one drop of the NYC files, a cited card after
one officer confirmation, then judges' unknown files without a code change.
The committed rehearsal proves less. REH10 receipts now exist, but that run did not prove the linked card
or surface drawing. REH11 rehearsed `065a323f`: the register joined the batch, exact-key evidence was
confirmed and surfaces drew, but the cited card stopped with `REGISTRY_SOURCE_UNAVAILABLE`.
Its runtime was not empty; no cited card or verification was produced. [H10] [H11]

REH11 left the served demo unchanged. Its staging rehearsal is not a demo roll or proof of a clean start.
The card fix (RC1) is in progress; REH12 will rehearse the next roll. [H11]
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
REH11's demo check recorded **28 PASS, 0 FAIL**. Require these lines, not just a running browser: [Demo11]

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
The named and present key counts must agree. REH11's demo check recorded **11 named and 11 present**,
with the gateway enabled. Health is not a live-answer receipt or proof of remaining credit. [Demo11] [Gateway]
The rehearsal itself used the gateway disabled; do not confuse it with the demo check. [H11]
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

The timings below are REH11's separate measured intervals, not a promised total. [H11]

### A. Work queue → retention dialog → batch

1. Choose the **Add files** link. Drop the NYC originals together. [Upload11]
2. Before upload, inspect the forecasts: GeoJSON **“within 1 GiB”**, table **“within 7 GiB”**,
   raster and point cloud each **“within 16 MiB”**. The table forecast says
   **“Choose Read as a table after upload.”** Forecast appeared after **0.209 s**. [Upload11]
3. In **Retain files**, use **Source case / New case name** for an unassigned `test_only` case. [H8]
   Read **“The batch opens before upload finishes. Keep its page open to send the files and see progress.”**
   The CSV stays in this batch, not **Continue with other files**. The first batch read was **0.251 s**
   after retention; final upload finished at **2.118 s**. Network order proves early opening; the first
   navigation observer used the wrong URL. Visible uploading was separately captured in Act 2. [Upload11]

Say: **“Receipt is not recording. We keep this page open while the files arrive.”**

### B. Batch → footprint layout

4. Select `buildings-original.geojson`. REH11 showed **“Remembered from an approved layout of the same
   columns”**: a building; identifier `bin`; name and height not stated; new area `buildings original`. [Layout11]
5. Inspect the proposal. Press **Approve layout** only if it matches the file. [Layout11]
   On a cleaned runtime there may be no remembered layout. If it says **“Needs an answer”**, answer
   **“What is each feature”** and **“Which field identifies each one”** from the source:
   a building; `bin`; name and height not stated. Press **Use this layout**. [H8] [Arch] (§13.1)
   That is a layout decision, separate from the final recording confirmation.
6. Approval to finished draft job was **27.9 s**, to ready job **54.395 s**: **1,661 ready**,
   **1 skipped**, **“INVALID_GEOMETRY: Ring Self-intersection”**. Original unchanged, no repair. [Layout11]

Say: **“The identifier comes from the file. No height is supplied here, so no height is invented.”**
A fresh layout's duration is not measured in this rehearsal. Do not silently promise the memory-path time.

### C. Batch → TIFF and LAZ holdings → map

7. Inspect the TIFF and LAZ holdings, then **Open package → Done → Tools → Layers**.
   Both surfaces place against the drafted footprints; the same open map updates without reload. [Surface11]
8. First published parts appeared **94.521 s** (TIFF) and **123.398 s** (LAZ) after retention;
   drawn words were observed by **285.792 s**. TIFF's last part read finished at **467.538 s**.
   These are different milestones, not interchangeable completion times. [Surface11]
9. Holdings reached **“Read 9 of 9 windows”** (TIFF), but only **“Read 6 of 211 batches”** (LAZ).
   Layers said TIFF **“9 parts drawn and 0 not placed, of 9 read parts”** and LAZ
   **“6 parts drawn and 0 not placed, of 6 read parts”**, **“Coloured by height as written, not measured.”**
   Both retain **“Display only: no height, measurement or record is taken from it.”** [Surface11]

Say: **“Read and placed are different. This display is not a surveyed height or a legal measurement.”**
LAZ full completion was not qualified. Do not reuse REH9 completion times or wait for LAZ before continuing. [Surface11]

### D. Register → evidence checkpoint

10. Choose **Open the table: gpmc-yuvp.csv → Read as a table**, without choosing a separate case.
    After **0.165 s**: **“753 records · 9 columns”**, **“Draft”**, **“Needs review”**.
    Tables produce mapped draft rows, not buildings. The tray's **“No reader in a batch takes this kind
    of file yet”** is stale for this CSV; the table reading succeeded. [Table11]
11. Choose **Link a register by a key**. State namespace **“NYC building identification number (bin),
    as written in both files”**, kind **integer**, map field `/features/*/properties/bin`, table
    `gpmc-yuvp.csv` column **0**, `bin`; press **Declare the key**. Wait for
    **“Closed: 753 read, 753 with a key, 0 without a key, 0 unread, 0 could not be read.”** [Key11]
    Declare to closed job was **37.404 s**; closed words observed by **88.984 s**. Inspect source rows:
    **612 matched, 81 conflicting, 60 no_match, 0 several**. Never pick a convenient conflict value. [Key11]
    Choose **Accept every exact single match of this file**. Read **“This file has 612 exact single matches;
    one confirmation takes 100. Confirm these, then accept the next 100.”** Acknowledge the actual scope.
    REH11 confirmed only the first **100**; **512** remained, with no conflicting rows accepted. [Key11]
    Stored words appeared after **10.834 s**: **“Stored with every pin it names. Nothing was written to the
    registry: the citation step adds accepted rows and parts to recorded buildings under this confirmation.”** [Key11]

Say: **“A shared key proposes a link. This confirms evidence, not registry records; conflicts remain open.”**

### E. Ready targets → officer confirmation → card → verification

12. Return to ready targets. Inspect package scope and exceptions, then tick a matched building whose
    evidence was confirmed. REH11 chose **feature 1001960**, register **column bin, row 702**. [Card11]
13. In **Your acknowledgement**, state the source, scope, selected feature and `test_only` purpose.
    The confirmation button is **Record packages and make chosen cards**. [H8]
    Packages are recorded; chosen buildings are offered cards; other ready buildings in those packages
    are recorded without cards. Recording is not limited to the ticked building. [Act8]
14. Press once after checking the full list. REH11 had **1,661 ready and 1,661 recorded**, but
    **0 carded, 1 stopped**. The job stopped after **71.487 s**; stop words were observed by **96.512 s**:
    **“Work stopped; the completed steps are kept. A cited source is not currently available.”**
    Code: **REGISTRY_SOURCE_UNAVAILABLE**. No card, quoted register row or verification resulted. [Card11]

**Card step: last proved at REH9 on the served demo commit; REH12 will re-prove it on the next roll**.
That historical card cited only the footprint, not the LPC register. Do not claim the cited card works on
staging. RC1 is in progress; do not retry this structural refusal or substitute a feature-only card. [H9] [Card11]

Say: **“The completed steps are kept. Here is the confirmed evidence; the cited card step stopped.”**

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
  REH11's mixed ZIP kept its GeoJSON and PDF members unchanged, as their own items, in **15.074 s**.
  The GeoJSON's **Approve layout** to draft was **44.057 s**, to **1,661 ready** **67.881 s**;
  one invalid geometry was skipped unchanged. It was not recorded. These were team-chosen public foreign
  `test_only` files, not unseen judges' data or a deadline for their file. [Judges11]
- **Read in part, rest kept.** Show the actual limit and locator of what was not read.
  Say: **“This result covers only the stated portion. The remainder is kept, not silently treated as empty.”**
  `read_to_limit` is an architecture state, not proof that every format reaches it today. [Arch] (§9)
- **Kept but not read.** Show **“Not understood”** or **“Part could not be read”**.
  Point to the retained-original words.
  Say: **“We have kept this original. This reader has not established its contents, so no facts are recorded
  from the unread part.”** REH11's Markdown said **“Not understood. Kept (13 KB); its kind was not
  recognised from its first and last bytes.”** Its PDF instead read **18 pages** in **44.398 s**, with
  **7 passages on pages 5–8, 10 and 16** naming floors, storeys, levels or rooms: page-and-line candidates
  for review, not recorded facts. Do not call that PDF unread. [Judges11]
- **Needs an answer.** Read the actual question.
  Say: **“The source does not settle this for the system. We need evidence or an officer's stated answer.”**
  Do not guess a CRS, a worksheet name, a floor or an identifier. [H8] [Arch]
- **Refused with words.** Read the exact reason and distinguish refusal from retention.
  Say: **“This route refused this receipt. We are not claiming these bytes were retained or their facts read.
  The reason is visible; other accepted files can continue.”** REH9 refused the large parcel upload and
  the HDB CSV. Those were limitations, not successful ingestion. [H9]

**CSV alone:** use **Import as a table → Create an unassigned source case → Retain table and start mapping**,
not the multi-file **Retain files** dialog. REH11's final-newline CSV showed **2 records · 9 columns** in
**0.175 s**, raw rows and mapping complete in **21.218 s**: **Draft; Needs review**, **0 teacher calls**,
**7 unanswered**, **9 open questions**, **CASE_ORIGINAL_TEACHER_REFUSED**. Completion is not accepted facts
or a live-teacher answer. Its source panel said `officer_supplied`, licence unconfirmed, personal-data state
unknown; the `test_only` case name did not make it an evaluation asset. [Short11]

A refusal shows the safety boundary working. It does not prove the intended reader or capacity is complete.
No code change, secret change or runtime reconfiguration is part of this act.
If the teacher is unavailable, use the offered officer questions or keep the result unresolved. [Live] [Arch]

## 4. If something goes wrong mid-demo

These are observed failures and presenter moves, not promises that newer merges fixed them.
Older failures remain historical boundaries, not REH11's outcome. Use the runtime owner for service recovery.

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
  not a linked-register success. REH11 instead opened the table in its batch; do not create a separate
  case to bypass a missing evidence screen. [H9] [Table11]
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
  progress. REH11's footprint ready job finished **54.395 s** after approval, not a promised countdown.
  Do not rerun an active read. [Layout11]
- **“Read but not placed: the batch area has no extent yet.”** Say placement has not succeeded;
  do not supply a guessed frame or height. REH11 placed both surfaces against drafted footprints;
  read the current holdings and Layers counts rather than repeating the older unplaced outcome. [H9] [Surface11]
- **“The buildings in view could not be read. A local service could not complete this operation.”**
  Return to the batch. REH8 saw a failed display read; it is not evidence that source buildings are absent. [H8]
- **“Choose an area with at most 10,000 display features.”** This is a map-context limit.
  Do not truncate the source. Use the batch's package and card results; move closer if the map offers it. [H8]
- **“Showing 15,000 buildings in view, the most drawn at once; move closer to see the rest.”**
  Say the view is bounded, not the source. Heavy-map stalls were observed with software WebGL. [Act8]
  Return to the batch if drawing stalls. REH11's whole-map worst frame was **467 ms**;
  after map open it was **183 ms**, with **2 frames over 100 ms**. No zero-stall claim. [Frames11]
- **“Area: not supplied by the record”**, or buildings shown under an unexpected area name.
  Read the source citation; do not infer legal or geographical membership from that label. REH8 saw this. [H8]
- **“Property Card: Blocked: select a unit with an assigned proposed code”** despite a completed batch card.
  Use the card result and verification link from the batch. Do not invent a unit or assign a code to bypass it.
  REH8's card also printed **“Unavailable: Not supplied by the executed text/CSV profile”** for geometry;
  that wording did not establish geometry from its map source. [H8] [Act8]
- **REGISTRY_SOURCE_UNAVAILABLE — “Work stopped; the completed steps are kept. A cited source is not
  currently available.”** Do not retry. Say the completed steps are kept and show the confirmed evidence
  instead. Preserve the batch address for the runtime owner. No rehearsed Studio recovery produced a card. [Card11]
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
- Do not claim LAZ full completion: it stopped at **6 of 211 batches**. Do not claim all frames stayed below
  **100 ms**: worst after map open was **183 ms**, with **2 frames over 100 ms**. [Surface11] [Frames11]
- Do not claim one evidence confirmation accepts the whole file: only the first **100** exact matches per
  confirmation; REH11 left **512** unconfirmed, plus conflicts and unmatched rows unresolved. [Key11]
- Do not say “any format, any size”, “everything entered in one drop”, “nothing froze”,
  “empty start proved” or “LPC evidence on this card”.
  Only make a scoped claim that today's retained results establish.
  [H8] [H9]

Close with: **“We showed what the sources support, what the officer reviewed, and what remains unknown.
A kept file, a proposal and a recorded fact are deliberately different.”**

## Evidence key

REH11 receipt fields (each reference below names its file and JSON field):

[H10]: evidence/runtime/reh10/report.md
[H11]: evidence/runtime/reh11/result.json "servedCommit; runtimeNotEmpty; roll.gateway; demo; verdict"
[Demo11]: evidence/runtime/reh11/demo-after.json "doctor.output; doctor.exit"
[Upload11]: evidence/runtime/reh11/result.json
  "act1.readerForecast; act1.dropToForecastSeconds; act1.upload; harnessQualifications; act2.judges"
[Layout11]: evidence/runtime/reh11/result.json "act1.layout"
[Table11]: evidence/runtime/reh11/result.json "act1.register"
[Surface11]: evidence/runtime/reh11/result.json "act1.surfaces"
[Key11]: evidence/runtime/reh11/result.json "act1.evidence"
[Card11]: evidence/runtime/reh11/result.json "act1.card; act1.layout.ready; failures"
[Judges11]: evidence/runtime/reh11/result.json "act2.judges"
[Short11]: evidence/runtime/reh11/result.json "act2.shortCsv"
[Frames11]: evidence/runtime/reh11/result.json "frames.map; act1.surfaces.framesAfterMapOpen; frameQualification"
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
