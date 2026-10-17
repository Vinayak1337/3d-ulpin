# VA1 - teacher round: header variants of the 33 verified positive columns (fallback learner Step 1, labels only)

**This session is a teacher session: new and narrow.** It opens only the files this task names. It never opens
held-out or evaluation material, never verifies, trains or evaluates, and is never resumed for VA2.

**Worktree for your commits:** `<worktree>`. First: `git -C <worktree> status --short` (clean, or stop), then there
`git switch -c task/va1-header-variants 7a6fded0` (staging `7a6fded0`; say it). Gate GF-AGENT (mapping learner).

Read first: `AGENTS.md` ("Teachers"); `docs/next-steps/WORKERS.md` §8 (rules that hold whichever provider teaches);
`docs/next-steps/FALLBACK-LEARNER.md` §3 and §4 Step 1 (seed, variants, filter, lineage; the owner's permission of
10 October night, also `SPRINT-SELECTION.md` §2 row "Header variants for training"); `docs/evidence/gf-agent/a4d/
HANDOFF.md` (the 33 verified positives over nine targets; T-data fired: 0 of 6 original targets reach 12);
`docs/evidence/gf-agent/t1/HOW-TO-VERIFY.md` (the label line shape).

## Why
The demo's learner panel shows teacher calls dropping as memory and the student take over. Memory works; the student
has never committed a correct positive field, because it has 33 positive examples over nine targets (A4e). The
plan's only pre-freeze remedy is Step 1: more spellings of the real positive headers, for training only. The owner
allowed it on 10 October night; the trigger T-data has fired. This task writes the variants; VA2 filters, trains
and measures them in a different session.

## Hard rules (each is a stop rule)
- **Seeds are only the verified positive columns of the development rounds T1, T1b, T1c and T1d**: label lines under
  `E:/BhuAayam-data/task-data/t1/`, `t1b/`, `t1c/`, `t1d/` that the canonical verifier accepts with a target other
  than `unknown`. Find them by running `scripts/agent/verify-teacher-labels.ts` on each round as A4e did (its
  `HANDOFF.md` gives the command); expect 33. If you count a different number, stop and report both lists.
- **Leave out `building.footprint`** (its value is geometry and its CRS is unverified): 32 seeds.
- **You write header text only.** For each seed: up to 20 other spellings of its header and up to 3 of each
  neighbouring header (abbreviations, Hindi in Devanagari, transliterations, portal and spreadsheet styles, units in
  the header where the target has a unit). **Never a cell value**, never a new column meaning, never a header for a
  different target. Code re-samples the values in VA2.
- Each line: `{ seedProfileId, target, headerVariant, neighbourVariants, style, labelKind: "synthetic_variant",
  method: "model:claude-opus-5-5@dev-2026-10" }` if this session runs on the Claude CLI, or
  `"model:gpt-6.1-sol@dev-2026-10"` on the codex pool. Never record a round under the other provider's id.
- Never open any `heldout`, `holdout`, `evaluator`, `provisional` or `acquisitions` folder or file, nor
  `publisher-meaning.jsonl`, nor `E:/BhuAayam-data/task-data/d1c/`, nor `E:/BhuAayam-data/datasets/messy-india/`
  family folders other than those a seed's profile names, nor anything under `E:/BhuAayam-data/runtime/**`. Never
  read any `.env`, `.envvv` or keys file. No provider call through the product, no Docker, no GPU, no training.
- Nothing in the existing label files or profiles changes.

## Part 1 - seeds (commit `docs(agent): VA1 the seed list`)
`docs/evidence/gf-agent/va1/seeds.json`: each seed's profile id, round, family, target and header, with the verifier
command and exit code per round; the count by target (expect the A4d table minus the footprint).

## Part 2 - variants (commit `docs(agent): VA1 header variants`)
`E:/BhuAayam-data/task-data/va1/variants-v1.jsonl` (outside Git), at most 20 variants per seed, in seed order. A
self-check script `E:/BhuAayam-data/task-data/va1/check-variants.py` (run with `python -B`): every line parses, its
seed exists, its target equals the seed's, no `headerVariant` equals its seed header after case folding and
whitespace removal, no duplicates within a seed, no digit run longer than 4 (a value, not a header), the cap holds.
`docs/evidence/gf-agent/va1/result.json`: file path, SHA-256, bytes, lines; counts by target and by style; the
check's command and exit code; `role: "development teacher: variants only; no verification, training or evaluation"`.

## Stop rule and success
- **Success:** a variants file of at most 640 lines over the 32 seeds that passes its own check.
- **Stop:** a seed list that differs from 33 (less the footprint); a check failing twice after one repair.

## You own
`docs/evidence/gf-agent/va1/**` (new); `E:/BhuAayam-data/task-data/va1/**` (new).

## Checks
`git diff --check`; lines of 120 characters or fewer in files you write; `python -B .../check-variants.py` exit 0;
the SHA-256 in `result.json` recomputed and equal.

## Git (owner's rules, binding)
Commit on `task/va1-header-variants` only; never push; never touch `staging` or `main`. Author and committer are the
owner's configured identity. No attribution of any kind: no Co-Authored-By line, no "generated with" line, and no
commit message or evidence line that names an AI model, tool, provider or worker as the one who did the work. (The
`method` field in a label line is the lineage the verifier requires, not attribution of the commit.)

## Final answer
```
TASK   VA1 - header variants of the verified positive seeds                      GATE GF-AGENT
WORKS  <seeds, variant lines, by target>
BRANCH <branch name and head sha>
GAPS   <targets with too few seeds to vary well>
COMMITS <short sha + subject, one per line>
CHECKS <each command with its exit code>
NEXT   VA2 in a separate session
```
Time box: 60 minutes.
