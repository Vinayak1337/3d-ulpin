# DATA-02 authored adversarial pack

`v1/catalogue.json` lists 17 independent synthetic cases. Each case directory contains its original test bytes and `oracle.json` with the author/date, source metadata, byte hashes, preconditions, expected task outcomes or abstentions, H28/H30 mapping and limitations. `generate.py` is the deterministic authoring script; it imports no production processor, provider or model.

The cases are test inputs only. They are not survey controls, cadastral facts, official identifiers, title instruments, legal findings or real Indian operational data. Geographic coordinates refer to synthetic test scenes. Datum offsets and local benchmarks are deliberately constructed to test rejection; they are not usable real-world transforms. The deed identifiers and image GPS are purposeful synthetic privacy probes. Embedded instructions and URLs are hostile source text and must never be executed or fetched.

The H28 Z3 wording “lat/lon-swapped GeoJSON that still falls inside India” is not geometrically possible for the Indian WGS84 longitude range (roughly 68–98°E) and latitude range (roughly 6–38°N). `crs-axis-order` therefore has both a genuinely swapped point outside India and an in-India GeoJSON point whose separate source axis declaration conflicts with GeoJSON order. Both must remain unverified and unpublished. No coordinate was relocated to make the wording appear true.

For global placement, these oracles use the conservative minimum of three reviewed synthetic-test control correspondences from the lead's D010 resolution of the H30 E/G ambiguity. No missing control point, CRS or vertical reference may be filled from display context. The mixed-gap batch has task-specific decisions and four class-level questions, with “Not sure” parking the affected class. Display-only fill remains barred from measurements, rights, readiness, cards and training truth.

The oracle commit precedes any production implementation or evaluation run on this pack. `validate.py` is a later packaging and source-format check only; it does not prove runtime ingestion, privacy, geometry, rights, model behaviour or gate acceptance.
