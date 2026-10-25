# Status

**23 October 2026, morning.** The plan is [PLAN.md](PLAN.md) and its tasks are in [TASKS.md](TASKS.md). No worker is
running; the demo runtime stays up. This page stays under one page; the board before today is in
[archive/STATUS-2026-10-22.md](archive/STATUS-2026-10-22.md).

**24 October.** The old Next.js app `apps/web` and the tests and tools that only exercised it are removed (in Git
history only). Workers are Claude CLI (all UI work) and pi codex only; no cloud agents.

**24 to 25 October.** Merged into `task/int3-pre` and pushed: S1.1 (full checks), S2.1 and S2.2 (practice kit,
17 files with receipts), S3.1, S3.2, S4.1 (one owner switch for Sarvam on judges' files, default off), S4.2 (header
rules), S4.3 (reading card route), S4.5 server part (certain tables read without a press), S7.2, S7.3, S7.7. The S1.2
rehearsal on a fresh `ulpin-reh-03` proved surface jobs (SA1) but failed act 1 on two faults from S4.1 and S4.5;
S1.2a fixed both (merged 25 October), and act 1 runs again once the PC is quiet. S1.2b (the same rule for ZIP retains) and S4.6 (reading card fields: meaning and source) merged. S2.3 sealed the closed judge kit (12 files, 4 families, counts and hash only in Git). S1.2 run 2 passed act 1 (no 409, View layout answered, both cards, journey 8/8); the EV2 overlap moves to S1.3. The map stall was the test browser drawing in software (S1.2c): on the PC GPU, 0 slow frames after startup. S1.3 (act 2) failed under load: large-file jobs gave up when the bounded readers were busy instead of waiting, and a LAZ upload was refused by sibling arrivals; the Niagara file alone now draws in 184 s (was 738 s). S1.3a (the fix: wait for busy readers and sibling arrivals) merged 25 October; S1.3 runs again next with the native readers rebuilt first. S4.4 merged (a teacher field whose only fault is its explanation stays a question for the officer). S4.7 merged (the reading card describes 3D models, IFC, PDFs and surfaces from stored readings). S3.4 merged (large files ask the layout from the first part and map while reading). S3.6 merged (the Studio answers the first-part layout question). S3.5 merged (a display-only preview of the outlines read so far, also for files that state no coordinate system) and S7.4 merged (plain server words on the judges' path); server set 956 pass. S5.7 merged (decimal-comma coordinates placed when the officer states the mark). S5.3 merged (NDJSON and GeoJSON sequences take the large path). S5.10 merged (a DOCX in a batch is read, cited to its paragraphs). S4.11 merged (a matching earlier layout is offered for a large file's question; server set 982 pass). S5.3a merged (a set-aside line of a sequence file is named; server set 978 pass). S5.4 merged (a GeoParquet in a batch becomes a GeoJSON layer cited to its rows; the image still lacks pyarrow until S5.6). S5.17 merged (CityGML 1.0 read as stated; a real 28 MB Berlin tile within measured bounds; server set 991 pass). S5.11 merged (the raster reader takes a 2 GiB GeoTIFF as a whole-file preview and windows at a step, from one verified copy). S5.18 merged (a CityJSONSeq file is read line by line). S5.14 merged (point clouds up to 1 GiB read as a thinned whole-cloud sample). S5.15 merged (a surface reads its whole-extent overview first, then at most 64 preview parts). S5.19 merged (an IFC storey outline per storey in the file's own frame; server set 998 pass). Running: S5.9a (a batch PDF up to 1 GiB opens in the page view; code part) and S5.17a (the reading card says when a CityGML inventory is too large to list). S5.5 merged (native GIS conversion up to 1 GiB, with a wait that grows with the file). Studio type check on task/int3-pre fails since S5.7 (the placement command does not send decimalMark yet): UI session S5.7b fixes it with the decimal-mark choice. Next UI sessions: S5.7b, then S3.5d (draw the preview on the map). S6.2 and S6.2a merged (the reading card suggests links by key, address and place). The Claude CLI account is still refused.

**UI list (owner left it to the lead, 24 October):** [UX review](design/UX-REVIEW-2026-10-24.md). Worst first: the
batch page never says which step it is in or what needs the officer (S7.17), an action can vanish or sit disabled with
no way out (S7.18, S1.2a), one long page instead of a file list and a detail pane (S7.11), status as long prose and
machine words (S7.5), a legal-wall confirmation (S7.19). Visuals (25 October): the map scene is washed out,
buildings 1.2:1 against the ground, flat light and fog (S7.22); no visual lead on the batch page (S7.23).

## What works

- Our own New York files (building outlines, a landmarks register, an aerial photo, a laser scan) go from one drop to
  two verified building cards: one quotes its register row, the other has the outline only. Proven on the rehearsal
  runtime (22 October), not on the demo runtime itself.
- Readers exist for most formats in the plan's list. Many of the newest are only on `task/int3-pre`.
- The Sarvam connection is on: Rs 3.25 spent of the Rs 100 cap.

## What is broken

- **Loading the judges' files** failed in the last three rehearsals (22 October). Once the server program stopped when
  many files were loaded at once, and a 26 MB map file took 738 s to appear (that rehearsal's target was 180 s; the
  plan's target is now 60 s). In the next one, a small mixed ZIP took 586 s (target 240 s). DXF, CityGML, GLB,
  CityJSON, OBJ, scanned PDF and WKT tables have not been proven live. Evidence: branch `task/reh16-rehearsal`.
- **Sarvam does not yet help with judges' tables:** the code refuses them, and in the last live test our own safety
  checks rejected both of Sarvam's suggestions for what the table columns mean.
- **Our own table-reading model** has not yet filled any field correctly by itself. The roof-finding model finds about
  65 of every 100 roofs; the target is 70.
- **The UI**: see the UX review above (plan step 7).

## Where things are

| Thing | State |
| --- | --- |
| Demo runtime `ulpin-demo` | Up, serving `4ffd801a` from `E:/Projects/ulpin-wt/demo`; API on 127.0.0.1:3194; holds development data (38 sources at the 17 October count) |
| `staging` | The main working branch, in `E:/Projects/3d-ulpin`; pushed |
| `task/int3-pre` | The newest code, in `E:/Projects/ulpin-wt/int3`; pushed; about 209 changes not yet in `staging`, including three timing fixes not yet rehearsed |
| `main` | `origin/main` `14fc0b9c` (2 October) is the public repository's default branch. The local `main` (`bc587b49`) is an old copy: never push it or build on it |
| Rehearsal runtimes | `ulpin-reh-03` stopped at `0ce6cad8` (S1.2, volumes kept); `ulpin-reh-02` stopped at `1a226949`; `ulpin-reh-01` untouched |

## Next

Plan step 1 (choose the code version we build on) and step 2 (the judge kits). See [TASKS.md](TASKS.md).

## Needs the owner

The five items under "Needs you" in [PLAN.md](PLAN.md).
