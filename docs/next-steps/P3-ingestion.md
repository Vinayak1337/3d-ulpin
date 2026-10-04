# P3 — Ingestion: from real files to the canonical record

Goal: take the readers that exist and make them **produce canonical building records**, not only metadata and citations. Start with the golden journey, then one sample per finale format family, then the mapping agent.

---

## P3.1 ⭐ Golden ingest: the demo area and building through the real import route

**Gate:** GF-BACKEND, GF-DATA · **Depends:** P0.3, P1.2, P2.1 · **Owner:** backend (owns the import/registry seams for this task)

```text
Install the demo area and building (site-decision.md) through the REAL import route so the linked database
holds them. Today it holds 1 physical feature and no area.

Use the existing route: POST /api/v1/import-packages/inspect -> /import-packages -> questions/answers ->
review -> prepare -> commit (packages/server/src/modules/{areas,registry,usp/ingestion}). Fix the route where it
breaks; don't add a parallel importer or a seed script.

Order:
1. Area context: boundary + GMDA sectors + any roads/water/land use -> NormalizedArea frame and baseFeatures.
2. Building: footprint from an official layer if one exists; otherwise create the building with
   footprint state "unknown" (P4.2 will add a learned candidate). Height unknown unless sourced.
3. Documents: attach the RERA PDFs as sources linked to the building; pages render through the existing
   document routes.
Then GET /areas/{id}/canonical and /buildings/{id}/canonical return them, with states and citations.

Difficult input: one RERA PDF that is scanned (needs OCR) and the G+41/G+42 conflict.
```

**Expect back:** the area and building in the linked database through the product's own route; curl output of both canonical routes; the bug fixes made to the import route; the 5-line report.

---

## P3.2 One finale sample per format family → canonical record

**Gate:** GF-SUFFICIENCY · **Depends:** P3.1 · **Owner:** backend (one agent per family is fine)

```text
For each finale family in H30 §F (vector GIS: GeoJSON/Shapefile/GeoParquet/KML; CAD: DXF; BIM: IFC; city models:
CityGML/CityJSON; mesh: glTF/OBJ; point cloud: LAS/LAZ; raster: GeoTIFF DEM/orthophoto; documents: PDF/XLSX/ODS;
controls: survey/control CSV), take ONE permitted real sample (reuse retained ones from docs/api/datasets.json)
and make the existing reader produce canonical output where the source supports it:

- vector/CityGML/CityJSON/KML -> footprints (+ heights if attributes give them, with method source_literal);
- IFC -> IfcBuildingStorey -> storeys (elevations, names as literals), IfcSpace -> spaces;
- DXF -> closed polylines on named layers -> candidate polygons (state candidate, layer named in limitations);
- LAS/LAZ + DEM -> per-building groundZ and roof height using the H27 Z1 rule (median DTM ring 1–3 m outside;
  70th percentile nDSM inside), method deterministic:lod12@1;
- orthophoto -> image overlay with corners in local metres;
- documents -> pages + citations (no geometry);
- glTF/OBJ -> context display only (never measured).
Where a family can't produce geometry, return the honest sufficiency state (existing sufficiency modules).

Write the capability matrix docs/evidence/usp/finale/GF-SUFFICIENCY/matrix.json: family, sample, received,
read, interpreted, converted to canonical, rendered, blocked reason.
```

**Expect back:** the matrix with one row per family, real samples, and each "converted" claim visible through the canonical route. No new readers.

---

## P3.3 CRS and height guardrails

**Gate:** GF-DATA · **Depends:** P3.1 · **Owner:** backend/geo

```text
Make frame handling explicit and safe in one place (services/geo/geo/core_frames.py and the TS side that calls it).

- On intake: record the declared CRS and vertical reference; if missing or contradicted by a source control
  point, mark crs_unverified and don't publish to the canonical record.
- Reprojection to the area's local ENU frame uses pyproj with the transformation pipeline string recorded in
  the method field.
- Heights: carry the vertical reference; convert only via a named operation; otherwise keep it as
  building_relative and say so.
- Never infer a UTM zone or datum from coordinate ranges.
Use one real difficult input from P2.2 (missing .prj or doubtful CRS).
```

**Expect back:** one frame module with a recorded transform per derived geometry, and the difficult input ending as `crs_unverified` with a readable reason.

---

## P3.4 ⭐ Constrained mapping agent (GF-AGENT)

**Gate:** GF-AGENT · **Depends:** P2.2, P3.1 · **Owner:** backend/AI

```text
This is the finale's "heterogeneous data -> normalised schema" capability. It must PROPOSE mappings, never write
values.

Read H14 (and Z2 MappingPlan), H28 Z2 (GF-AGENT cases), packages/server/src/modules/usp/ingestion/
adaptive-mapping*.ts, chunk-mapping*.ts, modules/model-gateway/*, modules/ai/officer-ai-validation.ts.

Build or finish:
1. MappingPlan schema: per source field -> {targetField from the canonical vocabulary | unknown,
   operation: copy | enum_lookup | unit_convert(<declared unit>) | parse_literal | link_parent_key,
   confidence, rationale}. The schema rejects literals: no numeric factors, EPSG codes, coordinates or IDs.
2. Deterministic pre-pass: exact header/known-family matches skip the model entirely.
3. Model call through the existing gateway with tools disabled and structured output; inputs are masked
   (column names, types, 5–20 sample values with PII masked), and the system prompt treats all file content
   as data.
4. Provider adapters: replay (recorded responses, the default for the finale), fake (tests), live (only if the
   owner adds a key). Outage or budget cap -> remaining layouts go to needs_input; manual_mapping always works.
5. The executor applies the accepted plan with existing deterministic code; the officer reviews uncommitted
   mappings in the import questions flow.

Evaluate on 3+ held-out real layouts from P2.2: precision on committed fields must be 1.0 (uncertain ->
needs_input); report recall and abstention. Run the injection cases from H28 Z2 using real files where they
exist; where none exists, record the gap (don't fabricate an attack file into the data packs; a test-only
string in a unit test for the schema validator is fine).
```

**Expect back:** an end-to-end mapping from a real messy Indian CSV into canonical fields through review; the evaluation `result.json` (precision, recall, abstention); the outage and budget-cap behaviour shown.
