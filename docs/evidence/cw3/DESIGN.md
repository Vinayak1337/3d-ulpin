# CW3 — cell files, not shared-source areas

- CW2's authority blocker is unchanged: one case binds one site and one area. No authority check changed.
- At EOF, the large fold revisits sealed raw/mapped pairs in the retained first-area frame. Only
  `PART_FEATURE_AREA_BOUND` features enter the cell collector, including holds before saved cuts.
- The CW2 rule is reused: intersect 40 km UTM and 0.5 degree grids, placing by extent south-west corner.
  Small, zone-contained features share cells; larger or zone-crossing admissible features get singleton keys.
  Shared cells span at most 49 km and 0.75 degrees. Wide-feature holds retain CW1's code and words.
- The first 64 distinct cells in source order become files. Overflow counts both cells and features, with a reason.
  A cell above the existing 128 MiB v1 derived-receipt ceiling stays held with byte-limit words; no limit is raised.
- Each Feature is copied from its original byte range and checked against its sealed raw SHA-256, in 1 MiB reads.
  Only the collection envelope is serialized; the parent's CRS declaration value is carried unchanged or absent.
- Each child has `cell-derivative/1` lineage: parent source/revision/hash/item/name, cell key, rule parameters and
  a hash-verified private JSONL sidecar containing every feature index, original byte range and raw SHA-256.
  Sidecars use the existing conditional immutable stream writer's content-addressed key scope.
- A stable parent-revision/hash/cell source-case request creates a separate unassigned case per cell. The existing
  ZIP/table receipt helper finalizes the child and its lineage atomically; normal intake enrolment queues its
  existing streamed GeoJSON route. Every card still requires officer confirmation.
- The stable request, per-cell advisory lock and lineage lookup reuse retained children after interrupted endings
  or enrolment. EOF is written only after every admitted child has been retained and enrolled.
- Children appear as independent batch cases/items in the existing work queue, not cross-case rows in the parent's
  tray. The parent's row reports the split; child rows retain parent/cell words throughout subsequent processing.

Offline counts and protocol tests do not qualify placement, map display, review, citations or cards. Rehearse the
parent's review-pressure pauses, EOF restart, private sidecar storage/capacity, and a child through card confirmation.
Sidecar bytes are bounded by the reader's 500,000 features but are not separate upload quota rows; include them in
storage-capacity qualification. No runtime, original, credential or protected data path was opened for this task.
