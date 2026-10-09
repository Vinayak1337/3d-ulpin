# P1 — The canonical building record and the scene projection

Goal: one versioned record that every reader and model feeds, and that the Three.js scene draws from. This is the "normalised schema" the whole project is about. Without it, each feature invents its own shape.

---

## P1.0 ⭐ Canonical field vocabulary for the agent (sprint A1, built first)

**Gate:** GF-CONTRACT, GF-AGENT · **Depends:** none · **Owner:** agent-backend worker (A1). K1 consumes it in P1.1.

```text
The mapping agent and learner (P3.4/P3.5) need a target vocabulary much wider than today's three targets
(building.sourceKey/name/geometry in packages/contracts/src/usp/ingestion.ts). Define it once in
packages/contracts/src/canonical/targets.ts:
- targets grouped by entity: building.* (sourceKey, name, address literal, use, storeyLabel literal, storeyCount,
  heightM, footprint), parcel.* (khasra/plot/survey literal, ULPIN anchor as a sourced assertion only, area),
  unit.* (unitNo literal, floorLabel literal, type, carpetArea, builtUpArea, balconyArea), level.* (label
  literal, kind, lowerM, upperM), space.*, document.* (registrationNo, sanctionNo, date, issuer, status), and
  unknown;
- per target: value kind (text literal | number+unit | date | enum | geometry | key), allowed operations
  (copy | enum_lookup | unit_convert | parse_literal | link_parent_key), unit family, and whether a model may
  ever propose it (identifiers and official anchors: never invented, only copied from a source column);
- a display label and one-line meaning per target (reused by the Studio's mapping questions).
Keep the old three targets as aliases so existing plans still validate.
```

**Expect back:** the vocabulary module, its contract test, and the alias compatibility. No database changes.

---

## P1.1 ⭐ Define `normalized-building/1`

**Gate:** GF-CONTRACT · **Depends:** P1.0 · **Owner:** backend worker (sprint K1)

```text
Define the canonical building record that bridges registry data and the Three.js scene.

Read: packages/scene/src/types.ts (FootprintInput, StoreyInput, LevelInput, SpaceInput, BaseFeatureInput,
overlays), packages/contracts/src/usp/{domain,geometry,common,snapshots-related}.ts, packages/server/src/modules/
usp/snapshots.ts, registry modules, H26 (identifiers), H27 §B (DomainCandidate), H30 (incomplete data), and
docs/next-steps/00-STANDARDS.md §2–§5.

Build in packages/contracts/src/canonical/:
- Value<T> = { value: T|null, state: <fixed state vocabulary>, unit?, citations: Citation[], method, revisionId }.
- Citation = { sourceId, sourceSha256, locator: {kind: page|region|row|cell|entity|feature|point, ...} }.
- AreaFrame = { areaId, origin {lon,lat,hEllipsoidal}, axes:"ENU", unit:"m", sourceCrs[], verticalRefs[] }.
- NormalizedBuilding = { buildingId, revisionId, parcelRefs[] (official ULPIN anchors kept separate),
  footprint: Value<MultiPolygon> + kind roofprint|ground_footprint, baseM, heightM, heightState,
  storeys: Value<Storey[]> (levelId, label literal, lowerM, upperM, belowGround, open, roof),
  levels: Level[] with spaces[] (spaceId, kind unit|common|shaft|balcony|terrace|parking|unknown,
  polygons, lowerM, upperM, proposedCode?), conflicts[], gaps[], candidates[] (DomainCandidate refs) }.
- NormalizedArea = { frame, buildings[] summary, baseFeatures[], overlays[], tilesets[] }.
- A pure function toSceneInputs(area, buildings) -> exactly the packages/scene input types (FootprintInput etc.),
  mapping states to the scene's rules (null height -> flat; estimated -> hatched; candidate -> distinct style flag).

Rules: no new store; this is a projection of existing registry/snapshot data. Version string in every payload.
Write docs/api/canonical-building.md (at most 1 page) with one real example built from the NYC footprint
fixture (fixtures/real-area) and one with unknown height and a conflicting storey count.
```

**Expect back:** contract types, the `toSceneInputs` mapping, a one-page doc with two real examples, and a contract test that both examples validate and project. No database changes.

---

## P1.2 ⭐ Serve the projection from the API

**Gate:** GF-CONTRACT, GF-SCENE · **Depends:** P1.1 · **Owner:** backend worker (sprint K1)

```text
Expose the canonical record as read-only, record-backed API projections (no new data store).

- GET /api/v1/areas/{areaId}/canonical  -> NormalizedArea (frame, building summaries, base features, tilesets)
- GET /api/v1/buildings/{buildingId}/canonical?revision=<id|current> -> NormalizedBuilding
Build them from the existing registry/snapshot/area modules (packages/server/src/modules/{areas,registry,usp}).
Reuse areas/{id}/context and buildings/{id}/register internals; don't duplicate their SQL.

Requirements: private by default (local operator subject); ETag = revisionId; 404 vs 403 distinct; unknown and
conflicting values come through as states, never dropped; citations resolve through the existing original route.
Regenerate docs/api/openapi.json and packages/api-client. Add 5 lines to docs/api/README.md.
```

**Expect back:** two routes, a curl example for each against the linked database, regenerated OpenAPI/client, and a contract test. If no area is installed yet, show it with the NYC fixture area and say so.

---

## P1.3 Shared status vocabulary and display words

**Gate:** GF-CONTRACT · **Depends:** P1.1 · **Owner:** contracts + frontend

```text
States and provenance words are spread across H28/H99, contracts and Studio code. Make one table.

1. packages/contracts/src/canonical/vocabulary.ts: the state enum, permission enum, method kinds, finding states
   (not_assessed, not_comparable, review_finding, ...), and for each a display label and a one-line meaning,
   taken from H99/H28 wording.
2. Replace duplicated string unions in packages/contracts and apps/studio with imports from it (mechanical change).
3. List any word used in the Studio that isn't in the table, and either add it or remove the usage.
```

**Expect back:** one vocabulary module, mechanical replacements, and the list of words reconciled. Typecheck passes.
