# T003 — architecture decisions and bounded proving experiments

Scope: qualify the smallest common schema-authority approach, document one-writer
ownership and lock compatibility/coordinate/render boundaries. Do not redesign the
database or implement all optional source formats in an architecture task.

## Current code and alternatives

The inherited `ulpin-spatial/1` uses manual TypeScript types and runtime checks;
the existing web application already resolves Zod 4.6.2. Python processing uses
Pydantic 2.11.4. Avoid independently handwritten schema vocabularies in two
languages. Compare (A) Zod as source with inferred TypeScript plus generated JSON
Schema consumed by Python; (B) hand-authored JSON Schema with two validators; and
(C) independent TS/Python models. A and B can establish one structural source;
C creates unnecessary drift. Choose A only after testing the installed exporter
on the required structural subset and parity cases.

## Experiment design

Use a small isolated source-contribution schema, not a new unused production
domain model. Exercise discriminated variants, integer revisions, explicit null,
unknown fields, bounded strings/arrays, tuples, JSON-safe finite numbers and
export determinism. Validate the same positive/negative JSON corpus in Zod and
Python jsonschema, without copying enums into a second handwritten validator.
Document any Zod-only refinement and keep cross-record/geometry semantics in
named domain validators; JSON Schema cannot establish source truth or geometry
topology. Reject NaN/Infinity during JSON input handling in both languages.

Use the currently resolved Zod version, not a broad dependency upgrade. Pin any
new direct dependency deliberately. Pin Python's JSON Schema validator to a
verified available release and qualify it in the hosted processing test image.
Do not run a migration or modify the private PC environment for this experiment.

## Decisions to record

1. Single structural authoring authority, generated-schema drift check and public
   TypeScript inference; semantic validator split and error paths.
2. Keep existing source/registry/physical-feature writers authoritative during
   migration. Compatibility adapters are readers. New relationships require
   demonstrable storage need and later T010 migration rehearsal.
3. Frame identity includes native origin/units/axes/vertical meaning and explicit
   transformation provenance; world and render placement are derived, not guessed.
4. Keep shared `MapViewport` and Cesium first; existing calibration qualifies only
   its tested profile, not complete visuals or all input geometry.

## Acceptance, tests and rollback

The parity experiment passes identical expected outcomes in both runtimes and
schema output is stable; unsupported conversion/refinement semantics have an
explicit boundary. One writer per current record class is identified with actual
file pointers. Existing type/pure/build tests remain intact. Changes are isolated
test tooling/dependency metadata and ADRs; reverting them does not affect stored
records. T004 onward implement the qualified model incrementally, reusing existing
spatial modules rather than making a parallel canonical registry.
