# Canonical building projection — `normalized-building/1`

Private reads: `GET /api/v1/areas/{areaId}/canonical` and `GET /api/v1/buildings/{buildingId}/canonical?revision=current`. Both use the existing area context/register readers; they create no snapshot or store. `revisionId` is a content digest including the exact input revision pins; `ETag` is that quoted digest. A matching current digest is readable; an unavailable complete historical projection returns **404**, rather than mixing historical geometry with current details. Private source/area or cross-site denial is **403**. The local operator subject is process attribution, not human authentication.

Each value is `{value,state,unit?,citations,method,revisionId}`. `unknown`, `absent`, `null`, `withheld` and `conflicting` have null values; conflicts keep independently cited alternatives. Official parcel ULPIN assertions are separate from application building/level/space IDs. `recordState:candidate` includes retained unrecorded import proposals and never implies registry acceptance. No literal floor expression becomes a count or slab schedule.

The backend projects unchanged geographic geometries onto WGS84 surface ENU metres around the retained area anchor (`deterministic:wgs84-surface-to-enu@1`), normalizing derivative ring winding only. Ellipsoidal origin height and measured building bases remain **null** when unavailable; the mathematical surface projection is not a surveyed elevation. Local drawings with unknown geographic placement are not placed on this map. Vertical limits are projected only with an explicit building-relative reference.

`toSceneInputs` returns exactly the scene's footprint/storey/detail/base-feature/overlay types, plus a `styles[id]` sidecar (`candidate`, `hatch`). Null height stays flat; no missing dimensions are filled. **Integration gap:** current `packages/scene` has neither a candidate style flag nor envelope hatching for estimated heights; its consumer must apply the sidecar. Unknown footprint is omitted, not replaced. Line-only roads retain a gap, never acquire invented widths. Image decoding is supplied by the authorised caller.

## Geometry-free source intake

The existing multipart `POST /api/v1/import-packages` accepts `format=document_buildings`, `metadata` validated
by `SourceBuildingImportSchema` in `packages/contracts/src/canonical/building.ts`, and unchanged PDFs under
their declared document keys. Declarations require `geometry:null`, `footprint:null`, `placement:unknown`,
source-literal claims and document/page/locator citations. Originals use existing private document intake.
Source-only prepare/review reports the analytical gap; commit records registry buildings with empty
footprints and null-geometry physical declarations. It cannot replace geometry or rights. Human original
citations use original authority, not staged extraction parts or teacher/model outputs. GIS geometry
qualification remains unchanged. Reviewed here means local source-only acceptance, not statutory approval.

`format=administrative_context` uses the same route/package flow for a pinned native ArcGIS original and
explicit sector ID/name mapping, with no building declarations. It records existing administrative-unit
memberships, never parcel/public-land physical features. The optional canonical area `administrativeContext`
array carries cited ENU candidate polygons, administrative role and `analyticalEligibility:not_assessed`.
The scene adapter does not yet draw this separate layer; its owner must consume it without treating sectors
as parcels. Road centrelines remain retained without guessed widths.

K2's [Magnolia receipt](../evidence/gf-backend/k2/magnolia-canonical.json) keeps its sanctioned layout attached,
local frame unplaced, and no villa/unit schedule inferred. [OCR evidence](../evidence/gf-backend/k2/ocr-comparison.md)
records validated local English assets, unsupported whole-page dimensions and one failed bounded region job;
no OCR result lines or Hindi support are claimed.

## Two real examples (complete payloads linked)

- **NYC OTI 353927, foreign `test_only`:** [payload](../evidence/gf-backend/k1/nyc-example.json), derived from `fixtures/real-area/original.geojson`. Source roof height **33.49 ft → 10.207752 m**, `state:source_supported`, cited feature `353927`, method `deterministic:international-foot-to-metre@1`. Footprint role, terrain base, count and interior levels remain unknown. Fixture source keys are explicitly labelled fixture references, not allocated registry identities. The separately installed NYC API example remains an **unreviewed proposal**, because import review is blocked by existing geometry qualification.
- **Haryana RERA 2831, TOWER 3:** [payload](../evidence/gf-backend/k1/tower3-example.json), from the retained storey-truth sheet. `heightM:{value:null,state:unknown}`; `storeyLabel` and `storeyCount` are **conflicting**, with page-1 `G+41` (central graphic) and `G+42` (UNIT DETAIL) alternatives. Neither is converted into an integer schedule. Footprint and placement remain unknown. That linked K1 payload is a fixture example. K2 additionally installed a real source-only registry building through the existing import API: [live canonical receipt](../evidence/gf-backend/k2/tower3-canonical.json). Four unchanged RERA PDFs are retained; no footprint, placement, height or detailed level schedule was invented.
