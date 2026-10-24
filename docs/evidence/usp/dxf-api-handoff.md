# DXF-02 — private canonical drawing intake

Lead integration, 2 October: code/handoff accepted on staging as `502de89c` / `e4572b3e`. Integrated authority/immutable-read controls: 10 pass, two expected configured-runtime skips; Nest route check: one pass covering all five routes; backend/client typechecks and `python scripts/api/check.py`: exit 0. Worker native evidence above is reused, not presented as fresh staging execution. Published OpenAPI/client: 237 operations / 279 schemas, five new DXF operations, three new schemas and the additive existing event-route variant; no removed operations/schemas or changed prior named schemas. Existing opt-in USP export is sufficient. Source catalogue/index record the controlled local workflow while retaining runtimeVerified=false and the original inspection history.

2 October 2026. Code `1d5893d31bc26a591d508269f8b9b95aa1927ca4`, base `cfc679fdc326865c33b645f0a0b6bd61dc9caf96`, branch `task/desktop-dxf-private-api`, exclusive checkout `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`. Staging remained read-only; its latest inspected head was `b7196674f65b2154dd2fbf2406690bbe7ba3b314`. Scope and shared read-fingerprint decision: [DXF-02 assignment](../../orchestration/PARALLEL_20261002C.md#dxf-02--private-canonical-drawing-intake). Requested Sol6.1/xhigh/default-standard; actual per-turn model/effort/tier unexposed. Supplied permissions were `never` / `danger-full-access`.

Five private guarded Nest routes deliver unchanged multipart receipt → canonical job → accepted native inspection → exact status/native/original reads, with explicit idempotent retry. Reuses cases/sources/operations, canonical attempts/fences, private storage and transactional outbox. Caller-declared lineage stays separate from source facts. Tool outages retain originals and report recoverable failure; interrupted jobs require a new explicit job. Generic original reads delegate to DXF authority; streaming/snapshot/copy/package routes cannot bypass it, including malformed markers and copied ancestry. Public source projections hide private lineage/accepted metadata/parts.

| Method | Path under `/api/v1/ingestion/cases/{caseId}` |
| --- | --- |
| POST | `/dxf` |
| POST | `/sources/{sourceId}/dxf/retries` |
| GET | `/sources/{sourceId}/dxf/jobs/{jobId}` |
| GET | `/sources/{sourceId}/dxf/jobs/{jobId}/native` |
| GET | `/sources/{sourceId}/dxf/original` |

Registration, operation manifest and opt-in USP export are included. Lead owns root barrel and generated OpenAPI/client publication. No dependencies, SQL, second queue/registry, frontend or provider changes. Current case/archive/access/source-family/context/reader/tool/attempt pins are checked around object I/O and before adoption; staged bytes are read back. Ambiguous COMMIT preserves authority. Result/status stay bounded and private, with no query paths or executable URLs.

Reuses unchanged accepted `native_dxf.inspect_dxf` and its 45-second parser/memory guard. The DXF-only wrapper adapts the existing Windows fixed-mutex, named kill-on-close Job, sanitized offline inventory and reaper design. One supervisor plus one parser, 2 GiB tree/process ceiling; 16 MiB original/artifact, 100k records, 10k projected entities, 500k tags and 100k coordinate starts. Wrapper ceiling 90 s; total worker 150 s within the existing 180 s lease; multipart 17 MiB; request 45 s and private read 60 s. Profile verification inventories 6,165 files. No runtime environment was installed or modified.

Supported scope remains source-local ASCII DXF R12–R2018 inspection: literal tags/locators/units and absence. DWG/binary DXF, external references, block explosion, geometry validity, global placement, room/floor/unit inference, ownership and qualified training facts remain unsupported. Source-native findings are not operational records or analytic admission.

## Checked result

Both unchanged retained `test_only` MIT ezdxf v1.4.3 samples run through actual enrollment/worker/parser/status/native/original methods. SQL and S3 are memory protocol doubles, not current PostgreSQL/object persistence or HTTP evidence. Origin/revision/licence and original receipts remain in [the accepted manifest](native-dxf/manifest.json); no source acquisition or operational facts were created.

| Original | Source SHA256 | Native artifact bytes / SHA256 | Units |
| --- | --- | --- | --- |
| `1_polylines.dxf` | `37f57491672a9b330be08888200a8ad893d15af52af91e1c6be54b0c9cda75de` | 249680 / `1d26c542913cbd51dd35286fb04a0529acca96677e50f943924c4fd73304e285` | declared, code 6, m |
| `ASCII_R12.dxf` | `b476d3e53fe24c1db3c701d20b2bebd774f7bd7966b12d81891505b9b29e4d21` | 29589 / `e926344244e4a73c6f6fcac93991fb8cd6883473ea88ecdca364eb5ac8d76166` | absent; INSERT scale/rotation absent |

First native journey exposed an overly strict summary-unit projection; corrected without changing originals/reader. The failed log is preserved. Artifact hashes include native observed-time metadata and are receipts for these invocations, not a deterministic-hash promise.

Actual checks and logs under `E:/BhuAayam-data/task-data/desktop-dxf-private-api/`:

- `pnpm exec tsx --test tests/dxf-authority.test.ts`: five authority/outage/retry/privacy/fence controls pass; first configured journey failed as recorded in `journey-initial.txt`. The corrected configured journey (`--test-name-pattern='retained declared-unit'`, same file) exits 0 for both originals in `journey-corrected.txt`; each has native bytes and a method-level receipt under `journey-corrected/`.
- Bundled Python `-B tests/test_dxf_host_wrapper.py`: exit 0, two actual Windows busy/cancel checks in `host-controls-native.txt`. Observed parser PID 38580, supervisor 39872; parser exit and mutex availability verified before scratch removal. Initial unavailable test-runner `psutil` import is retained in `host-controls.txt`; the control now uses built-in Windows APIs without adding a dependency.
- `pnpm exec tsx --test tests/dxf-read-compatibility.test.ts tests/ifc-read-compatibility.test.ts tests/source-fusion-ifc.test.ts tests/ifc-authority.test.ts`: exit 0, 14 pass, two explicit configured checks skipped, in `compatibility-initial.txt`. Configured IFC immutable-read control then exits 0 in `ifc-current-inventory-control.txt`: actual complete inventory, old-code read/fusion reachability, strict writer rejection, unknown/non-code mismatch denial. No IFC parser ran. Fresh read-only inventory evidence is separate; retained profiles remain unchanged.
- `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test tests/dxf-nest-routes.test.ts`: exit 0, five native/private registered routes checked without listener/generated writes, `nest-routes-final.txt`.
- `pnpm typecheck:backend`: server/API exit 0, `backend-typecheck.txt`. Staged `git diff --cached --check` exits 0.

## Immutable read compatibility and pins

Only independently reconstructed pre-DXF Git/LF and actual physical aggregates enter semantic/MVT read allowlists. SQL retains its exact bytes under Git attributes; an all-CRLF reconstruction is not accepted. IFC status/artifact/fusion use a distinct assertion that first verifies the complete current runtime inventory, then compares every non-code pin exactly. It returns no launch configuration. Stored inputs/digests stay unchanged; claim/process/adoption, semantic preparation/sealing/publication and MVT compilation/recovery remain strict. Existing older approvals retain their behavior.

Final complete 26-file physical/Git and aggregate evidence: `final-pins.json`, SHA256 `a997785c08999956a1411729ffb6351bd2f4a56918043790f681fb04386942b1`. It asserts both actual DXF journeys used the final physical DXF code aggregate and verifies normalized physical text equals committed code. Historical exact constituent evidence is retained in `baseline-constituents-v2.json`; only its Git/LF and physical-base representations are adopted.

| Aggregate | Final physical | Final Git/LF |
| --- | --- | --- |
| DXF | `1c00e8bbbac697ff41d71ebf6f81f0b4b18ad31aba005c9724d5ce01d2f95388` | `6d52384008e5aad896ec16defc76c607c905ca8e644fbb2661fd34c8285efa5c` |
| IFC | `3bd4f09e8a4bdfd2963e2e6c0ff735cdb423c3405e06694755f1f017bb585ac0` | `a441e6ac5d3947e4f267e63494685fada870384c6850c8c205dc8870ea0b68c8` |
| Semantic | `c32495d23f7df31384bc0ee83dea1481b34f9d1cbe92b8dbf2f32a99394e67cc` | `aefcce46f18502786d2cc4c15ce0a306ec765045c5039afe78e5500866d19e3e` |
| MVT | `41bcb3aae67bc7b3c88016a8053db7747f469fc8d1c570157f8d6adf7bd06019` | `3cf0b3859a113d4ba24f708d1fa8fa9aad124ac45fd0d21ec69f953e213fb358` |
| CityJSON validator | `286d29a1247eb945c0ddf0f7dbdda5125df8b5ae3e6cc4cfc120e9aab7625229` | `9df65cca9b979517fba9ffdebe237d8b57acb2971e1e5e13faf05be86411dab1` |

CityJSON validity stays strict: the shared jobs change makes old explicit validation producer pins historical/stale; no exception or validation rerun. Full pre-DXF IFC/semantic/MVT and validator constituent pins are in the receipt. Runtime DXF pins: Python `d932e5e2f324d57f392e8fd063dcf6d0185be8a664c57c6d24e7762ed02c28ca`; reader `6fa14e9f9d21d9068d47461d8dff574eb8416a5af104cc704dcbe582579a777b`; supervisor `0c2ad27b5219234b06940d2fc4acb1c775d19ca65b5032e9d9b9733e796d80ed`; lock `bca1431381ad18e43fa7ed6bd289735b449997d9a21758e0813815595a184721`; profile `a36c1d5d5fa25a306c8fa564a2c77654bb066b7092a4e119ad5304971b857812` (`profile-initial.json`).

Configuration is command-local `ULPIN_DXF_PROFILE`/`ULPIN_DXF_PROFILE_SHA256`; tests additionally use `ULPIN_DXF_LOCAL_PROCESS=1`/`ULPIN_DXF_PROOF_DIR`. Integrated checkout needs its own fresh profile and current code pins before a runtime assignment; never repoint or overwrite this retained evidence. Current HTTP/PostgreSQL/private persistence, authentic property/accuracy/learning, scale and release gates remain unqualified. No services, Docker, model/GPU/provider calls, deployment or push ran. Owned temporary processes exited and both private scratch roots are empty; worktree is clean after code/handoff commits.
