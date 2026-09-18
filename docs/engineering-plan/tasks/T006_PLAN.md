# T006 — frames, operations and vertical meaning

Detailed plan, 18 September 2026. Starting implementation baseline: T005 commit
`39a507d` plus its acceptance record. Inspect the final HEAD before committing.
Scope: additive `ulpin-spatial/2` core; preserve all v1 and canonical/2 consumers.

## Inspected boundaries and decision

The existing `spatial/types.ts` supports metre ENU and geographic frames;
`spatial/frames.ts` contains a bounded WGS84 ENU-to-ECEF display conversion. There
is no general CRS engine there. T003's accepted Zod authority exports JSON Schema
for Python; retain that toolchain and explicit semantic validators. Reuse the
qualified v1 ENU formula only through a guarded bridge, not as a general transform.

Add frame and operation schemas, pure validation/execution, shared numeric test
vectors and Python semantic parity. Frame variants distinguish engineering,
projected, geographic and WGS84 geocentric coordinates. Engineering axes and units
are explicit. Metres, millimetres, international feet and legacy US survey feet are
distinct; the latter is preserved for inputs, not recommended for new data.
Named benchmark/datum references, surface-relative heights and unknown vertical
meaning remain different. Identical labels do not establish a common benchmark.

## First executable profiles

1. A declared horizontal rigid registration between two engineering frames:
   normalize signed/permuted axes and units; rotate counterclockwise; translate
   in target canonical metres; convert to target axes/units. No shear, arbitrary
   perspective matrix or inferred control-point fit. Horizontal-only operation
   works without known Z. Three-dimensional execution additionally requires a
   common exact vertical reference or a declared signed constant vertical tie.
2. A WGS84 ENU/ECEF render placement with explicit geodetic origin and ellipsoidal
   height of a named local benchmark. No default height zero. The frame identifies
   a local tangent plane; it is not a country-wide survey CRS or vertical geoid
   correction. Geographic/projected catalogs can be retained without claiming an
   implemented general geodetic executor.

Operations pin source/target frame revisions. Callers select a bounded ordered
chain and explicit direction; no automatic shortest-route ambiguity or implicit
inverse. Check continuity, endpoint/version identity and repeated operations/frames.
Units, permutations and registration steps are auditable; originals are never
transformed in place. Reject non-finite inputs/results and unsupported profiles.

## Vertical policy and bounds

The local vertical equation is target-up-metres = source-up-metres + declared
offset. Up/down and each frame's vertical units are applied separately. An unknown
datum or terrain-relative depth is not made absolute by inserting an offset. A
surface model/evaluator belongs to a later qualified profile. A source-domain
bound, when supplied, is checked in the source frame after unit/axis normalization,
including inverse operations. Exact numeric conversion does not imply measured
registration accuracy; retain provenance and nullable accuracy explicitly.

## First consumers and tests

Provide a metadata-preserving v1 frame projection and request executor for probes.
Keep benchmark identity scoped to the legacy frame when only a free-text label
exists. Do not assume two frames with the text "ground" share an elevation zero.
No database/renderer migration is included; T009 will compose the new read adapter.

Write independent fixtures before implementation: 10 international feet = 3.048 m;
millimetres; swapped/signed axes; 90-degree rotation with nonzero translation;
up/down and mixed vertical units; explicit positive/negative vertical offset;
inverse and multi-step transformations; WGS84 equatorial/polar anchor and ENU basis;
and independently specified local/world checks. Round-trip tests supplement,
rather than replace, known answers. Share success/error code and numeric tolerance
cases with Python. Include stale/missing refs, dimensional mismatch, unresolved
vertical reference, surface-relative depth, invalid latitude, duplicate axes,
bad bounds, non-finite/overflow and disjoint/cyclic operation paths. Failed requests
must not mutate frames, operations or input coordinates.

Run generated-schema checks, current core tests and parity, existing spatial/UI
regressions, typecheck and build. Any relevant failed check remains open; do not
weaken predicates to match output. Code-only rollback; no migrations, reseeding,
source-byte changes, parser installation or arbitrary external grid downloads.

Primary reference checks: NIST SP 811 Appendix B for exact international and US
survey-foot definitions; PROJ axis-swap, pipeline and topocentric documentation
for the separation of units, axes, datum operations and ENU/ECEF origin semantics.
`https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors`
`https://proj.org/en/stable/operations/conversions/topocentric.html`
`https://proj.org/en/stable/operations/conversions/axisswap.html`
`https://proj.org/en/stable/operations/pipeline.html`
