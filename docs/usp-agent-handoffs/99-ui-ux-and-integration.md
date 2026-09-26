# 99 · Backend contracts for the user-owned Studio

**Current scope, 26 September 2026:** [Delivery policy](current-delivery-policy.md) supersedes older UI assignments and H97 addenda. This handoff plans only backend data, asset and API contracts. The user owns all screen design, frontend implementation and visual acceptance. No screen, theme, mobile, renderer replacement or screenshot work is scheduled here. Plan cleanup implements no feature and passes no runtime gate.

Read [H01](01-shared-contracts-and-ownership.md), enabled feature producers and [H28](28-data-acquisition-and-finale-tests.md). Preserve the recorded [D0/PACK0 and single-D1 baseline](../evidence/usp/continuation-2026-09-23/README.md) without recreating authored inputs. New official-source qualification remains separate. Use the live pinned staging base; older branch names and first-deliverable instructions are historical.

## 1. Existing consumer boundary

Preserve the Studio catch-all and compatible saved routes, the canonical registry/import authorities and the shared map runtime. The current map path is BlockPage → SavedSceneViewport → MapViewport with existing provider/session/cache boundaries. Retain the qualified Cesium D0/D1 path; changing a backend contract is not authorization to add a per-feature viewer or replace the renderer. Keep unique document, GIS, raster and point-cloud inspection capabilities and access to retained originals.

Backend producers must support exact source → candidate → review → record → evidence/report → retained revision operations. Source-only records, unavailable interiors and missing geometry remain useful explicit states. Invalid/retired unit requests never silently broaden to a building, parcel or different dataset. Selection IDs, feature IDs, registry IDs, import batch IDs and import package IDs are not interchangeable.

## 2. API/view-model ownership

FND owns shared schemas, request/access context, asset serving, persistence and lifecycle; feature owners own their service result types. A view model is a projection of those authorized records, not a second registry, manifest or source of truth. The [reference view-model schema](../design-system/mockups/officer-studio/view-model.schema.json) is a consumer reference only. Do not invent fields or sample values to satisfy it; expose unavailable/unsupported contracts when a producer is absent.

| Producer | Backend result / command contract |
| --- | --- |
| PACK / H10 | Exact scoped plan, direct/shared/omitted evidence, immutable artifact and current/historical status; Property Card subtype and access-checked revision QR use the same service. Original archive stays distinct. |
| READY / H11 | Scope-qualified requirements and counts, selectionToken resolving the same target population, missing/stale reasons and authorized source/request actions. |
| FIND / H12 | Exact participants, references, operation/profile, measured result, source roles, coverage, limitations and a persisted review-case command; parcel-only scope needs no invented building. |
| CITIZEN / H13, deferred | Released lookup and own-submission projections, upload/scan/review/recording states, clarification and retention; no internal dossier reuse or upload-as-ownership inference. |
| INGEST / H14 | Durable upload receipt, input manifest, recognized capabilities, mapping/sufficiency decisions, draft manifest, exceptions and accountable review commands. |
| HISTORY / H15 | Exact left/right revisions, field/source/geometry differences, source versus record dates, lineage, retirement and explicit successors. |
| RIGHTS / H16 | Declared relationships, beneficiaries, clauses, extent/validity and partial/conflicting traversal; one physical space may serve multiple units. |
| IMPACT / H17 | Pinned proposal, affected mapped spaces, exact manifests, reference/accuracy/depth and unassessed coverage; report never grants clearance. |
| ASSIST / H18, deferred | Typed grounded facts, evidence, ambiguity choices and allowlisted actions from authorized producers; no synthesis from denied cached data. |
| DEPLOY / H19–20 | Access-checked profile, capability, qualification, budget/cooldown/retirement and missing-configuration reasons; no credentials or unverified residency claims. |

## 3. Compatible routing and request semantics

Preserve current Batches/intake/map/register/dataset/workspace route contracts and safe legacy translation while the user changes presentation. `/studio/showcase?dataset=...` may resolve a retained historical hash to a saved ID; it must not auto-import deleted synthetic downloads. Persisted artifact links resolve their exact plan/comparison, not the currently selected unit.

The server validates area, parent, target, stage, world, manifest and access membership. Missing optional selection differs from invalid supplied selection. Reject duplicate/conflicting known parameters. Intake uses workspace/version before a spatial snapshot exists. Public or unresolved submissions remain intake-scoped until an authorized association exists. Proposed public routes are deferred and externally inaccessible until separately qualified.

## 4. Record-backed states and provenance

Return distinct `available`, `pending`, `needs_input`, `unavailable`, `denied`, `not_assessed`, stale and failed states where the feature contract supports them. Unknown, withheld, absent, null, conflicting and unsupported do not collapse to zero or empty success. A result must identify its exact scope, revision, capability and limitation; a denied response must not leak filenames, counts, source URLs or another principal's data.

Dataset classification and labels come from the record. Preserve fixed provenance words where supported: **Test fixture**, a labelled seeded case, **Replayed**, **Estimated**, **Illustrative**. Historical data is not relabelled official. Do not hard-code mockup names, identifiers, files, dates, counts or people, or add “fictional”/“demo” prose as an application-data label. H10's **Local demonstration link** is a QR delivery mode, not a data classification.

## 5. Geometry and authorized asset contract

Keep canonical analytical geometry separate from display derivatives. Source/asset persistence exposes hashes, versions, media/capability types, bounds, named CRS/vertical reference, units, semantic LoD, source IDs, licence/attribution, pick-identity mapping and limitations. FND serves only bounded registered authorized assets. No remote/path-traversal dependency fetches; missing texture/codec/transform is an explicit limitation. Preserve original bytes and relative dependency paths.

The existing canonical compiler's one-frame/5 km/2,000-entity/50,000-position/12,000-facade-bay/80 MiB profile remains a bounded capability, not a promise of arbitrary source support. Do not relax validators to claim a format passed. External CityJSON/CityJSONFeature conversion decodes declared scale/translate once, retains building/part hierarchy and semantic IDs, and preserves planar face rings/holes when triangulating. Unsupported/nonplanar surfaces abstain; roof surfaces are not flattened into XY footprints. Provider tiles retain their actual coordinate/compression/metadata declarations; no second transform on already transformed geometry.

NAP heights are not automatically ellipsoidal/ECEF heights. An unavailable qualified operation permits only labelled local-frame inspection and blocks global measurement joins; never invent geoid corrections. Interiors need independent source support. Context meshes are not legal units or analytical volumes. Cross-source placement reconciles reference system, epoch and duplicate identities; shared upstream provenance is not independent corroboration. Foreign geometry remains in its own geography.

## 6. Durable manifests, events and cache compatibility

INGEST owns `usp-scene-manifest/1` descriptors; FND owns opaque AssetRef. The scene manifest ID differs from the pinned data SnapshotScope.manifestId; no self-hashing or ID interchange. Each asset carries actual hash/version, bounds/frame, LoD and identity mapping. Persist before publishing availability. A recorded-only process cache cannot masquerade as a durable draft.

Expose a consistent status-plus-cursor snapshot, replay committed events and retain coherent version/removal semantics. Version gaps or expired cursors require the authoritative manifest; provide the specified polling fallback when SSE is unavailable. An older event cannot restore a removed entity. A failed/denied asset leaves explicit coverage rather than inventing a complete result. Ready-to-render is not ready-to-record. Preserve the consumer's bounded four-concurrent-asset loading contract; this is not an instruction to build a new client loader.

Request/cache identity includes method/path, scope/world/stage, manifest/target pin, filter, accessView and entitlement/policy version; intake uses workspace/version. Target/world/stage/access changes invalidate the old generation. Revocation must prevent pending responses from repopulating cleared private data. Events invalidate affected manifests/assets; source/record mutations invalidate dependency-matching results. Never place private records, tokens or packets in localStorage. The user's UI owns camera/focus/transient state; backend operations do not silently retarget it.

## 7. Authorization and mutation boundary

Availability is not authorization. Resolve principal/access context server-side on every read, asset download, job, command, packet and QR path, including compatible legacy endpoints. Preserve expected-version/manifest guards, idempotency, transactions and accountable review history. Capabilities expose implemented producer operations only; an unimplemented DTO is unavailable, not a fake successful result.

A card's selected-unit crop excludes other-unit pixels and metadata. Revoked, retired, wrong-unit or changed-policy requests fail without disclosing private information. QR possession grants no rights. Same-device local_operator mode stays separate from externally reachable/phone delivery; do not remove local-only protection globally. Public projections and provider settings obey their own release and operator grants.

## 8. Backend acceptance and external integration

GF-CONTRACT covers actual producer/consumer schemas and source/job/geometry seams. GF-VIEW covers source-shape/identity/frame/asset contracts, holes and unsupported geometry, manifest durability and selection pin compatibility. GF-SCENE covers official-source lineage, deterministic derivative rebuilding, invalidation and proof that display styling cannot change analytical hashes, quantities, readiness, findings, packets or exchange. GF-REHEARSAL covers the backend source-to-card state sequence, saved-state recovery, authorization and measured service receipts.

Use actual permitted official inputs, locked dependencies and the cheapest directly affected existing checks. Verify stale events, invalid target/scope, revocation during pending reads, missing assets, bounded recovery and resource limits where changed. Backend evidence does not prove picking, clipping/section behavior, camera restoration, browser performance, visual quality, accessibility or officer usability. These remain explicit user-owned integration dependencies; no backend-only receipt passes the complete product release. Historical V1–V8 and D0/D1 captures are evidence at their recorded revision only.

## 9. Preserved visual references, outside the execution plan

Retain [the design system](../design-system/README.md), [UI brief](../design-system/ui-brief.md), [Officer Studio reference notes](../design-system/mockups/officer-studio/README.md), [screen references](../design-system/mockups/officer-studio/screens.md) and [supplied interactive mockup](../../design-mockup/OfficerStudio.dc.html). They are protected visual references for the user's work, never production code or test data. Retain the source images pinned by `apps/web/public/studio-review/comparison-manifest.json` until an explicit hash-preserving reference migration.

No automatic UI task follows from these references. Legacy layout, font, screenshot and screen-implementation assignments remain in Git history at `92e4d04cdeaaa2d8ccc65680c6fea1675dcee88a`; they are superseded by this backend-only contract.

## Z4. Fixed wording and service claims

| Claim | Contract requirement |
| --- | --- |
| Identity | “Assign proposed 3D ULPIN” / “Assigned”; opaque P3 code separate from location and sourced official assertions; no official issuance claim. |
| Heights | Metres plus the actual named vertical reference; mean sea level only when the source establishes it. |
| Infrastructure | “Export screening report” and “Not a clearance or dig permission”; tolerance only when source-supplied, otherwise “tolerance not stated”. |
| Integrity | “Chain consistent”; “Chain signed and verified” only for a verified signed head. |
| Findings | Deterministic blocking/severity/size order, not an invented likelihood score. |
| Delivery | Same-device “Local demonstration link” where that recorded mode applies; no phone/public claim from a local resolver. |

These are backend response/artifact semantics for the user-owned interface. They schedule no UI changes.
