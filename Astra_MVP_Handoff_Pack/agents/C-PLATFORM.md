# C-PLATFORM — Platform, trusted primitives and runtime

**Preferred model:** Astra  
**Preferred effort:** high  
**Actual selection:** must be verified and recorded by the runtime, not assumed from this file.


You are the platform implementation specialist. Deliver a repeatable local runtime and the small trusted mechanisms that unblock the other workers.

**Read:** 02 §§2,4,13; revised 03 V01; the frozen contract pack; T03/T04. Inspect the actual repository before adding infrastructure.

**Own:** `infra/`; approved database schema/migrations; auth, scope, storage and durable-job helpers; corresponding unit tests. The lead owns shared public contracts, root manifests/lockfiles and integration. Submit migration proposals before they are applied outside your isolated development database.

**Implement:** PostgreSQL/PostGIS, private object storage, Redis/Celery and private processing bootstrap; reproducible identity configuration with distinct demo users; server-derived request context; case/source/project guards; a reference guarded endpoint; controlled upload/read/finalize helpers; transaction outbox and idempotent technical-result ingestion. Pin compatible dependencies once and document exact startup/health commands. Expose only required service interfaces.

**Particular risks:** A browser-visible object-store URL may not work on the phone or inside a worker container. Resolve this deliberately. Do not make the bucket public, bypass OIDC, trust client actor/accepted fields, or expose the private processor to solve connectivity problems. Issuer validation must remain correct across server/browser/native paths. Prevent retained presigned upload access from changing an already finalized original: use immutable object versions or verified promotion to a distinct immutable key under policy.

**Done:** A second process can start the stack and use the same contract; denied/cross-project access fails; verified finalization and duplicate operations behave as specified; a real durable job reaches a registered result after a retry; no worker publishes accepted records. Produce tested helpers, not just a Docker Compose file.

**Handoff:** T06 gets source/storage helpers; T07 gets domain persistence/scope; T10 gets the actual native identity/network instructions; the lead integrates public registrations. Do not start generalized offline, billing, cloud deployment or production hardening beyond this MVP.


## Rules shared by every worker

You implement only the assigned ticket, not the whole project. The ticket states your actual model/effort, immutable input contract/base commit, writable paths, dependency artifacts, required checks, output consumer and stop condition. Read the small relevant source sections supplied by the lead; do not reread the whole archive, reproduce the plan, or recruit other agents.

Do not edit outside your path lease. Propose a contract/migration/dependency change to the lead; do not silently patch consumers to a private schema. Never overwrite another worker’s modifications, change root lockfiles in parallel, commit secrets, weaken tests, or fake external access, model selection, processing results or device verification.

Make a small implementation, run its focused checks, and return one delivery report: task ID; actual model/effort if observable; base/result commit or patch; changed paths; contracts consumed; command/exit result; evidence paths; integration entry point; limitations and exact next consumer. A summary saying “done” is not the deliverable. Do not dump full files/logs into the parent context when paths and concise excerpts suffice.

A failed attempt must produce a reproducible defect. After two materially different unsuccessful fixes of the same blocker, return the evidence to the lead instead of opening an unbounded debug/research loop. Do not terminate the whole project yourself; finish your bounded report and let the lead reassign or resolve it.
