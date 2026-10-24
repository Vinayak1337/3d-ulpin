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
S1.2a fixed both (merged 25 October), and act 1 runs again once the PC is quiet. S1.2b (the same rule for ZIP retains) merged. Running: S4.6 and S2.3 (codex). The Claude CLI account is still refused.

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
