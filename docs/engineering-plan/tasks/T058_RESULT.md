# T058 — Studio adoption and reference-led visual work

Result: **Completed for the declared Studio task**. The user-rejected T057 is not
reclassified as accepted. No user approval of T058 is invented. Branch:
`feat/studio-reference-rebuild`, based on `ee66106`.

The original City Studio was copied into the product before the scene changes.
Its original 944-building fixture and baseline captures are retained. The product
now opens the Studio and supports property, register, exact unit/document,
workspace, source import and export routes. A shared GPU canvas survives the
district/register/workspace transitions; registered identifiers and draft state
are not recreated merely to change panels.

The new, explicitly synthetic reference quarter contains **62 buildings, 62
parcels, 239 floors, 478 units, ten roads and twenty utility alignments**. **903
prepared PDF specimens** are byte-verified and linked to the existing
`ulpin-spatial/2` common contract. The same layout generator feeds the live plan,
cutaway, register and PDF. Source input and geometry digests are in the prepared
manifest, not asserted from a screenshot.

Rendering work changes the actual scene: framing, park/street composition, facade
variation, roofs, material detail, daylight, shadows and short-range contact.
The three-column plan workspace follows the supplied anchor and adds real source
measurements, comparison and revision-checked local drafts. Source upload uses the
existing case/source service. Local draft review remains explicitly local and does
not claim an unperformed registry write.

## Verification performed

- **315** core/Studio Node tests passed, including **20** Studio-specific tests.
- Existing spatial **29**, UI **20**, scene **7**, repository-mode **2**, register
  scope **3**, Uttam Nagar **14** and AI-validation **22** tests passed.
- Generated-schema drift and **218** shared Python conformance/oracle cases passed.
- Type checking and the actual production build command passed.
- **Eleven** final Studio browser groups passed on the actual RTX 3070/Direct3D11 backend:
  held gestures, canvas picking, route history, exact unit PDF, reload, source-plan
  tools, local draft persistence, real backend upload and responsive routes.
- The original shared-map browser suite was rerun against the same product build.
  Its exact result is copied to `verification/legacy-map-results.json`.
- All protected original database rows were retained. The real upload intentionally
  added one source in a new synthetic verification workspace; its original bytes
  were downloaded and matched the prepared PDF hash.

## Visual review, not just test passage

The actual original Studio and final implementation were compared with REF-15,
REF-16 and REF-17 side by side. The map triple, scene-only pair, register triple
and workspace pair were inspected, along with close, utility and mobile views.
The corrected discrepancies and remaining procedural-versus-photorealistic
differences are recorded in `docs/evidence/t058/REVIEW.md`. The runnable gallery is
`/studio-review/index.html`. No reference image replaces the runtime scene.

## Boundaries

The imported-data Cesium workflows remain compatible and reachable. This task
does not pretend to convert every existing geospatial page into the Studio's
rectangular authored scene, implement ML, issue official IDs or establish legal
ownership. Existing sources and real imported shapes are preserved. Any hosted
CI results must be recorded from their actual run; local success is not labelled
as a completed hosted run.
