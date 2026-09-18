# ADR-003 — frame identity and explicit transformation operations

Status: accepted boundary; numerical profiles are qualified in T006/T007.

Keep source-native coordinates and metadata separate from analytical and rendering
coordinates. A frame is not merely an EPSG string or SRID 0: preserve origin,
units, axes, vertical meaning, operation version and any supported global tie.
Two local frames with different origins cannot be compared without an operation.

Every operation names source and destination frame revisions and the supported
profile. Unit conversion belongs to that operation exactly once. The first local
profile handles declared metres/feet/millimetres, rotation and translation with
independent expected points. General geodetic work stays at the existing qualified
Python/PROJ boundary; an affine matrix is not a substitute for every CRS operation.

Unknown vertical datum, own-building-relative height, depth below an unspecified
surface and an established ellipsoid height are different states. Valid local/2D
work may continue while dependent world 3D or clearance remains unavailable.
No zero-valued global anchor or vertical offset is invented to satisfy rendering.

All numerical operations validate finite outputs as well as inputs, document
units and tolerances, and retain source uncertainty separately from computation
error and render quantization. Local synthetic mm/cm qualification is not a claim
of actual survey accuracy. Measurements resolve the selected analytical revision,
never exploded positions, tiles or screenshot pixels.
