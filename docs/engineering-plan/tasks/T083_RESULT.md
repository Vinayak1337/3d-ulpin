# T083 — Durable Lake View and Shiv Vihar datasets

User explicitly requested proper saving after rejecting linked demo cards. Both packages are now saved in the current local linked PostgreSQL/object-store environment. No existing dataset was overwritten, archived or reset; no repository snapshot was refreshed.

## Stored records

- Lake View: dataset `22b196c2-b467-4f38-9252-5b4c5e3a2f14`, 49 buildings, 184 floors, 50 declared source files; 53 original stored objects including the package and all ZIP members/manifests.
- Shiv Vihar: dataset `160028fd-b3a4-42e9-b6da-daff641ddd3c`, 32 buildings, five supplied floors, 26 schedule spaces, five declared sources; eight original stored objects including package/manifests.

The additive `spatial_datasets` table holds the immutable revision-1 canonical input, normalized source document, manifest/digest, diagnostics and source revision bindings. Existing `cases` and `sources` tables retain receipt/source metadata; original bytes use existing S3-compatible `putOriginal` and readback verification. Canonical building/floor IDs and source geometry are unchanged. Saving does not assign a geographic anchor or invent missing floors, residents, rights or elevation.

The content hash is unique and a transaction advisory lock serializes concurrent saves. Repeat imports reuse the same dataset UUID and preserve its stored records. Malformed source packages are validated before any dataset/object write. Attempt cleanup removes only that attempt's unsaved objects, retaining them when commit state is uncertain.

## Product behavior

Map directory and header chooser read persisted datasets from the service. Batches now lists them as saved work with functional map links; their backing source cases do not create duplicate/broken generic workflow entries. Saved UUID routes load and hash-check the stored original package, then compare its normalized digest with the stored snapshot before rendering. Named legacy sample URLs resolve their saved receipt using the exact bundled hash.

The import viewer has a Save dataset action for supported fictional ZIP/JSON packages. It saves server-validated source data and updates to the stable saved URL. Dataset lists and work queues refresh after saves. Status reads Saved / revision 1 / needs review, distinct from an approved registry publication.

## Verification

- Concurrent save/replay for both packages reused the same UUIDs; invalid input produced no new dataset rows.
- All 61 stored package/member objects were downloaded from object storage and checked byte-for-byte by SHA-256/length against inputs. Source bindings covered all 55 declared sources. Stored canonical input and normalized source JSON exactly matched fresh normalization.
- Final production build/TypeScript passed. Seven local unit/import checks passed (two HTTP tests skipped in that run); the separate live HTTP run passed all four tests. Browser Save succeeded after the origin fix and reused the original Shiv Vihar UUID. Its saved floor ID remained searchable and opened the register.
- HTTP checks cover package readback/replay, invalid input/no rows, missing IDs, queue identity, cross-origin rejection and the validated loopback Host/origin boundary.
- Browser checks cover persisted Map and Batches lists, stored-package opening after server restart, and the in-app reimport/save path. Initial UI save exposed Next's internal localhost versus browser 127.0.0.1 mismatch; the guard now compares Origin with the validated request Host and exact port. Foreign origins, different ports, non-loopback hosts and cross-site requests remain rejected.

Evidence: `../evidence/t083/persistence.json`, browser captures, `tests/t083-dataset-http.test.ts`. Explicit replay/readback utility: `pnpm exec tsx --tsconfig apps/web/tsconfig.json scripts/spatial/save-demo-datasets.ts` from repository root. This operation deliberately saves/reuses the two authorized fixture packages; it is not a read-only test.

## Boundary

This completes durable storage and reopening of these datasets. They are fictional saved datasets requiring review, not legally approved records. T080 still covers broader resumable multimodal processing and reviewed atomic registry publication. The global published-property resolver is not promoted to treat these candidate snapshots as approved records; their floor/property register remains available through each saved map. Hosted repository-mode qualification and production scale are not established by this local run.
