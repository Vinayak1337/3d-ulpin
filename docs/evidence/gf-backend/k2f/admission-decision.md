# K2f — model-roofprint registry admission deferred

Lead decision: defer registry admission until after the demo; preserve every existing invariant and gate.
The demo lifecycle is **model candidate → officer-reviewed source selection**, with retained lineage.
That working K2c selection is not registry acceptance, cadastral truth or measurement authority.
The registry step exposes the actual `USP_GEOMETRY_PAYLOAD_UNQUALIFIED` refusal; do not manufacture success.

Facts:
- `database/sql/60-usp/09-geometry-schema.sql:32,63–82` pins qualification to an immutable revision ≥ 1.
- `packages/server/src/modules/usp/geometry.ts:78–89` requires an existing positive canonical revision.
- About 40 readers use positive revision as recorded; examples are
  `packages/server/src/modules/areas/areas.ts:141–142,206,1084` and
  `packages/server/src/modules/registry/registry.ts:207,243`.
- `tests/spatial-ml-footprint-integration.ts:72` asserts that creating drafts leaves no positive features.
- `packages/server/src/modules/areas/areas.ts:1247` invokes the qualification gate before review persistence;
  `packages/server/src/modules/usp/geometry.ts:114` emits the actual refusal.

Options considered (none adopted):
- (a) Put the draft at revision 1: it would appear recorded before officer review; violates the draft invariant.
- (b) Introduce a distinct draft marker: requires a coordinated lifecycle/readers migration and governance review.
- (c) Move the gate: requires an explicit admission-versus-analytical-authority design; not a local bypass.

This remains an **open governance design item after the demo**. No registry/area/geometry code, reader,
qualification predicate, revision or review history changes in K2f. Rights/parcels/heights/levels stay unknown.
The runtime-receipt re-pin is separately reserved for the owner's decision and is not part of K2f.
