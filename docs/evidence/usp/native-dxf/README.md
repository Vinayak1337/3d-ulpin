# DXF-01 local native inspection — 1 October 2026

Code checkpoint: `bbdf5cd4e9f8ea8a038d0604e39231001d19831c`, normally fast-forwarded from exact dispatch `78a9d0c293dccf6e18a9f7c3f5e2a9442efd1b0b`. Branch `task/desktop-dxf-native-reader`; checkout `C:/Users/kvina/.codex/worktrees/desktop-dxf/3d-ulpin`. The supplied turn permission instructions confirm `approval_policy=never`, `sandbox_mode=danger-full-access`. Requested GPT-6.1 Sol/xhigh/default-standard; exact model/effort and per-turn tier are not returned by the available tools and are not claimed as observed.

`services/geo/geo/native_dxf.py` and `scripts/usp/desktop-dxf-read.py` inspect original ASCII DXF R12–R2018 through ezdxf 1.4.3. The output carries source SHA/version, literal header units (absent, explicit unitless, declared or unsupported), tag lexemes and one-based code/value-line locators, original layer/handle/space values, block definitions and source INSERT transforms. Fields expose supplied/absent states; parser-created handles, layouts, unit defaults and R12 upgrade values are discarded. Numeric decoding is separate from unchanged numeric lexemes. No repaired source is saved.

Semantic projections cover LINE, ARC, CIRCLE, TEXT/MTEXT, LWPOLYLINE and simple 2D/3D POLYLINE/vertices. Coordinates, extrusion, elevation, bulges, widths, angle values and INSERT transforms remain source values. Missing required values are flagged. Mesh/curve-fit polylines and other drawing entity types remain unsupported with original tags; application/XDATA/embedded content is opaque and flagged. Other table/object record types are counted explicitly as opaque and remain in the original. Named model/paper blocks and original layout/paper flags are preserved; when an absent paper flag uses the DXF model-space default, that basis is stated separately. Source layout/flag conflicts are explicit.

The isolated child installs the existing `geo.native_pdf._install_memory_limit` OS ceiling **before importing the parser or reading stdin**. Its entire import/parse/encode journey has a 45-second parent deadline; on timeout `subprocess.run` kills/reaps that child. The parser executes no source code and neither resolves external references nor launches converters. Only required Windows/temp variables and two-thread native-library settings reach the child. An owned empty ezdxf v2 font cache prevents import-time system font scans; empty config/cache/cwd prevent user ezdxf settings affecting results. There is no unbounded in-process fallback. Only the child-facing helper `read_dxf` lacks external supervision; callers must use `inspect_dxf`.

Bounds: 16 MiB input/output, 100,000 source records, 10,000 projected drawing entities including child VERTEX/SEQEND records, 100,000 source coordinate/vector starts, 500,000 tags, 2 GiB process memory, one parser process and native-library thread environment limits of two. Point counting conservatively includes header/block/opaque records; no curve or INSERT expansion occurs. The CLI requires an exact original SHA, rechecks the local original before publication, writes exclusive fixed-name files into a fresh directory outside Git and refuses existing output directories. These are local developer CLI controls, not application access authority.

## Observed local checks

[Source manifest](manifest.json) retains exactly two unchanged, public upstream development samples from ezdxf v1.4.3 commit `df5ef277fcc674d77580143212ec63dd981cc2b3`, with MIT attribution/notice, URLs, hashes and explicit unknown geography/CRS/vertical reference. The source index/catalogue and `E:/BhuAayam-data` holding search found no retained DXF. Private originals, wheels, environment and output live under `E:/BhuAayam-data/task-data/desktop-dxf-native/`. These samples are `test_only`, never official operational facts or training labels.

| Source | Observed result at the code checkpoint |
| --- | --- |
| `1_polylines.dxf` (82,846 bytes) | 83 entities: 52 LINE, 22 ARC, 9 TEXT. `$INSUNITS=6` remains metres. 202 source coordinate/vector starts; 249,680-byte output. Child 0.346326 s. Other tables/objects remain explicitly opaque. Despite its filename, this sample does not establish POLYLINE coverage. |
| `ASCII_R12.dxf` (6,766 bytes) | 2 LINE + 1 INSERT in model space and 1 block TEXT. `$INSUNITS` remains absent, not zero/unitless. INSERT scale/rotation remain absent; `*U1` block reference is retained without explosion. 32 source coordinate/vector starts; 29,589-byte output. Child 0.325369 s. Missing codepage uses explicitly labelled parser-default cp1252. |

[Verification](verification.json) is the exact copy of `runs/verification-final.json` (SHA-256 `2b9ef3298ffb29e26e47c49ddb8102ffd8680134ac33403e4310cbb6990b8d5c`). It records actual commands/exits, four log hashes, source/artifact/receipt hashes and six physical/Git code pins. Final compilation, five targeted unittest regressions and both final CLI calls exit 0. The tests check original tag/field locators, absence versus parser defaults, lowered input/entity/point/output ceilings using unchanged input, a child timeout, wrong original pin and output overwrite refusal. Source hashes are checked before and after; no source editing or invented property fixtures were used. The final tests ran five cases in 1.122 s; timing is observational, not a performance gate.

The earlier ordinary environment installation and `pip check` exit 0. [Lane dependency lock](requirements.lock) pins all five dependencies and CPython 3.13 Windows amd64 wheel hashes; originals of those wheels and acquisition metadata are retained privately. The offline `--require-hashes --only-binary=:all:` installation check reports the exact pinned versions already installed. No shared requirements changed. Initial CLI attempts failed before publication because sanitized imports required XDG paths and a font cache; these defects were corrected before the final checks. Preliminary successful outputs remain separately retained in `runs/declared-01` and `runs/absent-01`, not relabelled final-code results.

To reproduce with the retained environment, use the exact commands in `verification.json`. The basic CLI form is:

```powershell
& 'E:/BhuAayam-data/task-data/desktop-dxf-native/env/Scripts/python.exe' `
  'C:/Users/kvina/.codex/worktrees/desktop-dxf/3d-ulpin/scripts/usp/desktop-dxf-read.py' `
  'E:/BhuAayam-data/task-data/desktop-dxf-native/sources/ASCII_R12.dxf' `
  --expected-sha256 b476d3e53fe24c1db3c701d20b2bebd774f7bd7966b12d81891505b9b29e4d21 `
  --output-dir 'E:/BhuAayam-data/task-data/desktop-dxf-native/runs/new-unique-check'
```

## Integration boundary and remaining scope

No API/job/source-reader dispatch, shared requirements, SQL, service, Docker, GPU/model/provider, frontend, OpenAPI/client/catalogue or root plan file changed. No push/deployment occurred. All parser children are reaped, temporary directories cleaned and the worktree is clean after the handoff commit; private originals/environments/evidence remain retained. The source-independent goal remains paused reference.

Lead-owned next seams are explicit: add this manifest/inspection receipt to `docs/api/real-sources.md` and `docs/api/datasets.json`; separately coordinate canonical source/job dispatch, runtime dependency installation and producer fingerprints, including the reused `native_pdf.py` guard. `verification.json` pins both physical and Git bytes, since that existing guard's physical CRLF differs from its Git LF bytes. Consumers must select bounded original bytes through existing access/revision authority and use `inspect_dxf`, rather than accept CLI filesystem paths as an API contract. No shared-seam edit is needed to accept this local reader checkpoint.

Unqualified: actual application/HTTP admission and recovery, official Indian CAD data, geometry validity/accuracy, georeference, rooms/floors/areas/ownership/legal identifiers, block expansion, external references, binary DXF/DWG, graphics/rendering, scale/launch/release gates and learning. CIRCLE, MTEXT, LWPOLYLINE/POLYLINE, explicit `$INSUNITS=0`, actual paper-space content and adverse geometry have code projections but were not exercised by these two real samples. No runtime gate or universal CAD-support claim follows from this bounded local check.
