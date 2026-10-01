# GEOPARQUET-01-R — independent bounded local reader review

**No actionable finding established in the assigned scope.** Candidate code `eb8ca96ffc6c215e41328dfd29f565ccc180b7b5`, handoff `2679ee5cfa0d79c5a74c0238fb1e68e9a16c95ea`, base `6f56c274cd923ac2ab677c564371690350daa764`. [Assignment](../../../orchestration/PARALLEL_20261001E.md#geoparquet-01-r) was pinned at `a1c3460033b01831e02a106fe23d7a627036a50e`; closeout observed staging `e050cec3c8df10f8ff1a2c5c3539c5520d14de6c`, clean and read-only. Candidate checkout `C:/Users/kvina/.codex/worktrees/desktop-geoparquet/3d-ulpin` remained read-only. Report branch `task/desktop-geoparquet-native-audit` starts at preserved CityGML report `6b179ff9a502a6c82a283a6440dcb023fbfdefa8`. Supplied permissions are never/danger-full-access; Sol6.1/xhigh/default-standard requested, actual per-turn model/effort/tier unexposed.

## Reviewed behavior

The four implementation files (native reader, CLI supervisor, focused tests and runtime lock) were read; the six-file additive candidate scope reconciles. No correction is requested for these reviewed paths:

- Arrow receives a bounded original-byte snapshot through `BufferReader`; extension handling is disabled and external column chunks are rejected before decompression. Compact Thrift/footer traversal, selected row-group declared expansion, row scanning, batches, WKB framing and coordinate allocation have explicit bounds. No dataset/path entry or whole-table pandas conversion is used.
- Standard XY WKB types 1–7 have checked framing and WKB-relative coordinate spans. Unsupported cells preserve complete bytes/hash/reason. Selected row/group/column locators, original metadata byte slices and WKB hashes remain separate from decoded coordinates. Geometry decoding does not establish placement, official identity, rights or measurement.
- Integers retain decimal strings, scalar nulls remain null, and duplicate/conflicting metadata is preserved. Missing, explicit-null, declared and specification-default CRS states remain distinct; the labelled CRS84 default applies only to the supported 1.1.0 missing-CRS case. Unknown geometry types remain unknown.
- Native imports follow the Windows process gate and Job attachment. Sanitized environment, affinity, parent deadline, bounded result reads, owned cleanup and exclusive complete publication were reviewed. Local path checks refuse URL/UNC/mapped drives, alternate streams and reparse paths. These checks do not qualify OS egress denial or a two-total-thread ceiling.

The supported profile remains GeoParquet 1.1.0, root binary WKB, standard XY types 1–7 and UNCOMPRESSED/SNAPPY. Other encodings/codecs/dimensions and ambiguous metadata remain unsupported or unqualified as documented in the [candidate handoff](../native-geoparquet-handoff.md).

## Evidence reconciliation and reused checks

Recursive [source-manifest](../native-geoparquet/sources.json), reference, artifact, receipt and code pins match. Four physical/Git implementation pins match, as do four retained wheels and **1,815 installed packaged files**. Installer-rewritten `RECORD` and `.data` destinations are excluded as recorded per wheel; exact compared-file pin lists are retained privately. Runtime is Python 3.13.7, PyArrow 21.0.0, Shapely 2.0.7, NumPy 2.2.6 and psutil 7.0.0. No install or acquisition was repeated. An initial reviewer helper's METADATA-name case comparison failed; its corrected reconciliation exits 0, and the original helper/log remain retained. That setup failure is not a candidate defect.

Two unchanged public upstream inputs remain `test_only`, with original acquisition, attribution and limitations preserved:

| Input | Original bytes / SHA-256 | Saved behavior |
| --- | --- | --- |
| GeoParquet v1.1.0 example, upstream revision `525b8f9150db637a7dfa9d8ba46af5f0ed354094` | 29,834 / `f3e4bf0b0376904f851057d2047bb69e81dce913f2ff1aabe8a4dc1ec0789bc2` | Two of five rows, Fiji/Tanzania, int64 literals `5496`/`63177`, 148 coordinate values, next row 2; output SHA `b69aaeeb3202a94f0bb6ce9ce3ed8971fba43afbfc56556785d5b98209f4a431`. |
| Apache `alltypes_plain.parquet`, revision `56653c437c8092f704a092d0d1d4e600124cd49f` | 1,851 / `12a618d20a59ee0967fef45e7ec1ff6d451e724838edc1bbeac780ca15e8fcc4` | Naturally absent geo metadata: `unsupported / geo_absent`, eight-row inventory, zero decoded rows; output SHA `81ad130e4632c9daf5d908daf3f3c44dbb98d16fbb2ab934c68d1c039cb03722`. |

Saved **nine passing tests**, compilation (exit 0), supported/geo-absent CLI journeys (exit 0) and URL denial (`LOCAL_ONLY`, exit 2, no output directory) were inspected and reused. The independent original-byte oracle code was read and its saved result reconciled; it was not rerun because it writes the retained result. It checks Compact Thrift page headers, Snappy dictionary bytes and RLE/bitpacked row indices independently of the production reader/Arrow/GEOS. Original name/metadata slices, both complete WKB hashes and first XY match. First WKB is 400 bytes, SHA `77d90b94153764abd866a6b527f0151d556cea5a69f007b3f034b08802a91df4`; XY `[180.0, -16.067132663642447]` occupies WKB bytes 22–38.

## Narrow temporal precision control

One unresolved concern was whether conversion of Arrow `time64[ns]` through Python `datetime.time` could silently lose nanoseconds. A private one-row control combines the unchanged first upstream WKB with authored `time64[ns]` tick **1**. It is a type/precision control, not an operational record or learning label. Exact private reader/CLI copies run through the supervisor's gate/Job/affinity/deadline; an in-memory adapter changes only its worker dispatch path so fixture generation and production `extract()` occur inside one gated child. Candidate files were not edited.

There were **two native child attempts for this one concern**, each exit 1. The first produced no diagnostic output. The second captured `GeoParquetError` with `ROW_DECODE`: “Pinned Arrow rejected selected row data; no partial output is published.” No successful rounded scalar or production projection was returned. Pinned `pyarrow/scalar.pxi` lines 643–660 and 702–727 confirm conversion of non-microsecond nanoseconds raises when pandas is absent; the duration path also refuses this loss. No actionable precision defect was established. **Non-microsecond time64[ns] is refused; broad temporal coverage remains unqualified.** The original stayed unchanged and owned children were reaped. No fresh real-source journey or additional native probe followed.

## Receipt, preservation and limits

Private receipts under `E:/BhuAayam-data/task-data/desktop-geoparquet-review/`:

| Receipt | Bytes | SHA-256 |
| --- | ---: | --- |
| `verification.json` | 13,616 | `4d67d0cde9a38b7032471a160f5faf2573dab6aef80aaec4719e087ff295daa8` |
| `reconciliation.json` | 15,972 | `d72f3312062e93349ef34e11e513209004372d48c4521cc677197fb7c4dce1e5` |
| `time-precision-verification.json` | 3,818 | `d8abd8f2fa1d79929750bbcc7dfc00f0faff541153df8a577fa63d55ae20317d` |

Reconciliation and precision-resolution helpers exit 0. Final closeout uses only stdlib: `C:/Python313/python.exe -I -S -B E:/BhuAayam-data/task-data/desktop-geoparquet-review/finalize-review.py`, exit 0. It pins private evidence/helpers/exact code, candidate clean state and preserved branches/physical markers; it repeats no wheel comparison, parser check or source campaign.

Only this report is committed. CityGML `6b179ff`, KML `90169d0` and DXF `3f675e4` review branches are preserved. The three `area.py`/`native_pdf.py`/`native_archive.py` physical EOL markers match their retained byte pins, with empty content/index diffs before report staging. Originals, prior outputs, private controls and failed-attempt evidence remain retained. No services, Docker, providers/models/GPU, frontend, generated contracts, additional workers or polling were used.

The retained Windows profile is 2 GiB, two affinity cores, 60 seconds and six monitored threads including helpers, with 32/16/1 MiB original/output/footer caps and selected row-group expansion/scan bounds. Saved resource observations support those particular runs, not general performance or adversarial qualification. Apache/BSD/GEOS notices are retained; underlying example-data redistribution and production packaging clearance remain deferred. API, full geometry/format conformance, global placement, accuracy, learning, scale, Linux and release gates remain unqualified. Return this review through the authorized lead callback, then stop; integration remains with the lead.
