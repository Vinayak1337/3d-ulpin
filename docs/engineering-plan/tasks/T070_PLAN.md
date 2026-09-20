# T070 — Clean application reset

User explicitly requested removal of fictional and actual datasets, then clarified “clean the app entirely.” Keep a private local recovery backup, clear the linked app, and remove hardcoded demo entry points. This supersedes earlier preservation requirements for live records; their recovery copy remains intact.

1. Stop web, dispatcher, geo and worker writers. Back up PostgreSQL, Redis and every object with SHA-256 verification.
2. Clear all application tables transactionally, retaining PostGIS metadata and schema; clear the dedicated object bucket and Redis database.
3. Remove built-in sample search and picker links; redirect historical sample routes to empty live directories. Keep renderer implementations and source/test fixtures in the repository.
4. Build and inspect empty queue, block and register views. Verify no data returns after services restart.

Recovery location: `.runtime/app-cleanup-20260920/` (ignored, private). No changes to the committed repository snapshot or downloaded reference images.
