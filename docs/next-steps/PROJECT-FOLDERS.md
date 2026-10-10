# Project folders on the owner's PC

Checked on 10 October 2026, 14:40 IST. `E:\Projects` holds several folders with "ulpin" in the name. This page says which ones are in use, what the others are, and what was found inside `3d-ulpin-claude`. Nothing was deleted or changed while checking.

## 1. Which folder to use

**Open every lead session in `E:\Projects\3d-ulpin`.** It is the main repository on branch `staging`, and it holds `hand-off.md`, `AGENTS.md` and all merged work.

| Folder in `E:\Projects` | What it is | In use? |
| --- | --- | --- |
| `3d-ulpin` | The main repository (`Vinayak1337/3d-ulpin`), branch `staging`. | **Yes: the lead's folder** |
| `ulpin-wt` | Worker folders. One checkout per worker (`a1`, `a2`, `b1`, `b3`, `d1`, `d3`, `f1`, `g2`, `k1`, `p1`, `s03`), each a linked worktree of the main repository on its own `task/…` branch. `_tasks` holds task files, launchers and logs, and is outside Git. | **Yes: workers only.** Never open it as the lead's folder. |
| `3d-ulpin-claude` | A linked worktree of the main repository on branch `claude/magical-bardeen-31bi7c`. See §2. | No. Archive. |
| `ulpin-ab-isolated-implementation-20260923` | A linked worktree from 23 September, detached at `777c978c`, with 19 staged but uncommitted new files under `ab-task/`. | No. Its staged files exist nowhere else. |
| `ulpin-data-policy-20260924` | A linked worktree from 24 September, detached at `36385b16`, clean. | No |
| `ulpin-city-studio` | A separate repository (`Vinayak1337/ulpin-city-studio`), branch `main`, last commit 18 September. | No |
| `3d-ulpin-baselines` | Not a repository. One JSON file. | No |
| `3d-ulpin-uttam-nagar-20260917` | Not a repository. 47 files from September. | No |

Sixteen more linked worktrees from the retired Codex desktop chats sit under `C:\Users\kvina\.codex\worktrees`. Their unfinished work was preserved on `wip/*` branches on 10 October (sprint task S0.1).

## 2. What is in `3d-ulpin-claude`

- **What it is:** the checkout an earlier Claude session worked in. Its branch split from `staging` on 4 October (common ancestor `bd0ef129`) and now ends at `d92d489a`, "Plan the selection sprint and refresh status". The same commit is on GitHub, so the branch is backed up. The folder is 201 MB and has no uncommitted changes.
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

- **Leave `3d-ulpin-claude` as it is.** It is the only local copy of the rejected distillation history, and its branch is on GitHub.
- **If the folder is ever removed,** remove only the worktree and keep the branch. That is the owner's decision; the lead doesn't delete it unasked.
- **`ulpin-ab-isolated-implementation-20260923` needs a look before any cleanup,** because its 19 staged files aren't committed anywhere.
- **Not checked:** the contents of the 123 files that differ between the two branches, and the three folders that aren't part of this repository.
