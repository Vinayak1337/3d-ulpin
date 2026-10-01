# IFC-01-R — native metadata and process-boundary review

1 October 2026. **No actionable finding established.** Scoped acceptance for the returned Windows local metadata reader under the resource interpretation expressly accepted in `PARALLEL_20261001B.md`. Canonical source/job/API integration, Linux execution, geometry/accuracy and release qualification remain outside this checkpoint.

## Pins and ownership

- Review dispatch / observed read-only staging: `f687cd29d17925f5893d7d1cddcfe31d30300177`.
- Implementation base: `78a9d0c293dccf6e18a9f7c3f5e2a9442efd1b0b`.
- Code: `4c686c2b9621a4e2c46656fa760d2eedc9ab90a6`; candidate handoff: `6f3957f90d69eb0a67f211c891e5cd0a143641ce`.
- Clean reviewer checkout branched at that handoff: `C:/Users/kvina/.codex/worktrees/point-review/3d-ulpin`, `task/desktop-ifc-native-audit`. Completed `4b06a068343d6902fa965379890d7c197e63b0b0` and its branch were preserved.
- Own only this report and `E:/BhuAayam-data/task-data/desktop-ifc-review/`. No implementation, original, existing receipt, source/catalogue, shared runtime or generated file was edited.
- Requested Astra/xhigh/default-standard; actual turn model/effort/tier are unexposed. Supplied permissions are `never` / `danger-full-access`. No Fast/priority setting was requested or changed.

Read the current assignment, guide/ledger/backend decisions, relevant source/format requirements, source index/catalogue and candidate handoff/manifest. Reviewed the complete six-file candidate delta: native reader, CLI supervisor, focused tests, dependency lock, manifest and handoff. This is a new IFC review; completed CityJSON/source reviews were not repeated.

## Code review

**Source interpretation.** `native_ifc.py` retains a reversible original-byte literal and exact STEP entity/attribute spans beside IfcOpenShell's decoded value. The lexical index masks strings/comments, bounds input/entity/depth, detects duplicate IDs and missing reference targets, and is checked against the parser's entity IDs, types and attribute counts. The source-wide pass checks supplied values against schema attribute types and detects duplicate GlobalIds. Iterative traversal checks spatial/placement/metadata cycles and bounds projected records; unprojected source content remains inventoried in the original. This is not full EXPRESS or geometry validation.

The saved outputs distinguish absent schema attributes, `$` null and `*` unsupported derived attributes. No saved null field contains a parser-supplied value; all saved derived fields retain null values and an explicit unsupported reason. Project unit prefixes, supplied storey elevation, placements, map-conversion scale and local references are retained without conversion, transform application, inferred heights or legal-unit promotion. The two examined sources preserve building/storey/space names and source IDs, with explicit geometry/global-placement exclusions.

**Native execution.** `desktop-ifc-read.py` launches the actual base interpreter with `-I -S` and a stdlib-only stdin gate. On Windows it attaches the Job before releasing that gate: process and Job private-memory ceilings are 2 GiB, active process count is one, and kill-on-close is enabled. CPU affinity is restricted before parser import; four compute-pool environment variables are set to one. The child receives a small environment without inherited credentials/provider configuration. Parser copies live under the supervisor-owned temporary directory.

The accepted interpretation is **two CPU affinity cores, single-thread compute pools and a sampled six-total-OS-thread ceiling**, including the four-thread helper allowance. Neither sampling nor the environment variables enforce two total OS threads or a kernel thread-creation ceiling. Retained final runs report three/four peak sampled OS threads, one processing process, and approximately 47.5/47.8 MB peak Job private memory. Their elapsed times are 0.359/0.344 seconds. These observations support the two small Windows runs only; Linux remains unexercised.

**Refusal and publication.** Supervision checks the 60-second deadline, sampled resource growth, nonzero exit and missing/oversized result, then propagates structured worker errors. Failure paths close the Job/kill and wait for the owned process. No in-process native fallback is introduced. The parent supplies a bounded snapshot and verifies the worker's source hash against those exact bytes. Result publication uses a complete fsynced temporary file on the destination filesystem and an exclusive hard link; existing originals/outputs cannot be replaced, and failed native results are not published. API access, source revision and job fencing must be supplied by the later canonical integration, as the handoff states.

## Retained evidence reconciliation

Private original evidence root: `E:/BhuAayam-data/task-data/desktop-ifc-native/`.

`qualification.json` is **4,955 bytes**, SHA256 **`f3387a768bdcccde3823e44c20f69727ecc00aa4ad3de5d0964ac02e23f8144f`**. Its code commit, code pins and final runs match the manifest. Reviewer reconciliation passed **30 hash/size checks**: two originals, two upstream metadata files, nine saved artifacts, nine wheels, and four owner-physical/four Git code pins. The lock matches the nine pinned package/version/wheel hashes, including IfcOpenShell 0.8.5. The recorded physical/Git difference in the lock was preserved and matched separately.

| Retained input/output | Original SHA256 | Output SHA256 | Checked original attribute slices |
| --- | --- | --- | --- |
| IFC2X3, 92,542-byte input; 55,011-byte output; 45 projected records | `c4db65ba847f6b369a95d6c54fa11f4750cbe6d59f021934e8923d8d578e5885` | `66dcfb321cac47b605ffed87beaf060b50b1203a151b738fe446b6251d003d3a` | 184 |
| IFC4, 142,325-byte input; 68,748-byte output; 56 projected records | `8790a1e193e82b8e7e7f337ec2633cd40f2120590317a1443503a25b079e2e80` | `b0d08570e368ccd6f1b32adc113b1363afa523cc8fa359fe65e087009bd6b0b6` | 237 |

All 421 saved attribute literals match their original byte spans, with matching entity/attribute locators. Representative checks cover names, millimetre units, `0.` storey elevation, null site coordinates, `EPSG:32760` and literal map scale `0.001`. Original hashes remain unchanged. Upstream licence/readme support the manifest's buildingSMART certification/educational origin and CC-BY-4.0 attribution at revision `80d976a9b193a26a8e928c3e79bff67af1de68a8`. Both sources remain `test_only`, with physical geography unqualified. An EPSG declaration does not supply independent accuracy, Indian operational evidence or learning labels.

The owner reports eight focused tests passing, compilation and code diff checks. The manifest explicitly says original test stdout was not saved; that test result is reused as an owner report, not a newly observed reviewer run. Both saved final CLI receipts have exit 0 and matching complete output hashes. The test file itself covers source preservation, malformed references/identities/cycles, missing reference information, reduced bounds, timeout, failed Job attachment and overwrite refusal.

## Targeted reviewer controls and limits

One concrete review concern was parser coercion/lazy decoding after the early diagnostic snapshot. Three bounded, isolated mutations of the retained IFC4 input exercised this concern through the candidate supervisor: fractional `CoordinateSpaceDimension` refused with `ATTRIBUTE_TYPE`; a numeric suffix in storey elevation refused with `WORKER_FAILED`; an invalid STEP Unicode escape refused with `PARSER_REJECTED`. No output was published, and the retained original remained unchanged. These controls did not establish a defect or qualify every malformed IFC syntax. They are regression copies, not operational facts or source qualification.

Reviewer commands used the pinned environment's `python.exe -B` on `reconcile.py`, `value-control.py` and `string-control.py`; each exited 0. Native controls retained all resource logic, reduced the maximum deadline to ten seconds, and only added `sys.dont_write_bytecode=True` to the in-memory child gate to avoid worktree cache writes. No full test campaign, fresh published-source extraction, Docker, API, database, model or provider run was performed.

Private reviewer receipts:

- `reconciliation.json`: 18,406 bytes; SHA256 `a86dc302a13b93b55b514e2d7c42cad83aee095d46aa294c3e46bc5e5013bd89`.
- `value-control.json`: 1,676 bytes; SHA256 `9cbecf834fe5ef104fb9cd3c063a091274f04e57b62ea73e1e1409cffa222d95`.
- `string-control.json`: 620 bytes; SHA256 `36e23e7f688b3354632eeba73ab53913f1830bbeac44848d8ea34a350c0ad022`.

`git diff --check 78a9d0c293dccf6e18a9f7c3f5e2a9442efd1b0b 6f3957f90d69eb0a67f211c891e5cd0a143641ce` exited 0. All owned native control processes returned through supervisor cleanup. The private review artifacts remain; no services, workers or schedules were created. Return the report by the authorized lead callback and stop. The goal tracker remains a paused reference, with no project/release completion claim.
