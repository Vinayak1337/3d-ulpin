# OBJ-HTTP-01 — canonical private OBJ runtime

Two retained TinyObjLoader originals now pass normal production OBJ HTTP intake → exact `runObjJob(jobId)` → private status/native/original reads on the populated isolated runtime. Production API, OBJ and native-reader code remained read-only. This qualifies the HTTP/persistence bridge with a fresh current-checkout profile; accepted reader tests were not repeated.

Exclusive branch `task/desktop-obj-http`, worktree `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`, assigned base `5cc9892f2228f98deea0323bb178a4fff8106fde`. Completed citation branch `task/desktop-reviewed-gltf-citations@2333cf05` is preserved. Helper commit `c3d15c50838fe2b72ca3467b46e09ef7c80039b9`; recovery correction `54b259af25736b804f17143d584538f63fb265c3`. Staging stayed read-only. Requested Sol6.1/xhigh/default-standard1×; actual per-turn model/effort/tier unexposed. Supplied permissions: never/danger-full-access.

## Reusable helper and actual runtime

`scripts/usp/desktop-obj-http-runtime.mjs` provides scoped startup/run-one/stop. Use a fresh existing directory outside Git with inherited access removed and access restricted to the current operator, Administrators and SYSTEM:

```powershell
node --import tsx scripts/usp/desktop-obj-http-runtime.mjs start <retained-prefix> <fresh-private-state>
node --import tsx scripts/usp/desktop-obj-http-runtime.mjs run-one <retained-prefix> <private-state> no_material.obj
node --import tsx scripts/usp/desktop-obj-http-runtime.mjs run-one <retained-prefix> <private-state> missing_material_file.obj
node --import tsx scripts/usp/desktop-obj-http-runtime.mjs stop <retained-prefix> <private-state>
```

Retained prefix: `E:/BhuAayam-data/runtime/prefix-worker-20260929`, project `ulpin-usptest-b050544f3d2cb99e`. Startup checked current processes/ports, private credentials/operator SID, exact storage labels/mounts/loopback bindings, eight profile-file hashes and available memory (~17 GiB free). Actual Docker Engine29.8.0/linux had24 stopped containers/14 volumes. Only its existing PostgreSQL/MinIO/Redis containers started; no full-prefix dispatcher startup, engine recovery, rebuilding or recreation occurred.

The accepted CPython3.13.7 profile generator produced fresh private lock/profile, retaining old locks/results. Profile SHA256 `0c3e8b3c8fcb6e38cc8e35dc7ab3e4bdc9a43e2e11b726c2a5d4ff7059b8301b`; full physical/Git-LF code, reader, native-lock and runtime pins are in the private receipt. Only process environment selected it. Hidden API PID8872 served `127.0.0.1:3192`; its launch head was the initial helper commit. Worker execution used the correction commit, differing only in this helper; production/native/profile identities stayed unchanged.

Local Windows process attribution/current private access plus Host/Origin/Sec-Fetch guards apply. This is not a human-login authentication qualification. Unrelated/non-OBJ/nonqueued jobs and stale source/case/tool pins are refused before worker invocation. Each original has one retained request key and one canonical job; no scan or generic queue drain occurs.

## Actual journeys and preservation

[Source manifest](native-obj/sources.json) remains the original/URL/revision/attribution/permission authority: TinyObjLoader revision `45636bdcef1a4fec140346b90c0b50bf0bc3e23b`, family `tinyobjloader-cornell-box-graphics-test-only`. Unchanged2142/2294-byte originals retain their recorded SHA256s and caller-declared lineage. Repository MIT/header attribution does not independently qualify original Intel Embree asset permissions.

One new research case `b55c19eb-fa7e-484a-a92f-32848b0e7ed2`, with unassigned frame and explicit test_only/unknown geography, was created through `POST /api/v1/cases`.

| Original | Canonical source / job | HTTP outcome |
| --- | --- | --- |
| `no_material.obj` | `485c39f3-81f9-4c58-b5b4-12c768b721a8` / `ec2a97fb-1d56-49a3-a06c-057287290293`, case revision1 | upload201; status/native/original200; completed,76 vertices/18 original polygons/72 references, zero missing companions |
| `missing_material_file.obj` | `c47d3ae4-92b2-496d-9479-314fe3a0f8fa` / `b6613a85-710a-4fc8-b55c-2c5d2b12e9e1`, case revision2 | upload201; status/native/original200; partial, same polygon population,10 unresolved material declarations |

All source revisions are1. Exact original bytes and native hash/size response headers passed; native artifacts match the accepted129927/138294-byte hashes. Result SHA256s are `e3ea77478329b73926ea001ec3e5314f14369c7af5544053df45c02c79f3f0a3` and `ddcbe1392cb69279ed04d0f6e785562fede26444f26e3f64eaf72152b111e9cc`. Accepted fence/current input/result/tool authority was checked through actual SQL/private storage.

Cross-site native read returned403. Exact execution of an unrelated prior document job exited1 before worker invocation. After the second upload advanced the shared case, the first status explicitly returned stale200/result-null, its native read refused409, and its unchanged original remained200. No refresh/retry or additional write was made.

Read-only snapshots of all public tables preserve every prior row, including mappings, streamed generations, sources/jobs/attempts/metadata, registry/reviews and outbox. Authorized additions only: case41→42, sources38→40, jobs/attempts/metadata79→81, operations143→145, outbox2549→2557 and streams106→109. Pending jobs0. No prior case/source/original/reference/history row changed.

Native512MiB/45seconds/one child and separate host1GiB/75seconds/two-process bounds remained unchanged. Native observed0.055751/0.056353s, peaks26042368/26083328 bytes; host observed2.689473/2.854770s, peaks49324032/49754112 bytes. No Node/API memory, OS-thread or general egress-ceiling claim follows. Units/axes/CRS/height/placement stay unknown; materials remain unfetched. No measurements, property identity, analytical geometry, rights, accuracy, learning or release qualification follows from graphics context.

## Recovery, proof and cleanup

Initial `run-one` exited1 after caseHTTP201 because the private helper used `case.json` for both HTTP response and case record. No OBJ source/job existed. Correction separated `case-response.json`/`case-record.json`. Bounded `continue-helper` verified that only the owned helper changed, the original API identity still matched, the exact HTTP-created case existed with revision0/no sources, and it was absent from the baseline. It preserved the failed receipt and reused that case; no duplicate enrollment or API/native-code rebinding occurred.

Syntax/whitespace, start, bounded recovery, both corrected journeys, final stale/original reads, preservation and stop exited0; initial helper collision and expected unrelated refusal exited1. No new parser/typecheck matrix was needed for this standalone MJS helper. Private proof `E:/BhuAayam-data/task-data/obj-http-20261004-run01/verification.json`: **41917 bytes**, SHA256 **`c36e0ab1ae5e8b52564970dbe840b0bd1c06f4c66d0e6d079da31d057c116f3e`**; links commands, failures, HTTP/SQL/object/code/runtime/source/result pins and cleanup.

Identity-checked cleanup stopped API8872 and exactly the three task-started storage IDs. API3192 listener absent; native PIDs47500/30456 absent and private scratch empty. All24 container IDs/14 volume names/eight profile files and original source hashes remain unchanged. Engine left available. No dependencies, migrations, `.env`/credential/original/history rewrite, provider/GPU/ML, frontend, push/main/deploy, polling or schedules. Catalogue/API publication remains lead-owned.
