# CLEANUP-DATA: exact provenance and retirement map

**Disposition: split the mixed saved-state bundles; retain the exact real-source allowlist below.** This is a read-only lineage audit, not a deletion or data migration.

- Checkout/base inspected: `staging` at `eae7e7f418d72e4a36c526804380c35944e3809e`.
- The cleanup inventory's recorded source base is `1fee61c853739c12cf6ac28d9de9976bdb758481`; this assignment's checkout is newer. The listed manifests, fixture paths and saved-state structures were present at the assigned base. I did not edit the inventory or ledger.
- The pre-existing index had staged `.agents/skills/*` and `AGENTS.md` edits when this audit began. Those paths were not touched or included in this report commit.
- `repo-data/database.dump` was decoded with the matching `pg_restore` from a disposable PostGIS container, using a read-only mount of `repo-data/`, no network, and an ephemeral `tmpfs` database. SQL inspection was read-only against that restored copy; the container was stopped and auto-removed. No existing app, database, volume, provider, or preview was used or changed.
- `data-bundles/uttam-nagar/rows.json.gz` was parsed as gzip JSON. Its declared foreign keys partition the 4,440 rows into six area-rooted components. Hashes below come from manifests/source records and locally hashed, format-appropriate source files; no binary was read as text.

## Retain: real gathered source context and exact hashes

These are public/third-party observations and deterministic derivatives with recorded source lineage. They are **not official cadastral/title evidence**, and do not establish ownership, legal parcel boundaries, height, occupancy, road width, or survey accuracy.

### NYC source in the repository snapshot

| Source lineage | Area / rows | SHA-256 and storage mapping | Decision |
| --- | --- | --- | --- |
| NYC building-footprint context around OTI 353927; source row `sources.id=eb33f3ab-ea9c-412e-a510-260c6a1f9bc3`, `geojson-area-v2`, 41,792 bytes | Observed site `9e77c608-bac7-4d56-9ac7-3032cc49074d`; 62 physical features and 62 registry records | `869c5dc4fb50d71be4f62f4a2936c29bd95ade14c712bdf4f51986841d82771a`; `repo-data/objects/869c5dc4fb50d71be4f62f4a2936c29bd95ade14c712bdf4f51986841d82771a.bin` | Keep unchanged. It is the only source row linked to the observed site in this snapshot. |

Keep **both** object-key references to that same payload: `acquisitions/e4427f6a-d443-4910-8ab9-3fe1e6cc80b6/original` and `areas/eb33f3ab-ea9c-412e-a510-260c6a1f9bc3/869c5dc4fb50d71be4f62f4a2936c29bd95ade14c712bdf4f51986841d82771a`. The manifest maps both to the same file and digest. Do not unlink/delete the payload while either key remains.

### Uttam Nagar saved transfer: six real reference objects

The three non-fictional areas are separate from their authored scenario copies. Each object maps through `rows.json.gz.tables.sources.case_id → cases.site_id`, and its matching `manifest.json` object key and SHA-256. The 53 bundle object digests are unique; none is a same-byte shared object across areas.

| Keep area / source | Features represented | SHA-256 → object file |
| --- | ---: | --- |
| `9bb67cbc-9773-4cee-ad1a-df29fc6c23a5` — Uttam Nagar OSM reference, no ownership data; 113 outlines + 35 roads | 148 | `9f5af0e0d25fc133e840e0152fc540b949198efe44b47116c3c32a31a735d7cf` → `objects/9f5af0e0d25fc133e840e0152fc540b949198efe44b47116c3c32a31a735d7cf.geojson`; `9cfea954b64d86a586b31980ecc49fdedb6d84e8ce73c9a851229f5392dea6a8` → `objects/9cfea954b64d86a586b31980ecc49fdedb6d84e8ce73c9a851229f5392dea6a8.geojson` |
| `d1b4ca2e-378e-4b43-8c34-04406dbb285b` — separately selected real OSM block; 20 outlines + 9 roads | 29 | `dbd094fadae4621ea7149bb39720472bf65ba8c0545d4b439cd2fcb9be4f2eb9` → `objects/dbd094fadae4621ea7149bb39720472bf65ba8c0545d4b439cd2fcb9be4f2eb9.geojson`; `317953642c770fb6913a14377a9a53904d9bf0eca5af7b150afbe7d5123d0f93` → `objects/317953642c770fb6913a14377a9a53904d9bf0eca5af7b150afbe7d5123d0f93.geojson` |
| `276dc595-97c4-4253-bf47-db4a12fd542b` — Google Research Open Buildings V3 selected footprints + OSM roads | 50 (15 selected footprint detections + 35 roads) | `fe34b52f0cf6706380527da4e659ca2a22624fd561e85d6bab5b8a22d32c2736` → `objects/fe34b52f0cf6706380527da4e659ca2a22624fd561e85d6bab5b8a22d32c2736.geojson`; `1e708d7307c46c8e9bf8b5733b76755b5078279eae24b5467393e7baf983bfaf` → `objects/1e708d7307c46c8e9bf8b5733b76755b5078279eae24b5467393e7baf983bfaf.geojson` |

The six exact transfer hashes above also match the corresponding source GeoJSON bytes in `fixtures/uttam-nagar/` and `fixtures/google-uttam/` (see allowlist below). The Google selection threshold is not an area-level accuracy guarantee. Google/OSM context is not title evidence.

### Source and provenance files to retain with those originals

The following exact files are source responses, receipts/queries, source-preserving extracts, or bounded geometry derivatives. Hashes are SHA-256 of the current files. Preserve the unchanged files and their neighboring source notes/selection reports.

| SHA-256 | Path | Role |
| --- | --- | --- |
| `85f86fdf5683a6026c23b12520947dea352dc65a85946bdbf7596180bf629857` | `fixtures/uttam-nagar/sources/uttam-nagar-osm-raw.json` | Raw OSM extract |
| `af3806f57ce13b3dfe2d923ec2e163af803a8f8227bf3a0f9138b6b6c4031a90` | `fixtures/uttam-nagar/sources/uttam-nagar-context.osm.json` | OSM neighborhood context response |
| `882d6de6bf85ceefa31d8d349814126aadccc8c263e6fdf46e704189c4f9a481` | `fixtures/uttam-nagar/sources/uttam-nagar-context.overpass` | OSM context query |
| `92edeefe83218d411997e038e1e577ec5932897ac8f8952566fe90da9a2230c1` | `fixtures/uttam-nagar/sources/uttam-nagar-query.overpassql` | Exact bounded OSM query |
| `2bc7c5200b2e34ff321ebc4b5fa0818ea59584e155961b3b273fa0c368805e89` | `fixtures/uttam-nagar/sources/uttam-nagar-geocoder.json` | Geocoder source response |
| `ddcef764dd167a77e0ef5580ef26bc2c7310ea688e9581f6d96b07a731ad6faf` | `fixtures/uttam-nagar/sources/uttam-nagar-location.json` | Locality lookup response |
| `45948831ecdcdbd9ebadf80b96fcf00bee78247c84b0e1dc180ed59139a28347` | `fixtures/uttam-nagar/sources/uttam-nagar-location.json.receipt.json` | Locality response receipt |
| `d5f344eb3d3ba21f66d32fcb4b92c4db00fc5649eb195c9434c1b6ebe75470a7` | `fixtures/uttam-nagar/sources/uttam-nagar-osm-raw.json.receipt.json` | OSM acquisition receipt |
| `402c11504fe77b27469b9c81ce9769fd03617c2dceb1a92e19038cabbfbbd81b` | `fixtures/uttam-nagar/sources/delhi-boundary-nominatim.json` | Nominatim boundary response |
| `ff52af127687946a3d2ad2660f53b42ce92a854fc504f2d28eeeef5bb8fac315` | `fixtures/uttam-nagar/sources/delhi-boundary-nominatim.json.receipt.json` | Boundary acquisition receipt |
| `5efc795e32555f591ec5fc515cf1c394e5ba1c0621610214c1168b17cfae2220` | `fixtures/uttam-nagar/sources/delhi-geocoder-boundary.json` | Geocoder boundary context |
| `463823194d1c517bf444aca3175753e923e4f96353b56b672c455b98300088b6` | `fixtures/uttam-nagar/sources/delhi-nct-boundary.json` | Delhi NCT boundary source |
| `de7674e2c8c68d3bc6eec9dea4246937183a403b78365713c3c7a0661544d5ec` | `fixtures/uttam-nagar/sources/delhi-nct-boundary.json.receipt.json` | NCT boundary receipt |
| `75420d3bedd2559223736f1aec7f58e1dea3ba97bc66b76fdcdadb5455208f6d` | `fixtures/uttam-nagar/delhi-boundary.geojson` | Deterministic boundary output |
| `ee05e183c2af1bd74660dbdf76c996ab612c70ed033dc3e5f4b17cd02d64b7d0` | `fixtures/uttam-nagar/delhi-nct-boundary.geojson` | Deterministic NCT boundary output |
| `9f5af0e0d25fc133e840e0152fc540b949198efe44b47116c3c32a31a735d7cf` | `fixtures/uttam-nagar/prepared/uttam-nagar-buildings.geojson` | Preserved selected OSM building geometry |
| `9cfea954b64d86a586b31980ecc49fdedb6d84e8ce73c9a851229f5392dea6a8` | `fixtures/uttam-nagar/prepared/uttam-nagar-roads.geojson` | Preserved selected OSM road geometry |
| `dbd094fadae4621ea7149bb39720472bf65ba8c0545d4b439cd2fcb9be4f2eb9` | `fixtures/uttam-nagar/uttam-nagar-buildings.geojson` | Bounded OSM block building source layer |
| `317953642c770fb6913a14377a9a53904d9bf0eca5af7b150afbe7d5123d0f93` | `fixtures/uttam-nagar/uttam-nagar-road-centrelines.geojson` | Bounded OSM block road layer |
| `9acc458a0456388f5a39062617367c53918977d74c2b383886528d12f8fe5fc8` | `fixtures/uttam-nagar/uttam-nagar-block-extent.geojson` | Analyst-selected block extent, not an official boundary |
| `193e23a463c813f8bf07831a2fd8c12f9be5baaead13bdbe5fb2684120a01f92` | `fixtures/google-uttam/00-all-google-detections.geojson` | All 91 Open Buildings detections in selected block |
| `fe34b52f0cf6706380527da4e659ca2a22624fd561e85d6bab5b8a22d32c2736` | `fixtures/google-uttam/01-google-building-footprints.geojson` | 15 confidence-filtered public footprint detections |
| `1e708d7307c46c8e9bf8b5733b76755b5078279eae24b5467393e7baf983bfaf` | `fixtures/google-uttam/02-osm-road-centrelines.geojson` | OSM roads used as selection context |
| `1fedfe1a7b59c52bc6eb3731a1e72df1110acc2f3f604fdbb5ef110779bce271` | `fixtures/google-uttam/block-boundary.geojson` | Derived street-enclosed study extent, not an official block |

For the Google V3 larger extract cited by its source documentation, the recorded Delhi subset is outside Git with SHA-256 `cdd065b5a4d6816a9e40d68c72ae988021006c74f1024a97e3544d459668283d`. The original regional download and extracted archive are also outside this checkout; this audit did not access or reacquire them.

## Retire candidates: exact authored roots and row/object graph

### `repo-data/` saved PostgreSQL snapshot

The restored snapshot contains 44 public tables and 7,211 total rows. Six sites have `registry_sites.synthetic=true`; their FK-connected closure is **2,252 rows across 35 tables**. These are exact root selectors for a later, separately authorized migration:

| Synthetic root `registry_sites.id` | Current site label | Feature rows | Registry records | Source rows / distinct hashes |
| --- | --- | ---: | ---: | ---: |
| `7f065cf2-5664-4c5b-bc77-86de0b6e462c` | C-001 guided walkthrough · site | 0 | 10 | 6 / 6 |
| `0ded05d3-b596-46a8-9918-ab1bc0a433be` | Lake View · demonstration | 22 | 89 | 48 / 42 |
| `c65e220d-bb6c-4bb0-9fff-8c140789602b` | Nandan block (`seed_key=nandan-v1`) | 0 | 22 | 5 / 5 |
| `f2bac6c6-7d55-449a-a85f-3cdd7f8c2a5d` | Start here · C-001 property demo · site | 0 | 10 | 5 / 5 |
| `8c61a45e-3ae9-4c7c-95f2-78918f23582a` | Synthetic officer UI test · not a real survey | 5 | 8 | 11 / 11 |
| `e4eea7b8-f1f0-4ea0-bd82-29e0c2a740a3` | V2 redesign verification · synthetic | 3 | 5 | 6 / 6 |

The six roots' exact aggregate table-row counts are: `registry_sites` 6; `map_areas` 6; `cases` 44; `sources` 81; `physical_features` 30; `physical_feature_revisions` 30; `source_feature_links` 30; `registry_records` 144; `registry_drafts` 40; `registry_reviews` 57; `registry_revisions` 139; `registry_aliases` 127; `registry_links` 175; `units` 91; `unit_revisions` 277; `identity_floors` 27; `identity_spaces` 91; `import_packages` 19; `import_package_revisions` 414; `area_check_runs` 8; `events` 87; `jobs` 39; `operations` 34; `snapshots` 23; `building_preparations` 8; `building_preparation_revisions` 14; `property_associations` 9; `property_association_revisions` 9; `external_identifiers` 38; `registry_case_feature_mappings` 84; `registry_case_import_operations` 16; `registry_rights` 14; `officer_investigations` 7; `officer_investigation_revisions` 24; `scene_asset_bindings` 10. All are reachable by declared foreign keys from those six `registry_sites` rows. Their 81 source keys contain 69 distinct hashes; treat each key/hash as a reference-counted object, since same payloads repeat across cases.

The other proven site-rooted component is Bronx: `registry_sites.id=9e77c608-bac7-4d56-9ac7-3032cc49074d`, `synthetic=false`, 399 rows across 16 tables, including the 62 observed features and the single source row above. Keep that whole evidence/review lineage while retiring synthetic records.

**Unresolved, preserve unchanged:** 85 cases with `site_id IS NULL` connect to 406 source rows and 28 distinct source hashes. Their current schema gives no site-rooted lineage to classify them safely. Also preserve eight additional manifest keys until their owning row/asset relation is identified: `areas/{61d84b30-5ebc-4331-a720-33c7d22fb697,8fb5ba07-a598-41f4-acaf-df11a0e97a13,a66171a2-b3ce-44f1-9843-5827e2025728,cac87e62-5787-4e30-a94e-10bcb57c17a8,d15a0835-1704-4d93-8f36-5df69d52651e,d42853a7-3085-48d0-bdcc-5de9fb8fdd89,e9e9876e-1a92-453b-bd47-5a0bd868ec76,eb74f134-5983-4653-86fc-23289fd100c8}/016dba1bf85c80797387f5cfe597db1852106b2d8e65887470642bb4038b8ad9`, all the same `016dba1bf85c80797387f5cfe597db1852106b2d8e65887470642bb4038b8ad9.json` payload. The acquisition key in the Bronx keep mapping is a separate ninth non-source key. Do not classify or unlink these unresolved references by absence of a site.

`repo-data/manifest.json` is the complete object-key/hash allowlist for this saved snapshot: **497 keys, 88 distinct byte hashes**. Beyond the Bronx keep payload, do not delete a file by naming pattern. Any later snapshot retirement must first migrate `repo:init` to a reviewed sanitized snapshot and verify every remaining key/ref. Keep all shared payload files until their last retained key is proven absent. `repo-data/database.dump`, manifest and existing historical copy remain untouched in this assignment.

The 10 manifest-listed scene assets are presentation assets, not gathered operational sources, and the FK closure has 10 `scene_asset_bindings` under synthetic roots. Retire only after consumers/bindings are migrated:

| SHA-256 | Path |
| --- | --- |
| `8925e55a15b40e0b57f7e02989b3618de1db62228e3beceaedc057e4b70e4135` | `apps/web/public/scene-assets/complete-demo/kiosk.glb` |
| `4b9bb5dbce49015dd5c310b5a7e4c674066b947596b44a45f60583711eee0dff` | `apps/web/public/scene-assets/reference/A.glb` |
| `9f487da4ce6ff5be6c63b7eef20d2882023df7d9177f95708c08b59be8752b62` | `apps/web/public/scene-assets/reference/B.glb` |
| `80f48f1fbb94812801a71a5ef8c9e23dc0ae534b37d0093a6f81d668eae90f89` | `apps/web/public/scene-assets/reference/C.glb` |
| `0bd6e5cbe95ff044cc0fa5da8ccbff22041002d2ab288e7901c805202fbedde5` | `apps/web/public/scene-assets/reference/D.glb` |
| `b80839a946a9112c39aa782639d1f76a09b07a1a783569b3216c80de07f21d8d` | `apps/web/public/scene-assets/reference/E.glb` |
| `a2b81299c63d29c0b95ed83b6a7cf301925c530fc0f2bf80b4e28959324c1df0` | `apps/web/public/scene-assets/reference/F.glb` |
| `86177872b430a647be7fa36d5b606bc4f3b1ea971b9f731c2c896d28b02096b5` | `apps/web/public/scene-assets/reference/G.glb` |
| `af3699aa02a04f88a6bc2702097d2c21f918e5f0bde533ce4eeeecfc401d311c` | `apps/web/public/scene-assets/reference/H.glb` |
| `db6defdb36ef0e5fb4498d6ffa4bf822389a851734ff5b48f66cd1580707b566` | `apps/web/public/scene-assets/reference/landscape.glb` |

### `data-bundles/uttam-nagar/` mixed 4,440-row transfer

The manifest has 32 tables, 53 sources/objects, and six area-rooted FK components. The following exact components partition all rows and all objects (component totals sum to 4,440 rows and 53 source objects):

| Area root | Decision | FK-connected rows | Features | Registry records | Cases | Import packages | Sources/objects |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `9bb67cbc-9773-4cee-ad1a-df29fc6c23a5` | Keep OSM reference, no ownership data | 834 | 148 | 113 | 2 | 2 | 2 |
| `eb82b76d-84cc-4fd0-ae93-b4a229fc4837` | Retire fictional rooms/conflict scenario graph | 1,437 | 153 | 162 | 6 | 6 | 15 |
| `d1b4ca2e-378e-4b43-8c34-04406dbb285b` | Keep real OSM block | 175 | 29 | 20 | 2 | 2 | 2 |
| `6a190c0f-3940-4dc4-b5b6-c2e8fbd26f16` | Retire fictional registry/conflict graph | 862 | 34 | 60 | 38 | 8 | 17 |
| `276dc595-97c4-4253-bf47-db4a12fd542b` | Keep Google/OSM public footprint/road reference | 245 | 50 | 15 | 2 | 2 | 2 |
| `457bac4c-1c6c-4157-a12a-1d44ba3c1bcf` | Retire fictional Google 3D registry graph | 887 | 51 | 51 | 33 | 6 | 15 |

Retirement object selectors are the 47 `sources` rows whose cases resolve to site IDs `eb82b76d-84cc-4fd0-ae93-b4a229fc4837`, `6a190c0f-3940-4dc4-b5b6-c2e8fbd26f16`, or `457bac4c-1c6c-4157-a12a-1d44ba3c1bcf`; each maps one-to-one to its SHA-named file in `data-bundles/uttam-nagar/manifest.json` (`objects/`). Those objects are scenario inputs/details and have no duplicate digest in another area. Retire their linked database rows/history and those 47 object refs/files together only after consumers are migrated. Preserve `README.md`, manifest provenance, license notes and the three real-root object sets listed above.

### Synthetic fixture portions

Exact authored paths in `fixtures/google-uttam/` to retire after seed/import consumers are removed: `03-DEMO-building-envelopes.geojson`, `04-DEMO-road-corridors.geojson`, `05-DEMO-road-conflict.geojson`, `UN-A-SYNTHETIC-plan.png`, `UN-B-SYNTHETIC-plan.png`, `UN-C-SYNTHETIC-plan.png`, and `synthetic-interior-spec.json`.

Exact authored paths in `fixtures/uttam-nagar/` to retire after consumers are removed: `demo-buildings.geojson`, `demo-conflict-road.geojson`, `demo-conflict-shed.geojson`, `demo-parcels.geojson`, `demo-plan-spec.json`, `demo-road-widths.geojson`, all files under `generated/`, and all files under `scenario/`. Keep the source/receipt files, prepared real OSM geometry, clean real reference layers, source notes and selection reports in the allowlist above. The real OSM/Google outline may have a fictional derivative; retain the original source feature/hash and remove only its separately authored fake heights, parcels, rooms, widths, residents or conflict geometry.

## Re-creation entrypoints to migrate or gate

These can restore or re-create the synthetic data after a file/row retirement; leaving them active would make the removal temporary:

- `pnpm repo:init` → `scripts/repo-data.ts init`: restores the complete mixed `repo-data/database.dump` and all manifest objects into repository mode. Point it to a reviewed sanitized snapshot before retiring the old snapshot as a bootstrap input.
- `pnpm data:uttam:install` → `scripts/datasets/uttam-nagar.mjs install`: installs all six saved area components and 53 object files. Split the saved transfer into a real-reference-only bundle first; keep `check`/`verify` from implying that authored rows remain a valid production dataset.
- `scripts/uttam-nagar/import-osm-reference.mjs` and `scripts/uttam-nagar/import-fictional-rooms.mjs`: the latter explicitly reinstalls fictional layers/interiors. Retain the raw OSM/reference acquisition path only if needed; remove or archive the fictional installer entrypoint.
- `scripts/google-uttam/import.mjs`: workflows include authored 3D/occupancy/conflict imports. Split source-only acquisition/selection from synthetic scenario installers; gate the fake import branches.
- `POST /api/v1/registry-demo` in `apps/web/lib/server/registry-routes.ts` calls `seedRegistry()` and creates the Nandan demo (`seed_key=nandan-v1`). `pnpm demo:seed` (`scripts/reference/seed.ts`) creates authored Lake View records. Remove from active product routes/scripts or guard as non-production fixture operations after migration.

## Recommended retirement sequence and limits

1. Migrate bootstrap/install/UI/test consumers to real-reference-only artifacts. Keep historical source docs and old hashes as receipts, not installable fixture data.
2. For the saved transfer, filter by the three explicit fictional site IDs; retain the three real site graphs and six source objects. Keep referential history with each root or migrate history as a complete root component. The `registry_sites.synthetic` flag and the bundle's explicitly named `FICTIONAL` roots support this selection; do not classify by filename alone.
3. For `repo-data`, use the six `synthetic=true` site roots as the proven synthetic row selector, retain the complete Bronx observed root and both keys for its source digest. Preserve the 85 unassigned cases/406 sources/28 hashes and eight unresolved area keys until separate provenance resolves them. Produce a new sanitized snapshot only after consumer migration and FK/object-ref review; do not hand-edit the saved dump or delete a content-addressed file while any key remains.
4. At execution time, inspect the actual active repository-mode database separately, enumerate exact references, and do a scoped transactional migration/backup. This report proves the checked-in snapshot and transfer only; it does not qualify any linked or populated database. No database mutation, volume reset, reseed, file deletion, fixture edit, source acquisition, service startup or test was performed here.

## Evidence used

the historical cleanup inventory (retired from the working tree; retained in Git at `14b0d89a4a1af77a5323bc20df31d033495e0134`) and its JSONL; `repo-data/README.md`, manifest and custom dump; the Uttam transfer manifest and gzip rows; `fixtures/uttam-nagar/README.md`, `SOURCE_NOTES.md`, receipts and selection report; `fixtures/google-uttam/README.md`, `selection-report.json`; `docs/GOOGLE_UTTAM_NAGAR.md`; package scripts and the referenced seed/import entrypoints. No official-source acquisition or permission claim was added by this audit.
