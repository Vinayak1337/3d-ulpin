# LR1 step 0: the small layout's meanings and where the large path refuses them

Read on `task/lp3b-large-file-automatic` at `4e87e096`. Paths are under `packages/server/src/modules/usp/ingestion/`
unless stated.

## 1. Kinds, targets and conversions

| Meaning | Small file (bounded GeoJSON) | Large file today |
|---|---|---|
| Kind | `contracts/usp/ingestion.ts:39` `kind: building, parcel, road, public_land, utility` (optional; absent = the older building layout); `registry.ts:81` `compileMapping` reads it | `contracts/usp/streamed-profile.ts:44-49` the plan has no `kind`; `proved-area-part.ts:71` hard-codes `kind: 'building'` |
| Targets | `contracts/usp/ingestion.ts:19` `building.*` or `feature.{sourceKey,geometry,name}`; `:50-55` one prefix per plan | `contracts/usp/streamed-profile.ts:39` `LegacyMappingTargetSchema` only; `:53` requires `building.sourceKey` and `building.geometry`; `streamed-mapping.ts:34,44-45` |
| Conversions | `registry.ts:8-16` `CONVERSIONS`: `literal_identifier@1`, `literal_integer_identifier@1`, `literal_text@1`, `geojson_polygon@1`, `geojson_geometry@1` | `contracts/usp/streamed-profile.ts:40` three of them; `streamed-mapping.ts:35,45` refuse the other two |
| Whole-number identifier | `registry.ts:101-103` needs `integerIdEligible`, set from the file's tokens by `services/geo/geo/gis_inspection.py:23-32` and narrowed by `registry.ts:59-60` | `streamed-mapping.ts:47-49` every value must be a string; the profile (`streamed-profile-inventory.ts:36-43`) counts types only, no whole-number count |
| Geometry by kind | `registry.ts:17-18,82-85`: polygons for building, parcel, public_land; points and lines for road and utility | `streamed-mapping.ts:29-30` polygons only, whatever the kind |
| Declared coordinate system | `services/geo/geo/area.py:78-96` `_geojson_crs`; `gis_inspection.py:58-61,142` publish code, evidence and unit; `registry.ts:62-66` unit into the profile; `registry.ts:92-94` the older building layout reads degrees only | `streamed-map-receipt.ts:14-28` records the name; `:73-75` refuses anything not in degrees (`STREAMING_SOURCE_CRS`); `retained-map-original.ts:18` a receipt counts only in degrees |

The mapped worker, which a large layout runs before any part is cut, also reads only the old meaning:
`chunk-mapping-normalizer.ts:21-35` takes a key only when it is a string, and `:37-38,113-114` look up
`building.sourceKey` and `building.name` by name (a `feature.*` plan would fail on the `!`). It is not in this task's
list of files; LR1 cannot make D1 and D2 work without it (finding F1 below).

## 2. How a proved part reaches the registry

`intake-large-worker.ts` (read-only) folds mapped records into cuts (`intake-package-cuts.ts:212-247`) and calls
`intake-part-draft.ts:324` `draftIntakePartTx` → `areas/areas.ts:535` `ingestProvedAreaPart` →
`proved-area-part.ts:109` `prepareProvedAreaPartTx`, which proves each feature's raw bytes
(`:34-54`) and builds the `Mapping` (`:56-79`). `areas.ts:552-553` then calls the normaliser with
`{...receipt.collectionMetadata, type:'FeatureCollection', features}` through `normalizeAreaImport`
(`areas.ts:605-629`, geo route `normalize` → `area.py:284` `normalize_area`).

- **The kind** has to travel in that `Mapping` (`proved-area-part.ts:71`), exactly as a small file's
  `compileMapping` result does (`registry.ts:86`). Nothing else in the chain names a kind; `intake-targets.ts:72`
  makes targets for buildings only, so a parcel package records features and makes no building targets.
- **The coordinate system** already travels: `collectionMetadata` (`streamed-map-receipt.ts:51`) holds the
  collection's `crs` member, and `areas.ts:552` spreads it into the normaliser's input.

## 3. Where CR1 resolves and transforms, and whether a part can call it

- Resolve: `services/geo/geo/area.py:78-96` `_geojson_crs` (words at `:88-90`, `:93`, `_crs` `:62-75`).
- Transform: `area.py:320-329` reads the declaration in `normalize_area`; `:402-405` reads x then y as written;
  `:427-440` transforms with the existing strict transformers.
- A proved part already calls the same code: `areas.ts:552-553` → geo `POST /internal/area/normalize`
  (`services/geo/geo/api.py:104-127`) with the `crs` member in the collection. **Stop rule (a) does not apply.**
  What is missing is upstream: the receipt refuses the file first (`streamed-map-receipt.ts:73-75`) and
  `retained-map-original.ts:18` refuses any receipt not in degrees. To store a resolved code on the receipt
  without a second implementation, the geo service needs a route that runs `_geojson_crs` alone
  (`api.py:113-121` has none); its rules stay unchanged.

## 4. Degrees in the large path

- `streamed-map-receipt.ts:15-18` no `crs` member: `EPSG:4326`, degree (RFC 7946 assumption, kept).
- `streamed-map-receipt.ts:25-27` a degree list by name (`EPSG:4326`, CRS84 two spellings); everything else unknown.
- `retained-map-original.ts:18` degree is required for a sealed receipt to count.
- `streamed-profile-worker.ts:68-73,95-98` the profile's reference takes `inspection.gis` only for a small file, so a
  large file's profile always says `sourceCrs: null`.
- `intake-text.ts:106-109` (probe card): the native `bbox` is copied; `extent.epsg4326` is set only when the stated
  code is `EPSG:4326`, otherwise left null. No bounds or preview is computed by approximation anywhere in the large
  path; nothing else computes degrees.
- Words: `intake-large.ts:34,73-75` (read-only) tell the officer "Large files are read in longitude and latitude
  only for now" for `STREAMING_SOURCE_CRS` (finding F2).

## D4 answer

The large path carries any GeoJSON geometry to the same normaliser: the mapped worker keeps a geometry reference only
(`chunk-mapping-normalizer.ts:149-150`), the cutter counts vertices of any nesting (`intake-package-cuts.ts:19-23`),
and `normalize_area` checks geometry against the kind (`area.py:406-407`). So lines and points are accepted for road
and utility exactly as the small layout does, and a kind whose geometry the file does not have is refused with the
small layout's words (`registry.ts:84-85`).

## Findings

- **F1** `chunk-mapping-normalizer.ts:21-38,113-114` (not listed as owned): string keys and `building.*` names only.
  LR1 makes the smallest change there (find the key and name operations by role; copy a whole number's digits for
  `literal_integer_identifier@1`); key reservation across chunks is unchanged.
- **F2** `intake-large.ts:34,73-75` (read-only): the officer's sentence for `STREAMING_SOURCE_CRS` still says
  "longitude and latitude only". After LR1 the code fires only for a declaration CR1 refuses; the sentence should
  become CR1's words. Left for the lead.
- **F3** the streamed plan schema is in `packages/contracts/src/usp/streamed-profile.ts`, not `ingestion.ts`; the
  receipt schema is in `ingestion.ts:91-107`. LR1 edits the streamed plan's targets and conversions there and the
  receipt's reference in `ingestion.ts`, and the profile inventory (`streamed-profile-inventory.ts`) gains a
  whole-number count, which D2's check needs.
