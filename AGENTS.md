# 3D ULPIN hackathon implementation

Latest steering: first correct the reference image pack UX (T069), then resume
T064–T068 app changes. See design/officer-studio-v3/DESIGN_BRIEF.md.

Latest user priority (20 September 2026): Studio is the sole officer interface.
Audit and simplify the complete source-to-record workflow for SIH 26011, safely
automating source metadata and removing redundant presentation. Preserve all
originals, identities, revision history and unique processing capabilities.
Replace old pages with thin Studio URL resolvers; delete proven-unused UI code.
Execute T062–T068 one bounded task at a time with fresh Astra 6 High workers and
parent review. See docs/engineering-plan/STUDIO_UX_PLAN.md and CURRENT_WORK.md.
This supersedes historical instructions to retain duplicate compatibility UIs.

Historical user priority (T058): T057 was rejected visually. First copy the actual
`E:/Projects/ulpin-city-studio` design and interactions into the product with
working routes; then improve that Studio against the original image mockups.
Prepare consistent synthetic records/documents first where needed. Compare actual
browser captures side by side before claiming completion. See T058_PLAN.md.
This authorizes the Studio's shared Three/R3F viewport; retain existing Cesium
and backend workflows as compatibility paths, not discarded implementations.
ML follows this visual milestone. Do not replace real source shapes with boxes.

Execution policy (18 September 2026): `docs/engineering-plan/backlog.json` is the
adopted task/status authority on `feat/unified-spatial-foundation`. Continue one
bounded task at a time, with its detailed plan, tests, review and recorded result.
The branch preserves the inherited `feat/reusable-spatial-map-core` implementation;
assess its coverage rather than rebuilding it. A task is not accepted merely
because its types compile or an earlier branch contains related code. Keep
private-PC data and isolated hosted-fixture verification explicitly distinct.

Current branch implementation scope (18 September 2026): build the authorized reusable renderer-first and unified-schema foundation on a separate branch. All pages delegate to the shared MapViewport/runtime; source-specific adapters may remain during compatibility migration. Use one layout-scoped resource cache and view-session service rather than page-specific copies. Canonical data remains in existing services. Establish and test the shared contract, compiler and streamed calibration maps before claiming visual acceptance or expanding all later UIs. See docs/SHARED_MAP_IMPLEMENTATION.md. Earlier dated presentation scopes below are historical and do not override this instruction.


Current scope (15 September 2026): replace the previous presentation with the reference-led officer interface on unversioned Block Map, Property Register and Plan Workspace routes. Match the supplied reference header and panels. Main navigation always opens directories; contextual property actions preserve canonical identity and the surrounding block. Build a clearly labeled persisted fictional demonstration neighborhood through real ingestion, processing and review, alongside separately selectable real datasets. Extract required capabilities before deleting obsolete screens; retain historical URL resolution, all originals and revision history. Use reusable feature modules, focused hooks and transient Zustand state. No version branding in the interface. The T00–T10 evidence and unresolved real Indian data/free-route Nous gates remain historical acceptance obligations.


The active demonstration is Lake View. Extend its existing canonical properties with fictional parcel IDs, visible parcels/roads, computed conflict examples and property PDF exports. Keep real datasets separate. Remove only the two user-selected redundant demonstrations from active directories by reversible archival; retain originals and historical access. Seed reruns must preserve user changes and history. Register scenes support circular orbit controls and Ctrl-drag. Workspace Clear/Ctrl+Q cancels only the current drawing. Block/building/floor/unit downloads keep canonical 3D ULPINs, linked parcel 2D ULPIN assertions and byte-identical source revisions; missing geometry remains explicitly unavailable.

- Keep Next.js, CesiumJS, PostgreSQL/PostGIS, S3-compatible storage, Redis/Celery, and private Python processing.
- Keep this release local and single-operator. Defer production authentication/multiple users, Android, formal statutory acceptance, official identity issuance, field synchronization and exchange. AI extraction is in current scope as reviewed assistance, never spatial authority or direct publication; no paid fallback.
- Never fabricate computed results or treat generated synthetic files as real survey evidence.
- Canonical units are local metres in a named frame and vertical benchmark. Display transformations are not measurements.
- Source receipt, suitability, draft geometry, and validation are distinct.
- Preserve originals, source revisions, geometry revisions, and input fingerprints.
- No private secrets in committed files or tool output. Services stay local.
- `REPO_DATA=true` selects the isolated `ulpin-repo` services and committed snapshot; false preserves the linked environment. Never overwrite populated repository volumes or refresh the committed snapshot implicitly. Preserve original object bytes, source attribution, identities and revision history; run `repo:check` before publishing a snapshot.
- Limit command output aggressively; never inspect binary files as text.
- You are working alongside other agents. Respect assigned files and coordinate shared-contract changes with the lead. Do not revert another agent's work. No recursive agent spawning.
