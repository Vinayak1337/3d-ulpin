# Current delivery policy — updated 26 September 2026

This records the user's direct instructions and applies to all current implementation assignments. It takes precedence over older handoff text, H97 hardening addenda, task cards, design references and worked examples. [AGENTS.md](../../AGENTS.md) carries the same operating rules. Historical evidence remains evidence only at its recorded revision.

## Official sources and unchanged originals

Use real data discovered through **data.gov.in first**, or downloaded directly from the responsible government/public authority or official issuing institution. Verify and record that authority; a community collection, mirror, vendor prediction, open licence or repository alone does not establish official provenance. Check source-specific access, use and redistribution permission separately.

Do not author synthetic datasets, dummy identifiers, generated documents/images, artificial geometry, simulated records, altered-source adverse cases or invented source facts to fill a test. Deterministic extraction/conversion is allowed only with a trace to unchanged official originals. Expected values may be independently calculated from those actual source facts, with the derivation and uncertainty recorded; do not invent an oracle's input facts.

Preserve issuer, original URL/resource ID, release/acquisition date, licence and permissions, original bytes/hashes, native IDs, geography, CRS/vertical reference, units and exact extraction lineage. Missing or conflicting source values stay missing or conflicting. Access to an official file does not establish survey accuracy, current title or permission to expose private information.

## Test coverage and legacy evidence

D0/PACK0, previous synthetic work, existing community datasets and their receipts remain protected historical material. Do not delete, rewrite or silently promote them. They do not meet the new official-source acquisition or acceptance requirement. The unmerged synthetic DATA-02 branch is superseded.

DATA-02 now discovers naturally occurring difficult official records and documents a case-to-source coverage matrix. DATA-08 independently derives expected outcomes from those sources. Find authentic clean/adverse pairs where available; do not fabricate a twin, remove metadata to create a defect, insert an attack, or generate dummy PII. Officially published source samples require provenance and permission checks. Record unavailable cases with the exact reason and the affected claim.

The safety and correctness requirements remain: unsupported must not read as zero, private data must not leak, and unknown reference/rights data must not be guessed. Unavailable coverage is **not a pass, waiver, completed gate or accuracy result**. Source/implementation work can continue independently; gate qualification still requires its named evidence and required review. No change to GF0–GF5 status is implied by this policy. A future explicit owner-approved scope change must remove the corresponding claim rather than hide a failed test.

## Desktop-first, light-only product

Deliver the current product for desktop in light mode only. Remove the theme switch and its reserved space; search, navigation and useful content take that space. Ignore stored dark-mode preferences. Mobile UI optimization and dark-mode product delivery are not current acceptance requirements.

Keep shared semantic components, design tokens, flexible layout boundaries and isolated responsive styles so themes and mobile layouts can be added later. Preserve working responsive behavior without expanding its scope now. Desktop keyboard access, focus, readable contrast, reduced motion and browser zoom remain required. Existing dark tokens, phone captures and reference designs are historical/future material, not a new delivery obligation or permission to claim mobile accessibility.

## Frontend replacement within the existing plan

The user requires the legacy UI to be deleted and rebuilt from the design system and supplied Officer Studio mockups. Carry this out progressively while executing the existing task cards in dependency order; do not start a separate redesign programme, bulk deletion pass or legacy-polishing detour. Each UI-bearing card builds its affected screens afresh, wires their actual capabilities, then removes the superseded components and styles once their consumers have migrated. Record the replaced, retained and still-pending surfaces in that card's receipt; an untouched screen is not a completed replacement.

Reuse the established tokens, semantic primitives, backend APIs, canonical registry, shared selection/cache contracts and single Cesium runtime where they satisfy the plan. Preserve unique document, GIS, raster and point-cloud inspection capabilities and compatible saved URLs; redirects into the replacement UI are acceptable. Rebuilding presentation is not authorization to delete records, originals, historical evidence or runtime infrastructure. Mockups supply layout and interaction references only, never production code or sample data.

UI-03 replaces the map presentation as map capabilities are implemented; UI-04 replaces Batches, intake and workspace; UI-05 replaces Register and its evidence, deviation and underground surfaces; PACK-01 supplies the card surfaces. Apply UI-08's record-backed content and provenance checks within each replacement. Preserve the unmerged UI-08 attempt-1 checkpoint as history; its standalone legacy-polishing attempt is stopped. Selectively reuse reviewed, neutral helpers or isolation tooling with explicit provenance, rather than importing the old presentation wholesale. Capture the affected real routes and test their interactions at each step. Full replacement and runtime gate acceptance remain pending until all assigned surfaces and tests are complete.

## Scene and future work

Enhanced view may style, shade and display deterministically converted **officially sourced geometry**. Do not populate the scene with invented trees, widths, storeys, roofs, façades, unit boundaries or heights. Publisher-supplied estimates retain their original estimated classification and cannot silently become analytical truth. Missing source geometry is shown as unavailable; styling is not substitute data.

The Evidence/Enhanced view control is distinct from a light/dark theme control. Future mobile support, additional themes and generative enrichment remain architecture options; implementation that invents source-like data requires a new explicit user scope decision. Existing independent-review, privacy, residency, source-retention and no-deployment rules remain in force.
