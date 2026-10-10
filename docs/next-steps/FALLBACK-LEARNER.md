# Fallback learner plan: fine-tune, then reinforcement learning

> **Parked. Not part of the sprint.** Recorded on 10 October 2026 at the owner's request, to be picked up **only if the current approach fails** (triggers in §3). Until a trigger fires, the plan is [SPRINT-SELECTION §5](SPRINT-SELECTION.md#5-translate-and-learn-design-agent--background-learner) and [P3.5](P3-ingestion.md). Nothing here is dispatched, preregistered or approved.

**Source.** The owner pasted the transcript of a video (The Code Report, dated 5 October 2026) about the open "Ajax" model. The transcript is machine-captioned; its model names and numbers were not checked against the project it describes. This file keeps the method, not the facts.

## 1. The strategy in the video

1. **Base model.** An open-weights instruct model of about 9 billion parameters, run and trained on the author's own GPUs.
2. **Distillation was the first plan and it failed.** The author trained on a frontier model's answers through its API. The provider's terms forbid that for competing models, and the account was banned twice.
3. **Supervised fine-tuning (SFT).** The model is shown examples of successful tool use. The author wanted 20,000 clean examples, had about 300 real useful ones, generated synthetic ones and filtered them down to about 2,000. A call for donated data returned almost nothing.
4. **Reinforcement learning with GRPO** (group relative policy optimisation). The model attempts the same task several times, code scores each attempt, and training favours the attempts that beat the group's average. It needs a scorer, not a teacher.
5. **Refusal removal** with an "abliteration" tool, as the last step.

## 2. Compared with our approach

| | Video | Ours (current) |
| --- | --- | --- |
| Student | 9B generative model | Layout memory, then a small CPU classifier (Stage A); a 0.5–1.5B model only as optional Stage B |
| Teacher signal | Frontier-model answers (blocked), then synthetic examples | Teacher labels over **real** public tables, kept only if a deterministic verifier passes them |
| Quality gate | Filtering of the synthetic set | Schema, no literals, executor dry-run, quote at locator; officer corrections outrank teachers |
| Evaluation | Not described | Held-out source families with publisher-dictionary truth; commit at precision 1.0 or abstain |
| No-teacher learning | GRPO with a code scorer | None; RL is reserved for routing |
| Bottleneck met | Too few real examples | The same: 15 positives in 591 examples (A4c) |

- **What is the same:** both train a student on a teacher's checked answers. Through an API a teacher gives text, not probabilities, so "distillation" means exactly this in both.
- **Where ours is stricter:** the verifier, the closed held-out families, the abstain rule and the memory layer. The memory layer alone gives the falling teacher-call curve.
- **What the video has that we lack:** a way to multiply a small set of real positives (step 3), and a way to learn from a scorer without any teacher call (step 4).
- **Verdict on 10 October:** keep the current approach. Our student is failing for lack of positive examples, not for lack of model size, and D1f is acquiring real documented columns to fix that. A 9B model with RL does not fit the 8 GB card or the days left.

## 3. When to pick this up

Check after the D1f labels are verified and the one retrain (A4d) is scored.

| Trigger | What it means | Start at |
| --- | --- | --- |
| **T-data.** Most of the six positive targets still have fewer than 12 verified positive columns (D1f's own target) | Real sources can't supply the positives | Step 1 only, then one Stage A retrain |
| **T-method.** The positives are there, and leave-one-family-out still shows no correct positive commit at zero wrong commits | The classifier is the limit | Steps 2 and 3 |

No other reason starts it: not spare GPU time, and not a wish for a larger model. Before the 22 October freeze only Step 1 is realistic. Steps 2 and 3 take GPU days and belong after selection unless the owner moves them.

## 4. The steps, adapted to our rules

Unchanged throughout: layout memory, the deterministic verifier, officer review, `pseudo_label` lineage, closed held-out families, and every output a candidate.

**Step 1. Multiply the real positives** (the video's 300 → 2,000).
- **Seed:** verified real positive columns only (T1, T1b, D1f).
- **Variants:** a teacher writes other spellings of each seed header and its neighbouring headers: abbreviations, Hindi and transliterated forms, portal styles. Code re-samples the cell values from real columns of the same target; no model types a value.
- **Filter:** the same verifier with a dry-run on the re-sampled rows, duplicate and near-duplicate removal, and a fixed cap of variants per seed column.
- **Lineage:** a separate file, `labelKind: synthetic_variant` with `seedProfileId` and `method: model:<teacher>@<version>`. Variants never enter evaluation, calibration or held-out, and every variant stays in the same fold as its seed family.
- **Needs an owner decision first:** 00-STANDARDS §7 says a teacher doesn't hand-write examples. This step relaxes that for training material only.

**Step 2. A generative student by SFT** (the sprint's Stage B, brought forward).
- **Model:** a small open-weights instruct model that trains on the 8 GB card, 0.5–1.5B with LoRA through PEFT and TRL. The video's 9B base does not.
- **Task:** one masked column profile in, one MappingPlan v2 field as JSON out.
- **Data:** verified pseudo-labels and officer decisions, plus Step 1 variants if they were adopted.

**Step 3. GRPO on top of Step 2** (learning without a teacher call).
- For each profile the student writes several plans, code scores each one, and training favours those above the group's average. TRL's GRPO trainer; one GPU owner.
- **Reward, from code only:**

  | Outcome | Reward |
  | --- | --- |
  | Not valid JSON, or fails the plan schema | lowest |
  | Contains a literal, or the executor dry-run fails | low |
  | Wrong positive target | strongly negative, worse than abstaining |
  | `unknown` where the reference is `unknown` | positive |
  | Passes the verifier and agrees with the reference label | highest |

- **On unlabelled public tables** only the executor checks give reward. That is what lets the student use tables no teacher has labelled. Shape checks can't tell two look-alike identifiers apart, so the labelled part stays in the reward.
- Reward and model selection use development families only.

**Teacher and learner roles in every step** follow [WORKERS.md §8](WORKERS.md#8-teacher-and-learner-work-the-model-follows-the-provider): the provider that has limit takes the role, Opus 5.5 on Claude and `gpt-6.1-sol` on the codex pool.

## 5. How to run it when a trigger fires

Follow the failure-recovery rule in `AGENTS.md`: **one** bounded comparison, preregistered before any run.
- **Hypothesis:** the step named by the trigger.
- **Baseline:** memory plus the Stage A student at the A4c threshold (0 of 15 positives committed, 0 wrong).
- **Success:** on leave-one-family-out over **real** columns, correct positive commits above the baseline with zero wrong commits. Only then one held-out run.
- **Stop:** the time box, or the same failure twice. Record "no gain" as a result and return to delivery.

## 6. Not taken from the video

- **Refusal removal.** Our student maps columns. It has no refusals to remove, and nothing here weakens a model's safeguards.
- **Bulk distillation through a provider API.** That is what got the author banned. Our teacher rounds stay small, task-shaped and verified, for learners that compete with no provider.
- **The 9B base model.** It doesn't train on our card.
- **Voting agents as the quality check.** The author reports that they went wrong; we keep the deterministic verifier.
