# AU3 - the work that needs this PC, drafted ready to dispatch

Base: staging `7a6fded0`. Read-only audit; no product code, runtime, training, provider call or download. Task list:
[local-tasks.json](local-tasks.json); one ready task file per id under [drafts/](drafts/) in the REH6 shape (worktree
left as `<worktree>`). At audit time `docker ps` listed only the demo's five containers (up); `ulpin-reh-02` is
stopped at `2ddefbbb`, and `git diff 2ddefbbb 7a6fded0 -- services/ database/ scripts/platform/ pnpm-lock.yaml` is
empty, so rolling the rehearsal to `7a6fded0` needs no schema step and no image roll.

## The six tasks

| Id | Needs | Owner | Size | What it settles |
| --- | --- | --- | --- | --- |
| REH7 | runtime, Docker | runtime | M | where the 31 s and 35 s window pages go (browser queue, pool, API CPU, DB) |
| DQ1 | data drive, network | none | M | a sealed set of 4-6 public files from new issuing authorities, open licence |
| REH8 | runtime, Docker | runtime | L | the dress rehearsal: NYC, then the sealed set, through the Studio to a card |
| B10 | GPU | gpu | L | B9's regions without scale augmentation, DEV only; **lead decision first** |
| VA1 | data drive | none | M | teacher round: header variants of the 32 positive seeds (Step 1, labels only) |
| VA2 | data drive | none | M | filter, one Stage A retrain, counts only, in a separate session |

## Order, and what runs in parallel

1. **Wave 1, now, in parallel:** REH7 (runtime owner) ‖ DQ1 (network and data drive) ‖ VA1 (teacher session).
   No GPU training in this wave: B10's launcher pins cores 0-15 and would skew REH7's timings.
2. **Wave 2:** REH8 after REH7 hands the runtime back and DQ1 has sealed its set (the same runtime owner role,
   so never beside REH7) ‖ VA2 after VA1 (a different session; its fit takes seconds, so frame figures are safe).
3. **Wave 3, overnight 18-19 October:** B10, if the lead chooses it, once no rehearsal runs. Its parts 1-2 take an
   hour; the run takes about 5-6 h detached; part 3 is a resumed session after the end marker.
4. Code fixes that REH7 and REH8 name go to cloud sessions; a second dress rehearsal on 20-21 October re-uses the
   REH8 draft with a fresh sealed set (a second DQ1).

## Findings that shape the drafts

- **B9's evidence is not on staging.** Its plan, receipts, result, ledger entry and launcher changes (16 commits, 39
  files) live only on `task/b9-more-regions` (`0d9ae962`; older copies `52d393ea` and `862dbdd2` carry an
  attribution trailer and are on no branch). The board still lists B9 as pending (`STATUS.md:38`, GF-AI row); its
  result (improved: DEV recall 0.6735 at 0.5, epoch 3) is not on staging. B10 cannot start before that merge.
- **The building ledger's own next decision** (B9 entry): "Under the plan the lead decides the next step; an unchanged
  repeat of this recipe is closed." No holdout call has been spent since the baseline. The audit's option is B10: B9
  lost recall in every size bin under 512 px (`[16,64)` 0.1269 to 0.0725) while the gain sat in large roofs, which
  fits the scale augmentation (factor 0.75-1.33, vanished instances dropped) hurting small roofs. The alternative is
  **none before 22 October**: the demo already has the fine-tuned model with its holdout result (B3 epoch 4), which
  is what "never cut" asks for.
- **The slow window pages cannot be one SQL statement:** each read sets a 15 s statement timeout
  (`area-display-window.ts:61`). Every read also reloads the area's packages and re-chooses its proposals in Node
  (`chosenProposals`, `areaProposals`), and the pool holds 8 connections (`db.ts:27`). Both slow pages were `after`
  cursor pages. REH7 tests four hypotheses with the product's routes, the browser's request timing and process
  samples; no SQL of its own, and the API log stays unread (it lies under the runtime folder).
- **Learner:** A4e fired T-data (0 of 6 targets reach 12 positives; 33 positives over nine targets) and says
  "owner must authorize fallback Step 1". That authorization exists: the owner allowed header variants on 10 October
  night (`SPRINT-SELECTION.md:60`, `FALLBACK-LEARNER.md:51`). VA1/VA2 follow Step 1 exactly; the teacher writes header
  text only, values are re-sampled from real columns, variants never enter calibration or held-out. Steps 2-3 (SFT,
  GRPO) stay after selection. No agent learner ledger file exists; VA2 writes an entry for the lead to place.
- **Dress rehearsal limits:** rehearsal runtimes are written with the gateway disabled (`DEMO-RUNTIME.md:250`), so
  REH8 shows the manual and memory paths, never a live Sarvam answer. Roofprint inference runs on CPU in the geo
  container (`spatial_ml.py:260`), so REH8 needs no GPU. `ulpin-reh-02` already holds Niagara: REH8 works in new
  cases and says the runtime was not empty.
- **Acquisition:** the India-first search of 11 October found no unauthenticated Indian map original; SOI, Bhuvan
  and Pune need the owner (`real-sources.md:129-130`). DQ1 tries Indian issuing authorities first (GODL-India),
  takes only publishers not yet recorded (so no held-out or development family can enter), and seals the set.

## Left out, with the reason

- **A live Sarvam run** (storey agent, S1's planned run, the teacher in the dress rehearsal): the keys are still the
  owner's step, and rehearsals never hold a key. It becomes a demo task when the owner puts the keys in.
- **A fresh empty `ulpin-reh-03`** for a truly clean Studio: every draft forbids `--create`; creating it is a lead
  decision (DEMO-RUNTIME "A rehearsal runtime" step 1).
- **Plan model and storey rules:** no open item in the board needs this PC before the demo; the Magnolia CAD path is
  exact and offline, and the Tower 3 scans stay `no_scale` candidates.

## For the lead

1. Merge `task/b9-more-regions` (or decide not to), then choose B10 or none.
2. REH8 lets the worker give the Studio's one officer confirmation and answer its questions on the rehearsal runtime,
   as the presenter would, each recorded; earlier rehearsals forbade any officer action. Confirm or strike that rule.
3. DQ1 is the single writer of `real-sources.md` and `datasets.json` while it runs.
4. Task ids avoid `E:/BhuAayam-data/task-data/lv*` (taken by the Studio lane): the learner tasks are VA1 and VA2.
