# T007 — qualified representations, quantities and capabilities

Detailed plan, 18 September 2026. Do not start implementation until T006 is accepted.
Baseline to inspect: `67079cb` plus the generated-backlog encoding correction.

## Goal and inspected code

Add one representation/quantity boundary consumed by the new composition and legacy
adapter. Existing `spatial/geometry.ts` already calculates translated-origin areas;
`spatial/topology.ts` rejects malformed holes, self-intersections and overlapping
parts under an explicit comparison budget. Reuse those bounded analytical helpers.
Python already has Shapely 2.0.7, but its broader validity definition cannot silently
expand this shared bounded profile. Use an explicit matching topology predicate
and independent numeric fixtures. Retain the old geometry worker and v1 contract.

## Scope and representation profiles

Provide typed inline point/line/polygon/multipart geometry; constant-elevation prism
geometry; referenced native/render assets; and unavailable geometry with a reason.
Every representation has a persistent ID/revision, entity, semantic role, optional
frame and exact source-part links. Asset-backed geometry pins an existing asset;
it does not pretend a stored mesh has been validated as a solid. World/source
selection is T008, and parsers/writers are later tasks.

Prism intervals are explicitly **positive-up metre elevations** relative to the
named frame benchmark/datum. Source-native vertical units/direction must be converted
explicitly through T006 before creating this profile. Lower/upper names do not mean
the first and second raw coordinates of a positive-down system. Horizontal inline
coordinates retain their declared frame units and axes. Originals are unchanged.

Validate exact entity/frame/source/asset references; preserve holes and parts;
reject Z/M in the declared planar coordinate tuple, unclosed/degenerate rings,
invalid topology, excessive comparison work, swapped bounds and stale provenance.
No repairs, bounding-box substitution, flattening or external schema lookup.

Geographic, projected and unplaced geometry can be retained, but the first analytical
executor only computes planar quantities in an engineering frame. Missing datum
does not block a horizontal area. It does block a factual volume or world-space
clearance. A geometry-free registry item remains representable and inspectable.

## Quantities and capabilities

Quantities carry definition, unit, representation/frame revision, method and either
a finite result or typed unavailability. Supported first definitions: horizontal
polygon area, planar centreline length, and constant-prism volume. Source-reported
quantities stay separate with exact source-part evidence; no automatic replacement
or net/gross-area equivalence. Display-only and unspecified roles do not become
measurement inputs. Display asset existence does not establish closed-solid volume.

Compute independent readiness values for source/local preview, horizontal
measurement, supported volume, known exterior and identifiable interior. Do not
accept user-supplied `ready: true` flags. A building exterior cannot produce floor
or unit selection. Geometry with no PDFs remains usable. Display offsets, materials,
LOD and document names are outside this calculation boundary.

## Verification, failure and rollback

Author exact fixtures before implementation: 10x8 m area 80 and six-metre volume480;
courtyard subtraction; multipart sum; concavity; 3-4-5 line; scaled feet/mm; nonzero
origin; reversed ring order; and zero-height/unknown-Z/unplaced/display/native-asset
cases. Wrong/missing references, conflicting quantity definitions, overlapping
holes/parts, bow-ties, degenerate rings, dimension dropping, overflow and budget
exhaustion must fail or return the declared unavailable reason without mutation.

Run the same expected values/error codes in Node and Python and test display/LOD/
document invariance independently. Add generated-schema drift checks and old
spatial/UI regression. Keep wire limits explicit; a large source remains preserved
for a later worker-qualified profile rather than silently truncated. No DB writes,
UI rebuild, source deletion or API breakage in this task. Rollback is removing the
new consumer path; existing readers/writers and original files remain untouched.
