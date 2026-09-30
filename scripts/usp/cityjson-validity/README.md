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
## Private server job integration

`server.py` is the supervisor for the additive `cityjson-validation` operation.
The API accepts only `requestKey` and `expectedDraftRevision` at
`POST /api/v1/registry-drafts/{draftId}/native-exterior/validations`; status/result
is read at the same path with `/{jobId}`. Both require the existing private guard.
The server derives source/selection/tool/access pins from the current unrecorded
candidate; a completed valid result does not admit or qualify registry geometry.

Configure the dispatcher process with absolute paths (no `.env` changes needed):

- `ULPIN_CITYJSON_VALIDATOR_PYTHON`: explicit Python executable.
- `ULPIN_CITYJSON_VALIDATOR_PYTHON_SHA256`: exact physical executable SHA-256.
- `ULPIN_CITYJSON_VALIDATOR_TOOLS_ROOT`: retained pinned tooling directory,
  presently `E:/BhuAayam-data/task-data/desktop-cityjson-validity/`.
- `ULPIN_CITYJSON_VALIDATOR_SCRATCH_ROOT`: existing private directory outside Git.

No PATH lookup, extension fetching, provider access or source uploads are enabled.
Python uses `-I -B` with only SystemRoot and private TEMP/TMP. Executable/DLL,
adapter, supervisor, tool lock, configuration and relevant code bytes are pinned
at enrollment and checked again. Physical checkout bytes matter; saved receipt
hashes are not substituted for current bytes. Unsupported/missing/changed
configuration fails closed with a controlled code and preserves previous history.

The Windows x86-64 supervisor owns a kill-on-close Job Object for its descendants
and the fixed host-wide `Global\ULPIN-CityJSON-Validation-v1` mutex across dispatcher
processes. Busy hosts require an explicit retry. The native validation deadline
is 120 seconds; source/report I/O is individually bounded, and the complete
worker/publication has a 300-second cancellation deadline with live lease checks.
Native tools run outside database transactions. This is offline configuration,
not an OS network-sandbox claim. Other platforms currently abstain.

Bounded raw reports and the full private receipt are immutable private objects;
ordinary API reads expose only controlled codes, source locators, version/hash
pins and separate document/selected-geometry verdicts. Result JSON uses a fixed
32 KiB whitespace-padded envelope for exact bounded streaming. Scratch is removed
after owned processes exit; crashes can leave private scratch requiring review.
An interrupted/expired job does not rerun tools automatically. Use a fresh request
key for an explicit new job; replay returns the same enrolled job after current
authority checks. Prior jobs/reports are retained. Archived `run-final` evidence
is used only by no-service parser controls, never enrolled as a runtime result.
