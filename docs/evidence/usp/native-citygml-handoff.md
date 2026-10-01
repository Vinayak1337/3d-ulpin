# CITYGML-01 — bounded literal CityGML inspection

Code: `1b2ba4ea07468b84e72dd1830d55ae2f94e0a962`, from assigned base
`6f56c274cd923ac2ab677c564371690350daa764`, on
`task/desktop-citygml-native-reader` in
`C:/Users/kvina/.codex/worktrees/desktop-citygml/3d-ulpin`.
This is a local CLI reader checkpoint awaiting lead review/integration.
Staging stayed read-only; its later observed head was `142905fa76a6a32b0fab3ce49ff635d43de1b097`.

The reader preserves source-native building/part IDs and XML containment,
literal properties and LoD declarations, namespaces, reference/axis/unit fields,
finite coordinate token arrays, and exact original byte spans for elements,
attributes, text and numeric tokens. Internal fragments inventory unique,
unresolved, duplicate and cyclic targets without expansion. An `xml:base`
context is explicitly unsupported for reference resolution. DTD/entity
declarations are denied before parsing; schemas, XLinks and external resources
are never fetched. Originals remain unchanged and only complete result/receipt
directories are published without replacement.

Supported profile: uncompressed XML 1.0 UTF-8, optional BOM, CityGML **2.0**
`CityModel` and building-module declarations. GML Envelope, Solid,
CompositeSurface, MultiSurface, Polygon, LinearRing, LineString and Point are
declaration inventory, with plain numeric-text `pos`, `posList`, `lowerCorner`
and `upperCorner` arrays where their enclosing module/geometry is supported.
Supplied dimension literals `2`/`3` permit count checks; absent dimensions remain
null and coordinates stay flat. Numeric spelling is authoritative; decoded
binary64 values are separate observations with no measurement qualification.
All XML-ancestor reference declarations remain visible. No CRS/default/unit
inference, sibling-envelope inheritance, transform composition, tessellation,
schema validation, solid validity, measurement, floor/unit inference, rights or
canonical identity follows. Other CityGML versions fail as unsupported;
non-building modules/ADEs, unrecognized GML profiles, relief/TIN,
OrientableSurface and MultiPoint remain explicit unsupported literal inventory.

The [source manifest](native-citygml/sources.json) pins exactly two unchanged
OGC-served standards examples, acquisition metadata, attribution, code/runtime
hashes, independent original locators and saved results. They are `test_only`
published examples, not operational property/survey records. No retained
CityGML pack was listed in the consulted source index/catalogue. The specific
example redistribution licence remains unverified; OGC copyright/terms and
SIG 3D/GDI-DE acknowledgement are recorded. Originals stay outside Git and
launch clearance remains separate. Shared source-index/catalogue updates are
lead-owned.

| Original | Saved local observation |
| --- | --- |
| `Building_and_garage_LOD2-EPSG25832.gml`, 19,499 bytes | CLI exit 0, `partial`; 256 elements, one Building and one contained BuildingPart, 28 coordinate declarations, 213 decoded values, 15 reference declarations. Relief/TIN, orientable surfaces and other modules are unsupported. Envelope CRS/dimension remain literal; building posLists have no guessed dimension or global placement. |
| `Building_LOD1-LocalEngineeringCRS.gml`, 11,158 bytes | CLI exit 0, `partial`; 157 elements, one Building, 18 coordinate declarations, 96 decoded values. `#local-CRS-1`, inline axis-unit/anchor declarations and custom metadata are retained; no local-to-world transform is composed. Relief and custom metadata remain unsupported. |

Private evidence root: `E:/BhuAayam-data/task-data/desktop-citygml-native/`.
Final outputs are `run-02-lod2/` and `run-02-local/`; prior runs and initial
failed check logs remain retained. `local-proof.json` is SHA-256
`5db4db347775113ac75bd24f36b475488bb845a05300450668ec6c8001b82552`.
The proof pins final physical/Git code bytes (equal), CPython executable,
bundled Expat extension, psutil wheel, originals and result/receipt files.

Verification used the isolated CPython 3.13.7 / bundled Expat 2.7.1 environment
and pinned psutil 7.2.2 from [the runtime lock](../../../scripts/usp/citygml/runtime-lock.json).
Six focused tests passed; after the final XML-base change, the affected external
resource/original-locator checks passed again (2 tests). All three owned Python
files compiled without pycache, exit 0. The saved CLI proof has 12 passed
expected/actual checks: nine literal fields read independently from original
bytes, external-DTD and malformed-input failures with no publication, and
unchanged original/prior-output hashes on denied replacement. No altered
original supplied successful source evidence; tiny adverse XML controls are
security controls only. A publication-control mock initially omitted its worker
file; correcting it exposed a Windows read-only fsync failure, which was fixed
with a writable derivative handle. These failed logs are preserved.

Reproduce the source journey with a fresh private destination:

```powershell
$env:CITYGML_ORIGINALS = 'E:/BhuAayam-data/task-data/desktop-citygml-native/originals'
& 'E:/BhuAayam-data/task-data/desktop-citygml-native/env/Scripts/python.exe' -B -m unittest discover -s services/geo/tests -p test_native_citygml.py -v
& 'E:/BhuAayam-data/task-data/desktop-citygml-native/env/Scripts/python.exe' -B scripts/usp/desktop-citygml-read.py "$env:CITYGML_ORIGINALS/Building_and_garage_LOD2-EPSG25832.gml" --out-dir 'E:/BhuAayam-data/task-data/desktop-citygml-native/new-private-result'
```

Use the assigned worktree as cwd. The CLI refuses existing destinations,
Git-contained output and direct network/URL paths. A private parent ACL is
caller-managed. This task's owned data directory and retained originals/results
now allow only their Windows owner, SYSTEM and administrators; the broad
inherited root ACL was narrowed without changing shared parents or source bytes.
Before local dependency installation/checks, the host had about 16 GiB free
memory and no other Python parser process was observed.

The supervisor adapts the established IFC/document process pattern without
editing it. One gated worker runs after Windows Job attachment: 32 MiB original,
16 MiB projection, 2 GiB Job/process private-memory ceiling, one processing
process, 60-second deadline, two affinity cores and single compute-pool intent.
XML depth is 64, element count 25,000, tag/text strings 64 KiB, and decoded
coordinate values 100,000. Logs have bounded receipt counts; worker stdout/stderr
are discarded. Final source runs used affinity cores `[0,1]`, at most four
sampled OS threads, about 48.6/47.5 MB peak Job private bytes and 0.112/0.097 s.
The monitored ceiling permits four OS helper threads in addition to the two-core
processing envelope. Environment variables do not enforce OS egress or a literal
two-total-thread limit. Those claims are explicitly false in receipts. POSIX
enforcement/publication and deadline/memory-kill behavior remain unqualified.

Requested settings were Sol6.1/xhigh/default-standard. Actual model/effort/tier
are not exposed in this turn; supplied permissions are `never` /
`danger-full-access`. No settings, app database, shared API/job/DB/dependency,
Docker, frontend, learner or provider changes were made. All owned processing
children stopped after each check; isolated environment, sources and outputs are
retained. API/job/registry wiring and every release/scale/accuracy/learning gate
remain deferred.
