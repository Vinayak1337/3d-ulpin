# CW2 — bounded cell areas

- Measurable new files use a 40 km UTM grid, intersected with a 0.5° grid starting at (-180.25°, -90.25°).
- The feature extent's south-west corner chooses both grid cells; an exact edge belongs east/north.
- The extent middle chooses the WGS 84 UTM zone/hemisphere, never the file's coordinate ranges.
- Shared-cell features span at most 9 km and 0.25°; all vertices stay inside that UTM zone/hemisphere.
- Thus all packages of one shared cell together span at most 49 km and 0.75°, including later packages.
- Any first package's retained south-west origin is within 49 km of every later cell edge.
- A larger but individually admissible feature, or one crossing a zone/equator edge, gets its own cell suffix.
- Features exceeding the existing 50 km/1° single-feature rule remain PART_FEATURE_EXTENT_BOUND, unchanged.
- Cell seed keys retain namespace:name with a stable cell suffix; namespace is case-scoped from the start.
- Officer names use only the file title, UTM zone, E/N and degree-grid indices, plus feature index if needed.
- At most K=12 cuts stay open; a thirteenth cell closes the least recently used cut. Limits still close each cut.
- CW1 Halifax: 2,778 packages, 159,013 routed, 13,395 outside holds, one reader rejection.
- CW2 Halifax offline: 549 packages, 172,408 routed, 24 areas, zero holds, one reader rejection.
- Each existing part locator stores the consumed cursor and ordered open cuts' source feature indices.
- Resume rehydrates only those bounded open cuts from sealed reader/mapping parts, then continues after the cursor.
- Checkpoints include the triggering feature already added to another open cut; EOF draining is checkpointed too.
- Held counts advance through that cursor, not the closed cut's last (possibly earlier) feature. No new table.
- CW1/unsupported CRS keep legacy folds. Activation is blocked on separately owned multi-area source authority.
