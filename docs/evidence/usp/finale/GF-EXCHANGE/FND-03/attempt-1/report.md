# FND-03 attempt 1 — private CityJSON exchange

- Base: `8c52896cd2c5d47327e79fc12d7018c4133428a9`; worktree: `/Users/vinayak/.codex/worktrees/ulpin-sol-implementation/3D Ulpin`; branch: `agent/FND-03-exchange`.
- Code commit: `297510c493c58478cc04e98c3ff70afcb71e7298`.
- Agent setting requested: Codex GPT-6 Sol, high effort. The task's tools did not expose the actual selected model or effort, so neither is claimed as observed.

## Delivered

The local-only USP route accepts a pinned recorded snapshot and selected registry records at `POST /api/v1/usp/exchange/cityjson/export`. It returns CityJSON 2.0, a private `P3-CJ/1` sidecar, a conceptual `P3-LADM/1` field report, and explicit loss entries. The sidecar binds the serialized CityJSON payload to the exact manifest digest, records all captured registry fields and referenced source revisions, carries original hashes and recorded licence families, and retains the named vertical reference. The exporter verifies referenced original bytes against their source receipts before returning data. Only exact EPSG-frame snapshots are accepted. It excludes historical synthetic records and records without a linked original from CityObjects. An incompatible share-alike source is withheld from an export requesting a different licence family. Public distribution is unavailable because this route has no per-artifact H01 release decision.

`POST /api/v1/usp/exchange/cityjson/compare` validates the version, frame, object identities, indices, sidecar binding, source revisions and original hashes, then returns a field-level comparison with no registry write. A plain CityJSON import reports sidecar facts as `omitted_by_profile`. Applying any result requires a separate reviewed command. Export and compare requests are bounded by the existing one-megabyte request reader and a 900-kilobyte export response limit.

The current registry does not carry a source-supplied 3D solid in this profile. Geometry is therefore omitted with a loss entry. No walls, roofs, heights, vertical datum conversion, parcel rights or unsupported relation are inferred. The LADM report is a conceptual mapping and makes no ISO conformance or legal validity claim. Existing legacy JSON export and FND-04 analytical/display guards were not changed.

## Checks and observed limits

| Check | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit 0; lockfile unchanged, 226 packages reused. |
| `pnpm typecheck` | Exit 0 after the exchange edits. The initial attempt returned 1 because this new worktree lacked `node_modules`; the locked install resolved that setup issue. |
| `pnpm exec tsx --test tests/usp-project-identity-code.test.ts tests/usp-geometry.test.ts tests/usp-d1-import.test.ts` | Exit 0, 14 existing tests passed. The D1 test reads the retained official 3DBAG source; its original SHA-256 is `5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2`. It does not exercise this new export route. |
| `python3 docs/usp-agent-handoffs/tools/validate_handoffs.py` | Exit 0, document consistency only; new planValidation receipt hashes 37 active inputs. The command ran before a final feature-only commit amend; the plan and validator bytes were identical at the final code commit. |
| `cjval --version` | Exit 127, command unavailable; version and CityJSON schema-validation result unavailable. |
| `val3dity --version` | Exit 127, command unavailable; version and 3D geometry-validation result unavailable. |

No official Indian building/unit snapshot with source-supplied solids, two levels, duplex components, two parcel associations, shared interests and split/merge lineage was available for an actual round trip. The standalone `GF-EXCHANGE` runtime gate, real-source accuracy and standards validation remain unqualified. Existing official D1 source is an exterior `area_feature`, outside this registry-record exchange adapter, and does not supply the missing interior or rights facts. No linked or repository service data was reset, seeded, changed or exported during this attempt.

## Manual use

Capture a recorded registry snapshot with an exact EPSG site frame. Submit its `scope`, one or more selected registry `targets`, `licenceFamily` (or `null`), and `distribution: "private"` to `exchange/cityjson/export`. Save the returned `cityJson` and `sidecar` together. Submit `{scope,cityJson,sidecar}` to `exchange/cityjson/compare`; omit `sidecar` to see the explicit provenance/rights losses. Review the comparison and the export loss list before using either artifact. The route stays on localhost and cannot publish a public derivative.
