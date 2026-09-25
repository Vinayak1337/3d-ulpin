# DATA-EXCHANGE-SCOPE-01 — existing source inventory

## Finding

**No eligible captured exchange scope was established from the inspected inventories.** This is not a claim that the full database contains no eligible record.

Closest source-level match: `fixtures/usp/D1/single-roof` retains an unchanged 3DBAG `CityJSONFeature` response for source record `NL.IMBAG.Pand.1655100000500568`. Its source receipt records a 2026-09-23 HTTP 200 response, `Content-Crs` EPSG:7415, and NAP height reference. `original.json` is present at 6,783 bytes with SHA-256 `5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2`. The manifest records documented CC BY 4.0, permitting redistribution with the specified 3DBAG credit, licence link, and change indication.

This does **not** satisfy the requested registry-building candidate: the D1 pack says its record workflow is unverified; the asset's `workflow_verified` and parser stages are `not_run`; it supplies no captured application scope, registry record revision, or record/source pin. The exact original hash is not present among the 497 objects in the checked-in repository snapshot's object manifest. The pack is retained historical regression material under current source policy. The FND-03 Astra review separately identifies its official D1 case as `area_feature`; it was not relabelled as a registry building.

## Other inventories checked

- DATA-01: official OSM road centrelines and LGD district codes; the receipts state these do not provide parcel or building facts, and the LGD extract has no geometry.
- DATA-05: RERA sanctioned-plan PDFs have unconfirmed source-specific reuse permission and no matched recorded building; the Swiss vector subset is foreign and has no qualified source CRS or Indian parcel association.
- DATA-09 attempt 2: official GMDA EPSG:32643 assets are sector polygons and road centrelines, with permission for scene reuse unconfirmed. Its RERA project location has no CRS and does not locate a tower. The `context_buildings` layer records no official footprint bytes acquired. LGD is an administrative code without geometry.
- `fixtures/usp/D4` source manifests and `fixtures/usp/D5` plan manifests: neither establishes a captured registry-building record pin with its official source original.
- `repo-data/manifest.json`: records a hash-pinned 3,939,807-byte database dump, 44 table digests, 206 registry-record rows and 497 retained object hashes. It does not map registry records to source revisions or captured scope pins. No record-level database read, restore, or service was performed. Thus database presence or absence of another eligible record remains unknown.

## Pins and execution boundary

- Accepted integration inventory base: `c7d01c503b3b670d332395bbde36619f8fa0fff8`.
- FND-03 report pin reviewed: result `a6d2cbf12604400858dd311762e803f3c37821e0`, report `docs/evidence/usp/orchestration/reviews/FND-03-attempt-1-astra.md`.
- Worktree: `/Users/vinayak/.codex/worktrees/data-exchange-scope-01-luna`, branch `manual/DATA-EXCHANGE-SCOPE-01-luna`.
- Requested lane: GPT-6 Luna / medium. Per-turn runtime model/effort metadata was not exposed in this task view, so the applied setting is unverified.

Read-only repository receipts and manifests were inspected. No web search/acquisition, raw personal data output, database restore/query, service startup, secret access, or source modification occurred. No new fixture was created.
