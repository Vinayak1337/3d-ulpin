# T077 — Reference identities, floor records and source extraction

User clarification, 20 September 2026: build inside Studio; reproduce reference 3D views, searchable parcel 2D ULPIN and building/floor 3D identities, per-building/floor data and supplied residents, clear labels without map clutter, source-format extraction into one model. User clarified no passwords: building internal 3D ULPIN and floor identifier building3DULPIN:floorNumber.

This updates the next bounded scope after the shared T075/T076 foundation. T076 production build passes, with final browser capture and import-race correction included in this integration pass. Full reference visual acceptance is still open.

## Ownership

- Data worker: a source-format normalizer and new independently labelled fictional source packages, unit tests; no edits to original package bytes. Every populated resident record is authored fiction, occupancy is separate from ownership. Floor schedules do not create unit geometry.
- Runtime worker: shared identity/search helper, source-backed building/floor labels, floor and space controls, map decluttering; shared map.js/map.css only.
- Parent: source receipt integration, Studio global search, selected building register/exploded context, import race fixes, browser review and final build.

## Acceptance

1. Source ZIP without normalized.json actually extracts GeoJSON/CSV into the same canonical adapter and shared viewport; integrity manifest and original bytes retained.
2. Search a linked 2D parcel ID, building 3D ID and floor 3D ID; land on correct building/floor, including unrelated IDs in another dataset.
3. Every authored demonstration building has linked parcel and floor identities, with fictional resident records shown only in relevant details. Show unknown and schedule-only geometry honestly.
4. All source geometry remains unchanged by exploded/section/display transforms. Reference-like labels avoid collisions and dense visual noise.
5. Switch dense/spacious/independent scenes; reject invalid sources without replacing the active map. Preserve preview across in-app navigation. No database seed.
6. Actual desktop/mobile and selected floor captures, tests, typecheck/build, recorded limits. No passwords are introduced.
