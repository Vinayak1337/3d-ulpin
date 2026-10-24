# FUSION-CITYGML-01 — selected accepted building fragments in combined context

3 October 2026. Code `fc137a38652cf7cfec46daed9f8821fcf52b0103`, assigned base
`c170fc17267f4492af89eedd7208c11c313f6522`, branch
`task/desktop-fusion-citygml-context`, exclusive checkout
`C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`.
Completed `task/desktop-reviewed-kml-citations@fb245292` is preserved.
[Assignment](../../orchestration/PARALLEL_20261003.md#fusion-citygml-01--selected-citygml-building-fragments-in-combined-context).
Supplied turn permissions are `never` / `danger-full-access`; requested
Sol6.1/xhigh/default-standard, actual per-turn model/effort/tier unexposed.
Staging remained read-only and its last inspected head matched the base.

## Delivered

The existing `POST /api/v1/usp/evidence/source-fusion/context` accepts
`{kind:'citygml', pin, buildingOrdinals:[0]}` with document/OCR/CityJSON/IFC/DXF/KML
selections. These ordinals index the accepted native `/buildings` array, not XML
element ordinals or registry identities. Select 1–25 distinct exact records,
within unchanged 2–8-source/25-total-selection bounds. Selected BuildingParts
are supported, but selecting a parent never expands an unselected part.

Each fragment preserves its exact native building record, source-local key,
JSON pointer, record/fragment hashes, literal elements and original byte
locators, coordinates/reference declarations, identifiers and link states.
Literal XML containment scopes the fragment; typed ownership and parent fields
come only from the corrected accepted reader. Opaque ADE descendants remain
literal inventory. Separate nonbuilding source context retains source metadata,
local engineering definitions, envelope/reference declarations and unsupported
content without assigning them to the selected building. Namespaces, parser,
source declarations, findings and semantics remain literal. References to
unexpanded targets stay references. No schema/XLink fetch, geometry transform,
CRS default, inferred parent/floor, canonical identity or learning label.

The selection hash binds the complete source/result/input/reader/fence pin,
artifact hash/size and sorted building ordinals. Canonical `citygmlStatusTx`,
accepted-attempt checks, private original/latest-source authority and
`assertCityGMLReadTools` are reused unchanged. Fusion verifies exact bounded
result/artifact bytes and reconstructs the accepted summary. Complete-set
authorization surrounds I/O; inventory checks stay outside SQL locks. Existing
64 KiB request, 64 MiB aggregate read, 30-second deadline and 1 MiB response
limits remain. Oversized selections refuse without truncation.

CityGML association proposals, manual association reduction and citation
attachment explicitly refuse 422 `SOURCE_FUSION_CITYGML_CONTEXT_ONLY`, with no
selected source silently removed. Proposal/attachment entry points refuse
before their I/O/model call. The citation adapter additionally narrows its
return after an exhaustive refusal, preserving all supported sources; registry
files remain unchanged. Existing KML building/floor citations still work.

## Checked retained inputs and outputs

Reuses the two unchanged [OGC standards examples](native-citygml/sources.json),
[accepted native/API artifacts](citygml-api-handoff.md), corrected native reader
and [EPSG 7415 document fragment](reference-document-enrollment/manifest.json).
OGC inputs remain `test_only`: German/example or local engineering coordinates,
no Indian operational/property crosswalk. SIG 3D/GDI-DE attribution and
unresolved specific-example redistribution terms remain recorded.

- LoD2 original selects building ordinal 0, native element 7,
  `GML_7b1a5a6f-ddad-4c3d-a507-3eb9ee0a8e68`. Only one of two native buildings
  attaches to context; the element-103 BuildingPart subtree stays unexpanded.
  A separate explicit ordinal-1 projection preserves that part and its literal
  `parentBuildingElement:7` without expanding the parent. Both keep absent
  dimensions and source-native link inventory, with `partial` status.
- Local engineering original selects ordinal 0, element 50, literal LoD `1`.
  `#local-CRS-1`, custom opaque metadata and inline reference context remain
  inspectable. Building posList reference/dimension stay absent/null, while
  the exact `7.0` numeric token agrees with its original byte locator. No
  local-to-world placement is inferred.
- Both combined contexts retain the exact selected document text
  `  <gml:name>RD + NAP height</gml:name>`, `not_assessed` association and empty
  canonical targets.

Authority/source-marker/accepted-fence/SQL rows, storage transport and tool
assertions are labelled memory-only controls over unchanged retained bytes.
Retained accepted result envelopes are compactly serialized for these checks
without changing input/summary/artifact/supervision fields. These are not
historical database facts or current runtime admission. No native run, fresh
resource measurement, source acquisition or model invocation occurred.

Private evidence root:
`E:/BhuAayam-data/task-data/desktop-source-fusion-citygml-20261003`.

| Saved output | Bytes | SHA256 |
| --- | ---: | --- |
| `lod2-controlled-journey.json` | 436255 | `cf03aef80ba9f08d71f5915371d2c8636a38ecff74cadb49210a314e7691ba37` |
| `local-controlled-journey.json` | 197358 | `840c550e416c723c22e638c2c3cde1d1068e587a29a82bc21cc72adc8f01b395` |
| `denial-control.json` | 323 | `b2c73925fbf146a6790d33d24d42e1c751c9a0ec5dc37a477d9125495f39ca60` |

Compact contexts are 122389 / 93115 bytes. They bind context hashes
`c0a5dfb5d561a7acb4aed60206cbd8cfd5f283af82a67a675e372d9eb467c006` /
`6d3354126e791bcd8da8ef203f3f1cc1900210d17db54a4b41ff45ec2e882300`.

## Verification and integration

25 distinct checks pass, zero skips:

- Three new CityGML checks cover both retained inputs, selection isolation,
  exact literals/locators, explicit context-only refusals, stale result/fence,
  wrong input/artifact and whole-response denial after revocation during the
  second selected-source read. Two aggregate captures, zero writes;
  no object/tool work inside capture transactions.
- Existing document/OCR/CityJSON/IFC/DXF/KML fusion checks: 19 pass.
- Existing KML citation amendment/private read/review/commit/history and
  denial/removal journeys: two pass.
- Existing grounded native/OCR proposal/manual-adapter journey: one pass.
- Backend server/API typecheck and staged whitespace check: exit 0.

The initial positive test omitted the proposal request's required requestKey;
it was corrected and only that affected check repeated. Initial typechecking
identified the new union reaching a registry OCR fallthrough; narrowing the
owned citation adapter fixed it without registry edits. Both failed logs stay
preserved alongside successful checks. No reader/input failure occurred.

Completion `completion-fc137a38.json`: 20383 bytes, SHA256
`c896435a1be2723e10239977cba5c6f42476ac3987d0bde3ec00766ef7059e54`.
It pins nine physical/Git code files, ten unchanged protected authorities,
two originals, seven retained input/manifest files, three outputs and seven
check logs. Normalized physical code matches committed bytes.

Lead owns additive OpenAPI/client publication for source selection/context and
embedded contracts, existing endpoint wording, catalogue/index and ledger.
Existing star exports/service/controller registration suffice; no new
endpoint/store/migration. No registry/packet/card, GeoParquet, generic
jobs/dispatcher/intake protection, native/config/runtime, generated API,
frontend or ML changes. No service/Docker/provider/GPU, push/deploy, additional
worker, polling or schedule. No owned runtime child or scratch was created;
private evidence and all originals/history remain preserved.

Current HTTP/PostgreSQL/private storage, installed tool inventory admission,
authentic applicability, geometry/global placement, rights, learning/accuracy,
scale and every release gate remain unqualified.
