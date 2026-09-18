# Continued Studio pass — evidence ledger

This pass starts after the previously pushed `6fe2d4f`. Earlier T058 evidence is
kept in place; it is not overwritten or presented as the current implementation.

## Visually reviewed

`final/map.png` was compared with the original `block.png` and standalone Studio.
The common header, layers/properties rail, inspector, minimap and finding tray
remain in the original design family. The scene now has coherent roof/facade
selection tint, three-dimensional leaf clusters, stronger front-side lighting,
readable road text and explicit public-park/utility labels. The prepared source
boundaries and computed measures remain unchanged.

`final/register.png` shows the full exploded building inside the model panel,
including far-side walls/window bays and the shared room layout. An earlier
continuation capture clipped the extremes; projection-based fitting corrected
that before this final capture. `final/workspace.png` replaces the old near-flat
preview with the same actual exterior geometry, not a second renderer or static
mockup. The source-plan and unit metadata still come from the original fixture.

The map triple, workspace pair and mobile inspector were inspected directly.
The gallery contains all full-size captures plus scene and register comparisons.
Its manifest records original/current image hashes and the source paths.

## Functional evidence

`verification/results.json` contains ten additional production-browser groups:
identity-safe thumbnails, atomic inspector navigation, register history, exact
floor focus, floor-local draft restoration, invalid-review prevention, real
source checking, PNG/focus behavior, touch cancellation and resource recovery.
`full-flow/results.json` retains the eleven-group original Studio journey on the
same production build. The deliberate source/HDR 503 cases are labelled expected
failures, not hidden or counted as healthy requests.

The source hash tests cover every prepared PDF and source asset. No source file
was regenerated. `verification/data-preservation.json` compares protected
database rows before and after this continuation. There was no new backend write.

## Remaining differences

The supplied map is a photorealistic illustration. This implementation remains
procedural, interactive geometry; exact terrain, trees, facade weathering and
composition are not pixel copies. The plan fixture is an actual consistent
two-unit drawing, not the illustrative plan depicted in the mockup. The local
draft queue is not a municipal approval workflow. Imported real Uttam Nagar
geometry remains in its original compatible viewer, not converted to boxes.

Those distinctions are intentional honesty boundaries, not claims that a unit
test establishes visual equality. User approval is not recorded by this review.
