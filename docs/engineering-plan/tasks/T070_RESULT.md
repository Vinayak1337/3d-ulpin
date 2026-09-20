# T070 — Clean app complete

All live linked application data was cleared at the user’s explicit request on 20 September 2026: 15 map areas (including archived), 225 cases, 565 source receipts, 562 physical features, 634 registry records, 674 units, all linked revisions/jobs and 587 stored objects. All 48 application tables remain empty after restart and browser navigation. PostGIS metadata/schema, processor models, repository fixtures, downloaded design references and committed repository snapshot are retained.

Private ignored recovery backup: `.runtime/app-cleanup-20260920/` contains PostgreSQL custom dump, Redis RDB, every object with metadata and SHA-256 manifest. Every copied object was read back and hashed. Database dump was restored into a temporary isolated database and checked (565 source receipts), then the temporary database was dropped. Redis database 0 was cleared after processing stopped.

Removed hardcoded reference-quarter navigation and synthetic global search results. Historical `/studio/map`, `/studio/register`, `/studio/workspace` sample URLs now redirect to live directories; unknown routes no longer mount the synthetic app. Recent-property links are filtered to existing blocks. Renderer implementations and source/test fixtures remain available in code.

Validation: production build passed; 19 entry/routing regression tests passed; 9 browser checks passed with no page errors, covering empty queue/blocks/register/intake, empty sample search/picker, historical route redirects and empty APIs. All local services healthy. Browser evidence: `docs/evidence/t070/`.

The application is running on port 3000. Reference visual fidelity remains pending and was not accepted by the user. Earlier preservation reports describe historical pre-reset checkpoints; their datasets now exist only in the private recovery copy.
