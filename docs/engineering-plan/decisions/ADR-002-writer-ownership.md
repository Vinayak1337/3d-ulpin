# ADR-002 — additive evolution and one authoritative writer

Status: accepted. Date: 18 September 2026.

Keep the existing deployments and persisted records. The new common model is a
typed read/command boundary, not another database that must be manually synced.

| Record class | Current authority | New boundary |
|---|---|---|
| Original bytes and source revisions | `storage.ts`, `domain.ts`, `areas.ts`, immutable source/object keys | Reusable source/asset/part references; no per-building byte copies |
| Physical observations, imports and source links | `areas.ts` and `area-db.ts` transactions/review/revisions | Core entity/representation projection with exact native frame and source lineage |
| Registry identities, drafts and rights | `registry.ts`, `registry-db.ts`, `registry-seed.ts` | Explicit physical-to-record links; never merge objects because labels or UUID strings happen to agree |
| Preparation and associations | Existing officer/preparation services and their revision tables | Typed contributions and scopes; preserve historical decisions |
| Processing and job state | `processing.ts`, dispatcher, private geo worker | Bounded idempotent commands and revision-bound results |
| Scene assets and publications | Derived compiler output; current calibration cache only | Rebuildable assets with a future transactional publication manifest; not cadastral authority |

Compatibility adapters are readers. Reuse immutable source IDs/hashes and current
stable record IDs. Core references carry an explicit namespace to distinguish
physical features, registry records and authored fixtures while retaining the
original opaque ID. Render keys are deterministic encodings of those references,
not newly issued official property identifiers.

T010 adds storage only after a concrete missing relationship is demonstrated and
rehearses add/backfill/compare/switch in isolated data. No automatic in-place
reprojection, dropped tables, duplicate authoritative registry or silent dual
writes. Every temporary projection has an owner, input revisions and rebuild path.
The successful T001 isolated baseline is preservation evidence for its tested
revision, not permission to mutate the private PC data without its own baseline.
