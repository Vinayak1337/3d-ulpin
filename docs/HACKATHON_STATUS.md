# Hackathon delivery status

**HACKATHON_DEMO_VERIFIED — 12 September 2026.**

All hackathon gates are complete: real input processing, editable models,
explicit evidence correction, an independent second case, production startup,
restart persistence and repeated browser rehearsals. **46 Python tests, 19 API
scenarios and 6 production browser workflows passed.**

Open the [prepared C-001 showcase](http://127.0.0.1:3000/?case=d34cacf3-f4fc-4ac2-a282-9058fc4ea0e5)
to inspect seven spaces and the initial **6.4 m³** overlap. Use a fresh workspace
and [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for the full raw-input-to-correction story.

## Completed evidence

| Gate | Result and evidence |
| --- | --- |
| Platform and private originals | Real PostGIS, S3 upload/readback/hash, anonymous-access denial, Redis and worker checks passed. [PLATFORM.md](PLATFORM.md). |
| Source-to-model journeys | Actual C-001/C-002 inputs, queued processing, explicit revised binding and reopened snapshots passed: **6.4 → 0 m³** and **14.4 → 0 m³**. [API journey report](../test-results/demo-verification.json). |
| Geometry and inspection | **46 Python tests passed** locally and under Python 3.12, covering validation, quantities/intersections, evidence, jobs, authentication and readiness. [ARCHITECTURE.md](ARCHITECTURE.md). |
| API regressions | **17 adversarial checks**, **1 late-result race** and **1 closed-ring save/build check** passed. [Main API evidence](API_TEST_EVIDENCE.md), [stale-result evidence](API_STALE_RESULT_EVIDENCE.md), [closed-ring evidence](API_CLOSED_RING_EVIDENCE.md). |
| Production browser workflows | **6/6 passed in 150.044 seconds**, with no failures, skips, retries or flaky results: three consecutive fresh C-001 rehearsals, C-002, editing/display controls/PNG-PDF tracing/rejected upload/narrow layout, and actual file-chooser uploads. [Exact titles, IDs and media](BROWSER_TEST_EVIDENCE.md). |
| Production startup and recovery | `pnpm demo` completed platform setup, migrations, production build and web/dispatcher startup. Stopping the worker made app health fail; rerunning the launcher recovered it without starting another web server. |
| Docker restart persistence | Full platform stop/start without volume removal preserved **11 case IDs/revisions, 9 current model snapshots and 46 original source hashes**, including candidate specifications and findings. All five health flags recovered. [Before/after evidence](../test-results/platform-restart-verification.json). |
| Web reopen and showcase | Browser rehearsals refreshed their corrected models. Showcase case `d34cacf3-f4fc-4ac2-a282-9058fc4ea0e5` retained model `681eddd1-c71f-41a5-8f64-1d6718457089`, seven spaces and **6.4 m³** overlap across production web restart. [Showcase screenshot](../test-results/showcase-overlap.png). |

The final browser run started **09:50:52.876 UTC** on 12 September 2026 and
finished about 150 seconds later. Production build
`sUwSVhReW4W_7uN6Aa4wQ` has **24 JavaScript chunks** that passed syntax validation.

## Runtime fixes and limits

An initial database restart exposed an unhandled PostgreSQL idle-pool error.
The pool now handles that event and reconnects; rollback failures preserve the
original error. The full restart rerun passed at **09:40:07 UTC** (15:10:07 India
time), retaining the same localhost listener within that run.

Client minification is disabled because the pinned minifier corrupted Cesium
embedded WASM byte strings. The verified webpack client output is about
**17.6 MB uncompressed**; server optimization remains enabled. Resolve that
performance limitation before wider distribution. The pinned legacy MinIO
image limitation is documented in [PLATFORM.md](PLATFORM.md).

The core needs **no Nous API key or model service**; none was created. Supplied
inputs are generated synthetic examples, and their local draft models do not
establish surveyed location, ownership or official identity.

## Repeat and continue

`pnpm demo` starts the application; `pnpm test:e2e` repeats browser verification.
Other commands and setup are in [README.md](../README.md). To repeat the
persistent-data check, coordinate an idle window without active demo or queued jobs:

```sh
python3 scripts/platform-restart-verification.py --run-disruptive-checks
```

Use [ARCHITECTURE.md](ARCHITECTURE.md) and [INPUT_GUIDE.md](INPUT_GUIDE.md) to
understand the model, try meaningful changes and prepare the presentation.

## Original project scope remains deferred

This release uses one local operator. Multi-user authentication/roles, Keycloak,
Android evidence collection, field requests, offline sync, separate reviewer
decisions, accepted registry records and official identity issuance are deferred.
IFC, point clouds, arbitrary/sloped solids, geographic transforms, automatic plan
extraction and public deployment are also deferred.

The preserved [36-row acceptance matrix](../Astra_MVP_Handoff_Pack/04_ACCEPTANCE_MATRIX.md)
requires the full authenticated, cross-client review/identity lifecycle for
**MVP_VERIFIED**. **HACKATHON_DEMO_VERIFIED does not mean MVP_VERIFIED.** Missing
native-device, reviewer, authorization and registry scenarios have not been
relabeled as passed.
