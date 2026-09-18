# T002 — reference and fixture specification accepted

Date: 18 September 2026. Result: **Accepted as a specification**, not implementation
visual approval. Review: direct image inspection and explicit self-review.

The portable catalog retains all 32 source records: 30 screens/boards and two
supporting crops. The original archive paths, image dimensions and SHA-256 values
were independently compared with the recovered renderer manifest. Their canonical
projection digest is `0f6ffaee3fe3ad2951733b3b40b3366e4b651117d8bec87bebdd3b6cda293c3d`.
The source manifest checksum is recorded separately; aliases are not falsely
represented as a byte-identical copy of the entire manifest.

Primary REF-15/16/17 were inspected at full size and all remaining references in
five contact sheets. Misleading workspace/register filenames are explicitly mapped
to their visible content. Nineteen screen families cover all UI-01–UI-16 gates,
with derived-state gaps recorded rather than invented screenshots. RQ01–RQ16 and
F01–F09 remain traceable, including held-out selection, zero-document operation,
native-frame seams and non-overlapping quantity definitions.

The acceptance contract defines four capability profiles, four viewport profiles,
eight camera cases, ten cross-cutting states, critical visual criteria and the
unchanged user approval gates. The current renderer has **not** been approved by
this task. No actual geography, source record, scene recipe or UI was changed.

Verification: `node --test tests/engineering-acceptance.test.mjs` **17/17 passed**,
including mutation tests for dropped requirements/gates, incorrect anchors,
duplicate hashes, fabricated approval, static-image substitution, false physical
touch/holdout claims and missing negative states. Existing plan consistency checks
passed **26/26**. Both workflows now include reference coverage checks.

Next: T003's bounded schema-authority, compatibility and coordinate experiments.
