# GN1 — bounded real files through a batch (GF1)

**Partial: G1, G2 and G3 qualified; G4 blocked by the protected author call.**

- [result.json](result.json): gate booleans and observed counts.
- [runtime.json](runtime.json): Nest HTTP, fresh PostGIS and this worktree's built geo image; source hashes inside the image verified. Only that nonce's containers were removed.
- [checks.json](checks.json): ingestion 233 → 243 passing; geo 120 → 137 passing; backend/Studio typechecks and generated-contract checks pass.
- [before.json](before.json), [after.json](after.json): NYC and DA4 keep their entire CRS objects and fingerprints. The existing CA0 fingerprint test passes unchanged.
- [token-proof.json](token-proof.json): all 155 DA5 normalizer keys equal the raw integer tokens, including separate labelled synthetic spelling controls.
- [ownership-stop.json](ownership-stop.json): exact blocked call and narrowly needed owner change.
- [attempts.json](attempts.json): failures, bounded corrections and earlier receipt qualifications. The temporary caller-bridge receipt is diagnostic only, **not** a pass for the final owned code.

## Observed

DA5 retains and enrolls, asks for an officer layout, then prepares and records **155 physical parcels**, no buildings, after an officer-stated `parcel` / `OBJECTID` integer layout authored without a destination. Stored source CRS is EPSG:2958, unit `metre`, and its declaration warning is retained. All three MultiPolygons keep two parts. No name or height layout is sent; geometry establishes neither ownership nor issuance.

The first NYC file has 1,662 raw features and records 1,661 accepted buildings. DA4 adds seven columns and receives the first file's approved operations as a **proposed** `memory` layout with new source pins and **no inherited approval**. A fresh officer approval prepares its own new area, with **1,417 ready buildings**, then records them.

A second NYC copy creates no area, package or physical record. Its row currently remains `probed` / `undecided`, with no reason, and its job is `stale`. The public refusal is still `STALE_REVISION`: `service.ts:221` calls `destination` without the source hash. That line is explicitly read-only. The delivered destination guard cannot prove this file owns the `file:<sha256>` namespace without that pin. G4 is therefore **false**, although the guard and `officerQuestion` mapping pass their unit tests.

## Why raw integer tokens are sound

Python's existing JSON reader now uses a `parse_int` callback that keeps the token on an `int` subclass. Fraction and exponent forms remain floats. The fact requires completeness, uniqueness, plain spelling, no negative zero and the exact ±(2^53−1) range. Leading-zero `007` is invalid JSON and is refused before a profile exists. TypeScript additionally checks safe-integer completeness/uniqueness. The fact is stored with the inspection's byte hash, never inferred from parsed integrality, and excluded from the schema fingerprint. Only `feature.sourceKey` admits the new conversion. Old profiles without the fact remain unqualified for it.

`profile` and `validate` are unchanged: inventory is stored at retain, not recomputed on reads. Old inspections lacking a unit default only for EPSG:4326; other systems must be checked again. Unit publication is confined to GeoJSON; native readers are unchanged.

## Re-run

```sh
node docs/evidence/gf1/gn1/run-runtime.mjs /tmp/gn1-review-new.json
```

The receipt path must not exist. The walk records G4's actual outcome: currently false; after the owner supplies the protected source-hash argument, it verifies the exact new refusal and waiting words. It never sends a layout for DA4 or the duplicate.

No provider calls, no demo-stack changes, no external original writes. Storage is the KN2/CR1 in-memory S3 HTTP stand-in, not production object-store qualification. Large files, adaptive proposals, archive GeoJSON and Studio are untouched. Projected GeoJSON inside a ZIP remains refused by `document-ingestion.ts:185-186`'s EPSG:4326/evidence guard. The hand-written GIS response schema at `wire-schemas.ts:230-239` does not yet advertise the additive optional inspection fields; the generated batch profile does.
