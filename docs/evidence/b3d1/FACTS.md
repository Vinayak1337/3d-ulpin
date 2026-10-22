# B3D1 step 1: what the accepted 3D readers hold

Paths are repository paths at base `26bc76fc`. "Real" lines name what the unchanged reader produced from a real input.

## CityJSON

- The accepted summary holds counts, `decodedBounds`, `transformState` and `referenceSystemState`
  (`absent | null | declared`). It holds no CRS code and no building id
  (`services/geo/geo/cityjson_processing.py:88-94`, `packages/contracts/src/usp/cityjson-ingestion.ts:23-31`).
  This is why the tray says "declared (the summary gives no code)"
  (`packages/server/src/modules/usp/ingestion/intake-native-readers.ts:135-142`).
- The artifact is the reader's whole output (`cityjson_processing.py:95-97`). It holds:
  - every CityObject's exact id, type, pointer and geometries (`services/geo/geo/native_cityjson.py:333-335`);
  - each supported face's ring pointers and its semantic surface pointer (`native_cityjson.py:209-224`);
  - the verbatim source document and the decoded vertices (`native_cityjson.py:347-351`);
  - the CRS literal exactly as the file states it, in `frame.referenceSystem`, with vertical meaning
    `not_interpreted` (`native_cityjson.py:343,353-358`);
  - units `not_established_by_reader` (`native_cityjson.py:361-363`).
- Real (D1 3DBAG `fixtures/usp/D1/single-roof/original.json`, read by `read_cityjson` unchanged):
  - the reference system is `https://www.opengis.net/def/crs/EPSG/0/7415`, a compound code; its horizontal part
    in the EPSG registry is EPSG:28992;
  - the transform is supplied;
  - Building `NL.IMBAG.Pand.1655100000500568` has one supported LoD0 MultiSurface with one face (its footprint);
  - BuildingPart `…-0` has Solids at LoD 1.2, 1.3 and 2.2, each with exactly one `GroundSurface` face.
- Precedent: the registry slice already takes a Building's LoD0 face as its footprint and requires EPSG:7415
  (`packages/server/src/modules/registry/cityjson-draft.ts:57,69-73`).

## CityGML

- The accepted summary holds counts, a status and finding codes. It has no CRS field and no building id
  (`packages/contracts/src/usp/citygml-ingestion.ts:24-32`).
- The artifact (`services/geo/geo/native_citygml.py:430-446`) holds:
  - Buildings and BuildingParts with the literal `gml:id`, or `idState: absent` (`native_citygml.py:210-216`);
  - boundary surfaces, `GroundSurface` among them, as element contexts (`native_citygml.py:17-18,205-208`);
  - each coordinate list with its owning building and its nearest **ancestor** `srsName` and `srsDimension`
    declarations (`native_citygml.py:274-285`);
  - a tuple dimension only where `srsDimension` is declared, otherwise `DIMENSION_ABSENT`
    (`native_citygml.py:305-314,423-424`).
- The reader's policy forbids CRS, dimension or unit defaults and inheritance from a sibling envelope
  (`native_citygml.py:445`).
- Real `Building_and_garage_LOD2-EPSG25832.gml` (saved projection `run-02-lod2/projection.json`):
  - the only `srsName` (`urn:ogc:def:crs,crs:EPSG::25832,crs:EPSG::5783`) is on the CityModel's own Envelope, a
    sibling of the buildings;
  - the two GroundSurface posLists (building `GML_7b1a…`, part `GMLID_BUI379228_1244_301`) have no ancestor
    `srsName` and no `srsDimension`, so their tuple dimension is `absent`.
  - So no ground outline in this file has a stated EPSG code or tuple size under the reader's own rules.
- Real `Building_LOD1-LocalEngineeringCRS.gml` (`run-02-local/projection.json`): `srsName` is `#local-CRS-1`, a local
  engineering system, and there is no GroundSurface. It is unplaced.
- **Decision:** CityGML gets no map bridge in B3D1. Its words already say "This summary states no coordinate
  reference system" and that it is not on the map (`intake-native-readers.ts:127-133,114-115`). Taking the Envelope's
  srsName and dimension would change the accepted reader's policy. That needs an owner decision.

## DXF

- The summary's `inspectionFrame` is `source_local` and `globalPlacement` is `not_assessed`. It states units only
  (`packages/contracts/src/usp/dxf-ingestion.ts:25-31`).
- The artifact holds layers, blocks and entities, with no CRS and no building concept, and lists "No … inferred
  scale/CRS" among its limitations (`services/geo/geo/native_dxf.py:446-462`).
- The tray words say so (`intake-native-readers.ts:117-125`). **DXF stays out.**

## The GeoJSON path the bridge reuses

- Converted native layers are kept as their own large originals with lineage and enrolled
  (`packages/server/src/modules/usp/ingestion/intake-native-derivative.ts:219-256,364-418`).
- A derivative child takes the streamed GeoJSON route (`intake-draft.ts:221-229`), and its part drafts create card
  targets (`intake-part-draft.ts:88`, `intake-targets.ts:71-91`). The bounded route does the same at
  `intake-draft-worker.ts:192-207`.
- The area normaliser:
  - refuses a compound CRS (`services/geo/geo/area.py:62-75`);
  - reads a position's third number into `sourceHeights` with unit and reference `None`, beside an x,y outline
    (`area.py:130-155,310-315`).
- The NR1 blocker is already fixed on this base. `cityjson_processing.py:16` accepts `sources/` and
  `large-originals/` (commit `48e138cf`, NR3), so no change is needed here.
