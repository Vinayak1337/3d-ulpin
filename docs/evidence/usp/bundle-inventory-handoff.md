# BUNDLE-01 — private ZIP inventory handoff

30 September 2026. Implementation base: `1df105b407f2d86553ef66649a41c9d2e87eef1e`, branch `task/desktop-bundle-inventory`. The original ZIP remains the retained source. The existing document job now returns a private, bounded member inventory as an `unsupported` native result with no text parts or model candidates. The status and result schemas retain older receipt readability. DOCX and XLSX dispatch remains active.

## Scope and limits

The inventory records the outer SHA-256, stable ordinal, bounded path label, declared and observed member bytes, member SHA-256, declared CRC and read result, route hint, issue, and shapefile companion state. It does not extract members into files, interpret scripts, import GIS, associate documents, or turn names into evidence. Unsafe names are replaced with a digest label. Nested archives and scripts remain inert. Unknown central directories, member/count/expansion problems and incomplete companions retain distinct coverage or issue states. The helper limits the inventory to 256 entries, 256-character path labels, 8 MiB per member, 30 MiB expanded, a 1000:1 declared ratio and 15 seconds of member reading, within the existing 10 MiB native and 16 MiB retained-source envelopes. Oversized ZIP64 declared totals cannot cross the JSON safe-integer boundary.

## Private API observations

The guarded isolated project `ulpin-usptest-b050544f3d2cb99e` used API port 3192 with the model gateway disabled. [The source index](../../api/real-sources.md) and [dataset catalogue](../../api/datasets.json) identify the retained inputs. The successful receipt is `E:/BhuAayam-data/task-data/desktop-bundle-inventory/runtime-2026-09-29T21-26-24-993Z.json`, SHA-256 `c1327c25945b4e309914a7ee62e9505ed816f2159f28b122fd1404a3602ea196` (UTC timestamp). Its four jobs completed:

| Unchanged input | Original SHA-256 | Native result |
| --- | --- | --- |
| Karnataka KSRSAC `District.zip`, 3,935,596 bytes | `0f5b59339c5d4e3a3c1efd4be810edd38264e40a51f29f17ab78b19067f88891` | `unsupported` / `ARCHIVE_INVENTORY_ONLY`; 7 members, 6,005,321 declared and observed expanded bytes, complete integrity and shapefile companions, zero text parts |
| Existing NYC 10013 locally assembled context ZIP, 4,778,508 bytes | `ec691b929143f520cbf8b427bc071877030c045a035fd99697cdcf231d542111` | `unsupported` / `ARCHIVE_INVENTORY_ONLY`; 76 members, 14,486,364 declared and observed expanded bytes, complete inventory, scripts explicitly inert, zero text parts |
| UK FCO retained XLSX | `aa301b90933f3b779a69a855f271fa7ab6217b5e0a93b279fca7636d675f32f4` | `extracted` / `xlsx`, first status page has 25 text parts, no archive inventory |
| UK MHRA retained DOCX | `3d709b94da96e91c83e7c901b3b1dca1b4d1403f0602696eff8c77973d2aae92` | `extracted` / `docx`, first status page has 25 text parts, no archive inventory |

Each submitted source was downloaded through the private original-file route and matched its input byte count and SHA-256. A cross-case status request returned 404. The status pages expose 25 parts at a time; the table does not claim those are whole-document totals. These are separate geographic and official-source contexts. The NYC ZIP is a retained local assembly, not an issuer-original ZIP. Source-specific permission for the exact Karnataka ZIP remains unconfirmed in the source index; this local inventory does not qualify publication, training or release use.

The first attempt returned `tool_error` because the guarded runner rebuilt the geo image but reused an older stopped geo container without the new helper. Only the owned geo and worker containers were recreated from the rebuilt image, with storage containers and volumes left in place. The private journey then passed, and was repeated after the final bounded-reader change to produce the receipt above. The initial failed job and earlier passing jobs remain in the isolated service history.

## Checks and pins

- `pnpm install --frozen-lockfile --offline` — exit 0; ignored local dependencies only.
- `pnpm typecheck:backend` — exit 0.
- `pnpm exec tsx --test tests/document-archive-inventory.test.ts` — exit 0, 2 tests; checks the inventory contract and older result readability.
- `PYTHONPATH=services/geo python -m unittest services.geo.tests.test_native_archive` — exit 0, 4 tests; checks companion/inert status, unsafe path, corrupt member and count-limit coverage.
- `node scripts/usp/desktop-bundle-inventory-smoke.mjs E:/BhuAayam-data/runtime/prefix-worker-20260929 E:/BhuAayam-data/task-data/desktop-bundle-inventory` — exit 0 on final run; private original downloads, two ZIP jobs, two OOXML compatibility jobs and cross-case denial.
- `git diff --check` — exit 0.

Final source SHA-256 pins: contract `6fe0624c2ceaf296f2365c127370ba2d12a587a55e0428f31c8851b55e100a63`; TypeScript native reader `096ae515fa5ab13e758f6da901ddac84bf312b10ed8548b338037b6195223383`; geo dispatch `a6cf728a98ecfe57e1782c7644659cf4d424937fd9e9f4a9bbcaf7ebc84dd6ff`; archive helper `b6e3207eacc293403bea6d5f8691b63d41c269d6c5ddc1af96884b194788f4c9`. The result reader fingerprint was `d9a91bec11d01b5fd20edea3486a0736bb58c0cdc9bb7c693d71a732540fd632`. Actual model and effort were not exposed in the worker turn; Sol/high/default was requested, and per-turn service tier was not observable.

This is a private inventory capability, not member ingestion, source interpretation, association, training qualification, performance qualification or a GF gate pass.

## Encrypted OOXML compatibility correction

Independent review at `135f3db90e4040d22ce32a6130644f60a98957c6` found that the first candidate routed encrypted Word/workbook ZIPs to generic inventory, changing their established top-level `encrypted` recovery status. The corrected dispatch retains `Encrypted document archive is unsupported.` for ZIPs with exactly one of `word/document.xml` or `xl/workbook.xml`; the TypeScript reader continues to map this to `encrypted` / `DOCUMENT_ENCRYPTED`. Encrypted generic ZIPs and ZIPs with both document entry points remain `unsupported` / `ARCHIVE_INVENTORY_INCOMPLETE` with member-level `ENCRYPTED`. The control ZIPs contain only technical header bytes, no operational records.

Correction checks: `python -m py_compile services/geo/geo/area.py services/geo/tests/test_document_archive_dispatch.py` exited 0; direct parser tests in the pinned geo image with the worktree code mounted read-only passed 2/2, covering both OOXML candidates plus generic and ambiguous cases; `pnpm exec tsx --test tests/document-archive-inventory.test.ts` passed 3/3, including the top-level encrypted mapping and older receipt; `pnpm typecheck:backend` exited 0. The guarded runtime preflight, start and final smoke exited 0. The runner's image build reused older stopped containers, so only its owned geo/worker containers were recreated before the smoke; their `area.py` SHA-256 matched the worktree `bb0375fbfb97c6fd4c567213f3c5d9d8683c5406351afcc733c15e4bee3fc655`.

The new private receipt is `E:/BhuAayam-data/task-data/desktop-bundle-inventory/runtime-2026-09-29T21-46-20-942Z.json`, SHA-256 `cfda84905b342f6817c05117acdbd3c35d31c5a505629f0f14e60148f8369abc`; all four unchanged inputs repeated the results above, including original download hashes and cross-case 404. Its reader fingerprint is `f7c73724a87f3704b01cbd4fd00c32eb130870dd423c4d3be4a36d6488241899`. The earlier receipt and stored jobs remain intact. Final stop exited 0: owned API/dispatcher/geo/worker are stopped, while PostgreSQL, MinIO, Redis and their three populated volumes remain running/preserved. No provider call or member extraction occurred.
