# VA2 - learner work: filter VA1's variants, one Stage A retrain with them, and the count receipts (fallback Step 1)

**A separate session from VA1**, and if both providers have limit, the other provider (WORKERS.md §8: a different
model checks what one wrote). This session never writes or edits a variant header.

**Worktree for your commits:** `<worktree>`. First: `git -C <worktree> status --short` (clean, or stop), then there
`git switch -c task/va2-variant-retrain 7a6fded0` (staging `7a6fded0`; say it; if VA1 is merged, the lead names that
commit). Gate GF-AGENT, FP-LEARN-TEST.

Read first: `docs/next-steps/FALLBACK-LEARNER.md` §4 Step 1 (filter and lineage) and §5 (how to run it);
`docs/evidence/gf-agent/a4d/HANDOFF.md`, `a4d/result.json`, `a4e/HANDOFF.md` (the arm you repeat: `cross_fit`, no
class balance, 805 examples, 33 positive, pooled threshold rule; the held-out count-only run); `scripts/agent/
measure-a4d.ts` and the Stage A trainer it calls (`services/geo/geo/usp_learning/stage_a.py`, read only);
`docs/evidence/gf-agent/va1/result.json` and `seeds.json`.

## Why
A4e left the student with 33 positives and zero correct positive commits; T-data fired. VA1 wrote header variants
of the real positive columns. This task turns them into training examples with real values, retrains once with
everything else equal, and measures whether the student now commits a correct positive field without a wrong one.

## Hard rules (each is a stop rule)
- **Variants are training material only:** `labelKind: synthetic_variant`, each in the same fold as its seed's
  family; never in calibration, threshold choice, evaluation or held-out.
- **Values come from real columns:** for each variant, re-sample cell values from real verified columns of the same
  target in development families of the same fold; no model types a value. A target with only one such column uses
  that column's values.
- **The filter (in code, before any fit):** the existing verifier with an executor dry-run on the re-sampled rows;
  duplicate and near-duplicate removal (equal after case folding, whitespace and punctuation removal, against the
  seed and every kept variant); the cap of 20 per seed. Record each drop with its reason.
- **One arm, the A4e arm,** with the variants added and nothing else changed (features, threshold rule, folds,
  seed). No second arm, no tuning. One held-out count-only run through the existing measurement, exactly as A4e.
- **No change under `services/**`** (it would move the processor image pin). If the trainer cannot take the extra
  examples without one, stop and report the file and line.
- Never open any `heldout`, `holdout`, `evaluator`, `provisional` or `acquisitions` folder or file yourself, nor
  `publisher-meaning.jsonl`, nor `E:/BhuAayam-data/task-data/d1c/`, nor anything under `E:/BhuAayam-data/runtime/**`;
  the held-out count runs only inside the existing measurement script. Never read any `.env`, `.envvv` or keys file.
  No provider call, no Docker, no GPU, no runtime.

## Part 1 - the filter (commit `feat(agent): VA2 variant examples from real values, filtered before learning`)
`scripts/agent/variants-va2.ts` and `scripts/agent/variants-va2.test.ts` (one good case, one near-duplicate, one
dry-run refusal, the fold rule). It reads `E:/BhuAayam-data/task-data/va1/variants-v1.jsonl` and writes
`E:/BhuAayam-data/task-data/va2/variant-examples.jsonl` and a drop list. If `measure-a4d.ts` needs one option to take
extra train-only examples, add only that option, with a test that the option off reproduces A4e byte for byte.

## Part 2 - retrain and measure (commit `docs(agent): VA2 one retrain with variants, counts only`)
Run the A4e arm with the variants. `docs/evidence/gf-agent/va2/result.json`: examples by kind (real, variant) and
target; pooled leave-one-family-out counts (wrong, correct positive, unknown committed, abstained) beside A4e's; per
target correct positive commits; the held-out counts (n, committed, correct, abstained), counts only; the threshold;
commands and exit codes. Then `docs/evidence/gf-agent/va2/ledger-entry.json` in the shape of the entries of
`docs/evidence/gf-ai/building/b3/failure-ledger.json` (hypothesis, baseline A4e, comparison, result, failure
signature, decision). The agent learner has no ledger file of its own (A4b to A4e record their attempts in their
`result.json`); the lead decides where the entry goes.

## Stop rule and success
- **Success:** a measured result by the A4e rule. "Supported" only if pooled leave-one-family-out shows at least
  one correct positive commit with zero wrong commits; otherwise the miss is recorded as one, and no further attempt
  is made in this task (Steps 2 and 3 are after selection unless the owner moves them).
- **Stop:** the option-off reproduction of A4e differs; the same failure twice.

## You own
`scripts/agent/variants-va2.ts`, `scripts/agent/variants-va2.test.ts` (new); one option in
`scripts/agent/measure-a4d.ts` if needed; `docs/evidence/gf-agent/va2/**` (new);
`E:/BhuAayam-data/task-data/va2/**` (new).

## Checks
`pnpm exec tsc -p scripts/agent/tsconfig.json`; the VA2 test and the existing agent tests A4e ran
(`docs/evidence/gf-agent/a4e/result.json` `tests.agentFiles`); `pnpm typecheck:backend`; the option-off byte-equal
reproduction; `git diff --check`; lines of 120 characters or fewer in files you write.

## Git (owner's rules, binding)
Commit on `task/va2-variant-retrain` only; never push; never touch `staging` or `main`. Author and committer are the
owner's configured identity. No attribution of any kind: no Co-Authored-By line, no "generated with" line, and no
commit message or evidence line that names an AI model, tool, provider or worker as the one who did the work.

## Final answer
```
TASK   VA2 - variant filter, one Stage A retrain, counts only                     GATE GF-AGENT
WORKS  <kept variants; pooled wrong / correct positive vs A4e; held-out counts>
BRANCH <branch name and head sha>
GAPS   <one line>
COMMITS <short sha + subject, one per line>
CHECKS <each command with its exit code>
NEXT   <supported or a recorded miss; anything needing the lead or the owner>
```
Time box: 90 minutes.
