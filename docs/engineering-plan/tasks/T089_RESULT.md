# T089 — Published main and fresh hosted UI imports

Deployed to https://168-144-77-211.sslip.io on the existing DigitalOcean droplet. User explicitly elected an open synthetic hackathon demo; officer authentication remains deferred. Branch `feat/visual-ml-completion` was committed/pushed and fast-forwarded into GitHub main without rewriting history. Final application revision: `e9133a60d8b065d4a6baadb5b72d73d17f496979` (later documentation-only completion commit does not change runtime code).

## Deployment and data

Old `/opt/ulpin` release preserved offline as `/opt/ulpin-previous-t089`, with its old Docker volumes detached. New active PostgreSQL, MinIO and Redis volumes are `ulpin-t089-postgres-empty`, `ulpin-t089-minio-empty`, `ulpin-t089-redis-empty`. Only schema migrations ran. No snapshot restore, seed, local database migration or scripted dataset POST was used. Existing private model weights were retained. Caddy HTTPS and loopback-only backend bindings remain in place. First concurrent compose image export failed; building geo once then starting with `--no-build` resolved it. Next production build and all services succeeded.

The hosted dataset endpoint returned `[]` before imports. Both complete ZIPs were selected with Safari's native file chooser on hosted Add files, then saved with its Save dataset button. The user helped complete the first native picker while Safari was active. Both were then verified in the Map list, opened and rendered.

- Lake View: `d708811f-936a-4f9a-bad2-4b51f7465dd1`; 49 buildings, 184 floors, 189 spaces, 50 declared sources. B01 has parcel and road findings, each 21.6 m², not additive.
- Shiv Vihar: `f660e739-fc33-4e48-861a-439ab2555058`; 32 buildings, 5 supplied floors, 26 schedule spaces, 5 declared sources. First Floor `DEMO-3D-SV-B-029:1` opens; absent geometry/elevation remains explicit.
- Hosted DB: 2 cases, 2 datasets, 61 sources, 0 old map areas. All 61 stored original objects verified by byte count/SHA-256. Both complete package downloads match local originals byte-for-byte.
- 656 runtime/source files on the server match the pushed tree. Database/storage/processor/Redis/worker health all pass. Web/dispatcher/Caddy active. Foreign-origin request rejected with 403.

## Priority fixes during this task

1. Add files incorrectly treated every ZIP as a Shapefile. Bounded container inspection now routes manifest-backed area packages and supported scene JSON through the common normalizer and dataset-save API; raw Shapefiles retain GIS inspection. Local and hosted Add files flows passed.
2. User requested another identical dataset, then withdrew that request. Duplicate prevention is unchanged. They asked to clear current local Lake View for a real import demonstration: archived its active entry without deleting originals/history; list and work queue omit it. Reimport reactivates it. No copy-creation changes were published.
3. Safari showed `Mask unavailable` although inference succeeded. PixelMask now decodes the retained 8-bit grayscale PNG labels directly before colouring; avoids dependence on canvas image readback/colour conversion. Exact decoded pixels match independent Pillow SHA-256 values. Verified public building/room masks and both new hosted dataset masks visually in Safari. Raw masks and inference data are unchanged.

## Fresh hosted ML proof

Started through Sources → select aerial image and B01 Floor 1 PDF → Run extraction. These are new hosted inferences, not copied local job records:

- `34e8d65a-9613-46c0-8499-43335af6eaed`: RF-DETR, succeeded, 10 building candidates, actual inference, about 4.30 s inference time.
- `24d41c06-719e-4e5e-9f2d-3bf2d823faa8`: CubiCasa5K, succeeded, 24 floor-plan regions, actual inference, about 6.11 s inference time.

Result arrows, source page counts, retained source overlays and Present → public sample / This dataset verified. No review acceptance or geometry authority was fabricated. Models remain assistance, and the full map remains source-vector/schedule-derived.

## Verification

37 tests passed across package/import/source/page/routing/mask checks; 2 opt-in live HTTP tests skipped in the initial suite. TypeScript and production builds passed locally and on the host. Real hosted browser imports, readback, map rendering and live ML runs cover the deployment path. Runtime-file integrity and source-object checks were read-only. Local app running on port 3000.

Evidence: `../evidence/t089/hosted-imports.json`, `hosted-ml.json`, browser captures. Some background Safari captures have a small composited window; visible accessibility states and full map captures were also inspected.

Presentation: `docs/HACKATHON_BRIEFING.md` includes a 45-second explanation, walkthrough, source/storage flow, duplicate/partial-building-data answer, and 50+ likely judge questions. Complete source ZIPs and import instructions are in `data-source/`.

Limits: no universal bulk importer, full cross-source entity resolution, officer authentication, complete point-cloud/terrain reconstruction, survey/legal certification or official 3D identity issuance. Existing droplet continues billing under its existing plan; this task adds no new server or paid service and configures no automatic deletion.
