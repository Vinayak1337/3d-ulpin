# KML-02 — private canonical KML/KMZ intake

Lead integration, 3 October: `b286b78e` / `e215b9da`, followed by opt-in contract export, production module/controller/manifest registration and DXF fusion immutable-read reconciliation. Completion/final-pin receipts, 23 physical/Git code pins and 19 evidence pins match. Twelve integrated authority/compatibility/fusion controls pass; three configured native/inventory checks deliberately skip, reusing the worker's recorded native evidence above. Five-route metadata check, server/API/client typechecks and API validator pass. Published 244 operations/284 schemas: five new routes/four new schemas and additive event variant, no prior named-schema changes/removals. No current native/service/persistence run or historical inventory repair; no release or accuracy claim. Source catalogue retains originals and separately records this bounded workflow proof.

3 October 2026. Code `2e375a534faa5c596809a17a77a8f0202ad5f351`, base `fd36a4b964e2c8855c17a9169c5efe43b03f6712`, branch `task/desktop-kml-private-api`, exclusive checkout `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`. Primary staging remained read-only; latest inspected head `622c1f65bdf398d857d9197df6f2fff5c85f4eda`. [Assignment and shared-seam ownership](../../orchestration/PARALLEL_20261003.md#kml-02--private-canonical-kmlkmz-intake). Requested Sol6.1/xhigh/default-standard; actual per-turn model/effort/tier unexposed. Supplied permissions: `never` / `danger-full-access`.

Unchanged original → canonical source/job → private inspection status/native/original reads, with explicit idempotent retry and exact KMZ member selection. Uses existing cases/sources/operations, attempts/fences, private storage and outbox. Accepted jobs can have `partial` or `needs_input` inspection status; this is truthful inspection, not analytical admission. Original, selected-member and XML hashes remain distinct. Caller-declared lineage is retained separately. Outages retain originals; interrupted execution requires a new explicit job. Generic source reads delegate to KML authority; streaming/snapshot/copy/package/generic retry cannot bypass it, including malformed markers and copied ancestry. Public source projections hide private markers/parts.

## Lead registration

Lead owns these remaining integration edits; none are included in this worker commit:

1. Add `export * from './kml-ingestion';` to the opt-in `packages/contracts/src/usp/index.ts`. New files currently import the leaf contract directly. Server subpath exports already support the new service; root barrels stay lead-owned.
2. Import `KMLController` from `./kml.controller` and `KMLIngestionService` from `@ulpin/server/modules/usp/ingestion/kml` into `apps/api/src/modules/ingestion/ingestion.module.ts`; add them to controllers/providers.
3. Add the five operations below to the ingestion operation manifest with batch `KML-02`, disposition `added`, nativeController `kml`, runtimeEvidence `pending`; preserve existing entries. Republish generated OpenAPI/client, including the additive `kml-native.changed` event. Catalogue/index/ledger remain lead-owned.
4. Reconcile the concurrent DXF fusion reader to use exported `assertDXFReadTools` from `dxf-config.ts` for immutable reads. It returns void after full inventory verification; writers continue using strict `assertDXFTools`. This worker changed no fusion files.

Paths below are under `/api/v1/ingestion/cases/{caseId}`. Operation IDs match their method/path with slash/braces converted to underscores, as declared in the controller.

| Method | Path | Request | Response / status | Transport |
| --- | --- | --- | --- | --- |
| POST | `/kml` | `KMLRetainSchema multipart` | `KMLRetainReceiptSchema` / 201 | multipart-bounded; maxBodyBytes 17825792 |
| POST | `/sources/{sourceId}/kml/retries` | `KMLRequestSchema` | `KMLQueueReceiptSchema` / 202 | json |
| GET | `/sources/{sourceId}/kml/jobs/{jobId}` | null | `KMLStatusSchema` / 200 | private-bounded-read |
| GET | `/sources/{sourceId}/kml/jobs/{jobId}/native` | null | binary / 200 | private-bounded-read |
| GET | `/sources/{sourceId}/kml/original` | null | binary / 200 | private-bounded-read |

Upload fields: one unchanged `file`, UUID `requestKey`, integer `expectedCaseRevision`, JSON-string `lineage`. Initial selection is automatic. Retry requires current case/source revisions and original SHA256, with `member: null` or exact `{path, ordinal, sha256, bytes}` copied from the verified candidate inventory. Actual native output must match all four selected-member pins and XML hash. Routes reject query fields and use the existing private guard/no-store/nosniff headers.

Reuses unchanged accepted `native_kml.py`, `desktop-kml-read.py` and dependency lock. New Windows wrapper retains fixed host mutex, named kill-on-close Job/reaper and verified offline inventory; it calls accepted `run_supervised`, adding only `-B` to its exact gated child launch. One supervisor plus one parser, 2 GiB outer tree/process cap; accepted child has one-process cap, two-core affinity and 45-second deadline. Actual supervision is stored separately from unchanged native bytes; no OS thread ceiling is claimed. Limits: 16 MiB original/native, 512 KiB result/status, 256 archive members, 64 MiB expansion, 100:1 ratio, depth 64, 100k nodes/tuples and 10k features; wrapper 90 s, worker 150 s inside 180 s lease, request 45 s/read 60 s. No new dependency, SQL, queue/store, frontend or provider work.

## Checked retained inputs

Uses [the accepted Google libkml source manifest](native-kml/sources.json), revision `8609edf7c8d13ae2ddb6eac2bca7c8e49c67a5f8`, BSD-3-Clause, `test_only`. No new source acquisition or operational/learning facts. Source hashes: KML `5a97b905a05c97ca0c43e59d423fe1db66299efd9ed75d1738c422da11605dfd` (36,196 bytes); KMZ `8b3faf50d7550fcad29d635a9c951e6f179885af7117288dbca199d4e770c8ac` (652 bytes).

| Journey | Actual result | Native bytes / SHA256 |
| --- | --- | --- |
| `kmlsamples.kml` | partial; 39 features, 182 tuples, 240 unsupported entries, 30 unresolved references; KML-specification reference, accuracy unassessed | 382212 / `fca01491e2b805f48d9c9e283ed1510f18c4c439c915aeafa198c933734d803c` |
| `multikml-doc.kmz` initial | needs_input, `KML_MEMBER_SELECTION_REQUIRED`; four candidates, null document/XML | 1415 / `56da5e3ef3b190280e32eba8b6c1e167de2c77d8ced0470b46e9e99a5d94a9e5` |
| exact `doc/doc.kml` retry | partial unnamespaced fragment; one Placemark named `doc.kml`, zero coordinates/geometries, unknown reference | 2600 / `c0c85da46e05082e2938b2ca930ad834e14ce13d55ff64787aabe49c82c5ff4b` |

Selected member: ordinal 3, 44 bytes, member/XML SHA256 `727198e00328bbeaa4e7b8af4260084eb28315b26eff817297dc1bcacd2c4455`. All three native outputs are byte-identical to the accepted saved inspections, compared read-only. Enrollment/worker/status/native/original methods used actual bounded Python execution and labelled memory SQL/S3 protocol doubles; this is not current HTTP/PostgreSQL/private-storage evidence. No external references were fetched or HTML rendered; inspection does not qualify geometry, property identity, ownership, rights, accuracy or learning labels.

Checks and evidence under `E:/BhuAayam-data/task-data/desktop-kml-private-api/`:

- Configured `pnpm exec tsx --test tests/kml-authority.test.ts`: exit 0, six checks including both actual originals and member retry, replay/payload conflict, outage/privacy/access/source pins, post-I/O revocation, stale/fenced denial and generic bypass refusals. `worker-initial.txt`, three native/journey pairs in `journey-initial/`. Initial unconfigured copied byte-cap assertion failure retained in `authority-initial.txt`; corrected to exceed the actual 512 KiB cap.
- `C:/Python313/python.exe -I -S -B tests/test_kml_host_wrapper.py`: exit 0, two Windows busy/cancel checks, `host-wrapper.txt`. Actual supervisor PID 12964/parser 17320; parser handle signaled and host mutex available after kill/reaper, before scratch removal. Built-in ctypes only.
- `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test tests/kml-nest-routes.test.ts`: exit 0, five leaf routes/guard/schema/private headers/query refusal, without listener/generated writes, `nest-routes-final.txt`. Initial production-document check correctly refused unregistered operations; `nest-routes.txt` preserved.
- `pnpm typecheck:backend`: server/API exit 0, `backend-typecheck.txt`; staged `git diff --cached --check`: exit 0.
- Initial compatibility plus affected DXF/IFC controls: 12 pass/one explicit native skip/one IFC inventory denial in `compatibility.txt`. Current shared runtime is missing 87 `.pyc` files recorded in the retained IFC inventory; no added/changed files, no cache reset/repair. Exact difference retained in `ifc-inventory-drift.json`. Fresh separate `ifc-read-inventory-current.json` (4,743 files; SHA256 `c0b33b9f8dd91914ec9c4f9b7f7e15e677a81287b6135741ce40783fdc60c63a`) supports configured `pnpm exec tsx --test tests/kml-read-compatibility.test.ts`: exit 0, all six controls, `compatibility-current.txt`. No IFC/DXF parser ran. This checks historical-code policy with exact current non-code pins. The retained inventory remains stale; saved results requiring that exact profile remain unavailable. No historical profile was replaced.

## Fingerprints and limits

Historical compatibility adds only independently reconstructed `fd36a4b9` Git/LF and captured physical IFC/DXF/semantic/MVT aggregates. Every non-code pin remains exact; complete current IFC/DXF inventory is required before immutable read comparison. Stored inputs/seals stay unchanged; writer claim/process/adoption, semantic preparation/publication, MVT compilation/recovery remain strict. Earlier accepted compatibility entries remain. CityJSON validator gets no exception: its old producer pins remain historical/stale after the shared jobs change.

Full old constituents: `baseline.json`; complete final 23-file physical/Git and six aggregate constituents: `final-pins.json`, SHA256 `2a5697b10265e0e731ee3c4569d100a42baf19b5aefd3cc8cab7853a49ffd2a9`. The receipt verifies normalized physical text equals committed code, originals/accepted reader/lock are unchanged, native output equality, and all three journeys used the final physical KML code aggregate.

| Aggregate | Pre-KML physical / Git-LF | Final physical / Git-LF |
| --- | --- | --- |
| IFC | `3bd4f09e8a4bdfd2963e2e6c0ff735cdb423c3405e06694755f1f017bb585ac0` / `a441e6ac5d3947e4f267e63494685fada870384c6850c8c205dc8870ea0b68c8` | `06bc6b13fcaae405d4d1390a8a13703f716d05ac3aa2f152679f8047927ae519` / `18a0bc3c1f01fffd338e122b3d028f438dd2f7459377e228a9ae1a94c33e93ed` |
| DXF | `1c00e8bbbac697ff41d71ebf6f81f0b4b18ad31aba005c9724d5ce01d2f95388` / `6d52384008e5aad896ec16defc76c607c905ca8e644fbb2661fd34c8285efa5c` | `0f16979a1d9206f99d2e99358932e6f50183a517ef3efd2a0b8f6e0b53b6795f` / `dbcfe71ae8bac243f6c3aa1b1f549b54b43535aa6c68fa743bdd552f8f897c46` |
| Semantic | `c32495d23f7df31384bc0ee83dea1481b34f9d1cbe92b8dbf2f32a99394e67cc` / `aefcce46f18502786d2cc4c15ce0a306ec765045c5039afe78e5500866d19e3e` | `fd4ab52af946b2be387e3619faf7003657ebe666a111ede66f03f5170bf19252` / `35c11ba89f22268f858c11599ac930f88fa3af2c6e5f2d51bf6a2b9dda240d24` |
| MVT | `41bcb3aae67bc7b3c88016a8053db7747f469fc8d1c570157f8d6adf7bd06019` / `3cf0b3859a113d4ba24f708d1fa8fa9aad124ac45fd0d21ec69f953e213fb358` | `b635803489804a2da5778a3dc3dbbfb31f3bab15dd8baf04c204d5e5f5034654` / `8e50f24dff2f78fe6681b76667dc29ec727c9ac377329886fe29a4807aafd532` |
| CityJSON validator | `286d29a1247eb945c0ddf0f7dbdda5125df8b5ae3e6cc4cfc120e9aab7625229` / `9df65cca9b979517fba9ffdebe237d8b57acb2971e1e5e13faf05be86411dab1` | `3e4382129163aa78850d809eb5587ab8ef1df6270ad97fdf43feede1d2b052ab` / `b1b1abc1c513f6e3511c47e4d4554a9f3b7bce0aae9fa31fb16b96f84b8cb0f5` |
| New KML | — | `c41f64137609c74fd2f8f04247df9b8d49fa84d34bc2c780b39ba9c72f80cf13` / `fabb23dcf90b0a0f5af81a258538f3202c56260ddc2a92d8a23cb3b6375b885d` |

Runtime pins: Python `d932e5e2f324d57f392e8fd063dcf6d0185be8a664c57c6d24e7762ed02c28ca`; reader `ee9de4e98d6b8ee99e90c4b2ef10763e9d55191c6b43d895f537535f6ab3ae19`; supervisor `8278b557b2caed708c3e7468c2fa89459ed72252a1d801cdac20e2683ade3f89`; lock `c56239b64b7dfa0c3c3133a30ab1f2d6009d33bffecf1056d590e11fdd24a489`; profile `8787803a92e6fb0fdd26a2b7fc8befa4cd308588a1ee1cb40b6e9d39c1e3efe7` (`profile-initial.json`, 3,412 files).

Command-local configuration: `ULPIN_KML_PROFILE` / `ULPIN_KML_PROFILE_SHA256`; configured tests also use `ULPIN_KML_LOCAL_PROCESS=1` / fresh `ULPIN_KML_PROOF_DIR`. Integrated checkout needs a fresh profile/current code pins before runtime execution; never repoint or overwrite retained evidence. Current HTTP/persistence, authentic applicability/accuracy/learning, scale and GF release gates remain unqualified. No shared services/Docker, database/migrations, providers/model/GPU, source acquisition, frontend, push/deploy or public activation. Owned processes exited, private KML scratch empty; worktree clean after code/handoff commits.
