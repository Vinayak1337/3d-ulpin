# T001 subtask: real isolated storage, worker and API baseline

## Outcome and environment

Run the committed repository snapshot, additive Uttam Nagar bundle and existing
API regression against real PostGIS, private S3-compatible storage, Redis and
Celery. This is a GitHub-hosted Linux runner profile, not a claim about the PC's
private database. Local Docker startup was blocked and will not be bypassed.
The existing containers, environment files and volumes on the PC are untouched.

Each hosted attempt owns `ulpin-t001-<run>-<attempt>` as a Compose project, a
matching `ulpin_t001_<run>_<attempt>` database, and a matching bucket. Generate new
credentials into the runner temporary directory, mask them before use, and do
not add them to Git or artifacts. Explicit `REPO_DATA=false` prevents the normal
repository-data mode from selecting the protected `ulpin-repo` environment.
Ports are 25432/29000/29001/26379/28000; the test-only Next server uses 3000.

## Fail-closed entry requirements

Require GitHub-hosted Linux, the exact repository, numeric run/attempt IDs,
matching project/database/bucket names, explicit loopback endpoints and complete
credentials. Reject production/default ports, endpoint userinfo/query/fragment,
an existing root `.env`, remote Docker endpoints and a pre-existing owned-name
project. A pure guard and negative tests run before any migration or restore.
Use explicit Compose `-p` and `--env-file`; never call `repo:init`, platform-start,
the old hard-coded transfer runner, or the worker pause test that addresses the
user's normal Compose project.

## Ordered execution and independent evidence

1. Validate the committed snapshot archive and every original file checksum before
   connecting. Require the test database and bucket to be empty. Restore without
   `--clean`, ownership replacement or disabled constraints. Upload create-only.
2. Compare actual restored tables with the committed table counts/hashes. Verify
   stored original bytes and metadata against the manifest and `sources` rows.
3. Run current migrations, retaining the pre-existing-row fingerprint set. Install
   the bounded Uttam Nagar bundle through its existing reviewed installer. Verify
   exact rows and originals and replay it to prove an unchanged no-op.
4. Repeat migration and compare protected rows, IDs, frames and original hashes.
   Pending historical jobs are a failure, not silently cancelled or marked done.
5. Start only the test server and dispatcher with the validated environment; run
   the existing API negative suite and closed-ring regression. These create new
   cases only. They may not modify the baseline's unrelated records. The old
   registry script mutates a named demonstration and is not used as a read-only
   preservation oracle. Record that coverage boundary explicitly.
6. Verify every protected row and original again after the new API cases. Run the
   calibration browser suite against this owned server. It proves the actual
   source/build/render path and software-WebGL interactions, not target-GPU visual
   acceptance. Run all Python geometry/processing unit tests in a disposable
   Python 3.12 test image with the project read-only and networking disabled.
7. Stop only owned child processes and the exact owned Compose project. A cleanup
   failure fails the task; runner teardown is not reported as a tested restore.

## Reports and failure handling

Keep bounded command logs and structured counts/digests under an ignored output
directory. Redact generated credentials from command failure output. Never upload
the runner environment, database dump, original documents or browser storage.
Report test failures with their unchanged assertions and fix a reproducible defect
through this task's plan before rerunning. No test result exists until a hosted
run finishes. Metadata-only CI and existing historical runs are not substitutes.

## Rollback and acceptance

All infrastructure is newly created on a disposable hosted runner, with no
production credentials. Revert only the added tooling/workflow if necessary.
T001 acceptance requires actual successful restore/hash/API/unit/browser evidence,
the initial source inventory and an honest list of skipped or deferred checks.
Private-PC data reconciliation remains required before any future write to that
environment; it is not fabricated from the committed fixture.
