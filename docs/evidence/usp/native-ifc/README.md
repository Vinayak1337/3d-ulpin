# IFC-01 local metadata handoff — 1 October 2026

**Lead acceptance, 1 October:** implementation `84e56b1`, evidence `236e7b6` and independent review `cbb4a25` are integrated. Lead matched all three reviewer receipts and 30 source/artifact/wheel/physical+Git pins, then observed all eight integrated tests pass (`python -B -m unittest discover -s services/geo/tests -p test_native_ifc.py -v`, pinned lane Python, retained-source environment variable; exit 0, 3.791 seconds). The resource interpretation is explicitly two CPU affinity cores/single-thread compute pools with monitored six-total-OS-thread helper allowance, not a literal two-thread guarantee. This resolves the interpretation question below without rewriting historical receipts. Windows local metadata inspection only is accepted; canonical API/job execution remains pending.

Code: `4c686c2b9621a4e2c46656fa760d2eedc9ab90a6`, based on exact dispatch
`78a9d0c293dccf6e18a9f7c3f5e2a9442efd1b0b`. Branch
`task/desktop-ifc-native-reader`, assigned association-sources worktree. Prior
reference-document checkpoint `6ac3d034` remains on its original branch.
Primary staging was read only; the independently advanced head was observed as
`9f79fcdd532120a26ae316c129288331dc047708` before handoff.

The new local CLI reads unchanged IFC2x3/IFC4 STEP bytes through **IfcOpenShell
0.8.5**, pinned with every resolved dependency in the lane-only Windows/CPython
3.12 [lock](requirements-win-py312.lock). The reader projects project units,
buildings, storeys, spaces, sites, containment/decomposition relationships,
placements and reference metadata. Every actual attribute retains its decoded
value, exact original literal, STEP ID and attribute byte span. Floats do not
replace the original decimal spelling. No conversion is applied.

Absent schema attributes, `$` null and unsupported `*` derived values remain
distinct. Source-wide duplicate STEP IDs/GlobalIds, dangling or wrong-type
references, lost parser values and cycles in traversed metadata/spatial links
reject publication. Missing facts stay visible; storeys do not become legal
units. Other source content remains in the original with a source-wide type
inventory. Geometry representations are explicitly unsupported for interpretation.

## Published-source result

No retained IFC was found. Exactly two small buildingSMART International
Certification-datasets examples were acquired at revision
`80d976a9b193a26a8e928c3e79bff67af1de68a8`. Upstream LICENSE and README were
retained with their URLs/hashes. Copyright buildingSMART International Ltd.;
**CC-BY-4.0**. These are `test_only` educational/certification inputs, with
physical geography unknown. They do not qualify operational facts or learning
labels. [The manifest](manifest.json) records original URLs, licence, acquisition,
code/dependency/artifact hashes, actual commands/exits and private paths.

| Original | Source entities | Projected metadata records | Output bytes | Final elapsed |
| --- | ---: | ---: | ---: | ---: |
| IFC2x3 Building-Architecture | 2,046 | 45 | 55,011 | 0.359 s |
| IFC4 Building-Architecture | 371 | 56 | 68,748 | 0.344 s |

Both inputs supply `Single-family house`, `00 groundfloor` with literal `0.`
elevation, and `living room` / `entry hall` spaces. Their length unit is
`MILLI` / `METRE`. Project, building, storey and space GlobalIds are preserved.
Containment/decomposition endpoints and source-local placement chains remain
source references, without evaluating global transforms or inferring heights.

The naturally incomplete **IFC2x3** original has null site latitude/longitude
and no qualified georeference. The result permits source-local inspection only.
The **IFC4** original supplies `EPSG:32760` and an `IfcMapConversion`, including
scale `0.001`; all fields/literals are retained, with `supplied_unqualified`
reference status. That declaration does not establish physical geography,
placement accuracy or a usable global transform. Brep/tessellation content stays
in the unchanged original and is explicitly outside the metadata profile.

Both final CLI commands exited **0**. Output SHA-256 values are:

- IFC2x3: `66dcfb321cac47b605ffed87beaf060b50b1203a151b738fe446b6251d003d3a`
- IFC4: `b0d08570e368ccd6f1b32adc113b1363afa523cc8fa359fe65e087009bd6b0b6`

Original hashes were verified unchanged after processing. Final native processes
used approximately 47.5/47.8 MB peak Job private memory. These are observations
on two small files, not scale/performance qualification.

## Bounds and verification

Default admission bounds: **32 MiB input, 100,000 entities, 10,000 projected
records, 16 MiB output, 2 GiB native memory, 60 seconds, depth 64**. The CLI
starts a stdlib-only gated process, attaches a Windows Job with process and Job
memory ceilings, kill-on-close and one active processing process, applies CPU
affinity, then releases native parsing. Parent supervision kills on deadline or
monitored resource excess. Native stdout/stderr are suppressed; structured errors
remain recoverable. Child environment contains no inherited credentials/provider
configuration. All parser temporary copies stay under the supervisor-owned tree.
Output publication uses complete, fsynced bytes and an exclusive atomic hard link;
originals and prior outputs are never replaced.

**Thread qualification gap:** Windows had four OS loader/helper threads while
still waiting before parsing. This implementation enforces **two CPU cores and
single-thread native compute pools**, with a monitored ceiling of **six total OS
threads** (four helper allowance). Final runs observed three/four OS threads.
It does **not** enforce a literal two-total-OS-thread ceiling. The complete assigned
envelope remains unqualified under that literal reading; lead must reconcile this
explicit interpretation before accepting the envelope. Sampling is not a kernel
thread-creation limit. No bound was silently relabelled as achieved.

Eight focused tests passed, exit **0**, in 3.812 seconds. They cover both unchanged
published files and all original attribute slices; duplicate identity, malformed
references, cycles, unsupported schema, comment/null handling, reduced
input/entity/record/output/memory bounds, timeout, refused Job attachment and
original/prior-output preservation. Corrupted copies exist only inside disposable
tests, not the source pack or qualification truth. The observed first pass found a
Windows cleanup-path defect after refused attachment; it was fixed and the focused
checks rerun. Compilation of all three new Python files passed. Code diff checks
passed. No unrelated service or verification campaign ran.

## Run locally

Private lane root: `E:/BhuAayam-data/task-data/desktop-ifc-native/`.
Environment, wheel cache, unchanged originals, acquisition receipts and final
outputs are retained there. The standalone CLI takes a local original and a **new**
output path:

```powershell
& 'E:/BhuAayam-data/task-data/desktop-ifc-native/env/Scripts/python.exe' `
  'C:/Users/kvina/.codex/worktrees/association-sources/3d-ulpin/scripts/usp/desktop-ifc-read.py' `
  'E:/BhuAayam-data/task-data/desktop-ifc-native/originals/ifc4-building-architecture.ifc' `
  --output 'E:/BhuAayam-data/task-data/desktop-ifc-native/outputs/next-inspection.json'
```

The new output's parent directory must exist and support hard links. A filesystem
without that atomic publication capability returns a local I/O failure. Do not call
the native `extract` helper directly in a service; the CLI supervisor supplies the
mandatory native-process envelope. Future canonical integration must reuse the
existing source, access, revision and job authorities. No shared seam is changed
by this checkpoint; lead owns subsequent dispatch/contracts/catalogue wiring.

## Qualification and ownership limits

This is local metadata inspection. It supplies no tessellation, measured volume,
geometry/EXPRESS validity, global placement, inferred floor heights, rights,
property registration, canonical admission, association, training labels, Indian
operational qualification or release-gate pass. Linux bounds are implemented but
unexercised; this dependency lock and runtime receipt cover Windows x64 only.
IfcOpenShell is LGPL-3.0-or-later per its pinned wheel classifier/header; binary and
transitive redistribution obligations remain a later release-clearance workstream.

Requested settings: GPT-6.1 Sol/xhigh/default-standard. Actual model, effort and
service tier are not exposed in this turn; no prompt is claimed to configure them.
Supplied permissions are `never` / `danger-full-access`. All parser workers exited;
isolated environment and useful artifacts remain. No API/DB/Docker, GPU, model or
provider runtime was started. Shared requirements, dispatch, existing readers,
contracts, OpenAPI, database, catalogue and frontend files remain untouched.
