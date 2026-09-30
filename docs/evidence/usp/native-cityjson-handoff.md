# CITYJSON-01 — bounded source-native reader

30 September 2026. Reader/CLI only; API/registry integration is a separate assignment. Worktree `C:/Users/kvina/.codex/worktrees/desktop-raster/3d-ulpin`, branch `task/desktop-cityjson-reader`, base `efaed669ac5474b10369a3f927bd8390bddfb32c`. Read-only lead head reconciled at `3a13c62bc18eeb9561776b0f44e41aeb8350ee81`.

Requested GPT-6.1 Sol/high; actual model/effort and service tier are not independently exposed by turn metadata. Priority was authorized, not observed. Supplied turn permissions explicitly verified `approval_policy=never`, `sandbox_mode=danger-full-access`. No workers/subagents were created.

## Delivered behavior

`services/geo/geo/native_cityjson.py` reads UTF-8 CityJSON 2.0, standalone CityJSONFeature and the retained 3DBAG feature/header envelope using the standard library. It preserves the complete parsed source document, exact source IDs/hierarchy, attributes (including null and unknown fields), encoded vertices, transform, metadata and semantics. The unchanged original stays separate: JSON value preservation does not claim byte-preserving reserialization. SHA-256 and RFC 6901 pointers bind projections to the original.

Solid shell/surface/ring nesting and MultiSurface surface/ring nesting are structurally checked without flattening; hole rings and null semantic assignments are retained. Face projections point to native rings and semantic records. Unknown geometry is retained at its pointer with `unsupported` status; mixed results report `partial_unsupported`. Malformed supported geometry fails the whole read with a typed error and locator; no partial success is published. Unresolved hierarchy links remain literal IDs with explicit issues, rather than inferred objects.

Only the supplied scale/translate is applied once. Missing transforms retain untransformed source coordinates; missing and explicit-null CRS remain distinct. All declared CRS/vertical metadata stays at the source metadata pointer. The reader does no CRS lookup or vertical-datum interpretation. A supplied EPSG:7415 declaration does not qualify global placement or an ellipsoidal height conversion. Unknown extensions are retained, not interpreted.

Limits: 8 MiB original, 1,000 objects, 100,000 vertices, 500,000 boundary indices, JSON depth 64, 1,000,000 tree nodes, 32 MiB output, cooperative 15-second reader deadline and a hard 20-second CLI child deadline. Rejects duplicate JSON keys, nonfinite coordinates, invalid boundary/semantic indices (including booleans), inconsistent semantic nesting and conflicting transforms. These are structural checks, not complete CityJSON-schema or geometric validation. No new dependency/install.

`scripts/usp/desktop-cityjson-read.py` requires an expected source SHA and a fresh directory outside Git with an existing parent. It writes only fixed-name `cityjson.json` and `receipt.json`, refuses existing outputs/hash drift, reads at most 8 MiB plus one byte and uses a local isolated Python child. There is no URL fetch, external reference resolution, provider call or input write.

## Real-source result and commands

Unchanged acceptance input: [D1 original](../../../fixtures/usp/D1/single-roof/original.json), SHA-256 `5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2`, 6,783 bytes. Origin, issuer attribution, CC BY 4.0 and reference declarations remain in the [manifest](../../../fixtures/usp/D1/single-roof/manifest.json) and [acquisition receipt](../../../fixtures/usp/D1/single-roof/acquisition.md). Foreign Dutch exterior stays in its own geography. No download or catalogue alteration occurred.

- From `services/geo`: `python -m unittest discover -s tests -p test_native_cityjson.py -v` — exit 0, six focused tests. Checks the independent [expected.json](../../../fixtures/usp/D1/single-roof/expected.json), malformed indices, duplicate/nonfinite controls, resource limits, explicit unsupported/missing-frame behavior, and nesting/null-semantic retention. Mutated copies are in-memory structural/malformed controls, not new property evidence; the real source has no hole rings.
- From the assigned worktree: `python scripts/usp/desktop-cityjson-read.py fixtures/usp/D1/single-roof/original.json --expected-sha256 5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2 --output-dir E:/BhuAayam-data/task-data/cityjson-20260930-03` — exit 0. Earlier pre-review runs are preserved separately under `cityjson-20260930-01` and `cityjson-20260930-02`; their reader hashes differ and they are not final-code evidence. The first attempted output path had a missing parent and was refused without publication.
- Inline standard-library verification — exit 0: output and reader/CLI hashes match the receipt; original unchanged; independent bounds agree; existing-output, inside-Git output and wrong-source-SHA calls each return exit 2 without overwrite/publication.
- In-memory standalone CityJSON 2.0 projection of the same retained header/objects/vertices — exit 0, preserving all supplied values. This is a format control, not another acquired original.
- Built-in `compile()` on the three new Python files — exit 0. Staged `git diff --cached --check` — exit 0.

Observed final result: 2 exact objects, 62 vertices, 230 boundary references. Building/part parent-child links and LoDs 0/1.2/1.3/2.2 match the oracle. Solid surface counts 10/16/19 and roof counts 1/2/3 agree. LoD 2.2 has three nonhorizontal roofs, with native roof-ring vertex counts 4/10/6. Decoded all-vertex bounds agree within 0.000001 m:

| | X | Y | Z |
| --- | --- | --- | --- |
| Minimum | 91447.4215 | 398435.80225 | 0.0005041809082015902 |
| Maximum | 91464.0575 | 398452.41925000004 | 8.514504180908201 |

The actual `b3_bouwlagen` remains null. No internal-floor geometry, unit boundaries or rights are established by this exterior source; none is generated. No triangulation, watertight-solid, global-placement, geometric accuracy, legal, exchange, API, rendering, scale or release-gate claim.

Private final evidence: `E:/BhuAayam-data/task-data/cityjson-20260930-03/{cityjson.json,receipt.json,verification.json}`. Output 33,168 bytes, SHA-256 `634685e1901b7e247878212262e45bf860942b1863490d7b8b67bda0b210022e`; receipt SHA-256 `8edaefe2c4b5bc6992b4e77c919a0f18801ebd03c9b7293f3ec41dbe890556bc`. Reader SHA-256 `12befa78d15c61ad6e4f3aec3c581eb0723a33c4f7b34516e86f4299e84f5492`; CLI SHA-256 `41739b9ad555198ea0118aa09b798602018e48730bb80430e54e9dc137ab9c60`.

Synchronous child processing exited. No API/Docker/provider/model process was started; no populated data, credentials, source index, existing dispatch, shared geometry authority, frontend or generated contracts changed. Originals and all three bounded output runs are preserved. Only the four assigned new files are committed; the worktree is clean at handoff.
