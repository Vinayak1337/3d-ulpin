# DATA-REF-02 — private reference-document enrollment

Two unchanged retained authoritative originals are now durable **source-only** documents in the existing application authority, each in its own evidence case. Native-only extraction completed; exact original reads and same-key replay passed. The five useful selected parts have stable source/input/result/fence and literal line locators for the future reference-binding implementation. No D1 attachment or accuracy/admission qualification was made.

## Observed enrollment

| Original | Source-only case / source / job | Result |
| --- | --- | --- |
| EPSG:7415 XML, 2,037 bytes; SHA `0972790c9b2befabb049c27a17c628cf96faa65ff4eb1bee0e834e845678ecd9` | Case `18d2aba5-35aa-4db1-9432-d6552d3bdcfb`; source `0bb1289a-a087-4b33-9590-4e693ddaa23b`; job `b15e790a-65c8-4920-ba59-608a7cd25204` | `text / extracted`; 31 literal parts across two API pages. Result `76aeb8d859c59e4af3d80eadaec3517c0bdee06b89a4a9fe8529a53a0021930c`, 20,352 bytes. |
| 3DBAG webservices HTML, 37,989 bytes; SHA `79f8def3e9b60f24279e0afb7bd03852d3c25afe16a411c5873f4aabb7064aee` | Case `b45d7625-9d99-41a9-8cde-e366fa933378`; source `d37030cf-0c46-4268-ae0b-18097aa30858`; job `e63f6bd6-f6f9-4384-8a3f-7cc51d86da8c` | `text / extracted`; 687 literal parts across 28 API pages. Result `4e94b38fb271b181fdf22bb97ca557b9eb7004b93e0c2c1f4a690e71202f9ce3`, 412,076 bytes. |

Both canonical inputs pin case revision 1, source revision 1, `native_only`, policy `source-document-native/1`, null gateway/layout values and document reader `e745ab9bf180da35d3fd59be8021da0f0944b203b34debb83549a590921d6166`. Canonical input hashes are respectively `ba0ddf7f86c0e190dfcfc0e88d3f1880519fd235c1967bc425381169e2963938` and `991a7eb3e372328b4bf2b2b49299d03313f092d086bb53c7aeaec72b633f91d6`. Each has one accepted attempt/fence **1**, whose completion hash matches its result. Model status is `not_requested` with zero calls/candidates; no OCR selection/result exists. These are evidence workspaces, not invented property/site/geometry records.

## Useful literal parts

| Source / original line | Part ID / SHA-256 | Literal observation |
| --- | --- | --- |
| XML 26 | `4d6affbc-df75-4c40-a35c-4171941a70b3` / `e04614fa28f72b85922d58a35a733218a6bd83365a09ec5142eab9d4d5512df7` | `<gml:name>RD + NAP height</gml:name>` |
| XML 29 | `8f987d25-35f4-440e-a049-d813b11d7799` / `e0116cae51c1bea9d334595762b4fedef90ab02dfa6e6686318e6a35acda7d23` | Component reference to EPSG CoordRefSystem **28992** |
| XML 30 | `37beeb6b-9192-4cec-ba10-619d2480bbd8` / `f93ddb46d92b8f53ebac2c998857b6327d022fa913ff70567e2b9887fc2b0559` | Component reference to EPSG CoordRefSystem **5709** |
| HTML 1261 | `5f488a53-0c0c-40bd-8d26-203d34e66ddc` / `7447629fd97563a09820a1a443afc6e4684ee0be2b4f15bbdafafdfff043b484` | API paragraph: “At the moment the only supported CRS is Amersfoort / RD New + NAP height (EPSG:7415).” |
| HTML 1272 | `c4d5c4ec-bfdf-4adc-ad41-cd565f05065c` / `8c3c45cc919d3080c4c13cde3dac731cac1e85deb1c5d75d8f40ba0c5780f7e9` | Tiles section: “Tileset and content CRS is EPSG:4978.” This concerns a separate delivery path. |

[manifest.json](manifest.json) retains each exact full part text, locator/unit hash, source/input/result pins, current access/context hashes, result reference and original issuing URL/version/licence from the accepted [source research](../cityjson-reference-evidence/README.md). The selected lines match the unchanged originals exactly. Locators are **literal source lines**, not semantic XML elements/HTML DOM selections, surveyed controls or reviewed frame assertions. All returned parts remain bounded at 4,096 characters; pages return at most 25 parts. HTML/XML was read as UTF-8 text; markup/scripts were neither interpreted nor executed.

Three other HTML lines, **1240, 1245 and 1399**, differ because the existing conservative privacy redactor masks identifier-shaped text. They are retained as redacted derivatives, and the original remains available; no source bytes were rewritten. Selected five parts are unaffected. Character offsets belong to each extracted/redacted unit, not arbitrary raw-document offsets. The application does not acquire linked CRS definitions or qualify a transformation merely because a line contains a URL.

## Preservation and cleanup

The earlier D1 case/source/jobs, registry draft/records/reviews, validation jobs/attempts and nine pinned stored objects matched their accepted before/after/final hashes. All prior global case/source/job/metadata/attempt/event/operation rows and 1,360 bucket entries remained unchanged. Intentional additions are exactly **2 cases, 2 sources, 2 jobs, 2 metadata rows, 2 accepted attempts, 4 operations and 4 objects** (two originals plus two extraction results); no events or active jobs remain. Counts changed from 37/34/71 cases/sources/jobs to 39/36/73; bucket entries from 1,360 to 1,364. Same-key receipt replay created no duplicate source/job/attempt.

API/dispatcher/geo/worker are stopped; the retained PostgreSQL/MinIO/Redis identities, mounts and storage remain running. Ports 3192 and 28000 are free. The five previously recorded runtime/config hashes match. Runtime returns to lead; source-index/catalogue remain lead-owned. No model/OCR/provider/native-validator call, associations, registry recording, qualification, frontend or new source discovery ran. Existing denial evidence was reused.

## Runtime and evidence

Served/base commit **64dc4e7fc7f553625361f15ffd46e2cabd16b90c** in `C:/Users/kvina/.codex/worktrees/association-sources/3d-ulpin`, branch `task/desktop-reference-document-enrollment`; primary staging stayed read-only. Actual retained processing image **sha256:f522efd1bf4975575b016cdeb587c1d12f0236697b9e20c45fcf64e9947e6a30** was inspected independently of the newly built tag. Twenty-six applicable container source copies were freshly pinned; differences in physical CRLF versus LF bytes are explicit and normalize to the accepted Git code, not rewritten saved hashes. Host code/reader, process, image and config pins are in private receipts; the manifest pins those receipts.

Preflight preserved and corrected an old CRLF copy of `native_cityjson.py` using its exact accepted Git LF bytes (repository `eol=lf`); the prior physical bytes remain private, and Git blob/index content is unchanged. The accepted CityJSON reader digest remains `377edfe71f3d08e0a1f4fb710441022b9a26fdadd0efa70724d0d1dea0f3d398`. Private helper fixes addressed a Windows ESM URL, an over-specific cache assertion, Uint8Array decoding and noncanonical jsonb-order hashing; saved successful enrollment observations were resumed rather than rerun. Original download responses use the existing **private, max-age=60** policy; native status/parts use **no-store** with current private authority. No stronger cache behavior is claimed.

Commands `runtime.mjs preflight/start/live/enroll/stop` and `verify.mjs` all completed with exit 0 after those bounded helper/checkout fixes. The final verification matches all selected text/hashes, canonical input/result/attempt fences, replay receipts, bounded pages, exact permitted row/object deltas, unchanged histories and stopped ownership. Receipt `E:/BhuAayam-data/task-data/desktop-reference-document-enrollment/verification.json`, SHA **dcc059a1bf2aebb528dd3a600d2e8984cad98a03a6151d3f93b1dbcefb975ce5**; all source/input/result/part/code/helper artifact hashes are indexed in the manifest. `git diff --check` and staged whitespace check pass. Supplied permissions never/danger-full-access; requested GPT-6.1 Sol/high/default-standard, actual model/effort/tier unexposed.

This supplies actual accepted document parts for the independent binding implementation. The future reference API was not called. Independent D1 controls, release binding, surveyed accuracy, global placement, canonical admission and release acceptance remain unqualified; the goal remains paused reference.
