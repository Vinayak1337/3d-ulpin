# NWIC vector admission profile handoff (DATA-10B)

## Scope and lineage

This is a bounded offline structural profile of the already acquired NWIC/GSI India district GeoJSON. The private archive remains unchanged outside Git at `/Users/vinayak/.codex/task-data/ulpin-nwic-boundaries-v1/district_nwic_geojson.zip` (71,238,839 bytes; SHA-256 `44c734cc72139f2447dcebfe2791cac862dc5ba265e158912d797cf3410d5c37`). The expanded member remains unchanged outside Git at `/Users/vinayak/.codex/task-data/ulpin-nwic-boundaries-v1/extracted/district_nwic.GeoJSON` (168,356,689 bytes; SHA-256 `2b27a478e24d8c51b0655e74ce3f4f880e75c752e4597550d6fc925ed06ac201`). The utility streamed and rechecked that expanded-member hash. It did not write, simplify, repair, or redistribute source geometry.

The compact aggregate profile is [vector-admission-profile.json](../../../fixtures/usp/D3/nwic-boundaries-v1/vector-admission-profile.json), pinned in that pack's manifest. It contains exact per-feature raw-object byte spans and source identifiers for maxima and native topology failures; offsets are zero-based `[start,end)` byte positions in the unchanged expanded member. Spans include the opening and closing braces of each Feature object and exclude surrounding whitespace and array separators. The accepted `source-observations.json` and earlier acquisition receipt were preserved byte-for-byte by this task.

## Measured source structure

- 733 `MultiPolygon` features; 1,220 polygons; 1,326 rings; 3,125,505 coordinate positions. All positions are finite 2D XY and all source rings are explicitly closed; null, empty, malformed, non-finite, short-ring, and extra-dimension disposition counts are zero.
- Maximum Feature span: 926,787 bytes; maximum positions in one Feature: 17,228; maximum positions in one ring: 16,903. These maxima occur at feature index 59, `properties.id`/`objectid` 14, byte span `[18,292,522, 19,219,309)`.
- Maximum polygons and total rings in one Feature: 112 each, feature index 48, `properties.id`/`objectid` 3, byte span `[12,855,936, 13,571,638)`.
- Native Shapely validity on the unchanged coordinates reports 720 valid and 13 invalid features. All 13 reasons are ring self-intersections. Their feature indexes, source property IDs, exact byte spans, and GEOS reasons are listed in the profile; no `make_valid`, snapping, closure, or other repair was applied.
- No top-level GeoJSON Feature IDs occur. `properties.id` and `properties.objectid` are JSON numbers, each distinct on all 733 features. `dtcode` is a string with 732 distinct values; the duplicated value is `"999"` at feature indexes 731 and 732 (byte offsets 168,166,202 and 168,253,046). `district` has 728 distinct strings; `state`, `state_name`, and `stcode` each have 36 distinct strings. These are source attributes, not canonical application IDs or ULPINs.

The source declares the literal CRS URN `urn:ogc:def:crs:EPSG::7755`: EPSG:7755 WGS 84 / India NSF LCC, easting/northing in metres. The observed native extent is `[2818369.546553203, 2177948.4534365367, 5679118.542969628, 5444563.235709688]`. Offline `pyproj` transformed every source XY to longitude/latitude with `always_xy=True`, using the single available non-ballpark operation: `Inverse of Survey of India Lambert + axis order change (2D)`. The resulting finite longitude/latitude extent is `[68.17751186834793, 6.755952899354266, 97.4128965141613, 37.0883417738344]`.

The inverse numerical round trip covered all 3,125,505 positions. Its maximum, mean, and RMS residuals in source metres are `6.51925802230835e-9`, `1.2490108583717708e-9`, and `1.622972144968263e-9`. PROJ reports operation accuracy metadata `0.0`; neither that metadata nor these round-trip residuals measure source positional accuracy or boundary correctness. No external control points were used.

## Reproduction receipt

The exact geo image was pinned to `sha256:91683e358f3fa8d8a132b8d02548d588343fbdb38c902e473512ce9c84ecefd2`; runtime versions were Python 3.12.14, NumPy 2.0.2, Shapely 2.0.7 / GEOS 3.11.4, pyproj 3.6.1 / PROJ 9.3.0. `services/geo/requirements.txt` SHA-256 was `118eb43f0bf7ad98af17e4676c32a0eadbf0748f917e623c3316ada646aefa1d`. The bundled `proj.db` was 8,581,120 bytes, SHA-256 `79b660eb3c09f50c0f251e958db7cbf9a2d5d18d2836e99082095b31c7e029c5`.

The successful profile command exited 0. It used `--network none`, a read-only container root, read-only mounts for the source and profiler, one writable output-directory mount, `PROJ_NETWORK=OFF`, 2 GiB memory and swap limits, 2 CPUs, 64 process limit, 900 CPU-second limit, and a 256 MiB no-exec temporary filesystem. The reader used 1 MiB chunks, retained at most one raw Feature at a time, and transformed in batches of at most 50,000 positions. The measured profiler runtime was 9.113 seconds and peak resident memory was 65,863,680 bytes.

```sh
docker run --rm --network none --read-only \
  --memory=2g --memory-swap=2g --cpus=2 --pids-limit=64 --ulimit cpu=900:900 \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m -e PROJ_NETWORK=OFF \
  --mount type=bind,source=/Users/vinayak/.codex/task-data/ulpin-nwic-boundaries-v1/extracted/district_nwic.GeoJSON,target=/input/district_nwic.GeoJSON,readonly \
  --mount "type=bind,source=/Users/vinayak/.codex/worktrees/f017/3D Ulpin/scripts/usp/data/profile-nwic-vector.py,target=/profile.py,readonly" \
  --mount "type=bind,source=/Users/vinayak/.codex/worktrees/f017/3D Ulpin/fixtures/usp/D3/nwic-boundaries-v1,target=/out" \
  --entrypoint python sha256:91683e358f3fa8d8a132b8d02548d588343fbdb38c902e473512ce9c84ecefd2 \
  /profile.py /input/district_nwic.GeoJSON /out/vector-admission-profile.json \
  --container-image-digest sha256:91683e358f3fa8d8a132b8d02548d588343fbdb38c902e473512ce9c84ecefd2 \
  --source-host-path /Users/vinayak/.codex/task-data/ulpin-nwic-boundaries-v1/extracted/district_nwic.GeoJSON
```

An earlier launch exited 1 before reading the input because `TransformerGroup` was imported from the wrong pyproj module. The import was corrected to `pyproj.transformer`; the successful run above regenerated the profile with the final profiler SHA-256 recorded inside it (`a220d85c15ee61cc2ac457827e0770665c98e63ac913b1ee47222c42c3a527c9`).

The pack verifier checks declared available metadata bytes only. It does not establish source accuracy, permission scope, semantic ingestion, rendering, or workflow readiness. This profile does not pass semantic admission, private tiles, GF-STREAM, GF-SCALE, or DATA qualification. It establishes no legal boundary correctness/currentness, parcel or ownership facts, building/3D geometry, vertical measurement, runtime budget, or training permission.
