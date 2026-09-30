# CITYJSON-VALIDITY-01 — offline executable validity result

1 October 2026. Independent implementation under [CITYJSON_VALIDITY_01](../../orchestration/CITYJSON_VALIDITY_01.md), starting exactly at `e568adaf8a0e5cde4986000effc15a168a8bba44`. Branch `task/desktop-cityjson-validity`; worktree `C:/Users/kvina/.codex/worktrees/backend-review/3d-ulpin`. Code commit **`aa407551903a7af8890c45f51b829261c4e0f113`**. The subsequent handoff commit is returned in the callback. Completed audit branch/commit `a49ce108d207dd535022f25481c1bdacec13c8b3` remains intact. Supplied permissions verified `never` / `danger-full-access`; requested GPT-6.1 Sol/xhigh/default-standard, actual model/effort/request tier unobserved. No new workers or dependency on unaccepted draft code.

## Delivered result

The retained D1 source now has an actual **full-document cjval schema result** and **selected val3dity primitive result**, through a reusable private offline adapter. Earlier FND-03 exit-127 observations are historical; installing a package alone is not this result.

| Check at final adapter bytes | Actual result |
| --- | --- |
| cjval **0.10.0**, complete supplied header/feature CityJSON 2.0 derivative | **Valid**, all eight error checks pass, no warnings. This covers the full supplied document, including its other supplied LoDs. |
| val3dity **2.7.0**, selected Building LoD0 MultiSurface | **Valid**, one selected MultiSurface assessed. |
| val3dity **2.7.0**, selected BuildingPart LoD2.2 Solid | **Valid**, one selected Solid assessed, no error codes. No other LoDs were geometrically swept. |
| Adapter regression checks | Six passed: incomplete/contradictory schema reports, incomplete/config-mismatched solid reports, tool-hash mismatch, supervised timeout, source-hash mismatch/original preservation, and distinct-point coalescing exclusion. Diagnostic controls are not property evidence. |

Final adapter exit **0**, cjval exit **0**, val3dity exit **0**. Tool reports and input coverage determine validity; exit codes alone do not. Final measured wall times: cjval `0.106531 s`, val3dity `0.029851 s`, adapter including pin checks/derivatives `0.283858 s`. These are one small warm local observation, not performance qualification.

## Source, derivative and result pins

Original: `fixtures/usp/D1/single-roof/original.json`, **6,783 bytes**, SHA-256 `5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2`; rechecked unchanged. [Manifest](../../../fixtures/usp/D1/single-roof/manifest.json), [acquisition](../../../fixtures/usp/D1/single-roof/acquisition.md), [source index](../../api/real-sources.md) and [catalogue](../../api/datasets.json) retain the 3DBAG URL/attribution, CC BY 4.0 and Dutch EPSG:7415/NAP declaration. No source acquisition was repeated. Native-reader/oracle/API work was reused, not rerun.

Private tooling, downloads, build and outputs: **`E:/BhuAayam-data/task-data/desktop-cityjson-validity/`**. Final artifacts are under `run-final/`:

| Artifact | Bytes / SHA-256 |
| --- | --- |
| `document.city.json` | 6,106 / `61a657877414c4119ccde2181fdd65da83c4787cd2e871180d8d56e503275f92` |
| `selected.city.json` | 4,695 / `ad706df4685ec531fc3e5184efb8de6ea78afc105920ac4fd350ce082008c62e` |
| `cjval.stdout` (structured report) | 1,115 / `5398f5a46076c0b0da9570739560d1285c46b432f28f1c05a537a0fe6a1007f2` |
| `val3dity.json` | 924 / `0ddc9ced6fbde885516aa7c213bd6f6fedc0cb84947e33816ae32c5aebe30649` |
| `receipt.json` | 4,504 / `6772d46505f6afed2dadf62480391d97665125eb254acfff2f856e1c094bdc02` |
| Private `verification.json` | `b7981c8e6e733fc6bb3dba970a8e2d46eb387f7137895d29f3b45b1f3cbe4e8e` |

The full derivative copies the supplied `/metadata` CityJSON header and `/feature/CityObjects` / `/feature/vertices`. Feature ID/type and pointers remain in lineage. No transform, encoded vertex, source ID, LoD, ring, semantic value, attribute or null is changed. The selected derivative keeps all vertices, objects and hierarchy; only unselected geometry entries are omitted, with explicit source-array-index mapping: Building `NL.IMBAG.Pand.1655100000500568@0` and BuildingPart `NL.IMBAG.Pand.1655100000500568-0@2`. Original bytes are never overwritten or repaired.

Adapter SHA-256 `1597edef52eff75c1a6482080f5a593a9b2aeceae5c4a268ac6f4c10b25a9db6`; tool-lock SHA-256 `2c4d22a220ef841d2068141833a9c2fe544ac6096e35e809ec57205b56d4bbe6`; final configuration SHA-256 `8490a35fbd343b5d2bb564c579afb4fcbfee55221ec38fe7c4daa82af5ded95a`. The receipt contains exact child argument vectors, diagnostics, hashes and source-currentness recheck.

## Pinned tools and configuration correction

- **cjval 0.10.0**: [upstream](https://github.com/cityjson/cjval/tree/0.10.0), commit `40db6dd698cfe9de5a88a4a1aac4a5173095d86f` (also verified in the downloaded crate's VCS metadata), MIT, Hugo Ledoux/contributors. Crate SHA-256 `0bf1a5c7c573e78d0ae5ba7a4f60dbbff877c54c18eb7fc97d642a762720214c`, matching crates.io metadata. Included Cargo.lock SHA `972b3a334d5ee1832efcc9e26c8ca39f4fbbbde22c280f72e54b85a526af0054`. Native executable SHA `54f7c4f31261bf4e3974ff30f6ad1d987e75fb909bfbcf7df539f5686189ed85`. Built unmodified with Rust `1.98.1-x86_64-pc-windows-gnu`, existing WinLibs GCC `16.1.0`, two Cargo jobs, `--release --locked --features build-binary --bin cjval`; exit 0, 2m25s. Task-local CARGO_HOME/RUSTUP_HOME and `--no-modify-path`; no global install. Embedded CityJSON 2.0 schema hashes are in [tools.json](../../../scripts/usp/cityjson-validity/tools.json).
- **val3dity 2.7.0**: [upstream](https://github.com/tudelft3d/val3dity/tree/2.7.0), commit `fbe9e4d65376e1c3f63401f15967485783f78c0a`, GPL v3, Hugo Ledoux/contributors. Upstream Windows release archive SHA `cf8d3f025cd52aafc9ea370296a2430baa4aa39ce44a8b3ba1d8b3a540d8a5a7`, matching GitHub release digest. Its nested archive supplies executable SHA `7bffd5cf94f4e8adac094a4fac576efe8cd7335d86da2eeeaf1e00b3e0a87809`; five bundled DLL pins are checked before invocation. `--version` confirmed 2.7.0. Upstream documentation, licence texts, archive metadata and build/setup logs remain in the private root. Tool/native-dependency distribution and production clearance remain later release work.
- **Initial run 01 is retained and inconclusive for source-solid validity.** With `--snap_tol 0`, val3dity reported MultiSurface valid and Solid error **305 MULTIPLE_CONNECTED_COMPONENTS**. Inspection of the pinned [`Surface::add_point`](https://github.com/tudelft3d/val3dity/blob/fbe9e4d65376e1c3f63401f15967485783f78c0a/src/Surface.cpp#L209) shows strict `squared_distance < tol²`; zero prevents even identical coordinate occurrences joining. The CLI rejects negative tolerance, so zero is not a usable exact-identity configuration. Retained `Surface.cpp` SHA `2d6e49b7a3daf5aaf08bd3ef8920d9b3595a021b17299ac05eafaeaee5eb1c52`. Run-01 report SHA `a7a3fe4f5e8da3cdc7888e9e09f2ad899a73e9bc317bfc1f1149ca12f801b0ed`; it is not labelled a source defect or a pass.
- **Corrected configuration identifies repeated identical points only.** `snap_tol=1e-12` in unchanged source units (D1 declares metres); integer-grid/float-resolution preflight confirms distinct source points cannot coalesce. D1's supplied scale is `0.001` on all axes, largest checked coordinate ULP `5.820766091346741e-11`; scale exceeds the guarded error/tolerance bound. Planarity distance `0.01` source units, normals `20°`, overlap `0` are explicitly pinned upstream defaults; `--ignore204` is absent. No source coordinate was moved or rounded. Run 02 confirmed the correction; `run-final` repeated only this affected path after final fail-closed/unit-label corrections, at the committed adapter bytes. No geometry sweep or tolerance search was performed.

## Use, checks and limits

[Usage and setup](../../../scripts/usp/cityjson-validity/README.md) and [adapter](../../../scripts/usp/cityjson-validity/validate.py) are committed new files only. Run `python -m unittest discover -s tests -p test_cityjson_validity_adapter.py -v`: exit 0, six tests. The exact retained-D1 CLI command with both selections, pinned source hash, private tools/output root and `--timeout 120` is in the usage file; final exit 0. `git diff --cached --check` exited 0 before code commit; staged inventory contained only three new adapter files and one focused regression file. No shared dependency/lockfile, contracts, registry, CityJSON service/reader, generated API/catalogue, SQL or frontend changes. Lead owns source-index updates and integration.

The adapter bounds original bytes to 8 MiB, diagnostics to 4 MiB each and validation to one supervised 120-second deadline. It rejects extensions to exclude upstream URL-fetch behavior and uses embedded schemas; source validation was native/offline with no source uploads. No OS network sandbox/container was installed or used. Tool setup downloads used the authorized public network. Missing tools, changed hashes, unsupported references/profiles, timeout, incomplete reports or inconsistent coverage abstain explicitly. Outputs already present are refused. Tool process exit 0 cannot manufacture a pass from an incomplete/invalid report.

This result establishes schema validity and the selected source primitive validity **under the stated tool versions/tolerances**. It does not establish source/survey/reference accuracy, watertight correctness beyond the validator's supported checks, Indian placement, interiors/floor count, rights, source-building matching, canonical admission, analytical qualification, SFCGAL operation support or GF-EXCHANGE round trip. Native output, candidate drafts and valid exterior shells still require reviewed canonical admission/qualification. No `qualify_geometry` receipt or eligibility annotation was created; no release gate was advanced.

All task-started installer/build/validation and timeout-control processes exited. Tooling, licence/provenance receipts and every bounded output run are retained for reuse; no running validator/container remains. No Docker/application service, daemon configuration, guarded runtime query, socket repair, credentials, source/data volumes, GPU/model/provider, push or deployment was touched. Final worktree clean status and handoff commit are supplied in the authorized callback.
