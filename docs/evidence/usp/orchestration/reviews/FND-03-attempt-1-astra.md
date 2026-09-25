# FND-03 attempt 1 — Astra risk review

**Disposition: corrections required; partial implementation only. GF-EXCHANGE remains pending.**

- Base `8c52896cd2c5d47327e79fc12d7018c4133428a9`; code `297510c493c58478cc04e98c3ff70afcb71e7298`; result `a6d2cbf12604400858dd311762e803f3c37821e0`.
- Review worktree `/Users/vinayak/.codex/worktrees/fnd03-astra-review`, branch `review/fnd03-attempt1-astra`, created at the immutable result. Prior FND-06 review branch preserved.
- Observed Codex desktop / `gpt-6-astra` / `high`, verified in this task's latest local `turn_context`. Same-family engineering review, **not independent milestone approval**.
- Read operating guide, H29 FND-03, H26 D–F/Z3, narrow code diff, existing snapshot/source authority and worker evidence. No production edits or recursive delegation.

## Findings requiring correction

### P1 — Withheld licence content remains in the sidecar

`apps/web/lib/server/usp/exchange.ts:104–106,137–144` removes an incompatible share-alike record only from `CityObjects`. The response still copies **every** input record, its complete body, and **every** source's metadata into `sidecar.records`/`sidecar.sources`. Source metadata includes captured inspection/reference parts (`snapshots.ts:102–104`). Thus an export requesting an incompatible licence receives the data it labels `withheld`, including derivative source text, under that export-family envelope. Private-only distribution prevents public release but does not make the implemented withholding or H29 acceptance claim true.

**Smallest fix:** compute one allowed export set and use it for every emitted artifact, including sidecar bodies and source-derived content. Retain only the necessary withheld marker/loss for excluded content; preserve attribution for allowed material. Do not silently reinterpret `withheld` as “omitted only from CityJSON”.

### P1 — Omitted CityObjects bypass comparison of sidecar-only rights/provenance

`exchange.ts:206–224`: when `expectedObject` is absent, lines 209–211 emit `unsupported` and `continue` before looking up or comparing the sidecar record. Unsupported parcel kinds, multi-parent units, unavailable-parent records and other omitted objects are precisely where the sidecar retains facts that CityJSON cannot represent. Change or remove their body fields while retaining ID/count: the binding hash still covers only CityJSON, source metadata still matches, and no record conflict is emitted. A same-registry comparison can therefore return `state: compared` despite changed rights, lineage, record revision/hash or other sidecar-only facts. The record-count check at lines 195–196 does not close this gap.

**Smallest fix:** compare identity/pin/body/source bindings for every retained sidecar record independently of CityObject support/presence. Keep the CityObject loss entry, but never skip comparison of the surviving sidecar facts. Apply the same principle when an expected CityObject is missing, where the current early continuation also omits field-level sidecar results.

### P2 — Changed hierarchy children are invisible to comparison

`exchange.ts:129–131,214–217`: export creates reciprocal `children` links, but comparison checks only `type`, `attributes`, `parents`, and `geometry`. Its validator also does not validate the hierarchy. Removing or changing an exported parent's `children`, then updating the sidecar's CityJSON hash to match those supplied bytes (or importing without a sidecar), produces no hierarchy conflict even though the payload differs from the captured relationships. A content hash binds two submitted artifacts; it does not prove their agreement with the expected snapshot.

**Smallest fix:** compare `children` along with `parents` and verify that submitted hierarchy references resolve and are reciprocal. Treat a loss/change as a conflict; do not infer replacement relationships.

## Boundaries reviewed without an additional defect

- Routes remain POST/local-only and use the existing principal. `exactInput` checks distinct registry pins against manifest membership and target selection; `readManifest` verifies scope/digest/access-view/policy. Reads use captured bodies, not current mutable record bodies.
- Original bytes are read through existing storage and checked against captured size/hash. No original writes, registry mutation, new authority or provider call appears in either exchange path. Comparison is read-only; snapshot creation is a separate pre-existing command.
- EPSG-shaped horizontal frame, named vertical reference and metre units are required and matched during comparison. This is a profile restriction, not verification of an EPSG definition or vertical-datum accuracy.
- Public distribution is rejected by the request contract. Geometry omission and conceptual-only LADM wording are appropriate partial-delivery limits; absent source facts must not be filled to satisfy a round trip.

## Verification and outstanding work

Reused [worker report](../../finale/GF-EXCHANGE/FND-03/attempt-1/report.md): typecheck and 14 existing adjacent tests passed, document validator passed; `cjval`/`val3dity` commands returned 127. None exercises the new export/compare routes. The result commit changes only report/plan-validation evidence and its receipt reference; it does not satisfy or alter H26/H29 acceptance requirements. This review used source/control-flow evidence for the defects, without manufacturing data or running a new harness.

**Smallest new-route check after fixes:** use one already authorized, official-source-backed recorded **registry building** with an exact EPSG site frame and retained source bytes. Supply its existing captured scope and pin to `POST /api/v1/usp/exchange/cityjson/export` with private distribution; send the returned `cityJson`/`sidecar` to `/compare`, then omit the sidecar and verify explicit missing provenance. Record route status, snapshot/original/artifact hashes and absence of registry writes. No solid, two-level fixture, public release or provider is necessary for this bounded geometry-omitted path. Test the concrete findings by removing existing returned fields/links or using existing recorded incompatible licence metadata, without inventing source facts.

**Dependency:** the evidence does not identify an eligible official registry-building snapshot with retained originals and an isolated read-only route runtime. The existing official D1 case is an `area_feature`, which this adapter rejects; do not fabricate or relabel it. The implementation owner should locate an eligible existing scope or explicitly retain the runtime-verification block. No service was started by this review, including reserved port 3108.

Full GF-EXCHANGE still requires available pinned validators with passing receipts and the source-supported round trip covering levels/components, parcel associations, shared interests and lineage. Those missing facts, geometry support and source coverage remain unqualified; neither adjacent tests nor this review grants gate completion.

Review cleanup: only this report changed; `git diff --check` passed. No tests, installations, data acquisition/generation, keys, provider requests, service/container/port use, protected-data changes or production writes. Worktree retained for report integration; no owned running resources. Original checkout and moving Sol worktree were untouched.
