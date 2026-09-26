# Historical engineering plans and verification inputs

**Current implementation starts at [USP handoff 00](../usp-agent-handoffs/00-README.md).**
Use [01](../usp-agent-handoffs/01-shared-contracts-and-ownership.md) for shared
contracts, the assigned feature A–K file, and
[99](../usp-agent-handoffs/99-ui-ux-and-integration.md) for the actual Studio UI.
Do not resume an old task merely because it is marked next in this folder.

This retained tree contains dated T-number plans/results and machine-readable
acceptance history. Its validator, reference catalogue, legacy source copies,
backlog and crosswalks still have local consumers. They preserve earlier coverage;
the current gate and dependency order are in [H00](../usp-agent-handoffs/00-README.md)
and [release-plan.json](../usp-agent-handoffs/release-plan.json).

Do not delete this tree recursively or reset accepted statuses. Migrate each
consumer and preserve source hashes before retiring its input. The fixed
baseline material is historical, not proof that new features or datasets pass.
The [historical current-work record](https://github.com/Vinayak1337/3d-ulpin/blob/eae7e7f418d72e4a36c526804380c35944e3809e/docs/engineering-plan/CURRENT_WORK.md)
and [previous entry point](https://github.com/Vinayak1337/3d-ulpin/blob/f623cff897f91bb3ebd4c225f700ac263f7beb72/docs/engineering-plan/00_START_HERE.md)
remain in pinned Git history. They do not establish a current runtime pass.

Existing validation, from this directory:

```sh
python tools/validate_plan.py
python -m unittest discover -s tools/tests -p 'test_*.py'
```

These check historical planning/collector consistency only, not application,
dataset or browser acceptance. Do not use `--planning-snapshot` to erase later
results, or regenerate/backdate manifests as fabricated new evidence.
