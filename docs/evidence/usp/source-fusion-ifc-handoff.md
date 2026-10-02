# FUSION-IFC-01 — selected native IFC context

2 October 2026. Code **`c7431f8781626602fc70e0a1871846f43dc2b236`**, branch `task/desktop-fusion-ifc-context`, worktree `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`, accepted base `d7f0e50828d7e1c9d4d375d22eb358214a8f0310`. Assignment: [PARALLEL_20261002C](../../orchestration/PARALLEL_20261002C.md#fusion-ifc-01--accepted-ifc-metadata-in-combined-context). Prior reference-control branch remains at `cb0f9daa8f76ef799a86d3f5d78fb654320dfbea`. Staging stayed read-only; its later observed head was `81f3c050c3d47d0f4cb02bef0ba7803c7ea7d368`.

## Delivered

The existing private **POST `/api/v1/usp/evidence/source-fusion/context`** accepts additive `kind: "ifc"`, an exact existing fusion pin and unique positive native `stepIds`. Only accepted `IfcBuilding`, `IfcBuildingStorey` and `IfcSpace` records can be selected. Selection order is normalized. Existing document/OCR/CityJSON variants and saved context hashes remain compatible.

Each IFC fragment retains the accepted artifact hash/length, source/schema/parser metadata, selected records, original attribute states/values/raw literals/byte spans, incident relation records and exact native artifact pointers. Supporting records retain referenced placements and source-wide project/site, units and reference declarations. Unselected building/storey/space metadata is not expanded; relation literals may retain their native unselected endpoint references. Missing parents and multiple source parents remain explicit; declared null/absent/unsupported fields are preserved. These native edges and STEP IDs/GlobalIds establish no canonical identity, property/document relationship, legal units, frame alignment or learning truth. Geometry remains unsupported and supplied georeference remains unqualified/unapplied.

`acceptedFusionIFCTx` delegates to the unchanged canonical `ifcStatusTx`/`assertIFCJobRow`/`ifcResultBytes`. Both existing aggregate captures retain sorted case gates and case/source locks, source/currentness/access checks and exact input/reader/fence comparison. Canonical IFC tool checks run outside their database lock scopes before and after private object I/O. The existing bounded fusion stream reuses canonical IFC schemas, keys and summary validator; it verifies exact result/artifact bytes and hashes, artifact job scope and summary equality. No new parser, ingestion store, write or authority replaces the canonical workflow.

Bounds remain 2–8 sources, 25 selected fragments, 64 KiB request, 1 MiB response, 64 MiB aggregate private bytes and a shared 30-second deadline. IFC keeps its 16 KiB result and 16 MiB artifact caps. JSON depth/value checks precede artifact interpretation. The final whole-input authorization follows all private object reads; partial context is withheld on denial.

**Exact compatibility delta:** `source-fusion-citations.ts` rejects IFC selection and narrows its returned context union to the existing supported variants; `source-fusion-associations-projection.ts` rejects IFC at both literal extraction and manual-selection projection. Both return `422 / SOURCE_FUSION_IFC_CONTEXT_ONLY`. IFC is not promoted into document citations or association proposals. Shared registry writers/access authorities, IFC readers/workers and model/gateway implementations are unchanged.

## Retained proof and limits

Private evidence: `E:/BhuAayam-data/task-data/desktop-source-fusion-ifc/`. Receipt **`projection-receipt.json`**, 11,293 bytes, SHA256 **`6b16d1dfc6ef15ad9df17cab569bad77b1c139b2cafd774cb820feb60d4dc6f2`**, pins authentic inputs, outputs, physical/Git code bytes and command logs.

The unchanged buildingSMART IFC2X3 original is 92,542 bytes / `c4db65ba847f6b369a95d6c54fa11f4750cbe6d59f021934e8923d8d578e5885`; the [accepted parser artifact](native-ifc/manifest.json) is 55,011 bytes / `66dcfb321cac47b605ffed87beaf060b50b1203a151b738fe446b6251d003d3a`. Native STEP IDs **25, 36, 183** select building, storey and space. The retained EPSG:7415 [reference-document result](reference-document-enrollment/manifest.json) is 20,352 bytes / `76aeb8d859c59e4af3d80eadaec3517c0bdee06b89a4a9fe8529a53a0021930c`; one exact enrolled part is selected. All returned records match their artifact pointers; every non-null raw attribute literal matches its unchanged original byte slice.

`retained-projection.json` combines those actual IFC metadata fields and the authentic saved document fragment: **98,341 bytes**, SHA256 **`bee2780c13d36ae71f7418381afe21827166e76bd8302018b330ba5604ebca84`**. It explicitly records that the canonical IFC job/result envelope was not retained. It manufactures no accepted IFC source/job/result pin. The IFC2X3 reference state is naturally `missing_or_unqualified`; source-local inspection and no applied global transform remain visible. buildingSMART retains CC-BY-4.0 `test_only` certification provenance; EPSG retains its reference-document role. No cross-geography property match is asserted.

Separately named `controlled-selection.json` / `controlled-context.json` exercise the complete bounded service using in-memory IFC IDs/job/accepted rows/tool pins and retained artifact bytes. Those pins are protocol controls, never persisted accepted operational facts. The controlled context has 3 selected entities, 5 incident relations, 28 supporting records, 77,584 reserved read bytes and 48,084 compact response bytes. Pretty output: **98,805 bytes**, SHA256 `e437791f30b6ca67e45bfd2487bc429d9f431d1ac66e33a23091a0b504c17143`; validated-body fingerprint **`7403964c2b9d26db6877b4c298b648079368aa60c612b064ab467d1a1c48cbf2`**.

The existing retained OCR context reproduces fingerprint `12058b2711142152e577c0ac2b3dd4e87d17ef64c1e58333421ff12003344a48` and unchanged saved-file SHA256 `5fbcac319122d09b32db6e6c03de6461fc581d58adbb45e4101498c3115702e9`. Originals and historical receipts remain unchanged.

**Qualification:** current accepted IFC authority, runtime tool inventory, HTTP/PostgreSQL/private-object persistence remain unrun. Protocol tool checks are stubbed; no saved profile is repointed. A later canonical runtime needs its actual profile/2 and accepted job envelope. No geometry, matching, rights, ML/learning, operational Indian data, scale or release gate is qualified by this increment.

## Checks and publication

Final commands from the assigned worktree exited **0**:

- `pnpm exec tsx --test tests/source-fusion-ifc.test.ts` — 2 checks: retained mixed projection/literal byte spans/missing frame/unchanged saved hash; incorrect selection/result pins/artifact scope and IFC revocation during a later document read, with two aggregate captures and zero writes.
- `pnpm exec tsx --test --test-name-pattern 'grounded native/OCR proposals' tests/usp-source-fusion-associations.test.ts` — 1 existing manual adapter compatibility check.
- `pnpm typecheck:backend` — server/API pass. Initial exit 2 exposed the downstream citation union; its supported return type is preserved in the owned helper. Initial/final logs are retained.
- `pnpm exec tsx E:/BhuAayam-data/task-data/desktop-source-fusion-ifc/receipt.mts`; `git diff --check`; `git diff --cached --check` — pass.

Lead must republish the existing endpoint's additive request/response schemas and operation wording through its owned OpenAPI/client pipeline. Existing root star export/module registration suffice; no new operation or catalogue acquisition is needed. Controller/module/export/generated files are untouched.

Supplied actual permissions: never/danger-full-access. Requested Sol6.1/xhigh/default-standard; actual per-turn model/effort/tier are unexposed. No frontend, dependencies, services/listeners, DB/Docker, source acquisition, native parser, model/GPU/provider, subagent/chat/schedule, push or deployment work ran. Owned commands exited; useful private evidence is retained. Worktree returns clean after this handoff commit. Return through the authorized lead callback, then stop.
