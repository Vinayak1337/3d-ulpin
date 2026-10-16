# AD2 — what the area context sends, and what the Studio reads

Report only; nothing here changes the server, the contract or a screen. Sources: `AreaContext` and
`PhysicalFeature` in `packages/contracts/src/area.ts:88-134,242-311`; `areaContext` in
`packages/server/src/modules/areas/areas.ts:256-299`; the Studio's consumers of `useAreaContext`
(`MapPage.tsx:40` → `MapWorkspace.tsx`, `RegisterPage.tsx:96`, `WorkspacePage.tsx:339`,
`CandidateReviewPage.tsx:46`) and every helper they hand features to (`footprints.ts`, `useBuildingScene.ts`,
`canonicalScene.ts`, `heightBands.ts`, `BuildingSearch.tsx`, `inspector/*`, `queries.ts:featureCode`).
Paths below are under `apps/studio/src/features/` unless named otherwise.

## Top level of the response

| Field | Server sends | Read by the Studio | Where |
|---|---|---|---|
| `area` | the area row | `id`, `name`, `revision`, `reference` | `map/MapWorkspace.tsx:88,114,120,127`; `review/candidates/CandidateReviewPage.tsx:63,68` |
| `features` | every current feature (up to the area limit) | **only when `displayFeatures` is absent**, and the server always sends `displayFeatures` | `map/MapWorkspace.tsx:63`; `register/RegisterPage.tsx:105`; `review/WorkspacePage.tsx:340` |
| `displayFeatures` | `features` minus proposals' ids, **plus** the proposals: every current feature a second time | yes, the list every screen draws | same three lines |
| `packages` | the bodies of the area's last 30 import packages, each with its own `features[]`, `factCandidates`, `parts`, `questions`, `review` | `id`, `state`, `quarantine.message`, `quarantine.sourceSha256` only | `map/MapWorkspace.tsx:67-68,91-101` |
| `parcelAssociations` | confirmed `occupies_parcel` rows | never | — |
| `parcelIdentifiers` | validated parcel ULPINs | never from the context (the screens read the register's own list) | — |
| `sceneAssets` | presentation assets | never | — |
| `latestCheck` | the last area check run | never | — |

So each feature crosses the wire at least twice (`features` and `displayFeatures`), and once more inside every
import package of the last 30 that holds it.

## Fields of one feature (`displayFeatures[i]`)

| Field | Read | Where |
|---|---|---|
| `id` | yes | `map/footprints.ts:21,35,72,80`; `map/useBuildingScene.ts:30,45`; `map/MapWorkspace.tsx:105,210`; `map/BuildingSearch.tsx:39,43`; `map/inspector/*` |
| `kind` | yes | `map/footprints.ts:16,48,66,68,76,80`; `map/MapWorkspace.tsx:103-104`; `map/BuildingSearch.tsx:39,48` |
| `name` | yes | `map/footprints.ts:76-77`; `map/BuildingSearch.tsx:39,43`; `map/inspector/AreaInspector.tsx:18`; `map/inspector/evidence.ts:6` |
| `identifier` | yes | `map/BuildingSearch.tsx:38,43,48`; `map/inspector/BuildingInspector.tsx:101,116` |
| `areaId` | yes | `map/BuildingSearch.tsx:39` |
| `revision` | yes (`> 0` means recorded) | `map/footprints.ts:163` |
| `datasetNamespace` | yes | `map/MapWorkspace.tsx:351`; `map/inspector/evidence.ts:8` |
| `sourceKey` | yes (search) | `map/BuildingSearch.tsx:43` |
| `geometry` | yes (local metres; drawn) | `map/footprints.ts:27,65,178-179`; `map/useBuildingScene.ts:29`; `map/MapWorkspace.tsx:211`; `map/inspector/UndergroundInspector.tsx:31` |
| `height` | `value`, `state`, `evidence[].sourceRevisionId/jsonPointer/row` only | `map/footprints.ts:30,35`; `map/heightBands.ts:24-25`; `map/inspector/AreaInspector.tsx:19`; `map/inspector/BuildingInspector.tsx:51,63`; `map/inspector/evidence.ts:11-13` |
| `evidence` | `sourceRevisionId`, `jsonPointer`, `row` only | `map/inspector/evidence.ts:7-9` |
| `properties` | keys `sourceSubtype`, `land_cover`, `address`, `geom_source`, `ulpin`, `officialUlpin`, `official_ulpin`, `registryId`, `registry_id` | `map/footprints.ts:67,78,80`; `map/inspector/BuildingInspector.tsx:52-53,85`; `map/BuildingSearch.tsx:42-44` |
| `semantics` | `floorCount`, `sourceDate` only | `map/footprints.ts:31`; `map/inspector/BuildingInspector.tsx:86` |
| `verticalExtent` | `lower`, `upper` (utilities) | `map/footprints.ts:69-72`; `map/inspector/UndergroundInspector.tsx:31-32` |
| `utilityProfile` | `network` and the profile shown | `map/footprints.ts:70-73`; `map/MapWorkspace.tsx:334`; `map/inspector/UndergroundInspector.tsx:39` |
| `projectCode` (not in the contract) | yes | `api/queries.ts:featureCode` → `map/inspector/BuildingInspector.tsx:116` |
| `sourceGeometry` | **never** | — |
| `geographicGeometry` | **never** (the scene draws `geometry` or the canonical read) | — |
| `sourceReference` | **never** | — |
| `sourceRevisionId` (on the feature) | **never** (only the one inside `evidence[]`) | — |
| `representation` | **never** | — |
| `worldStatus` | **never** | — |
| `geometryRole`, `semantics.geometryRole` | **never** | — |
| `areaM2` | **never** from the context (`WorkspacePage.tsx:258` and `candidates/model.ts:141` read other records) | — |
| `sourceFeatureIndex` | **never** | — |
| `height.unit/meaning/reference/originalValue/originalUnit/claimId/method` | **never** | — |
| `semantics.evidenceState/levelReference/validFrom/validTo/horizontalUncertaintyM/approvalStatus/assetId` | **never** | — |
| `displayState`, `proposalPackageId` | **never** | — |

## Share of the bytes (local fixtures, not the demo area)

The demo area's 46.7 MB could not be re-measured here (no API or database in this session). The two retained
context fixtures give the per-feature shape; neither carries `displayFeatures` or `packages`, so they show
only the feature fields' share. Bytes of each field summed over the features, as compact JSON:

| Fixture | features | `geographicGeometry` | `sourceGeometry` | `sourceReference` | `height` | `geometry` | `properties` | the rest |
|---|---|---|---|---|---|---|---|---|
| `apps/studio/src/local/data/nyc-bronx-context.json` | 62 | 15.7 % | 15.5 % | 11.7 % | 15.3 % | 8.3 % | 7.9 % | 25.6 % |
| `apps/studio/src/local/data/lake-view/context.json` | 54 | 15.0 % | 7.9 % | 17.6 % | 11.3 % | 7.4 % | 3.2 % | 37.6 % |

The never-read `geographicGeometry`, `sourceGeometry` and `sourceReference` are 35–43 % of each feature;
the duplicate `features` list doubles what remains, and `packages[].features` repeats it again per package.
