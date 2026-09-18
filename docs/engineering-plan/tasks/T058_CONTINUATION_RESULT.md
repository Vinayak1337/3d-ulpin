# T058 continuation — implementation and verification result

Continued from `6fe2d4f` on the same `feat/studio-reference-rebuild` branch. The
previous push was confirmed, and its three hosted workflows were successful.
This continuation addresses additional functionality and visual gaps rather than
moving to ML or treating the earlier completion note as user acceptance.

## Corrections

Property thumbnails are now qualified by the selected property ID. Closing the
inspector, selecting a finding and returning to a floor use atomic route changes.
Browser Back restores the actual register unit, not just the URL. Returning from
the register preserves the camera unless an explicit new command was requested;
View in map now focuses the selected floor at its source elevation.

Check source now downloads the prepared original, checks its SHA-256 and byte
count, and validates the selected building, floor plans and occupancy links. It
no longer displays an unconditional validation message. A failed source request
leaves verification visibly unsuccessful; retry after recovery is tested.

Draft notes, measurements, selected unit and revisions are stored separately by
floor. Old building-scoped drafts are read only on their own floor and retained
when migrated. Source changes, stale revisions and foreign-floor unit references
cannot silently overwrite a draft. Invalid or unfinished measurements cannot be
queued for review. Control-Q clears only the current drawing, not notes or the
workspace route. This remains an explicitly local review queue, not publication.

The rendering implementation now reuses the same instance/material code and
building-envelope generator for the map, floor cutaway, exploded register,
elevation and plan-workspace preview. The workspace preview is a real exterior
instead of near-flat floor bands. The register model fits its full projected
extent. Leaf clusters, front lighting, readable road/park/pipeline labels and
selection materials improve the scene without changing the source fixture.
North-side parcel-overhang display now uses complete rectangle subtraction, with
non-overlapping patches and an independent 32 m² example test.

Studio styles are loaded at the persistent entry, avoiding missing workspace
styles during route reloads. Renderer-resource failures are handled around the
actual shared canvas, with an explicit retry view; the property route and records
remain intact instead of showing an invented map or a permanent loading screen.

## Verification

The final production build passed after fixing a nullable restored-draft guard.
The production preview, not only development mode, was used for the final runs.

| Verification | Actual result |
|---|---|
| Core and Studio Node tests | 328 passed, including 33 Studio tests |
| Existing spatial/UI/scene/repository/register/Uttam/AI tests | 97 passed |
| Total Node tests in these suites | 425 passed |
| Shared Python schema/semantic/numeric oracle cases | 218 passed |
| Original full Studio browser flow | 11 groups passed |
| Additional continuation browser regressions | 10 groups passed |
| Final actual scene captures | Eight views; no page errors or failed requests |

The adversarial browser suite deliberately injects source and HDR-resource 503
responses and checks recovery. These are expected failures, separately recorded
from unexpected page errors. Held touch/cancellation is Chrome emulation, not a
physical-phone claim. No new backend upload was performed in this continuation;
the earlier actual-upload receipt remains preserved as historical evidence.

The prepared v2 source files, 903 PDFs, normalized core, real imported datasets and
repository snapshot were not regenerated or changed. Final protected database
row fingerprints are in the continuation preservation receipt.

## Visual review and boundaries

Fresh 1672 × 941 desktop and 390 × 844 mobile captures are in
`docs/evidence/t058/continuation/final`. The comparison gallery at
`/studio-review/index.html` includes the original mockup, original standalone
Studio, current implementation and a before/after continuation comparison.
The full register, map comparison, plan-workspace comparison and mobile inspector
were visually inspected after the production capture. The complete register
model now fits; the plan preview has an actual exterior; the common Studio shell
is preserved rather than replaced with a new unrelated layout.

The image target remains more photorealistic than this procedural geometry.
Façade weathering, exact neighbourhood arrangement and individual vegetation
are not pixel-identical. The source-plan fixture has different room geometry from
the illustrative mockup; it is not misrepresented as the mockup's scanned plan.
No source image is used as a scene backdrop. Visual review here is self-review,
not an independent reviewer or unrecorded user approval.

The milestone remains the active review item so these results are not used to
silently start a different feature phase. Existing Cesium/imported-data workflows
remain compatible; this task does not claim that arbitrary real footprints were
migrated into the rectangular demonstration scene.
