# Teammate B — Immediate Assignment

**3D Property Registry · 12 September 2026**

Complete only the tasks below first. You have basic backend/frontend/app skills; the assignment is bounded so you can work before the complex core exists. Own your code, tests and fixes. Vinayak owns architecture, geometry, security, review transactions, sync design and heavy processing.

Read [01](reference/01_Product_Problem_and_Solution.md) for input/fixture meaning and [02](reference/02_Modules_and_Architecture.md) for the shared stack. Use the [revised master plan](03_Three_Person_Implementation_Plan_REVISED.md), not the older staffing instructions, for ownership. Work starts as research/pure functions/fixtures; shared schemas are finalized with Vinayak before integration.

## B01 — Define input fields, payload examples and intake test scenarios

**Phase:** 1  
**Start condition:** START NOW — use the supplied source documents; no live app is required.

**Do:** List what the user enters, what the file/inspector supplies and what only the server sets for each input type. Draft upload/finalize/list/read/evidence-response examples and an acceptance matrix. Separate structural input validation from purpose-specific suitability. Mark schema proposals for Vinayak approval rather than creating a competing canonical contract.

**Deliver:** `docs/intake/input-fields.md`; request/response fixture drafts; valid/invalid/missing-metadata/stale/denied scenarios; questions that V00 must resolve.

**Done when:** The examples cover parcel, plan, level/control records and request-linked photos/notes first, with all richer inputs inventoried. Actor, accepted status, accepted pointers, authoritative revision and server timestamps are not trusted client fields.

**Boundary:** Do not design a separate backend, automatic legal approval, storage access policy or independent geometry schema.

**Handoff to:** Vinayak freezes the shared contract; A supplies actual file/metadata examples.

## B02 — Build pure intake validators and a schema-driven API test collection

**Phase:** 1  
**Start condition:** START NOW with fixtures/tests and pure functions; adopt V00 shared schema exports before integration. No database or frontend is needed.

**Do:** Validate the agreed metadata envelope and request shapes in TypeScript. Test source type, purpose, optional/required fields, explicit unknown values, operation IDs and expected revision fields. Create request examples/test helpers using mocked transport and clearly labelled fake responses. Do not turn the mock into a second production API.

**Deliver:** Tests under the agreed platform-test area; reusable intake validators using `packages/contracts`; API request collection or equivalent scripts; schema-valid mock examples.

**Done when:** Good examples pass; malformed requests fail with field-level messages. A source can be received yet require metadata for a particular purpose. Fake responses are labelled and cannot count as real endpoint evidence.

**Boundary:** No hardcoded permissive auth, duplicate contract definitions, guessed measurement units or client-controlled acceptance. Integration of parsers into the canonical packages is reviewed by Vinayak.

**Handoff to:** B03/B05 reuse the validators and tests; Vinayak’s clients consume the same schemas.

## First handoff

Send changed files, a source/sample or request example, a valid and invalid result, exact run/test commands, actual output and known limitations. Mark tests not run when they have not run. Coordinate the contract and synthetic XY layout with Vinayak; do not invent a real site, official identifier, missing datum or accepted record.

Use the [source register template](templates/SOURCE_REGISTER_TEMPLATE.md) and [task handoff template](templates/TASK_HANDOFF_TEMPLATE.md). Keep one primary implementation task active; report an exact missing dependency instead of saying only “waiting for backend.”

## Your next assignment, not a current blocker

**B03:** Vinayak will provide a guarded route, shared contracts, database and verified upload/finalization helpers. Then implement the source upload-session, finalization, case-source-list, source-detail and controlled-read routes. You do not need to wait for the 3D editor.

Your [later task queue](05_Teammate_B_Start_Now_and_Later.md) specifies subsequent work and its unlock conditions. Do not begin advanced inputs or UI polish at the expense of the first complete manual web/mobile case.
