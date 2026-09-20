# T089 — Publish main, fresh hosted data and presentation briefing

User authorizes committing this branch, pushing, merging to main, replacing the obsolete DigitalOcean deployment data and importing Lake View and Shiv Vihar exclusively through the hosted file chooser. Keep the demo open; officer authentication is explicitly deferred. No local data reset, seed or hosted snapshot restore.

1. Review publishable tree, verify imports/ML controls, commit branch and fast-forward main without rewriting remote history.
2. Reuse existing droplet and HTTPS proxy. Install the exact main release into a clean application directory. Preserve old release/volumes offline for rollback; start fresh isolated empty database/object/queue volumes. Apply schema only, not records. Retain qualified model artifacts and server secrets privately.
3. Build and start new application. Verify empty hosted directories. Upload both complete packages using hosted browser UI; review, render and save each. Verify receipts, reloading, conflicts, search, sources and model readiness.
4. Document exact feature boundaries, data flow/storage, duplicate-data limitations and judge questions. Record actual deployment/import evidence.

Checks: import/source and ML control regression tests, production build, package checksums, public origin rejection, hosted UI end-to-end and health. Do not call repo:init, repo:export, a seed utility or scripted dataset POST.
