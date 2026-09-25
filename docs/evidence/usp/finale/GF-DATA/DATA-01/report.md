# DATA-01 — matched source bundle, GF0

Producer: Codex / `gpt-6-sol` / high. Worktree: `/Users/vinayak/.codex/worktrees/51a5/3D Ulpin`; branch: `agent/DATA-01-source-bundle`; verified integration base: `546ff4edea76906b4f5640ff6fd2a9c226326ded` (`staging`). Implementation commit and executable results are recorded in `source-check.json`. Independent review remains pending.

## Sources and observed scope

| Profile | Provenance and bytes | Tested use | Explicit gap |
| --- | --- | --- | --- |
| `D4/gf0-context-v1` | Existing Uttam Nagar OpenStreetMap road/path centrelines, nine LineStrings; 8,838 bytes, SHA-256 `317953642c770fb6913a14377a9a53904d9bf0eca5af7b150afbe7d5123d0f93`. The retained object matches `data-bundles/uttam-nagar/manifest.json`; original Overpass response receipt is linked in `provenance.json`. | Real Indian road context, literal way IDs, EPSG:4326 geometry and source lineage. | Analyst-selected clip; no cadastral parcel, legal width, ownership, survey accuracy, heights, interiors or recorded rights. It is not an independent source family from the retained OSM fixture. |
| `D4/gf0-structured-codes-v1` | [LGD districts resource](https://www.data.gov.in/resource/local-government-directory-lgd-districts), Ministry of Panchayati Raj, resource ID `37231365-78ba-44d5-ac22-3deec40b9197`; downloaded CSV, 89,622 bytes, SHA-256 `b8901c98350a4057d3371ce14228181e4bb12cc447f847490efee599a0e38b59`. | Literal CSV parsing: 785 unique district codes, 36 state/UT codes, 32 exactly empty and five whitespace-only local district names. Census state code `09` is retained as text beside state code `9`. | No geometry, parcel IDs, title, ownership, building/floor/space facts or per-row effective dates. Portal sandbox warning means official-currentness needs independent confirmation. |
| `D7/gf0-access-status` | Protected `demo-data/real-block/SOURCE_ACCESS.md`, SHA-256 `b1ca574e2009a4dc4387e229f58bd429eb502aa9b005148b883cc90694264143`. | Records `failed(permission_required)` with zero acquired source bytes. | Coherent authorized Indian block, matched plans, rights and utility depth are absent. |

The source-page snapshot was used only for discovery. The first direct CSV HEAD returned HTTP 500; the page-linked published data endpoint returned CSV 200 within a 5 MB cap. The endpoint's access query token is absent from committed files. The official LGD download page displays a CAPTCHA and was not bypassed. Details are in `acquisition.json`.

## Permission and stage boundary

The OpenStreetMap asset records ODbL 1.0 and attribution. Any derived public export needs separate share-alike handling; this bundle is not qualified for a non-share-alike export. The LGD record cites the data.gov.in published-content notice and [Government Open Data Licence](https://www.meity.gov.in/static/uploads/2024/02/Gazette-Notification_OpenDataLicense_13.02.2017.pdf). A resource-specific licence field was not independently observed, so this receipt does not qualify a new redistribution workflow. Both are `test_only`; training permission is `not assessed` and no source is designated ML ground truth. The `expected.json` assets are project-authored with their own licence families.

Each D4 asset has a `usp-data-pack/1` manifest and immutable hash/byte assertion. The sidecar `provenance.json` supplies H28 metadata absent from the strict shared contract. `discovered`, `acquired`, `inspected` and bounded `tested` are recorded per source. The `parsed` manifest stage refers to `source-check.json`; `rendered` and `workflow_verified` remain `not_run`. The bounded checker verifies hashes, source IDs, shape, literal code distinctions and the D7 access boundary. It does not prove operational ingestion, placement, current administrative authority, privacy release or GF-DATA gate completion.

## Contract handoff to FND

`packages/contracts/src/usp/data-pack.ts` currently lacks typed fields for source family/release, native IDs, resource ID, acquisition timestamp, original hash/size versus subset hash/size, parser, height type/benchmark, coverage, `licenceFamily` per asset, training permission, privacy/purpose, subset lineage and the five acquisition stages. Add these through the shared contract owner with producer/consumer tests and a compatible migration path; do not treat this sidecar as a registered DTO. Preserve the distinction between source observations, authored expected values and reviewed facts.

## Local execution

`python3 tests/usp-gf0-source-bundle.test.py`, `python3 scripts/usp/data/gf0-source-bundle.py --check`, and `pnpm exec tsx scripts/usp/data/verify-pack.ts <each D4 manifest>` passed in the preliminary run. The final implementation-commit run and exact exits are in `source-check.json`. Initial test invocation through `python3 -m unittest tests/usp-gf0-source-bundle.test.py` failed because the hyphenated filename is not importable by module name; direct file invocation passed. An initial incorrect expectation of 37 exactly empty local-name cells failed; inspection found 32 exactly empty plus five whitespace-only cells, and the fixed independent expected file preserves that distinction.

This is DATA-01 source evidence only. It does not claim D5/D6 acquisition, any AI oracle, complete GF-DATA or a finale gate pass.
