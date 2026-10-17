# GEOPARQUET-03 — aggregate scan admission and accepted continuation

3 October 2026. Code `418b142d69f19973edad60381b0f6c9fdeb81947`, base
`c170fc17267f4492af89eedd7208c11c313f6522`, branch
`task/desktop-geoparquet-continuation`, exclusive checkout
`C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`.
[Assignment](../../orchestration/PARALLEL_20261003.md#geoparquet-03--bounded-continuation-through-the-native-reader).
Requested Sol6.1/xhigh/default-standard; actual per-turn model/effort/tier are
unexposed. Supplied permissions: `never` / `danger-full-access`.

The native reader now preflights the aggregate rows required by all selected
groups before `iter_batches`. It includes each selected group's prefix and
rounded final batch, clipped to that group's declared rows. The existing
100,000-row ceiling applies to this aggregate as well as individual groups.
`ROW_SCAN_LIMIT` refuses excessive windows without publishing partial success;
the canonical wrapper preserves it as `GEOPARQUET_ROW_SCAN_LIMIT`. This
conservative check can refuse a window that would stop earlier at its coordinate
budget. Batch size, all caps, output format and supported literal semantics
remain unchanged.

Only four code/check files changed: native reader, canonical wrapper error
allowlist, one metadata admission regression and one actual continuation test.
CLI/lock/contracts/config/service/processor/worker, generic jobs/dispatcher/
source protection, fusion/citations and ML are unchanged. Existing
[five-route API](geoparquet-api-handoff.md) and source/result/fence authority
remain. Reader changes require explicit current jobs/profile/tool pins;
historical originals/results/receipts are retained with strict checks and no
compatibility exemption or inventory repin. Lead owns catalogue/index/ledger
integration; there are no new operations or wire schemas to publish.

## Concrete continuation

Reuses unchanged upstream `example.parquet`, 29,834 bytes, SHA256
`f3e4bf0b0376904f851057d2047bb69e81dce913f2ff1aabe8a4dc1ec0789bc2`.
[Manifest](native-geoparquet/sources.json) retains origin revision, terms,
attribution and foreign `test_only` qualification. Exactly two sequential native
runs use the same frozen current reader and runtime profile through canonical
retain/job/worker/retry/status/native/original methods with memory SQL/S3
controls. Initial upload and continuation request replay without extra jobs.

| Window | Literal rows | Coverage | Artifact bytes / SHA256 |
| --- | --- | --- | --- |
| start 0, count 2 | 0 Fiji, 1 Tanzania | partial; scanned 2, 148 coordinate values, next row 2 of 5 | 23850 / `b69aaeeb3202a94f0bb6ce9ce3ed8971fba43afbfc56556785d5b98209f4a431` |
| start 2, count 2 | 2 W. Sahara, 3 Canada | partial; scanned 4 including prefix 2, 1644 coordinate values, next row 4 of 5 | 74975 / `78fb245f218091ba7a1e945b86c2b02dc3fd02cff3a2f7bc34c795ea092e3044` |

The initial full artifact is byte-identical to the accepted prior projection.
Continuation retains exact accepted parent job/result/artifact/input/fence pins,
same source and current tools, native row indices/column locators and WKB
bytes/hashes. Wrong parent/result/artifact/next-row requests and wrong internal
parent input/fence or reader pins are denied. Both accepted artifacts and the
unchanged original remain readable after continuation. One row remains
uninspected. Source literal values do not establish operational accuracy,
geometry/CRS validity, canonical identity, rights or learning labels.

## Verification and limits

Private evidence: `E:/BhuAayam-data/task-data/desktop-geoparquet-continuation/`.
`final-pins.json`: 15,265 bytes, SHA256
`4f95fe12b76ba68e05624607afd2b98c641425599d0a4740e3d08af44aac4bfc`;
four physical/Git code pins, eleven unchanged authority pins, twelve evidence
pins, originals, saved outputs and preserved GEOPARQUET-02 receipts.
Physical reader/CLI aggregate:
`3126c1531f82c6e4b7b9d8bdfd7f1ece06c817ba4a601e78f97ed95e7ff17485`.

- Metadata-only aggregate regression: exit 0, one pass, no native imports/runs.
  Two individually admissible groups requiring exactly 100,000 rows are refused
  when batch rounding adds a row; the exact 100,000 batch-row boundary passes.
  These are labelled technical metadata controls, not source records.
- Configured canonical continuation: exit 0, one pass/no skips; precisely two
  native runs, 0.204/0.206 seconds, peak Job private bytes
  61,652,992/61,960,192, affinity `[0,1]`, four sampled OS threads.
- Backend server/API types: exit 0. Three affected Python files compile without
  bytecode; post-run full inventory and staged whitespace checks exit 0.

Fresh `profile-01.json`: 5,877 files, 1,240,550 bytes, SHA256
`4cafe1746bdcb751f548d48d8ab10496a19aa4bac551f5ea03c1370cc651a499`.
Existing installed runtime/environment bytes are unchanged; current checkout
imports remain identical to the frozen profile after both runs. No dependency,
runtime/cache/lock repair or cap increase. Existing 32/16/1 MiB source/output/
footer, 1,000 rows, 100,000 coordinates, 128 MiB per-group expansion,
60-second/2 GiB and gated single-child supervision remain. Prior absent-geo proof
is reused: unsupported metadata returns before this preflight; no fresh
absent-geo parser or old security campaign ran.

Scratch is empty, no task-owned Python remains, and task evidence ACL permits
owner/SYSTEM/administrators only. Preserved GEOPARQUET-02, CityGML and KML fusion
branches remain. No services, provider/model/GPU, source acquisition or frontend
work. Current HTTP/PostgreSQL/private-object persistence, native multi-group
benchmark, authentic applicability/accuracy, scale, Linux, OS egress denial and
release gates remain unqualified. Integration requires a fresh profile for its
exact checkout before new native jobs; preserved historical profiles stay intact.
