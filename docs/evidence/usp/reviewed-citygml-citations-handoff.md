# LINK-CITYGML-01 — selected building/BuildingPart evidence citations

3 October 2026. Code `a74737eac571552bd5f11b03fe5b6e40eebc91af`, assigned base
`5dd11f5c016cf1f0f28979b38399f13e29dfacfe`, branch
`task/desktop-reviewed-citygml-citations`, exclusive checkout
`C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`.
[Assignment](../../orchestration/PARALLEL_20261003.md#next-implementation--link-citygml-01).
Preserved `task/desktop-fusion-citygml-context@0cb090da`; staging remained
read-only. Supplied turn permissions `never` / `danger-full-access` were
confirmed before implementation. Requested Sol6.1/xhigh/default-standard;
actual per-turn model/effort/tier unexposed.

## Delivered

`registry-citygml-citation/1` attaches explicitly selected accepted Building or
BuildingPart fragments through existing building/floor correction `addFusion`,
private read/idempotent replay, accountable review/commit and historical read.
Private evidence returns `{pin, fragment}`: a singleton CityGML projection with
its exact selected building record/literal subtree and separate nonbuilding
source context. Selecting a building never expands an unselected part; a part
does not expand its parent. Source-native IDs, names, type, containment/parent
pointers and coordinates establish no canonical identity, floor semantics,
geometry, rights, applicability or learning truth. Citations remain
`operator_selected` / `not_assessed`. Automatic CityGML association, identity
assertions and space citations remain unsupported.

Pins bind unchanged original/source revision, result/input/reader/accepted
fence, artifact, singleton selection, native building and element ordinals,
source-local key/type/ID state, JSON pointer, record and fragment hashes,
original root byte locator, separate source-context hash, exact historical
target revision/body, operator/access/time and partial inspection status.
Names/namespaces, LoD, unresolved references, absent/null dimensions and opaque
metadata remain literal in the private fragment. No parser/schema/XLink fetch,
CRS default, transform, geometry admission or inferred parent/floor.

The new typed source bridge delegates unchanged `acceptedFusionCityGMLTx` and
`citygmlSourceTx`: exact current/latest private source, canonical target site,
accepted attempt/result/input/reader/fence and no copied ancestry. Tools delegate
`verifyFusionCityGMLTools` → unchanged `assertCityGMLReadTools`; no exemption.
Existing complete case gates, ordered aggregate source locks, historical target
authorization and before/after I/O/review/commit reauthorization cover CityGML.
Removing denied citations remains useful without reading their artifacts.
Old citation IDs/hashes and general/public hiding remain unchanged.

Bounds are unchanged: 2–8 context sources, 25 total selections/citations,
32 KiB fusion amendment, 64 MiB aggregate artifact allocation, 30-second
deadline, 512 KiB CityGML result/16 MiB native artifact and private native
response at most 1 MiB minus the existing envelope reserve. No truncation.
The prior fusion citation-refusal check now verifies a missing canonical target
site; automatic-association refusal remains intact. Other fusion algorithms and
all native/intake/job/config/runtime/GeoParquet/packet/card/ML/frontend files
remain unchanged.

## Retained inputs and scoped verification

Reuses the two unchanged [OGC standards examples](native-citygml/sources.json),
[accepted native/API outputs](citygml-api-handoff.md),
[CityGML fragment implementation](source-fusion-citygml-handoff.md) and the
retained [EPSG 7415 document fragment](reference-document-enrollment/manifest.json).
OGC inputs stay `test_only`, in their German/example or local engineering
geography. SIG 3D/GDI-DE attribution and unresolved specific-example
redistribution terms remain recorded. No Indian/property crosswalk.

- LoD2 original: building ordinal 0/native element 7, literal ID
  `GML_7b1a5a6f-ddad-4c3d-a507-3eb9ee0a8e68`. One of two native building
  records attaches plus one exact native document citation. Unselected element
  103/BuildingPart is absent from the disclosed building subtree. Partial
  inspection and absent dimensions remain visible.
- Local engineering original: ordinal 0/element 50 attaches to a controlled
  floor correction. LoD `1`, `#local-CRS-1`, opaque custom metadata and absent
  building reference/dimension declarations survive review/commit/history.
- A separate explicit ordinal-1 BuildingPart amendment/private read preserves
  `parentBuildingElement:7`, without expanding element 7 or asserting that the
  part corresponds to the selected floor.

Target/site/source/input/result/job/SQL/storage/review/tool envelopes are
labelled controls over unchanged original/native/document bytes. Retained
native supervision is reused unchanged; no fresh native execution or resource
measurement. Actual installed inventory and geo-review production are
unrun/stubbed. Existing commit methods store record revision 2 while preserving
target revision 1/body history and exact citations in the recorded body.

Private root:
`E:/BhuAayam-data/task-data/desktop-reviewed-citygml-citations-20261003`.

| Saved journey | Bytes | SHA256 |
| --- | ---: | --- |
| `Building_and_garage_LOD2-EPSG25832.gml.controlled-journey.json` | 821499 | `5cf09fbf78bbf9604aed5d687712fe7ace169a24b3c21710398a374aad125124` |
| `Building_LOD1-LocalEngineeringCRS.gml.controlled-journey.json` | 628047 | `63ae779a4dd8ee2bd24980074c03ae6f5a1e15116d0abb3740fdfc8698756727` |

Compact private responses are 124185 / 94910 bytes. Each journey retains actual
request/receipt/citation/context/private read, controlled review, canonical
commit result, recorded body and historical read.

Nine affected checks pass, zero skips: two new CityGML journeys/controls; two
existing KML citation journeys; four native/OCR/IFC/region/DXF compatibility
journeys; one affected CityGML fusion-boundary check. Controls cover wrong
site/copied ancestry/stale fence, late source revocation, changed fragment with
recomputed citation ID, denied commit/read, unsupported space/identity/automatic
association and useful removal. Backend server/API types and physical/staged
whitespace checks exit 0. No failed implementation/input check or repeated
native/review campaign.

Final completion `completion-a74737ea-v2.json`: 22900 bytes, SHA256
`c4fe6ca68ea9d6d47d63ea86bf110ba96d90a193e464689732f73d5a65ee7ba8`.
Six physical/Git code pins, twelve unchanged authority pins, two originals,
eight retained input/lineage pins, two journeys and five check logs. Normalized
physical code matches committed bytes. The preserved initial completion
mislabelled historical target revision 1 as recordedRevision; v2 separately
records committed revision 2 and target revision 1. No journey/code/check bytes
changed for that metadata correction.

## Lead integration and limits

Lead republishes additive CityGML citation/fragment/amendment/evidence and
embedded record/draft/review contracts, plus existing POST/GET
`/api/v1/registry-drafts/{draftId}/document-citations` wording/manifests.
Existing star exports/registration/routes suffice; no new endpoint/store or
migration. Catalogue/index/ledgers remain lead-owned. Prior context-only and
native-runtime receipts stay historical.

Current HTTP/PostgreSQL/private persistence, installed tool admission,
authentic applicability, geometry/global placement/rights, learning/accuracy,
scale and all release gates remain unqualified. No source acquisition,
runtime/dependency/cache/cap edits, service/Docker/provider/model/GPU child or
scratch, frontend, generated API, push/deploy, new worker, polling or schedule.
Originals, history and completed branches remain preserved. Return owned
commits/proof by the standing authorized callback and end for integration.
