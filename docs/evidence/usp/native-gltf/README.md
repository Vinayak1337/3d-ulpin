# GLTF-01 — local context inspection checkpoint

Code: `f0a7f0d8439690d3e93f0153317e1741eb45d158`, based on assigned `f687cd29d17925f5893d7d1cddcfe31d30300177`. Worker branch is `task/desktop-gltf-context-reader` in `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`; staging was read only and observed at `410fdf28b2d5471878205f49d716a99ef684640a` before implementation.

The new reader inspects glTF 2.0 JSON and GLB with local scene/node declarations, matrix/TRS declarations, mesh/primitive/material references and a supported local POSITION/index projection. Float32 VEC3 positions and unsigned scalar indices retain source order, topology mode, accessor/view/buffer pointers, decoded offsets/strides/counts and exact referenced span hashes. GLB locators also identify original-file byte offsets. Embedded-buffer locators bind decoded buffer bytes to the original URI pointer; they do not invent original-file byte offsets. Absent transforms/scene/index arrays remain absent; specification defaults are separately labelled. No world transform is applied.

Unknown required extensions block geometry projection. Sparse, normalized/other POSITION profiles, morph geometry and mesh/accessor/view extensions remain explicit unsupported profiles. Other attributes, materials, images, textures, skins and animations are inventoried as declarations only. External buffers/images are never fetched; missing companions remain `needs_input`. This is a source inspection profile, not a format-wide validator or renderer.

The CLI requires an expected SHA-256 and a fresh private output directory outside Git. It holds a Windows read handle denying original writes/deletion, snapshots the bounded bytes, gates reader import until Job attachment, checks code/source/output hashes and publishes fixed-name files exclusively. Owned temporary files are removed on exit; failed parsing publishes nothing. The final outputs are `gltf.json` plus `receipt.json`. Windows venv redirectors would violate the one-process bound, so the child uses the base interpreter directly with `-I -S`.

Limits: 16 MiB original/aggregate buffers/output; 10,000 nodes and primitives; 100,000 projected positions; 300,000 projected indices; JSON/hierarchy depth 64; 500,000 JSON values; 64 GLB chunks. Windows Job flags `8968` enforce one active process, 2 GiB process/job private memory and kill-on-close. The parent enforces 45 seconds including import/read/serialization and bounded stdout/stderr. Compute-pool environment settings are one thread; **there is no OS thread ceiling claim**. Non-Windows CLI execution is refused. Linux remains unqualified.

## Sources and actual checks

Only two model inputs were retained, both unchanged upstream Box variants at KhronosGroup/glTF-Sample-Assets revision `f36bfdabd1031c3cf6689a50570b8cdf3678b49c`. **Box model, copyright 2017 Cesium; CC BY 4.0.** [Sources/attribution](sources.json) records exact URLs, bytes, hashes and retained model-specific terms. These are published graphics examples for `test_only` parser development, with no geography, operational/property facts or independent accuracy truth. `Box0.bin` was deliberately not acquired or resolved.

| Unchanged input | Actual CLI result |
| --- | --- |
| `Box.glb`, 1,664 bytes | `inspected_local`: 2 nodes, 1 primitive, 24 positions, 36 indices; usable local geometry projection. 5,775-byte output; Job peak private memory 25,653,248 bytes; supervised time 0.055554 s. |
| `Box.gltf`, 2,898 bytes | `inspected_partial`: source hierarchy retained, external `Box0.bin` declared `needs_input`; 0 projected positions/indices and geometry unavailable. 4,532-byte output; Job peak private memory 25,522,176 bytes; supervised time 0.055321 s. |

The seven focused test groups pass: exact span/value lineage; embedded and external-URI handling; hostile accessor/index/nonfinite/unsupported profiles; JSON/GLB/hierarchy limits; output-byte bound; actual timeout/memory/process/gate controls; original-lock/hash/fresh-output guards. Adverse test inputs are transient mutations of the upstream graphics bytes/declarations, not new operational fixtures. Final compile checks and `git diff --cached --check` also pass. Both original hashes remain unchanged; no owned temporary directory remains.

[Verification](verification.json) contains exact commands/exits, final receipts, artifact/source pins and development corrections. The primary private receipt is `E:/BhuAayam-data/task-data/desktop-gltf-native/verification.json`, 12,487 bytes, SHA-256 `1e35b19a59ca2d0da1d3808ac3c76d9d93c532455c5cc6b89e4038acb2db6f4d`. Private originals, attribution metadata, isolated environment and outputs remain under that lane root. [Runtime lock](runtime-lock.json) pins CPython 3.13.7, base executable/DLL, standard-library constituents and physical/Git code hashes. The unchanged package initializer differs between physical CRLF and Git LF; both hashes are retained. The three new code files match their Git bytes. Saved fingerprints are never rewritten to disguise checkout differences.

`pygltflib` 1.16.5 was inspected but not installed: its dataclass defaults insert offsets, normalization flags and empty lists. This slice uses CPython's JSON/struct/base64 modules to retain original declarations and enforce its narrow binary profile. The evaluated wheel hash and the reused repository Windows Job/gate pattern are recorded in the lock. No shared dependency or supervisor file changed.

## Reproduction and boundaries

From the assigned absolute worktree, run:

```powershell
$env:GLTF_TEST_SOURCE_ROOT = 'E:/BhuAayam-data/task-data/desktop-gltf-native/originals'
& 'E:/BhuAayam-data/task-data/desktop-gltf-native/env/Scripts/python.exe' -I services/geo/tests/test_native_gltf.py -v
& 'E:/BhuAayam-data/task-data/desktop-gltf-native/env/Scripts/python.exe' -I scripts/usp/desktop-gltf-read.py E:/BhuAayam-data/task-data/desktop-gltf-native/originals/Box.glb --expected-sha256 ed52f7192b8311d700ac0ce80644e3852cd01537e4d62241b9acba023da3d54e --output-dir E:/BhuAayam-data/task-data/desktop-gltf-native/review-glb-fresh
```

Choose a new output path; reruns never overwrite receipts. `--scene` selects an explicit source scene index when required; absent source selection is never guessed.

Changed production files are only `services/geo/geo/native_gltf.py` and `scripts/usp/desktop-gltf-read.py`; tests are in `services/geo/tests/test_native_gltf.py`. No shared source/job/API registration, existing-reader edits, services/Docker, model/GPU work, frontend/renderer, provider call, push or deployment occurred. Sources/catalogue publication and later canonical wiring remain lead-owned after review.

All outputs remain `context_mesh`, with global placement unknown and analytical geometry, measurements, property identity and registry admission unavailable. The two local journeys qualify only this bounded development profile. API persistence, official-source/accuracy, learning, scale, renderer and release gates remain open. Source attribution and intended-use launch clearance remain attached for the deferred release workstream.

Requested settings were GPT-6.1 Sol/xhigh and default/standard; model/effort/per-turn service tier are not separately exposed by this turn. Supplied actual permission instructions are `approval_policy=never`, `sandbox_mode=danger-full-access`. No settings or internal app state were modified. Owned children are stopped. Return this checkpoint for review and stop; do not dispatch workers or poll.
