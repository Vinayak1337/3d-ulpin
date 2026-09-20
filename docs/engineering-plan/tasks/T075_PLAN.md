# T075 — Reference package to shared canonical scene

Status: implementing, 20 September 2026. First bounded gate of T074. No live dataset seeding or source replacement.

## Outcome

One explicit adapter accepts the existing versioned reference package's normalized JSON, preserves its exact original bytes and record identities, builds the existing `ulpin-spatial/2` canonical snapshot, and projects a qualified view to the existing `ulpin-spatial/1` scene compiler. UI import can then use the same path for independent datasets. These contracts are versioned boundaries, not interchangeable schemas.

## Ownership

- Contract worker: new `apps/web/features/spatial/reference-import/` modules and focused T075 tests. Original preservation, validation, canonical mapping and display projection.
- Parent: integration boundary, package loading, execution records, independent review and tests. Inspect current shell/runtime before choosing the next bounded visual task.
- Explorer: read-only integration recommendation. No recursive delegation.

## Required behavior

1. Pin supported input version and reject malformed/reference-invalid input with actionable errors.
2. Preserve source bytes, revisions, IDs, attributes and lineage; retain unavailable/unsupported facts explicitly. No generated official identifiers.
3. Validate supported Polygon/MultiPolygon topology including holes and use existing frame contracts. Keep base elevations and unknown values.
4. Derive render representations from canonical geometry; record adapters/profiles explicitly. Display-only utilities or decoration never acquire measurement authority.
5. Exercise the actual canonical snapshot builder and scene compiler with the dense fixture and an unrelated fixture, without ID-specific rendering logic.
6. Keep current source ZIP compatible and verify its manifest before normalization. Raw source file acceptance is a separate adapter capability.

## Verification and review

Focused tests cover byte preservation, version rejection, missing/dangling IDs, holes/multipart, nonzero elevation, malformed topology, geometry-null records, distinct IDs and stable deterministic output. Compile both valid fixtures using the shared compiler. Review current limits and test output before marking this gate complete. Typecheck all integration changes. Browser work follows after the schema gate; this task alone does not claim visual acceptance or broad GIS support.
