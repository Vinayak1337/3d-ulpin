# Hackathon delivery status

**Current classification: core, production startup and Docker restart
persistence verified; final browser rehearsal evidence pending lead sign-off.**
Do not yet use `HACKATHON_DEMO_VERIFIED`. The short-deadline demo is distinct from
the full original project and its `MVP_VERIFIED` gate.

## Delivered and directly checked

| Area | Current evidence |
| --- | --- |
| Full local platform | Colima/Docker, PostgreSQL/PostGIS, private MinIO, Redis, FastAPI and Celery are running. Real PostGIS query, private object upload/readback/delete, anonymous 403 and actual worker execution passed. See [PLATFORM.md](PLATFORM.md). |
| Input-to-model journeys | Lead reported both C-001 and C-002 live API journeys passed: actual uploaded originals verified by hash, inspection, preparation, queued geometry, explicit revised binding, rebuilt correction and reopened snapshots. Repeat with `pnpm test:demo`; run IDs are written to `test-results/demo-verification.json`. |
| Independent geometry and inspection | Geometry worker reported **46 tests passing locally and under Python 3.12**, including invalid inputs, quantities, intersections, evidence, job/auth behavior and readiness. See [ARCHITECTURE.md](ARCHITECTURE.md) and `services/geo/tests`. |
| Adversarial application behavior | **17/17** live API checks passed, covering upload idempotency, malformed JSON/CSV, benchmark mismatch, foreign case IDs, origins, stale edits and source/evidence immutability. |
| Late results and canonical footprints | Controlled stale-result race passed; late output did not replace the current model or newer candidate. Closed-ring create/edit followed by real queued builds passed with identical persisted/computed specs. Together with the adversarial suite: **19 passing scenarios**. Evidence and case IDs: [API_TEST_EVIDENCE.md](API_TEST_EVIDENCE.md). |
| Truthful service readiness | Stopped worker makes application health `ok:false, worker:false` while other healthy service flags remain true. Restart restores all true; token denial and full post-restart platform health passed. |
| Production launch and launcher recovery | Lead reported successful complete `pnpm demo` startup with the webpack production build and dispatcher. Independently stopped the worker, ran `pnpm demo`, and verified it recovered services/migrations and exited with the same existing IPv4 localhost web listener, without another web server. |
| Docker restart persistence | Complete `platform-stop.sh` → `platform-start.sh`, with no volume removal, preserved **11 case IDs/revisions, 9 current models and all 46 original source hashes**. Candidate specifications, snapshot IDs/full model contents and finding IDs/hashes matched before and after. All five application health flags recovered. Exact evidence: [platform-restart-verification.json](../test-results/platform-restart-verification.json). |
| Web implementation and handoff | Source inspectors, linked plan/3D views, editing, plan previews/calibration/tracing, floor controls and history are implemented. [README.md](../README.md), [DEMO_SCRIPT.md](DEMO_SCRIPT.md), input guide and architecture guide describe the actual interface. Browser execution remains a separate release check below. |

The core is deterministic and needs **no Nous API key or other model service**.
No key was created because no AI-dependent step was necessary. The original
handoff documents remain preserved; the current plan is
[HACKATHON_PLAN.md](HACKATHON_PLAN.md).

## Final demo gate — pending lead evidence

The production launch and coordinated Docker restart checks passed. Set
`HACKATHON_DEMO_VERIFIED` only after the lead also records the remaining browser
checks and signs off the combined evidence:

- Integrated browser checks for selection, source inspection, meaningful
  editing, PNG/PDF reference behavior, calibration/tracing and useful failure
  states, at the supported presentation viewport.
- Three consecutive fresh C-001 browser rehearsals completing
  **6.4 m³ → explicit r2 binding → 0 m³** without precomputed model substitution.
- Browser reopen of a corrected workspace after the verified service restart,
  preserving the selected case, source/revision views, findings and result.
- An evidence record stating actual commands or interactions, results and
  relevant case/snapshot IDs. Record remaining gaps directly if a check fails.

No final browser pass is claimed in this document yet. The Docker restart
verification kept the host web process running; the lead separately exercised
full production web startup. Browser-visible reopen/rehearsal remains distinct
from exact API persistence comparisons.

The first coordinated Docker restart exposed a PostgreSQL idle-pool error that
terminated the host processes. The lead added an idle-pool error listener and
preserved the original error if rollback fails, then rebuilt. The complete
restart and persistence rerun passed on that fixed production build.

The passing coordinated run completed **12 September 2026, 09:40:07 UTC**
(15:10:07 India time). Production localhost listener PID **83630** stayed the
same through worker-only launcher recovery and the complete Docker restart.
To repeat this check after coordinating an idle window with no active demo or
queued jobs:

```sh
python3 scripts/platform-restart-verification.py --run-disruptive-checks
```

The lead is preparing a further production UI build to address Cesium minifier
compatibility. Its browser results remain pending; the completed runtime and
persistence checks above refer to the previously verified production build.

## Deferred from the original project

Today's application intentionally uses one local demo operator. Multi-user
authentication and roles, Keycloak, native Android evidence collection, targeted
field requests, offline synchronization, separate reviewer decisions, accepted
registry records and official identity issuance are not delivered by this demo.
IFC, point clouds, arbitrary/sloped solids, geographic transforms, automated
plan extraction and public deployment are also deferred.

The original [36-row acceptance matrix](../Astra_MVP_Handoff_Pack/04_ACCEPTANCE_MATRIX.md)
requires the complete cross-client, authenticated review/identity lifecycle for
the unqualified `MVP_VERIFIED` label. This hackathon work does **not** pass that
matrix wholesale. It has not relabelled missing native-device, reviewer,
authorization or registry scenarios as passed.

Use the next two days to understand the current model and evidence flow, try
meaningful geometry/source changes, collect presentation feedback, and choose
the next product increment. Begin with [ARCHITECTURE.md](ARCHITECTURE.md) and
[INPUT_GUIDE.md](INPUT_GUIDE.md); keep requests for the formal lifecycle separate
from fixes needed for the working local demonstration.
