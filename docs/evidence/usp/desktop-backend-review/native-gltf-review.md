# GLTF-01-R — bounded context reader review

## Decision and scope

**One actionable P2 finding. Return index validation to the implementation owner before accepting the usable projection path.** No other actionable finding was established within the assigned local source-inspection profile.

- Dispatch: `8c50f88e1adcf123ee0f5d885f087ad62ca9534f` (`GLTF_01_REVIEW.md`).
- Base: `f687cd29d17925f5893d7d1cddcfe31d30300177`.
- Candidate code: `f0a7f0d8439690d3e93f0153317e1741eb45d158`; handoff: `7ef7db547bdd9175db52537d73ac43d606139129`.
- Reviewed the complete seven-file delta, saved seven test groups/two unchanged-file CLI runs, source attribution, runtime lock, binary spans, hierarchy/default semantics, unsupported profiles, URI non-resolution and Windows source/process/publication boundaries.
- Reviewer checkout: `C:/Users/kvina/.codex/worktrees/point-review/3d-ulpin`, branch `task/desktop-gltf-context-audit`. Production files were not edited. Completed PDF/IFC reviews remain closed.

## [P2] Reject the reserved maximum value for each unsigned index component

**Location:** `services/geo/geo/native_gltf.py:522–523` (candidate code above).

The index check only rejects values at or above the POSITION count. glTF 2.0 also prohibits the maximum value of the index component type: 255 for UNSIGNED_BYTE, 65535 for UNSIGNED_SHORT and 4294967295 for UNSIGNED_INT. These values are reserved for primitive restart. With 256 positions, an unsigned-byte index of 255 passes the current check and the primitive becomes `available_local_projection`; the overall result claims `inspected_local` and geometry `available`. The same missing check is reachable for unsigned-short indices within the 100,000-position budget. This concerns the assigned invalid-index/original-topology boundary, without requiring general glTF conformance or a renderer.

Reject the component's reserved maximum, or explicitly withhold usable projection, independently of the POSITION count. Add a targeted regression for this case while retaining the existing ordinary index-range check.

### Single targeted reproduction

Private root: `E:/BhuAayam-data/task-data/desktop-gltf-review/`. `prepare_reserved_index.py` preserves the unchanged Box original and creates one separately labelled adverse mutation: repeat its coordinate tuples to 256 positions, omit NORMAL, and use unsigned-byte triangle indices `[0, 1, 255]`. Original hierarchy/material declarations remain. This is parser test data, with no operational or accuracy qualification.

```powershell
& 'E:/BhuAayam-data/task-data/desktop-gltf-native/env/Scripts/python.exe' -I 'C:/Users/kvina/.codex/worktrees/point-review/3d-ulpin/scripts/usp/desktop-gltf-read.py' 'E:/BhuAayam-data/task-data/desktop-gltf-review/reserved-index-255.glb' --expected-sha256 cea62fcd4c8a06037c7080f9dde3769a18132493361ee89e6c5766b359903bc7 --output-dir 'E:/BhuAayam-data/task-data/desktop-gltf-review/reserved-index-result'
```

Actual exit **0**, empty stderr, 256 projected positions/3 indices, `inspected_local`, `geometryProjectionStatus=available`. The saved primitive is `available_local_projection` with indices `[0,1,255]`. The input is 3,960 bytes; SHA-256 is the command's expected hash. Fresh outputs were published once; any rerun must choose another output directory.

- `reserved-index-result/gltf.json`: 9,129 bytes; SHA-256 `bc1d305e7d4ce28aa5bb4691ae4e6ba0ecafc1e1c607e750eb624cd1c8cc0796`.
- `reserved-index-result/receipt.json`: 1,691 bytes; SHA-256 `6570ae1e1c4d3799e453e33934c929aec97b7b496f62f08f0245b9ae6a2baddf`.
- `reserved-index-provenance.json` and `reserved-index-observation.json` retain mutation lineage, exact command/exit, output/source/code pins and observed controls. The bounded child reported 27,222,016 peak Job private bytes and 0.056859 supervised seconds; it exited. The original Box.glb hash remained unchanged.

## Evidence reconciliation

Read-only `C:/Python313/python.exe -I -S E:/BhuAayam-data/task-data/desktop-gltf-review/reconcile.py` exited **0**. It did not execute the reader or rerun tests. Its `reconciliation.json` is 9,879 bytes, SHA-256 `497d929842aee5b377b346c5977aeb6c11e3645fa8977bebd23dc0d704bfc3f3`.

It matched the primary verification receipt (12,487 bytes; SHA-256 `1e35b19a59ca2d0da1d3808ac3c76d9d93c532455c5cc6b89e4038acb2db6f4d`), repository/private manifest contents, saved check records, five source/metadata pins, seven evidence artifacts, fourteen runtime/wheel pins, four code files and the reused supervisor-origin fingerprints. Saved verification reports compile/check execution and seven tests at exit 0; both unchanged-file CLI commands also exited 0. Those runs were reused, not repeated.

Independent `struct` reads of the unchanged 1,664-byte Box.glb matched **every** saved POSITION/index value and these exact original-file spans:

| Role | Accessor | Original offset | Decoded offset | Span / stride | Values |
| --- | --- | ---: | ---: | --- | ---: |
| POSITION | `/accessors/2` | 1304 | 288 | 288 / 12 bytes | 24 |
| indices | `/accessors/0` | 1592 | 576 | 72 / 2 bytes | 36 |

Both referenced-span hashes and the buffer hash matched. Source scene/root/node declarations matched; absent node transforms stayed absent with defaults separately labelled. The saved Box.gltf result preserves `Box0.bin` as unfetched `needs_input`, with zero positions/indices. Its companion remains unacquired.

The producer's three new code files match Git bytes. This reviewer checkout materializes those files as CRLF, so the targeted run truthfully has different physical hashes: reader `8fb6b2c4800ef21c129126b37c4e7cdcd8a1dce398b780645d3ea7db852fb3f0`, CLI `95e9301d3178438a26333ef28ee8ca1282779fe968b889c092a8cd7b81fcb0ba`. `record_observation.py` exited **0** after verifying the only byte differences are LF/CRLF and matching the run receipt to the actual physical files. The unchanged initializer likewise retains its recorded physical/Git distinction. No source file, original receipt or historical fingerprint was normalized or overwritten.

## Controls and limitations

Static review and saved controls support bounded GLB/JSON decoding, aggregate buffer/output limits, finite supported accessor values, exact offsets/strides, absence/default separation, required-extension/sparse/morph restrictions, no external resolution, gated import, original write/delete exclusion, fresh exclusive output and refusal cleanup. Saved Windows tests exercise timeout, memory/process rejection, failed attachment, source locking, wrong hash and existing output. These checks do not cure the index finding above.

The observed profile is Windows only: one active Job process, 2 GiB process/job memory, kill-on-close and a 45-second parent deadline; bounded logs and compute-pool environment settings are present. There is **no OS thread ceiling**. CPython 3.13.7 uses the base interpreter child with `-I -S`; the evaluated pygltflib wheel is not installed.

Inputs remain attributed Khronos/Cesium Box graphics examples at revision `f36bfdabd1031c3cf6689a50570b8cdf3678b49c`, copyright 2017 Cesium, CC BY 4.0, `test_only`, with unknown geography/global placement. No transform composition, format-wide conformance, rendering, measurement, identity, API persistence, operational accuracy, learning, scale or release gate is qualified. Source/catalogue publication and canonical wiring remain lead-owned.

Requested reviewer settings were Astra/xhigh/default-standard; actual model, reasoning and per-turn tier are not exposed. Supplied permissions are `never` / `danger-full-access`. No settings, services, dependencies, provider/model/GPU, frontend or shared runtime changed. Only this report is committed; new private review evidence stays outside Git. Return the finding to the lead and stop.
