# M001 — approved old-proof cleanup
Status: Planned. Execution not started. This is optional maintenance, not a product-data task.

## Authorization and exact boundary
The user confirmed 'all proofs' after the exact folder `E:\Projects\3d-ulpin-proof-20260917` was identified as the setup/demo/audit proof directory. Delete that directory and its proof contents only after reconnection and path verification. Do not broaden this to every filename containing 'proof', 'audit', 'demo' or 'setup'.

Exclude `E:\Projects\3d-ulpin`, its originals/fixtures/database/volumes, `E:\Projects\3d-ulpin-uttam-nagar-20260917`, the Google/OSM source studies, City Studio and future newly generated acceptance evidence. The latest user instruction is planning only, so no deletion runs now.

## Safe steps once execution resumes
Resolve the existing absolute path; verify it equals the authorized target and is an ordinary directory under the intended Projects parent. Inspect for reparse points, symlinks/junctions or unexpected resolution before recursive removal. Stop if deletion would follow a link outside the target or if the folder is no longer the identified proof output.

List a bounded filename/size inventory to verify the content class and active file handles/process use. Do not print sensitive raw contents. Use one native shell end-to-end with literal-path operations. If the folder is already absent, record that no removal was needed. If it is locked, stop/resolve only the known owning process with appropriate authorization; do not kill unrelated applications.

Delete the verified target, then check that it is absent and excluded directories remain present. Record only a short result and failure details. Do not retain a hidden copy of the entire proof folder against the user's cleanup intent. This authorized deletion is destructive; a rollback is not promised. Uncertainty about the exact path or newly discovered source/data content requires stopping, not guessing.

## Acceptance
Exact authorized directory absent; protected repository/source/study paths unaffected; actual outcome recorded. A partial failure is not reported as complete. A maintenance blocker does not require abandoning unrelated plan work.
