# Offline CityJSON validity adapter

Validates a full supplied CityJSON 2.0 document with pinned **cjval 0.10.0**, then only explicitly selected source geometries with **val3dity 2.7.0**. Standard-library Python; no application services or shared Python/Node dependencies. It writes immutable validation derivatives and a private receipt outside Git. It never writes canonical geometry or a qualification receipt.

```powershell
python scripts/usp/cityjson-validity/validate.py `
  fixtures/usp/D1/single-roof/original.json `
  --source-sha256 5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2 `
  --tools-root E:/BhuAayam-data/task-data/desktop-cityjson-validity `
  --output E:/BhuAayam-data/task-data/desktop-cityjson-validity/new-run `
  --select NL.IMBAG.Pand.1655100000500568@0 `
  --select NL.IMBAG.Pand.1655100000500568-0@2
```

`@N` is the zero-based geometry-array index in the original object. The D1 selection is its supplied LoD0 MultiSurface and BuildingPart LoD2.2 Solid. IDs, hierarchy, attributes, encoded vertices, transform, rings, LoDs, semantics and nulls remain unchanged. Full schema validation retains every supplied geometry; the second derivative omits only unselected geometry entries, keeps all source vertices/objects and records index mapping. A nonempty header geometry merge, conflicting header/feature values, extensions or unsupported selected type abstains. No extension/network fetches are permitted by this profile; cjval's bundled schemas are used. Validation does not contact a public web validator or upload sources.

## Isolated tool setup and pins

[tools.json](tools.json) pins Windows x86-64 executable/DLL bytes, origins, releases, attribution, terms, embedded schemas and Cargo.lock. Private tooling is expected at these relative paths:

- `cjval-source/cjval-0.10.0/target/release/cjval.exe`
- `val3dity-native/val3dity.exe` and the five DLLs in its pinned release.

Download URLs and archive SHA-256 values are in the pin file. The cjval archive is the crates.io `0.10.0` crate with its included lockfile; build with `cargo build --release --locked --features build-binary --bin cjval`, two build jobs, Rust `1.98.1-x86_64-pc-windows-gnu`, and task-local `CARGO_HOME` / `RUSTUP_HOME`. The observed release build used existing WinLibs GCC; it changed no global toolchain or PATH. The val3dity release archive contains a nested zip; extract both into private task-owned directories, checking both archive and executable/DLL hashes. No global installation is required.

Executable hashes identify the measured installation. A rebuild on another machine/path may differ; review and record new build/provenance pins before using it. This adapter does not silently update pins or download anything. cjval is MIT (Hugo Ledoux/contributors); val3dity is GPL-3.0 (Hugo Ledoux/contributors). Retain upstream licence files and dependency terms with the private installation. Distribution/production clearance of the tools and their native dependencies remains a later release check.

## Interpretation and bounds

- Original limit: 8 MiB; tool diagnostics: 4 MiB each; 1–16 explicit selections; one supervised deadline, at most 120 seconds across validation. Subprocesses run without shell/stdin/visible windows. Missing tools, wrong hashes, inconsistent/incomplete reports, unexpected versions/configuration, timeout or exceeded output bound cannot pass. Existing output directories are refused.
- A zero snapping tolerance is unusable with val3dity 2.7.0: `Surface::add_point` compares distance strictly below tolerance squared, so even identical points cannot join. The adapter uses **10⁻¹² m** solely to identify identical coordinate occurrences. An integer-grid/float-resolution gate proves this threshold cannot merge distinct source grid positions; other profiles abstain. No coordinates are edited, rounded or repaired. The initial zero-tolerance observation is retained separately and is not attributed as a source defect.
- Planarity distance tolerance is **0.01**, normal deviation **20°**, overlap tolerance **0** (explicit upstream defaults); `--ignore204` is absent. Distances use the unchanged source coordinate units: D1's retained declaration is metres. The adapter does not convert or qualify units/reference accuracy. Results are conditional on these tolerances and the validator's supported linear planar profiles.
- Schema validity and selected primitive validity are separate report fields. Warnings are retained. Process exit 0 is insufficient: complete report identity, checks, primitive counts and verdict consistency are required. Overall exit 0 means both requested checks returned valid; exit 2 means an invalid/unsupported/unavailable/error result or refused operation. `receipt.json` preserves commands, elapsed times, original/derivative/tool/config/report hashes and diagnostics.
- A valid exterior shell establishes no reference accuracy, Indian placement, interiors, ownership, building matching, canonical admission, analytical eligibility, SFCGAL operation support or GF-EXCHANGE round trip. Inspection/native APIs retain their existing authority and behavior.

Focused regression command: `python -m unittest discover -s tests -p test_cityjson_validity_adapter.py -v`.
