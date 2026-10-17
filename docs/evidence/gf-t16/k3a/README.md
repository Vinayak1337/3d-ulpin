# K3a: prism contract for P5.1's level schedule (`geo.geometry.build_prisms`, method `prism/2`)
Pure geometry: no DB, no API route, no defaults. P5.1 calls it once per reviewed space, one component per level row.
- **Input:** `{spaceId, components[]}`; component `{componentId, levelId, footprint, lowerM, upperM, verticalReference,
  enclosure}`. `footprint` is GeoJSON `Polygon` or `MultiPolygon` (holes allowed), local metres as decimal strings.
  `enclosure` is `closed`, `open` (stilt) or absent. Unreviewed or unknown limits are passed as `null`.
- **Output:** `{spaceId, method, state, heightState, totalVolumeM3, totalVolumeM3Exact, components[]}`.
  Each component has `areaM2`/`areaM2Exact`, a normalised closed `footprint` and `prism` (`lowerM`, `upperM`,
  `heightM`, `verticalReference`, `volumeM3`, `volumeM3Exact`).
  `*Exact` strings are exact decimals; floats are only for display.
- **Unknown limits:** `heightState: "unknown"`, `prism: null`, no volume; the 2D area stays; totals are `null`, never 0.
- **Unsupported:** `state: "unsupported"` plus `reason` on the space and the failing component; no area or volume.
  Reasons: `ring_self_intersecting`, `ring_zero_area`, `level_limits_not_increasing`, `hole_outside_exterior`,
  `polygons_overlap`, `vertical_reference_missing`, `footprint_invalid`, `coordinate_invalid`, `identifier_missing`.
- **Duplex:** one `spaceId`, one component per level; the total sums component volumes, so a slab gap adds nothing.
- **Not covered:** overlap between different spaces (P5.4), persistence, and any API shape (no change now).
