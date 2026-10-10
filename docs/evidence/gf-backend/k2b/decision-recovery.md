# Bounded officer-command recovery

First live command returned 503 (no successful receipt). Inspection of the existing SQL schema found that
`physical_feature_revisions.package_id` is NOT NULL: the command had omitted the import-package lineage while
appending its physical revision. All writes are in one transaction; before-state is recaptured before recovery.
No database schema change or direct DB write was made.

Hypothesis: carry the package ID from the exact prior physical revision into the officer revision, without
editing that package or deleting history. Add a focused regression for this required lineage. One corrected API
run must append registry/physical revision 2 and preserve revision 1; exact request-key replay must not append
another revision. Stop if the materially corrected run fails. The API intentionally redacts DB exception text;
the worker does not weaken that filter to obtain a private traceback.
