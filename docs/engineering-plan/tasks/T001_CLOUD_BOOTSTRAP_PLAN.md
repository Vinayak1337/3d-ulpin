# T001 preparation — cloud checkout and source-baseline tooling

Plan version 1.1. Prepared 18 September 2026. Target-repository execution is blocked until an authorized GitHub connection or authenticated cloud checkout is available. This is a bounded preparation increment inside T001, not completion of the entire baseline task.

## Outcome and allowed changes
Package the existing engineering plan under `docs/engineering-plan`, update the execution environment to allow a cloud checkout, and introduce a metadata-only baseline collector with tests. Add one uniquely named candidate GitHub Actions workflow. No existing product files, root instructions, dependencies, database configuration, migrations, source originals or renderer code are changed by this additive patch.

Check the target's current `AGENTS.md`, existing paths and workflows before applying. No live clone or fresh source tree could be fetched in the authoring environment. The patch must fail on path collisions; do not force-apply or silently overwrite an existing plan.

## Design
The collector reads Git's committed tree at a resolved HEAD. It records selected source hashes, safe script names, test/workflow path inventory and dirty/clean status. It never executes application scripts, inspects `.env`, connects to databases, follows tracked source symlinks, fetches remotes, installs dependencies, creates a branch, commits or pushes. It labels detached CI checkouts accurately and distinguishes a source inventory from preservation of a live database.

Use subprocess argument arrays with timeouts. Inspect blob sizes before bounded reads. Restrict source-content reads to an explicit allowlist and hash only regular committed files. Report safe relative paths, never remote URL credentials or script command bodies. Write the report exclusively to a new file outside the checkout and verify HEAD/status stability across collection.

## Tests and independent oracles
Use temporary Git fixtures, never pretend that they are the user's repository. Test clean and dirty checkout policies; detached HEAD; nested-directory input; no commit; wrong remote; credential redaction; malicious script content remaining unexecuted/unprinted; ignored `.env`; symlink entries; oversize/malformed manifests; external-only and no-overwrite output; source mutation detection. Expected SHA-256 values are computed independently from authored fixture bytes.

Validate the inherited plan with its existing validator and regenerate its Markdown backlog. Static-check the workflow for least privilege, no deployment, no self-hosted runner and pinned actions. Workflow execution on GitHub remains unverified until an actual run exists.

## Commit and rollback boundary
Intended one commit: `chore(T001): adopt engineering plan and cloud baseline tooling` on `feat/unified-spatial-foundation`. Apply only after `git apply --check` succeeds in a clean verified clone. Use an ordinary commit; no reset, force push, main-branch commit or automatic merge. Rollback removes only the added plan/tool/workflow files through a reviewed revert. No database rollback is involved.

## Exit of this preparation increment
The patch and overlay exist; helper tests and plan validation pass in synthetic fixtures; all status files say target-repository execution remains unverified. T001 itself still needs fresh code inspection, real safe baseline tests, isolated fixture/database/object-store verification, and a reviewed result. PC cleanup and validation of private PC-only data remain separate.
