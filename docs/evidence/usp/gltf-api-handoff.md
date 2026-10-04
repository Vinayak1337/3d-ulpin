# GLTF-02 — canonical private native intake, 4 October 2026

**Owned intake/worker/controller code is delivered; the bounded canonical producer/consumer check passed with actual native execution and disclosed SQL/storage doubles.** No live HTTP/database/object persistence is qualified. Lead still owns root exports, service/controller module registration, operation/generated API/client/catalogue publication and existing-reader immutable-read compatibility.

Exclusive checkout `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`, branch `task/desktop-gltf-api`, assigned base `0311fa0839fdc8d60cc60d568463e9de1069e7c2`. Leaves `827dc9e3`, transferred six shared guards/dispatcher changes `e31b66a8`, focused check/execution head `1c6abd4a`. Finished document HTTP branch/receipts remain intact; staging stayed read-only. Requested Sol6.1/xhigh/default-standard1×, supplied never/danger-full-access; actual model/effort/tier unexposed.

## Delivered behavior

Private `GltfIngestionService` retains unchanged bounded bytes and caller-declared provenance, registers one existing canonical job/attempt/metadata authority, and supports explicit idempotent retry with current source/case/access and optional scene index. Absent scene selection remains absent/source-declared; no scene is guessed. Worker checks source bytes/hash, current reader/profile/config/code, exact input digest, lease/fence and staged result/artifact before acceptance. Status/artifact reads recapture current access/input/accepted result after object I/O. Original reads remain useful without a reader runtime and verify immutable bytes/current source access. Partial inspection is an accepted recoverable result, not a geometry/identity promotion.

New controller operations, awaiting lead registration:

| Method | Path under `/api/v1/ingestion/cases/{caseId}` | Result |
| --- | --- | --- |
| POST | `/gltf` | Multipart unchanged original, requestKey, case revision, JSON lineage; optional sceneIndex;201 receipt |
| POST | `/sources/{sourceId}/gltf/retries` | Current revision/hash/access, optional sceneIndex;202 exact job receipt |
| GET | `/sources/{sourceId}/gltf/jobs/{jobId}` | Bounded private current status/summary |
| GET | `/sources/{sourceId}/gltf/jobs/{jobId}/native` | Exact accepted source-native JSON artifact/hash |
| GET | `/sources/{sourceId}/gltf/original` | Exact unchanged original/hash |

Controllers refuse undeclared query/multipart fields and use the existing private guard, no-store/nosniff headers. Shared additions register typed `gltf-native` input, a dedicated dispatcher slot and `gltf-native.changed` including partial. General originals route through canonical authority; streamed legacy/snapshot/copy/generic retry paths cannot bypass glTF protection. Profile `gltf-native-v1` or an own `gltfOriginal` marker—including null/malformed—activates protection on captured/current rows. General source projection strips private glTF receipts/reference parts. Existing lock order and other operation branches are preserved.

## Runtime and actual verification

New `scripts/usp/gltf/profile.py` pins an existing interpreter/environment/current checkout; it installs nothing and never repoints the historical lock. `server.py` adapts the accepted CityGML mutex/tree ownership and invokes the complete unchanged `desktop-gltf-read.py` CLI/`native_gltf.py`. It adds only no-bytecode-write child startup, controlled receipt transport and profile checks. CLI source locking, import gate, one native process,45-second/2GiB Job bounds, exact spans/declarations and external-resource refusal stay unchanged. Supervisor tree has a separate two-process ceiling (wrapper plus native child), kill-on-exit and the same2GiB aggregate ceiling; no OS thread/egress ceiling claim. Node wrapper has75-second outer timeout, worker150 seconds within the existing180-second lease. Originals/artifacts16MiB, finite source/history/response budgets and host mutex remain explicit.

Fresh private profile `E:/BhuAayam-data/task-data/gltf-api-20261004-run01/profile.json`:2526 files,489048 bytes, SHA256 `8a73626b057d69c717d091b1a8249255dbeb8d5062325c60cb87f743b77d48ba`. Uses retained CPython3.13.7 base `C:/Python313/python.exe` and the existing small glTF environment; new scratch is private under that run root. Measured admission:291,912,302,592 bytes free on E: and16,760,918,016 bytes free RAM. No data relocation, large runtime copy, Docker/API/dispatcher services, live populated writes or ML/GPU work.

Both unchanged [Box originals and attribution](native-gltf/sources.json) were reused: copyright2017 Cesium, KhronosGroup revision `f36bfdabd1031c3cf6689a50570b8cdf3678b49c`, CC BY4.0, graphics test_only. No `Box0.bin` acquisition/fetch.

| Actual canonical bridge input | Result |
| --- | --- |
| Box.glb,1664 bytes, SHA256 `ed52f7192b8311d700ac0ce80644e3852cd01537e4d62241b9acba023da3d54e` | completed;2 nodes/1 primitive/24 positions/36 indices;5775-byte artifact SHA256 `3640eeb9cdeb91cef30caa9af3e94f89fddaf6000e2c685ebac250d8d0329ebe`; native Job peak25,481,216 bytes/time0.046597s |
| Box.gltf,2898 bytes, SHA256 `4a0d69eecfce0672a50b71dc218cbacec6c53fe2445040c235c6314b1b2c41b9` | partial; hierarchy retained, external buffer needs_input/unfetched,0 projected positions/indices;4532-byte artifact SHA256 `992c6ad19fb4c4e7efc23a5cd24babde2cde3acb7889a71ff30fcd2af553a8bb`; peak25,587,712 bytes/time0.045743s |

Exactly one actual supervisor/reader invocation per format. Whole artifacts match retained reader output byte-for-byte. Canonical retain/status/artifact/original/replay and supported retry enqueue passed; replay causes no additional object write. Fresh retry jobs stayed in controlled memory and were not executed. Post-I/O revocation, stale case, wrong accepted fence, changed artifact hash and protected legacy snapshot/copy/retry refused; denied requests added no writes. Test UUIDs are technical envelopes, not real operational identities. Scratch empty, both native PIDs absent; no owned service remains. Source bytes, historical reader/CLI/locks and prior receipts are preserved.

`pnpm typecheck:backend`, Python source compile, fresh profile admission, `node --import tsx --test tests/gltf-ingestion.test.ts` (one check, zero skips) and whitespace checks exited0. Reproduction requires `ULPIN_GLTF_PROFILE`, its exact `ULPIN_GLTF_PROFILE_SHA256`, `ULPIN_GLTF_LOCAL_PROCESS=1` and retained source root; optional `ULPIN_GLTF_PROOF_ROOT` must be a fresh private directory because receipts refuse overwrite. No repeat reader campaign was run.

Private verification `E:/BhuAayam-data/task-data/gltf-api-20261004-run01/verification.json`:15571 bytes, SHA256 `7e745251f11e42eb63852137d6133f36b39b53f70a54a23c58d10ac8cbdc5f52`. Pins code/runtime/source/result/artifact/supervision/cleanup and prior reader proof. Current combined reader identity is `aec092270367ee5eefe9464e310978cfe84c2e3f0c5aa373cc4484e963b78255`; accepted code aggregate `a50cf2e380ad19770783ce9708ff76e10d90f68ab00962706b3a579dbfa060a2` remains physical/execution-specific.

## Integration limits

Adding the typed branch in `jobs.ts` changes existing IFC/DXF/KML/CityGML/GeoParquet code aggregates. `read-compatibility-inputs.json` retains reconstructed assigned-base Git/LF constituents separately from actually observed current worker/lead-checkout physical bytes. No before-change worker physical snapshot is claimed. Only `jobs.ts` differs in those constituent sets; non-code/runtime/profile/reader/supervisor guards remain unchanged. Lead owns exact immutable-read compatibility publication, strict writers and final integration hashes; do not rewrite historical receipts or rerun those readers.

All outputs are `context_mesh`, global placement unknown, no composed world transform, building/floor/property identity, measurements, rights/accuracy/learning/registry promotion. Thin controller wiring and live persistence remain unqualified pending lead publication/separately assigned runtime. No accepted-reader edit, source discovery, dependency/migration/frontend/credential/original change, provider call, push/main/deploy or polling schedule.
