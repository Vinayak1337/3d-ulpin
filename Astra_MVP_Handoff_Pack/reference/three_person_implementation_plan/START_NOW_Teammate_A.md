# Teammate A — Immediate Assignment

**3D Property Registry · 12 September 2026**

Complete only the tasks below first. You have basic backend/frontend/app skills; the assignment is bounded so you can work before the complex core exists. Own your code, tests and fixes. Vinayak owns architecture, geometry, security, review transactions, sync design and heavy processing.

Read [01](reference/01_Product_Problem_and_Solution.md) for input/fixture meaning and [02](reference/02_Modules_and_Architecture.md) for the shared stack. Use the [revised master plan](03_Three_Person_Implementation_Plan_REVISED.md), not the older staffing instructions, for ownership. Work starts as research/pure functions/fixtures; shared schemas are finalized with Vinayak before integration.

## A01 — Make the input-source register and acquisition decisions

**Phase:** 1  
**Start condition:** START NOW — only the supplied project documents are required.

**Do:** Inventory every source family in the input matrix below. For the first manual case, prioritize parcel context, a plan, level evidence and reference/control information. For each needed family choose one practical primary route and one fallback. Research the actual provider/access route and intended-use conditions; distinguish a public viewer, a downloadable file, a documented API and permission-based access. Record what you actually acquired and inspected, not just what a portal advertises. Keep deferred data leads brief.

**Deliver:** `docs/data/source-register.md`; `docs/data/source-decisions.md`; provider/asset references and acquisition instructions. Use the supplied source-register template.

**Done when:** Every core input has a concrete acquired sample, a specifically described permission/access blocker, or an explicitly synthetic fallback. Download/inspection status and permission status are separate. All other input families are marked deferred, optional or needed with a reason.

**Boundary:** Do not claim government integration, current dataset access, commercial/showcase permission or survey accuracy from the old notes. Do not scrape a viewer, bypass access controls, or acquire large datasets merely because they exist.

**Handoff to:** Vinayak uses the decisions to choose supported profiles; B uses the input/metadata requirements.

## A02 — Assemble the minimal fixture pack and independent expected results

**Phase:** 1  
**Start condition:** START NOW for the folder, manifest and source examples. Freeze the exact synthetic XY geometry and final schemas with V00 before publishing numeric fixtures.

**Do:** Build a small explicitly synthetic C-001 pack: parcel context, E-PLAN-01 reference drawing, E-LEVEL-02 r1/r2, reference/control records, and request-linked example response RQ-LEVEL-01. Preserve the prescribed storeys, U01–U04, separate common circulation and BSM-01. Add valid and deliberately invalid input samples. Keep any real importer samples in a different collection from the coherent case. Record expected results independently of the production functions.

**Deliver:** `fixtures/c001/README.md`, `manifest.json`, original sample files, `expected-results.md`; `fixtures/adapter-tests/`; a manifest entry for each file with hash, provenance, reference, purpose and limitations.

**Done when:** A second contributor can identify which file supports footprint, lower limit, upper limit and alignment. Expected checks include the 2.8–3.0 m overlap, corrected contact at 3.0 m, missing references and the U04 evidence dependency. Missing XY dimensions are resolved as new synthetic choices, not attributed to the source documents.

**Boundary:** Do not attach an invented real-world location or official-looking ULPIN to the synthetic case. A local-frame fixture must be explicitly labelled; do not pass it off as a geographically located dataset. Do not overlay unrelated cities as one site.

**Handoff to:** All three contributors use this same pack. Vinayak approves its geometry/reference conventions; B uses it for seed and request fixtures.

## A03 — Implement small, independently testable input inspectors

**Phase:** 1  
**Start condition:** START NOW with pure parsing helpers and local tests. Align their public result shape with V00 before integration; no database, login or live backend is needed.

**Do:** Implement bounded CSV/JSON parsing and metadata inspection for the selected control/level CSV and parcel-vector profile. Check headers, parseable numbers, declared units/reference metadata, supported type and required identifiers; return specific issues with row/field locators. For PDF/image plans, initially report supplied metadata and manual-reference requirements; use a renderer supplied by Vinayak rather than building automatic plan understanding. Preserve original values.

**Deliver:** `services/geo/adapters/basic/` helpers; valid/invalid tests; sample inspection JSON; a local example command. Use the Python processing area rather than creating another application server.

**Done when:** A documented command processes a good sample and produces structured issues for bad headers, malformed numbers, missing required metadata and unsupported input. Unknown reference/quality stays unknown. Metadata inspection is not labelled geometry validation or acceptance.

**Boundary:** Do not implement CRS transformations, arbitrary 3D validity, floor inference, model training or cadastral decisions. Do not silently repair coordinates or guess units.

**Handoff to:** Vinayak supplies the shared result schema and later processing template; A04 turns these helpers into real operations.

## First handoff

Send changed files, a source/sample or request example, a valid and invalid result, exact run/test commands, actual output and known limitations. Mark tests not run when they have not run. Coordinate the contract and synthetic XY layout with Vinayak; do not invent a real site, official identifier, missing datum or accepted record.

Use the [source register template](templates/SOURCE_REGISTER_TEMPLATE.md) and [task handoff template](templates/TASK_HANDOFF_TEMPLATE.md). Keep one primary implementation task active; report an exact missing dependency instead of saying only “waiting for backend.”

## Your next assignment, not a current blocker

**A04:** Vinayak will provide the controlled private-job/storage template. Then expose your inspectors as real processing operations; a simple approved core-data fetch adapter may also start then, without waiting for AI.

Your [later task queue](04_Teammate_A_Start_Now_and_Later.md) specifies subsequent work and its unlock conditions. Do not begin advanced inputs or UI polish at the expense of the first complete manual web/mobile case.
