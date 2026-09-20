# Source-style fictional showcase packages

These are new packages. Original `neem-reference-dataset.zip`, archived T072 receipts and their identifiers/coordinates were not modified.

- `/reference/showcase-dense.zip`: 82 buildings, 329 floor records, 339 space records, 333 fictional residents.
- `/reference/showcase-reference.zip`: 28 buildings, 121 floor records, 131 space records, 125 fictional residents.

Both contain **source GeoJSON and CSV only**, plus manifests. Neither contains `normalized.json`. The runtime must derive its scene using `normalizeSourceFiles`, then use the existing canonical `ulpin-spatial/2` adapter. `manifest.json` fingerprints every file; `source-manifest.json` declares the bounded `ulpin-source-package/1` profile, file roles, named local metre frame, explicit vertical benchmark, source revision and synthetic classification. There is no national datum or geographic placement inferred from a filename.

## Identity and residents

Original object IDs and existing geometry IDs/revisions/rings are retained. New floor records carry `DEMO-3D-<PROFILE>-<BUILDING-ID>:<level>` identifiers: level 0 is ground and -1 is basement. Building IDs use the same prefix without a level suffix. Parcels carry separately linked `DEMO-2D-<PROFILE>-<PARCEL-ID>` identifiers. These are clearly fictional demonstration identifiers, not official ULPIN issuance. Internal stable object IDs remain separate from display identifiers.

`floor-schedule.csv` supplies building, parcel, floor and unit IDs; explicit level; floor/unit demo 3D IDs; unit type; and stated area when supplied. Existing supplied unit polygons stay geometric. Most units are **schedule-only**, with null geometry and no invented area or boundaries. Added floor polygons are explicitly authored synthetic geometry matching the author's building footprint; they are not a claimed extraction result.

`fictional-residents.csv` supplies resident ID/name, role `resident`, classification `synthetic`, and explicit building/floor/unit joins. All names visibly begin “Fictional Resident”. No contacts, passwords or ownership assertions are present. Common areas, circulation and parking have no residents. The normalizer also accepts a resident explicitly linked only to a floor; it does not invent a unit for that resident.

## Supported extraction profile

The normalizer accepts declared local GeoJSON FeatureCollections for parcels, buildings, floors, spaces, roads, utilities and public land, plus the declared floor/resident CSV schedules. It preserves original byte fingerprints, raw source properties, feature/row locators, explicit geometry revisions and unknown values. Invalid source fingerprints, undeclared/mismatched coordinate frames, duplicate identities/headers, missing relationship endpoints, conflicting parentage and resident location mismatches are rejected.

This bounded profile does not claim arbitrary GIS/IFC/CAD/PDF/LiDAR ingestion. It does not infer floor segmentation, unit boundaries, residents, legal rights or measurements from an image. Future source adapters can produce this same normalized contract while keeping their evidence and limitations explicit.

Regenerate with `python3 scripts/spatial/generate-source-showcases.py`. Test with `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/t076-source-normalizer.test.ts`.

## Reference city reconstruction (T078)

`/reference/showcase-anchor.zip` is the default local preview. It contains 49 buildings, 184 floor records, 189 unit records and 188 fictional occupants. The photographed-style REF-01 image has no underlying source city dataset in the supplied pack. These are newly authored local-metre shapes reconstructing its visible composition: pale medium-rise buildings, park, surrounding blocks, street junction, focal red building, parcel boundary/road intersections and utility alignment. No source photograph was used as a fake interactive map.

Generate only this separate package with `python3 scripts/spatial/generate-anchor-showcase.py`; it uses the existing GeoJSON/CSV source schema and integrity manifests. It does not overwrite the older packages or write to a service. Display trees, windows, roofs and camera settings remain synthetic presentation metadata. The two focal conflict areas overlap one another and must not be summed as independent land area.
