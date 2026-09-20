# Bulk Studio normalization model

This is a proposed, source-led exchange model for the isolated prototype. It does not replace the current backend schema. The [source inventory](SOURCE_INVENTORY.md) records what was actually inspected; [schema.json](schema.json) specifies new fields; [demo-data.json](demo-data.json) supplies an independently authored fictional example. Nothing here is an official identity issuance or statutory determination.

## Identity, evidence and geometry

An `object` is stable across revisions: parcel, building, floor, space, utility, road, control point or open area. Its opaque `id` and system `systemId` do not encode mutable parent membership, geometry, floor number, name or address. Source IDs are namespaced by dataset/source record keys; identical source strings in unrelated files do not prove identical objects. Labels remain editable attributes. `geometryId` identifies the currently selected geometry version and may be null without deleting the object.

An `identifierAssertion` holds an externally asserted identifier, including an official 2D ULPIN, with issuer, evidence and verification status. An absent 2D ULPIN is null/unavailable; it is never generated from coordinates or copied from a system 3D ID. A building can link to multiple parcels, each with different assertions. The prototype's `demo:3d:*` IDs are unmistakably internal fictional identifiers.

A `geometry` is an immutable version with its own ID, version number, optional predecessor, source record references and transformation lineage. Canonical coordinates belong to a named metre frame with explicit axis order and vertical benchmark. Native CRS and vertical datum remain nullable. Polygon rings include closure and holes; a footprint plus an observed base elevation and height can form a display extrusion. No height means no fabricated 3D volume. No unit boundary means null geometry, even when the schedule includes unit area. `areaM2` is a calculated footprint measure in the named metre frame; source area claims remain observations. Renderer world transforms are not measurements.

The coordinate arrays resemble GeoJSON geometry structure, but **local metre arrays are not RFC 7946 WGS84 GeoJSON**. An adapter must declare the frame; it cannot send these coordinates to a longitude/latitude map. The v1 fixture schema supports Polygon/MultiPolygon/LineString/Point. The concrete proposed v1.1 contract below adds native surface/solid payload references and multipart volumes without replacing source geometry with boxes.

## Immutable sources and preserved observations

Each `source` identifies a revision/representation, modality and provenance classification. `original_file` requires original URI, byte count and SHA-256; preserve the received bytes separately from every derived output. `descriptor_only` has no originals and may never count as a processed or downloadable file. `embedded_records` is used only for this fictional fixture. Raster metadata captures dimensions, pixel size and full affine geotransform when actually supplied; point-cloud metadata captures point count, native format, scale and offset. Unknown values stay null. LAS/LAZ equivalence is a relation between preserved representations, not permission to discard one.

`sourceRecords` retain original keys, record locator (feature/layer, sheet/row, document page/entity or embedded key), complete source attributes and source revision. Unknown vendor fields live here unchanged, avoiding destructive migrations. Adapters promote known fields into typed objects and observations, never silently drop the rest. Current JSON fixture attributes are arbitrary JSON values; production adapters must retain exact source bytes too, including CSV textual formatting and decimal precision.

`observations` hold field assertions, value/unit, method, time, uncertainty and evidence. Multiple conflicting values can coexist; selection requires a recorded review rather than last-write-wins. `lineage` records inputs, transform parameters, software/mapping version, output geometry and fingerprint. The fixture fingerprints are SHA-256 of canonicalized embedded records, **not original file hashes**. A reviewed projection needs explicit CRS/unit/axis/vertical transforms; an AI-extracted value remains an unreviewed observation and does not establish spatial authority.

## Membership and rights

`relations` are typed, many-to-many edges with evidence/status and validity. They represent containment, occupation, crossing, service or overlap. A physical building may straddle parcels; a utility may cross many parcels; shared space may serve several units. Do not replace these relationships with one mandatory parent column. `contains` direction is container → member; `crosses` is feature → intersected object. Relations can be asserted before geometry becomes available, but remain unreviewed until supported.

`rights` have independent stable IDs, kind, subject object set, beneficiary, evidence, status, legal authority and validity. They are separate from physical objects/geometry. A measured overlap does not prove encroachment or ownership; a utility line does not automatically create an easement. The fictional access example is explicitly unverified. Real rights require separate evidence review, never automatic publication from a plan or AI extraction.

## Batch lifecycle and idempotency

The intended workflow is receipt → classification → mapping → processing → review → ready → recorded. Receipt means bytes or records exist; suitability means units/frame/type have enough evidence; draft geometry means derivation succeeded; validation/review decides whether a specific object is recordable. These states are distinct. Failures and unknown values become `issues` scoped to source records, objects and fields. UI counts derive from actual arrays and states.

Adapters first preserve originals and source records, then normalize into a staging batch. The replay key combines source namespace/revision or content fingerprint, adapter/mapping version and processing parameters. Replaying the same key is a no-op, not a duplicate identity. Changed input or parameters produce new immutable geometry/observation revisions, preserving reviewed overrides and history. Cross-source duplicate candidates require explicit matching evidence; filenames and near coordinates are insufficient. Production batch commits must use transactional membership/geometry updates and a review audit event; those services are deliberately out of scope for this UI prototype.

A blocking issue prevents recording its affected object. The demo's B12 has a known footprint but missing height and floor count. It remains visible in 2D. Officers can defer it, exclude it from a batch, or attach actual height evidence; a generic confirm button cannot make it measured. Other ready buildings may proceed under a stated ready-object commit policy. Deferral never changes missing values to zero. Descriptor-only imagery/cloud/control/elevation entries demonstrate classification but are not processing-ready evidence.

## Source-specific mapping guide

| Source family | Preserved source keys | Promoted structures | Required checks |
|---|---|---|---|
| GIS GeoJSON/GPKG | layer, feature/source IDs, all properties, native geometry | objects, geometry versions, parcel/building membership, observations | CRS/local frame, units, ring validity, source identity collision, stated versus calculated area |
| Floor schedule / plan | building/parcel/floor/unit keys, sheet/row/page, stated areas/counts | floors/spaces, membership, observations; geometry only when evidence exists | distinguish building footprint reference from unit boundary; plan calibration and revision |
| GNSS / controls | point IDs, XYZ, accuracy, time, datum/monument text | control objects, observations, frame alignment evidence | synthetic versus survey status; horizontal and vertical alignment independently |
| Orthomosaic / DEM / DSM | original raster and metadata, band/nodata/pixel units, native CRS/transform | sources and derived surface geometry revisions | complete affine transform, actual vertical datum, resolution; preview is not metric evidence |
| LAS / LAZ | original bytes, header/VLRs, point format/count, scales/offsets, classes | source representations, derived geometry with algorithm lineage | native frame/datum, equivalent representation checks, classification suitability |
| Rights documents | original bytes, page/record locator, dates/parties/assertions | independent rights and evidence links | human evidence review, authority and applicability; no inference from geometry alone |

## Proposed volume and surface extension (v1.1)

The implemented fixture contract remains v1.0. The following is a **concrete v1.1 proposal**, not a claim that the current JSON schema, renderer or backend already supports solid analysis. It replaces the v1 geometry's mandatory coordinate-array shape with a discriminated `payload`; adapters must explicitly negotiate `schemaVersion` and supported payload kinds. Scalar height remains an optional observation/extrusion parameter, never the only representation of a building or legal space.

```typescript
type GeometrySemantic =
  | "Point" | "Curve" | "MultiCurve" | "Surface" | "MultiSurface"
  | "Solid" | "MultiSolid";

type ImmutablePayloadRef = {
  assetRevisionId: string;        // immutable native or derived artifact revision
  contentSha256: string;          // measured digest of complete referenced bytes
  mediaType: string;
  format: string;                 // e.g. IFC4, CityJSON-2.0, indexed-boundary-v1
  elementSelector: string | null; // IFC GlobalId, CityObject key, or model entity ID
};

type GeometryPayload =
  | { kind: "coordinate_geometry"; geometryType: "Point" | "LineString" |
      "MultiLineString" | "Polygon" | "MultiPolygon"; coordinates: unknown[] }
  | { kind: "native_model"; ref: ImmutablePayloadRef;
      nativeSemantic: GeometrySemantic; transformId: string }
  | { kind: "indexed_boundary"; ref: ImmutablePayloadRef;
      semantic: "Surface" | "MultiSurface" | "Solid" | "MultiSolid";
      topologyValidationId: string }
  | { kind: "composite"; semantic: "MultiSurface" | "MultiSolid";
      parts: { partId: string; geometryVersionId: string }[];
      composition: "disjoint_parts" | "union_required" };

type GeometryVersionV11 = {
  id: string;
  objectId: string;
  version: number;
  supersedesId: string | null;
  semantic: GeometrySemantic;
  payload: GeometryPayload;
  purpose: "physical_boundary" | "survey_surface" | "legal_space_claim";
  frameId: string;                // defined metre frame; never a guessed EPSG code
  verticalDatum: string | null;
  nativeCrs: string | null;
  derivation: "native_reference" | "lossless_normalization" | "derived";
  sourceRecordIds: string[];
  lineageId: string;
  analysisStatus: "unavailable" | "unvalidated" | "validated" | "rejected";
};
```

`ImmutablePayloadRef` is an artifact revision reference, not an expiring signed download URL; a local storage resolver retrieves the preserved bytes. Its digest is mandatory when the payload actually exists. Unknown/missing bytes belong in source receipt/issues, not a fabricated payload reference. An element selector identifies a particular feature inside that exact revision; it is not the canonical object ID.

The proposed `indexed-boundary-v1` artifact has a vertex array of XYZ tuples in its declared frame; each face contains one exterior ring and zero or more interior rings of vertex indices; each shell contains oriented face references; each solid contains one exterior shell and zero or more interior void shells. MultiSolid stores separate solid references. Shared vertices/faces are explicit so adjoining volumes can share boundaries. Surface collections do not acquire volume just because their triangles render correctly. A validation record must state closure, manifoldness, face orientation, self-intersection, void containment, tolerance in metres, tested algorithm/version and outcome. `analysisStatus: validated` is scoped to these tests and the known frame/datum, not legal acceptance.

A native IFC/CityJSON/CityGML/CAD element may contain curved, sloped, overhanging, nested or voided geometry. Preserve that native representation. A normalization adapter may produce a boundary artifact only when supported, with source selector, unit/axis transform, explicit vertical transform, tolerances and any approximation recorded in lineage. Tessellating curved surfaces is **derived**, even if visually close. A bounding box, simplified mesh or height extrusion cannot replace the native geometry as an analytical equivalent. If the native frame is unknown, preserve the source model and object candidate in staging; do not assign a normalized metre geometry version until the frame is established.

### Multipart spaces and cross-floor occupancy

A duplex is one stable `space` object. It may have one multipart geometry version with two volume components, or one connected solid crossing the slab opening. Separate `occupies` relations link the same space to both floor objects; relations do not require one parent floor and do not duplicate its identity. A disconnected parking bay, storage room and apartment can be separate physical spaces linked by a right, or explicitly identified components of a reviewed space; the adapter preserves the source's distinctions rather than assuming they are one volume. Floors are optional organizational/spatial objects, not mandatory boxes in a building tree.

Composite parts reference immutable geometry versions in the same validated frame, have stable part IDs and form an acyclic graph. `disjoint_parts` requires tested non-overlap; `union_required` marks a pending geometric union and cannot expose a summed volume as final. Geometry fragments do not automatically become independently titled cadastral objects. `legal_space_claim` volumes are asserted spatial extents linked to separate rights/evidence records; they never inherit legal authority from a physical mesh.

### Adaptation and rendering boundary

An adapter returns a staging package of unchanged source revisions/records, identity candidates, observations, proposed geometry versions, relations, transformation lineage and issues. It advertises capabilities independently: metadata extraction, native preservation, display generation, normalized surface extraction and validated solid analysis. Lack of one capability does not discard the others. Raster/point-cloud files remain source assets with CRS/geotransform, band/class/scale/offset metadata and revision references. Raster-to-surface or cloud-to-building segmentation creates **new derived** geometry versions with algorithm, parameters and uncertainty; it never changes the asset into a parcel or treats every point as a cadastral object.

Display assets have a separate contract:

```typescript
type DisplayAsset = {
  id: string;
  sourceGeometryVersionIds: string[];
  asset: ImmutablePayloadRef;
  representation: "mesh" | "tiles" | "point_cloud_preview" |
    "raster_preview" | "footprint";
  lod: string | null;             // adapter-declared scheme, not inferred accuracy
  screenErrorPixels: number | null;
  simplificationToleranceM: number | null;
  displayTransformId: string | null;
  analysisEligible: false;
  lineageId: string;
};
```

Several LoDs or streamed tile sets may render one analytical geometry version. Their cache keys include input version IDs, representation parameters and renderer/compiler version. Display selection, exploding floors, vertical exaggeration or origin rebasing never changes measured geometry. A stale display asset is detectable from its input IDs and must be regenerated or visibly marked stale. A display asset can also preview an unnormalized source, but then it must not claim normalized map placement or provide metric tools.

When a payload is unsupported, show its source/metadata and a clear unsupported-geometry state. If an **independently evidenced** footprint exists, offer that 2D footprint with its own provenance; otherwise retain record selection without invented geometry. Never convert an unsupported solid to a rectangular box and call it normalized, and never use rendered mesh simplification for area, volume, boundary conflicts or rights decisions.

## Identity corrections, splits and merges

A corrected name, measurement, boundary, height, floor association or external identifier normally retains the canonical object ID and creates new observations/geometry/relation revisions. Correcting a source key updates the source-to-object mapping through an audited alias assertion, preserving its earlier value. A source revision changing its key does not silently delete and recreate the object. Duplicate-identity correction is a distinct audited consolidation: retain the redundant ID as a resolvable alias with its history and redirect to the reviewed surviving ID; do not rewrite historical evidence IDs.

A real subdivision or consolidation is different: create new successor object IDs and preserve predecessor objects with closed validity intervals. Do not recycle one predecessor ID for a new merged object, and do not make both split children share the old ID. Geometry revisions alone cannot describe identity-changing events. The proposed event contract is:

```typescript
type ObjectTransition = {
  id: string;
  kind: "split" | "merge" | "duplicate_correction";
  predecessorObjectIds: string[];
  successorObjectIds: string[];
  effectiveAt: string | null;
  recordedAt: string;
  evidenceSourceRecordIds: string[];
  geometryVersionIds: string[];
  reviewStatus: "proposed" | "accepted" | "rejected";
  reason: string;
};
```

A split has one predecessor and multiple successors; a merge has multiple predecessors and one successor. Duplicate correction explicitly distinguishes duplicate records from a real-world merger. Accepted transitions must be atomic with relation validity changes, enforce an acyclic predecessor/successor graph and preserve old URL/ID resolution. Unknown effective time remains null; recording time is not silently substituted. Rights and official ULPIN assertions do not automatically transfer to successors: carry explicit reviewed applicability decisions and retain the original assertions. Acceptance requires actual evidence and review; the UI prototype does not execute these events.

## Concrete mapping of an inspected Drive floor-space row

The first parsed `normalized/floor_spaces.json` record has `buildingId: SV-B-029`, `floorId: F00`, `unitId: GF-S01`, `unitType: retail_shop`, `areaSqM: 255`, `level: 0` and `sourcePlanFile: plans/SV-B-029-ground-floor.pdf`. Its provenance points to `plans/SV-B-029-floor-schedule.csv`, revision `1.0.0`; the CSV row also states parcel `SV-P-028`. The record's `geometryReference` is the **building footprint** and explicitly states there is no source unit polygon.

The adapter first looks up the source-scoped mapping key `(SV-MASTER-001, buildingId, floorId, unitId)` and reuses the mapped opaque object IDs on replay. These source keys aid matching; they are not embedded into immutable canonical identity. In this illustrative mapping, existing building `SV-B-029` resolves to `obj-4c91`, floor F00 to `obj-6a18`, and unit GF-S01 to `obj-7b52`. The opaque IDs below are proposed example targets, not IDs observed in Drive. The registered source revision would preserve the complete source record, including its building-footprint reference and source review-status text.

```json
{
  "sourceRecord": {
    "id": "sr-drive-gf-s01",
    "sourceId": "src-drive-floor-spaces",
    "sourceRevision": "1.0.0",
    "recordKey": "SV-B-029/F00/GF-S01",
    "locator": "normalized/floor_spaces.json#/records/0",
    "attributes": {
      "buildingId": "SV-B-029",
      "floorId": "F00",
      "floorName": "Ground Floor",
      "level": 0,
      "unitId": "GF-S01",
      "unitType": "retail_shop",
      "areaSqM": 255,
      "sourcePlanFile": "plans/SV-B-029-ground-floor.pdf",
      "geometryReference": {
        "type": "source_footprint_within_plan",
        "buildingFootprint": [
          [
            322,
            212
          ],
          [
            392,
            212
          ],
          [
            392,
            305
          ],
          [
            322,
            305
          ]
        ],
        "coordinateFrame": "LOCAL-SHIV-VIHAR-DEMO",
        "note": "No unit polygon source exists."
      },
      "roomCount": 1,
      "bedroomCount": 1,
      "bathroomCount": 0,
      "reviewStatus": "derived_from_chunk_8_schedule",
      "provenance": [
        {
          "sourceFile": "plans/SV-B-029-floor-schedule.csv",
          "sourceFormat": "CSV",
          "sourceObjectId": "GF-S01",
          "sourceRevision": "1.0.0",
          "processingStep": "source read",
          "transformation": "none",
          "timestamp": null,
          "reviewStatus": "source_recorded"
        }
      ]
    }
  },
  "object": {
    "id": "obj-7b52",
    "type": "space",
    "label": "GF-S01",
    "systemId": "internal:3d:obj-7b52",
    "geometryId": null,
    "status": "needs_review",
    "sourceRecordIds": [
      "sr-drive-gf-s01"
    ],
    "attributes": {
      "use": "retail_shop"
    }
  },
  "areaObservation": {
    "id": "obs-area-gf-s01",
    "objectId": "obj-7b52",
    "field": "statedAreaM2",
    "value": 255,
    "unit": "square_metre",
    "method": "source_schedule_assertion",
    "sourceRecordIds": [
      "sr-drive-gf-s01"
    ],
    "status": "unreviewed",
    "observedAt": null,
    "uncertainty": null
  },
  "floorMembership": {
    "id": "rel-f00-gf-s01",
    "fromId": "obj-7b52",
    "toId": "obj-6a18",
    "kind": "occupies",
    "status": "asserted",
    "sourceRecordIds": [
      "sr-drive-gf-s01"
    ],
    "validFrom": null,
    "validTo": null
  }
}
```

This is a **mapping excerpt**, not a complete schema-valid dataset. Its `attributes` reproduce the parsed source record; exact file bytes must also be preserved. The `sourceId` must resolve to a separately registered preserved revision. The shown revision `1.0.0` is the producer revision found in record provenance; an actual ingestion must additionally bind it to the normalized file’s measured content hash rather than treating that string as proof of immutable bytes. A separate evidence link preserves the CSV provenance and original PDF path; a PDF filename alone does not claim that its plan geometry has been read or calibrated. The source classification stays synthetic. There is no geometry row for this space, no calculated area/volume, no extrapolated height, and no generated official 2D ULPIN. The 255 m² value is a source assertion, not a measurement of a copied building polygon. Review may record the existence of the schedule-only space under an explicit completeness policy while keeping spatial operations unavailable.

## Remaining model risks

The v1 fixture validator checks this example's references and basic geometry semantics, not full solid topology, cross-source entity matching, transactional revision history or rights applicability. The v1.1 contracts above still require schema implementation, adapter capability negotiation, storage/migration design, graph/solid validation and integration tests before production ingestion. Unknown native units or vertical datum must block affected quantitative operations even when a preview renders. Native format conversion may be approximate; it must preserve original payloads and expose the approximation. Large fictional apartment areas remain authored fixture geometry and should not be presented as typical housing dimensions or derived source measurements.

## Fixture and validation

The fictional Neem Quarter fixture has 12 irregular buildings and 12 plots, four floors and 12 spaces in Neem Court (B01), three roads and one underground utility. Coordinates use `LOCAL-NEEM-QUARTER-DEMO`, a fictional zero benchmark and no geographic anchor. Scene trees are explicitly visual decoration and never count as cadastral records. B12 carries the single open missing-height issue. Seven sources comprise three embedded-record sources and four descriptor-only examples. The fixture is intentionally small for a responsive map.

Run `python3 design/bulk-studio-v4/validate-fixture.py` from the repository root. It checks unique IDs, references, SHA-256 lineage, closed positive-area rings, footprint area, frame consistency, focal floor/space bounds, batch links and the honest pending exception. With `jsonschema` installed it also checks Draft 2020-12 schema conformance; otherwise that part reports unavailable and can be required with `--require-jsonschema`. This is artifact validation, not survey certification, legal acceptance, production ingestion testing or proof that the producer's Drive binary files are valid.
