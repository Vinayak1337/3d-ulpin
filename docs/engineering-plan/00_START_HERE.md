# Historical engineering plans and verification inputs

**Current implementation starts at [USP handoff 00](../usp-agent-handoffs/00-README.md).**
Use [01](../usp-agent-handoffs/01-shared-contracts-and-ownership.md) for shared
contracts, the assigned feature A–K file, and
[99](../usp-agent-handoffs/99-ui-ux-and-integration.md) for the actual Studio UI.
Do not resume an old task merely because it is marked next in this folder.

This retained tree contains dated T-number plans/results and machine-readable
acceptance history. Its tools, reference catalogue, legacy source copies,
backlog and crosswalks are still consumed by CI. They preserve earlier coverage;
they do not override F0 → F1-min → V0 or D0–D7 in the adopted handoffs.

Do not delete this tree recursively or reset accepted statuses. Migrate each
consumer and preserve source hashes before retiring its input. The fixed
baseline material is historical, not proof that new features or datasets pass.
[CURRENT_WORK.md](CURRENT_WORK.md) routes to the current assignment and selected
historical results. [The previous entry point](https://github.com/Vinayak1337/3d-ulpin/blob/f623cff897f91bb3ebd4c225f700ac263f7beb72/docs/engineering-plan/00_START_HERE.md)
is retained in Git history.

Existing validation, from this directory:

```sh
python tools/validate_plan.py
python -m unittest discover -s tools/tests -p 'test_*.py'
```

These check historical planning/collector consistency only, not application,
dataset or browser acceptance. Do not use `--planning-snapshot` to erase later
results, or regenerate/backdate manifests as fabricated new evidence.
