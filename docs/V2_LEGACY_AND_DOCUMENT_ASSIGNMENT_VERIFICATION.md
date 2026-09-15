# Legacy route and document-assignment verification

Verified locally on 15 September 2026. This records the bounded migration and source-copy seams; it does not claim full V2 visual acceptance or public deployment.

The old UI is available under `/legacy`, including areas, property register/preparation, registry, workbench and sites. Exact former page paths redirect there. `/` opens `/v2`; a root URL containing `case` retains its legacy workspace context. Repeated query values, encoded identifiers and other query parameters survive the redirects. APIs keep their existing paths.

Legacy global and navigation CSS use `@scope (.legacy-app)`. The shared root layout contains only neutral page sizing and Cesium widget CSS. Chromium verification confirms legacy padding/layout applies inside that scope while styles remain inert outside it, including after the legacy subtree is removed. Shared old components need an explicit V2 styling bridge. `PreparationBuild` accepts `editorUrl` for its caller's presentation route.

Executed:

```sh
pnpm exec tsx --test apps/web/lib/legacy-url.test.ts
pnpm typecheck
pnpm exec tsx scripts/verify-case-document-copy.ts
services/geo/.venv/bin/python -m pytest services/geo/tests -o addopts='' -q
```

Results: all **4 route/style tests passed**, typecheck passed, both document-copy integration groups passed, and **163 Python tests passed in 2.13 seconds**. The copy test invokes the actual API handler and live database, S3 and Python processor. All its allocated synthetic entities and objects are removed afterward.

`POST /api/v1/import-packages/:id/copy-case-documents` accepts `expectedRevision`, original `caseId`, 1–20 distinct `sourceIds`, destination `buildingId`, and a nonempty `reason`; it returns the updated import package. The destination must be that building's canonical preparation. Existing PDF plans, PNG plans and levels CSV sources are supported. PDF/CSV limits are 10 MiB each, PNG 16 MiB, batch 64 MiB. Other profiles require explicit import mapping.

Every original is hash-checked before copying. The batch saves once, with new preparation source IDs and immutable `copiedFrom` case, source revision/profile/hash, locator, reason, time and actor provenance. Original bytes and case history remain unchanged. Native CSV values become reviewed candidates; PNGs and textless PDFs remain references without inferred geometry. The existing CSV `method` column is retained as text only. Exact concurrent retries retain IDs; stale, cross-property, wrong-owner, unsupported-profile, corrupt-byte and malformed-native-input requests cannot partially change the package. A previously copied subset requires selecting new documents rather than duplicating evidence.
