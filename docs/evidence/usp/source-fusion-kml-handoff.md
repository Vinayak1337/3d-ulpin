# FUSION-KML-01 — accepted geographic fragments in combined context

3 October 2026. Code `27301edb1b2d42f8506eb58c0bd38a151fd7477a`, base `2940105fe62e38bdbfec9e2784fcd0a82ecb7a02`, branch `task/desktop-fusion-kml-context`, exclusive checkout `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`. Completed KML-02 branch at `98a16154` is preserved. [Assignment](../../orchestration/PARALLEL_20261003.md#fusion-kml-01--accepted-geographic-fragments-in-combined-context). Supplied permissions: `never` / `danger-full-access`; requested Sol6.1/xhigh/default-standard, actual per-turn model/effort/tier unexposed. Primary staging stayed read-only; latest inspected head `989d2906`, with unrelated loader/test changes preserved.

The existing `POST /api/v1/usp/evidence/source-fusion/context` accepts `{kind:'kml', pin, featureOrdinals:[...]}` alongside document/OCR/CityJSON/IFC/DXF. Select 1–25 unique native feature ordinals within the existing 25-total-selection/2–8-source bounds. Complete selected records retain names/IDs, literal fields, element locators, coordinate lexemes, altitude declarations/defaults, absent states and native parent ordinals. Source-document/member inventory and unsupported/unresolved findings stay inspectable. No parent-feature expansion, link/style/HTML resolution, geometry repair or coordinate transformation.

Original/member/XML, canonical result/input, native artifact, selection and record hashes remain distinct. Selection hash binds original SHA, exact member pin, XML SHA, artifact SHA/size and sorted feature ordinals. Canonical KML source/current family/private binding/reader and accepted-attempt/fence authority is reused. Exact bounded result/artifact reads reconstruct and compare the accepted summary. Existing full-set locks and before/after object-read authorization remain; inventory checks run outside SQL locks. Limits stay 64 KiB request, 64 MiB aggregate read, 30 s deadline and 1 MiB response, with KML's 512 KiB result/16 MiB native caps. Oversized context fails explicitly; no silent truncation.

An accepted multi-member `needs_input` archive returns 422 `SOURCE_FUSION_KML_MEMBER_SELECTION_REQUIRED`, directing the caller to canonical exact-member retry before selecting features. An archive without KML returns `SOURCE_FUSION_KML_NO_MEMBER`. Selected partial fragments remain available even without geometry/reference. KML is context-only: association literals/manual selection and reviewed citation attachment explicitly refuse `SOURCE_FUSION_KML_CONTEXT_ONLY`; no selected KML source is dropped to accept the remainder. The refusal precedes model invocation/citation I/O. Older variants/version/context hashes remain unchanged.

## Checked output

Reuses [unchanged Google libkml test_only originals](native-kml/sources.json), BSD-3-Clause revision `8609edf7c8d13ae2ddb6eac2bca7c8e49c67a5f8`, KML-02's [retained accepted envelopes/native bytes](kml-api-handoff.md), and the authentic [EPSG 7415 saved document fragment](reference-document-enrollment/manifest.json). No new parser/source/model run. SQL/source-marker/fence rows, object transports and runtime/tool assertions are labelled memory-only controls, not reconstructed historical database facts or current runtime/persistence qualification. Canonical result JSON is serialized from the retained complete accepted envelope without changing its input, summary, artifact or supervision pins.

- Ordinary KML selects ordinals 2/3: `Simple placemark` and `Floating placemark`, source ID `floating-placemark`. Exact floating coordinate lexemes `-122.084075`, `37.4220033612141`, `50` and declared `relativeToGround` survive. Simple placemark's altitude mode remains absent while `clampToGround` stays separately labelled as a specification default. Original XML line locators agree; vertical datum is null/unassessed. All 240 unsupported findings and 30 unresolved references remain unchanged. Selected names/IDs are source-native observations, not property identity.
- Combined document fragment remains exactly `  <gml:name>RD + NAP height</gml:name>`. Association is `not_assessed`; canonical targets are empty.
- Selected KMZ `doc/doc.kml`, ordinal 3, 44 bytes, member/XML SHA `727198e00328bbeaa4e7b8af4260084eb28315b26eff817297dc1bcacd2c4455`: feature 0 retains literal `doc.kml`, `partial`, absent geometry, zero coordinates and unknown reference. The original archive hash remains separate.

Private evidence root: `E:/BhuAayam-data/task-data/desktop-source-fusion-kml-20261003/`.

| Output | Saved bytes | SHA256 |
| --- | ---: | --- |
| `controlled-selection.json` | 1582 | `069fdce9cab653065add609a84f0cf5cb3f5bfff4b05a1ab88afa30dd588aee8` |
| `controlled-context.json` | 223682 | `70a61e5d31eb3f92dd0fdb58d6d3eb2fb8c5d5cf13330ba5915596909d58ec00` |
| `selected-kmz-context.json` | 10701 | `666697003660cbd1444ea750b201f0a577da00d9b9b8ffe4799f3953b370926d` |

Compact responses: 147,643 and 7,244 bytes. Context hashes: ordinary `7aaec12aa0bce4895231db3811eba61775c8fd345270511e76fcfe654dbd6d1e`; KMZ `4d6ca723f0bdbdb137c80735d67e0c6c8f2c8262ae8c61a334b3afbe7856bf92`.

Checks exit 0:

- `pnpm exec tsx --test tests/source-fusion-kml.test.ts tests/source-fusion.test.ts tests/source-fusion-ifc.test.ts tests/source-fusion-dxf.test.ts`: 19 pass, no skips, `fusion-checks.txt`. Three new checks cover retained literals/incomplete fragment, actionable selection refusal, exact accepted result/member/input denial, context-only restrictions, preserved old OCR context hash and whole-response denial after revocation during the second object read. Two aggregate captures, zero writes; no I/O/inventory under SQL locks.
- `pnpm exec tsx --test --test-name-pattern 'grounded native/OCR proposals' tests/usp-source-fusion-associations.test.ts`: one pass, `association-compatibility.txt`.
- `pnpm typecheck:backend`: server/API pass, `backend-typecheck.txt`; staged `git diff --cached --check`: pass.

`code-receipt.json`: 12,211 bytes, SHA `ba130479f9325d049ff97fe784b40bd2e5e522e143fba2879e49d7f8e8aba595`, eight physical/Git code pins, 15 unchanged protected-path pins and 18 source/evidence pins. Normalized physical text matches committed code; originals match retained hashes. KML intake/config/native wrapper/jobs/dispatcher/source protection are unchanged from base. No registry/packet/card/ML, runtime/profile, generated API or frontend edits.

Lead needs the existing controller summary to add KML, additive OpenAPI/client publication and catalogue/index/ledger handoff. Existing exports/module/service registration suffice; no new endpoint/migration/store. Actual tool/runtime admission and current HTTP/PostgreSQL/private persistence remain unrun. No property/geometry/global placement, rights, accuracy, learning, performance or GF/release qualification. No services/Docker/provider/GPU/model process, runtime/cache repair, source acquisition, push/deployment, extra worker or polling/schedule. Worktree clean after code/handoff commits; no owned runtime process or scratch was created.
