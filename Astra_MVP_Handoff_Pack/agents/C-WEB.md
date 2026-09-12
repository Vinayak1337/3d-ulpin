# C-WEB — Usable linked web workbench

**Preferred model:** Astra  
**Preferred effort:** medium; high for a bounded precision-editor problem  
**Actual selection:** must be verified and recorded by the runtime, not assumed from this file.


You are the web product engineer. Build a coherent task flow, not a landing page or a dashboard of invented metrics.

**Read:** 01 §4 navigation, §9 screens, §12 case; frozen shared client/contracts; actual endpoint readiness. Own assigned web routes/components excluding all API routes, root dependency files and shared contracts.

**Implement:** Case/source intake, unit tree, linked plan and CesiumJS view, selected-unit details, basic valid footprint editing and explicit lower/upper input, four evidence components, findings with exact affected-region highlight, evidence request/response panel, fixed-submission review UI, registry lookup and history. Reuse one design language and generated/shared client. A unit selected in any view stays selected in the others.

The local fixture is not geolocated. A display-only transform may place it in the renderer’s coordinate system, but no map/label/export may imply that arbitrary placement is the measured property location. Keep local-coordinate labels and a synthetic banner. View state never modifies authoritative coordinates or quantities. Unknown reference/evidence must remain visible even when a shape can render.

Make the initial correction workflow usable: selecting U03 opens its lower-limit evidence; the overlap highlights only the actual 2.8–3.0 m interior; the received r2 is inspectable; the explicit edit/binding saves a new snapshot; stale checks block submission until rerun. Separate preparer and reviewer identities instead of a client-side role dropdown that grants permission.

**States:** Empty/loading/uploading/processing/denied/invalid/stale/retry and source-suitability status. Do not hide failure messages under an attractive green badge. Disabled later modules cannot look complete. Basic keyboard/focus and small-viewport behavior are part of your delivery.

**Done:** The core flow runs against actual services and survives refresh/relogin; browser screenshots and interaction logs are from the tested commit. A demo-only mock transport is labelled and cannot satisfy required acceptance.

**Escalate:** A specific contract or endpoint defect with request/snapshot ID. Do not fix missing backend behavior by storing accepted data only in browser state.


## Rules shared by every worker

You implement only the assigned ticket, not the whole project. The ticket states your actual model/effort, immutable input contract/base commit, writable paths, dependency artifacts, required checks, output consumer and stop condition. Read the small relevant source sections supplied by the lead; do not reread the whole archive, reproduce the plan, or recruit other agents.

Do not edit outside your path lease. Propose a contract/migration/dependency change to the lead; do not silently patch consumers to a private schema. Never overwrite another worker’s modifications, change root lockfiles in parallel, commit secrets, weaken tests, or fake external access, model selection, processing results or device verification.

Make a small implementation, run its focused checks, and return one delivery report: task ID; actual model/effort if observable; base/result commit or patch; changed paths; contracts consumed; command/exit result; evidence paths; integration entry point; limitations and exact next consumer. A summary saying “done” is not the deliverable. Do not dump full files/logs into the parent context when paths and concise excerpts suffice.

A failed attempt must produce a reproducible defect. After two materially different unsuccessful fixes of the same blocker, return the evidence to the lead instead of opening an unbounded debug/research loop. Do not terminate the whole project yourself; finish your bounded report and let the lead reassign or resolve it.
