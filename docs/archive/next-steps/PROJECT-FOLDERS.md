# Project folders on the owner's PC

Checked on 10 October 2026, 14:40 IST. `E:\Projects` holds several folders with "ulpin" in the name. This page says which ones are in use, what the others are, and what was found inside `3d-ulpin-claude`. Nothing was deleted or changed while checking. **Updated the same afternoon, after the cleanup the owner asked for; the record is [CLEANUP_20261010.md](../orchestration/CLEANUP_20261010.md).**

## 1. Which folder to use

**Open every lead session in `E:\Projects\3d-ulpin`.** It is the main repository on branch `staging`, and it holds `hand-off.md`, `AGENTS.md` and all merged work.

| Folder in `E:\Projects` | What it is | In use? |
| --- | --- | --- |
| `3d-ulpin` | The main repository (`Vinayak1337/3d-ulpin`), branch `staging`. | **Yes: the lead's folder** |
| `ulpin-wt` | Worker folders. One checkout per lane (`a2`, `b3`, `d1`, `f1`, `g2`, `k1`, `p1`), each a linked worktree of the main repository on its own `task/…` branch, plus `s03`, which the running demo database container mounts a file from. `_tasks` holds task files, launchers and logs, and is outside Git. | **Yes: workers only.** Never open it as the lead's folder. Never remove `s03` while the `ulpin-demo` stack exists. |
| `3d-ulpin-claude` | **Removed on 10 October.** Its branch `claude/magical-bardeen-31bi7c` stays, locally and on GitHub. See §2. | Gone |
| `ulpin-ab-isolated-implementation-20260923` | **Removed on 10 October.** Its 19 staged files were committed first as branch `wip/ab-task-20260923`. | Gone |
| `ulpin-data-policy-20260924` | **Removed on 10 October.** It was clean and its commit is in `staging`. | Gone |
| `ulpin-city-studio` | A separate repository (`Vinayak1337/ulpin-city-studio`), branch `main`, last commit 18 September. | No |
| `3d-ulpin-baselines` | Not a repository. One JSON file. | No |
| `3d-ulpin-uttam-nagar-20260917` | Not a repository. 47 files from September. | No |

Of the sixteen Codex desktop worktrees under `C:\Users\kvina\.codex\worktrees`, fifteen were removed on 10 October. `desktop-raster` stays, because a stopped Docker stack mounts files from it and its ignored `.runtime` folder holds receipts and logs that exist nowhere else.

## 2. What is in `3d-ulpin-claude`

- **What it was:** the checkout an earlier Claude session worked in. Its branch split from `staging` on 4 October (common ancestor `bd0ef129`) and now ends at `d92d489a`, "Plan the selection sprint and refresh status". The same commit is on GitHub, so the branch is backed up. The folder is 201 MB and has no uncommitted changes.
- **How it differs from `staging`:** 255 commits that `staging` doesn't have, almost all from 2–4 October, and 381 commits in `staging` that it doesn't have. 330 files exist only there, 762 files exist only in `staging`, and 123 files differ.

### The 330 files that exist only there

| What | Files | Useful now? |
| --- | ---: | --- |
| `docs/evidence/usp/ml-distillation/`: evidence from the old text-model distillation lane (ML-DISTILL-01, tasks STUDENT-41 to STUDENT-44) | 249 | No. Its own `status.md` records the last candidate as accepted technically but **rejected on quality**. The 10 October plan replaced this lane with the building model and the mapping learner. |
| `scripts/usp/learning/association/` and `services/geo/geo/usp_learning/association/`: code for that lane | 73 | No. It was never accepted. **Never merge this branch wholesale.** |
| `scripts/google-uttam/` and `scripts/osm-road-block/`: old acquisition scripts | 6 | No. Removed from `staging` in the 4 October cleanup. |
| `PROJECT_AND_ML_REVIEW.md`: the external review | 1 | Reference only. Two review documents in `staging` cite it. |
| `apps/studio/src/local/consolidated.ts`: a local sample-data layer for the Studio | 1 | No. Nothing imports it, and `staging` removed it on 10 October when the Studio moved to live records. |

### Links from `staging` into that branch

- **By path:** 11 of the 330 files are mentioned in `staging`, all in history documents: `docs/orchestration/CLEANUP_20261004.md`, `docs/orchestration/ML_DISTILL_01.md`, `ML_REVIEW_RECOMMENDATIONS.md` and `PROJECT_DEEP_DIVE_ACTION_PLAN.md`. Those links don't resolve in `staging`.
- **By branch name:** the superseded `docs/next-steps/HANDOFF.md`, `docs/next-steps/P0-reset.md` (the step that copied the plan documents into `staging`, already done) and the cleanup record.
- **Not linked from** `AGENTS.md`, `SPRINT-SELECTION.md`, `STATUS.md`, `WORKERS.md` or `hand-off.md`.

### Already in `staging`

The sprint plan, the status board and the P0–P10 prompt pack were written on that branch and then brought into `staging` (sprint task S0.2). `staging` holds the current versions.

## 3. Recommendation

- **Done on 10 October:** the `3d-ulpin-claude` folder was removed and its branch kept. The rejected distillation history is still on that branch and on GitHub.
- **`wip/ab-task-20260923`** holds the preserved staged files. Nobody has reviewed them.
- **Not checked:** the contents of the 123 files that differ between the two branches, and the three folders that aren't part of this repository.
