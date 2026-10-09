# Handoff: cloud review session → local session on the owner's PC

> **Superseded on 10 October 2026.** The reconciliation is done; see [docs/STATUS.md](../STATUS.md). The executable plan is [SPRINT-SELECTION.md](SPRINT-SELECTION.md). The owner answered the open decisions:
> - Claude leads everything;
> - no team labels;
> - Sarvam is the runtime teacher;
> - the selection demo is about 24 October.

Written 6 October 2026 at the end of a cloud review session. A new Claude Code session on the owner's PC has none of that conversation, so start here.

## What the cloud session did

1. Reviewed `PROJECT_AND_ML_REVIEW.md` and wrote [ML_REVIEW_RECOMMENDATIONS.md](../../ML_REVIEW_RECOMMENDATIONS.md).
2. Did a deep dive across the docs and code: [PROJECT_DEEP_DIVE_ACTION_PLAN.md](../../PROJECT_DEEP_DIVE_ACTION_PLAN.md).
3. Wrote this prompt pack ([README](README.md), [standards](00-STANDARDS.md), P0–P10), including a conditional distillation recipe (P4.7).

## The conclusions that matter

- No release gate has started; all 30 gate tests have 0 attempts. Work went to format breadth and a text fine-tune.
- The ML that SIH26011 and GF-AI need is **building masks plus plan segmentation**. Both models exist (`services/geo/ml-models.json`) and are wired in (`spatial-ml`), but were never evaluated on Indian data. The fragment-support text lane should pause.
- GF-AI can't pass under the current label rules. **The owner must allow team-labelled holdouts** (P2.3).
- The Studio runs on 3 live / 33 mocked routes, and the linked database has no installed area. **Connecting them is the critical path** (P3.1, P8.1).
- The process overhead (837k lines of docs, the receipt culture, a contradictory AGENTS.md) needs a reset (P0).

## First actions on the PC, in order

1. **Reconcile reality.** Check the live `staging` head, the open Codex worktrees under `C:/Users/kvina/.codex/worktrees/`, which worker chats are still running, and the private data under `E:/BhuAayam-data/`. Read the Codex chat/session logs the owner points to for status since 4 October. Write what changed into `docs/STATUS.md` (P0.4) before acting.
2. **Settle the lanes.** AGENTS.md still says Claude is the *frontend* lead only and Codex owns the backend. If the owner now wants Claude to carry the whole project, record that in AGENTS.md as part of P0.2, including who owns which seams and whether Codex workers continue.
3. **Get the owner's decisions** (deep dive §6): team labels, gates passing at the demonstrated scope with named waivers, the demo site, the scope freeze, the finale date.
4. Then follow the critical path in [README](README.md): P0.1 → P0.3 → P1.1 → P2.1 → P3.1 → P8.1 → P4 → P5 → P7 → P9.1.

## Where things live

| What | Where |
| --- | --- |
| These documents, plus the review history | branch `claude/magical-bardeen-31bi7c` (contains `review/project-ml-20261004`) |
| Accepted backend integration | `staging` |
| Large originals, weights, checkpoints, receipts | `E:/BhuAayam-data/…` (outside Git) |
| Worker worktrees | `C:/Users/kvina/.codex/worktrees/…` |

The safety rules in AGENTS.md still hold: never reset populated volumes, delete originals, overwrite `.env`, push to `main` or deploy without the owner's go-ahead.
