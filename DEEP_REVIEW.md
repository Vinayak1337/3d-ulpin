# Deep review: original goal, agreed scope and delivered registry

Reviewed on 13 September 2026. This review distinguishes the original competition brief from the later, explicitly agreed synthetic/local demo scope. It includes code inspection, adversarial geometry and API checks, a real legacy-case import, and browser checks of review and query behaviour.

## Verdict

The application now demonstrates a useful registry workflow rather than only generating isolated building models: persistent spatial identities resolve to recorded volumes, fictional rights and preserved evidence; corrections are reviewed before becoming current; planning queries calculate actual intersections against current records.

The first delivery nevertheless missed several registry-level edge cases and some planned UX details. The deterministic Nandan stories passed, but that alone was not enough to establish general registry correctness. This audit fixed the concrete defects below. It does **not** establish production cadastral readiness or completion of the full competition brief.

## Defects found and fixed

| Priority | Finding and evidence | Correction |
| --- | --- | --- |
| P1 | Unsupported geometry keys could be silently stripped by the draft schema. A caller could provide a hole or a separate geometry frame and get a different solid checked. | Registry geometry and query-frame schemas reject unsupported fields explicitly. Both contract tests and an actual PATCH rejection were checked. |
| P1 | Closed rings could be normalized on the computed prism while the record retained its closing vertex, making later record/geometry comparisons inconsistent. | Registry drafts and reviewed records now keep canonical matching ring coordinates. The persisted allocation check covers this. |
| P1 | Moving A-201 50 m outside Building A produced no blocking relationship finding. Linking it to Building B's floor also passed the original checks. | Python now checks explicit horizontal containment, floor/building membership consistency and actual parcel crossings. Shared `serves` relationships remain valid across buildings; context containment is still not an ownership overlap. |
| P1 | Imported records selected the first ready JSON source rather than preserving the source bindings used by the built unit. Plan-only preparation was unnecessarily blocked. | Imports carry the unit's actual bindings/calibration. New context snapshots retain source bindings. Old context evidence is recovered only when unambiguous; otherwise import asks for explicit re-preparation. |
| P1 | A partly incomplete CSV was rejected wholesale even when the bound elevation rows were valid. The real C-001 import exposed this. | Parsed partial sources may support valid rows or human review. Every verified elevation still must match its exact alias, locator, value and benchmark. A real processed C-001 case then imported and passed review with no invented rights. |
| P1 | Evidence could be attached without comparing its declared coordinate frame to the site. | Sources that explicitly declare another frame or benchmark now fail review clearly; documents with no coordinate declaration remain usable evidence. Matching and mismatched frames are covered by tests. |
| P1 | An older in-flight query could finish after the inputs changed and appear under the new point/proposal. | Responses echo their exact inputs, the UI only displays matching results, and superseded requests cannot overwrite the latest response. A browser request was deliberately paused, X changed from 4 to 99, then released: the old result stayed hidden; a fresh [4,6] query returned the correct stack. |
| P2 | The legacy builder's unique-alias rule rejected distinct apartment records both labelled “101”. | Registry checks allow repeated readable aliases while still rejecting duplicate record IDs. Legacy case alias rules remain unchanged. |
| P2 | A 150-total-record limit prevented the promised 100-space capacity when each space also had a floor record. | The 100-space cap remains; context headroom is now 2,000 total records. A 100-space/100-floor test passes, while 101 spaces fails explicitly. |
| P2 | Review showed elevations/volume but no actual footprint comparison. A translated same-area polygon could look unchanged in its summary. | Review now overlays current/proposed outlines, exposes exact coordinate differences and lists affected neighbours/related records. |
| P2 | Acknowledgement text survived subsequent edits and could be reused without reconsidering changed warnings. | Edits, record switches and freshly prepared checks clear the acknowledgement. Browser verification confirmed recording stays disabled until a new acknowledgement is entered. |
| P2 | “Locate” only reset filters. The 3D camera did not actually move, and fixed camera limits were unsuitable for larger local scenes. | Locate now targets the selected footprint/vertical extent. Finding selection targets the affected proposal. Camera distance limits scale with scene extent. Browser verification confirmed the camera move. |

Review fingerprints now include the validator version. Uncommitted reviews made under the earlier rules must be checked again; already committed review retries remain idempotent. The strengthened checks do not rewrite current registry records.

Key implementation evidence: [registry validation and commit](apps/web/lib/server/registry.ts), [relationship geometry](services/geo/geo/registry.py), [import provenance](apps/web/lib/server/registry-import-evidence.ts), [review UI](apps/web/components/RegistryEditor.tsx), [query state and map UI](apps/web/components/RegistryWorkbench.tsx).

## Agreed-plan audit

| Requirement | Assessment |
| --- | --- |
| Two adjoining buildings on one shared local property map | Working; both are rendered together. Their shared wall is zero-volume contact. |
| One identity for a shared basement/cross-parcel corridor | Working; each is one spatial record with multiple relationships. |
| Stable site/parcel/building/floor/space IDs | Working; allocation is site-scoped and serialized. Geometry/name changes do not concatenate or regenerate IDs. |
| Search, copied record link, export and restart persistence | Working for current site records. Imported legacy identifiers also have resolver support. Full cross-site and legacy-alias search is not yet integrated into the main search box. |
| Explorer with parcels, buildings, floors and spaces | Present as a flat grouped list, **not the fully nested site hierarchy envisioned**. Identical floor names need stronger building qualification in navigation. |
| Linked plan and 3D views | Working, with selection and volume highlights. Footprint editing remains numeric JSON; a graphical boundary editor would improve the workflow substantially. |
| Building, elevation and record-type filters | Building/elevation filters affect volumes. The record-type control primarily filters the explorer; consistent map filtering still needs improvement. |
| Current record with rights, evidence, relationships and history | Working. The history UI is thin: full old bodies are preserved/API-exportable, but the screen mainly shows timestamps and elevations. |
| Prepare → build/check → review → record | Working with explicit draft targets, blocking errors, acknowledgements, immutable recorded revisions and stale-review rejection. |
| Reuse the existing preparation workbench | **Partial.** Source preparation and first import work. A correction uses the new registry editor; returning to the imported legacy case, changing it and importing again currently returns the original draft. It is not a general re-import/update workflow. |
| Geometry/rights change review and affected neighbours | Working for the demo, strengthened by this audit. A complete map-based before/after mode and richer evidence-source diff remain useful. |
| Above/below and proposed-volume queries | Working against current site records, with ordered elevations, rights/evidence, revision and exact query inputs. Boundary contact is separate from positive volume. |
| Synthetic source-to-build/review seed | Working and idempotent. It preserves operator changes and original source revisions. |
| Existing C-001/C-002, original downloads and case URLs | Preserved. Both full source-to-model correction tests were rerun successfully after the changes. |
| Runs locally without runtime internet dependencies | The prepared runtime uses local assets/services. Initial dependency/image installation still requires internet. No new external runtime dependency was added by this audit. |

## Remaining improvements, in order

1. **Complete the preparation-to-correction handoff.** Keep explicit mappings from imported case units to registry records, create a new linked draft for a later built case revision, show its input-source changes and preserve the current registry until review. Retries must reuse that new import operation rather than returning an old recorded draft. This is the largest remaining gap against the agreed workflow.
2. **Make the explorer an actual property hierarchy.** Nest parcel → building → floor → space, show shared infrastructure once with multiple relationship links, qualify repeated floor/room labels and expose cross-site/legacy lookup in one resolver. Make record-type filters apply consistently to the views.
3. **Give floors declared elevation bands.** Current floor records are horizontal context plus membership; authoritative lower/upper values live on spaces. The new checks detect wrong-building membership, but cannot establish that a space is assigned to the correct vertical floor band merely from a floor label. Add explicit, evidenced floor limits rather than inferring them silently from labels or whichever children happen to be linked.
4. **Make history and evidence comparisons legible.** Expand a past revision to its full rights, relationships and geometry; show review findings/acknowledgement and the precise before/after source locators. A document preview currently opens the file; it does not automatically jump to every referenced feature, row or page region.
5. **Replace raw coordinate editing with a guarded plan editor.** Move/snap vertices in the local frame, preview neighbours and preserve the same save/check/review boundary. Keep numeric entry for exact corrections and reproducibility.

These are scoped follow-ups, not claims that they are already implemented. The first three would most improve the administrator's experience after the prepared presentation.

## Original competition brief versus this release

| Original ambition | Honest present position |
| --- | --- |
| Standardized 3D ULPIN generation | We have a documented, stable **prototype registry identifier format**. Official issuance or conformance to an external cadastral identifier standard has not been established. |
| Map vertical and underground rights | Demonstrated with synthetic prisms, source-linked fictional assertions and shared/cross-parcel relationships. It does not adjudicate rights or verify title. |
| Drone, LiDAR, GIS, floor plans, GNSS/CORS, DEM/DSM integration | Existing local JSON/CSV and plan PNG/PDF preparation is present. New drone/LiDAR/DEM/BIM importers and real geodetic integration were explicitly excluded from the agreed release. |
| AI extraction, floor segmentation and parcel delineation | Explicitly deferred. The application performs actual polygon/prism processing; it does not perform AI extraction. |
| Intelligent topology validation | Deterministic, explainable geometric and relationship checks are present. They are not a learned model or a legal conflict-resolution engine. |
| Scalable/interoperable cadastral framework | Local PostGIS persistence and an application JSON API/export are demonstrated. Multi-user governance, production scale, standard exchange and institutional integration are unproven/out of scope. |
| Improve governance and infrastructure planning | There are concrete demonstrable admin tasks: resolve a record, inspect its evidence, control an update, inspect a vertical stack and find excavation intersections. Actual governance benefits would still need validation with administrators and real surveyed records. |

The strongest defensible presentation is **“an evidence-linked 3D property registry with controlled corrections and explainable spatial queries.”** Do not present it as automated surveying, official ULPIN issuance or a production land-record authority.

## Verification in this audit

- **59 Python tests passed**, including outside-context membership, wrong-building floor association, valid shared service, parcel crossing, repeated apartment aliases and the 100-space/100-floor case.
- **Eight focused TypeScript contract/provenance tests passed**, including closed-ring normalization, rejection of unsupported fields and preservation of context evidence through processor-result validation.
- **17/17 API regression checks and seven existing scene tests passed.** TypeScript checking also passed.
- Existing registry integration scenarios passed: 8 m³ conflict, 12/4 m³ excavation, current/draft isolation, acknowledgement enforcement, idempotent commits, stale neighbours and seed preservation.
- C-001 again computed **6.4 → 0 m³**, and C-002 **14.4 → 0 m³**, preserving original bytes/revisions. Adding context provenance initially exposed a result-schema stripping issue; that was corrected before these successful reruns.
- A real generated C-001 case was temporarily imported and reviewed through the API. Its actual bound sources were retained and no rights were invented. Only the test's unpublished registry objects were removed; its source case was archived and preserved.
- Production build passed and the restarted production UI again returned **12 m³ basement / 4 m³ utility** with zero-volume boundary contacts separately shown and no browser console errors.
- Browser checks covered footprint comparison/blocking, fresh acknowledgement, a deliberately paused stale query, a fresh ordered stack and the actual Locate camera action. The isolated UI audit draft was removed after verifying the current record was unchanged.

Repeat focused checks with `pnpm exec tsx --test tests/registry-import-evidence.test.ts tests/registry-validation.test.ts`, the Python suite, `pnpm test:registry`, and `pnpm test:demo`. After `test:demo`, `pnpm exec tsx scripts/verify-registry-import.ts` exercises a temporary unpublished import of that script's C-001 case. The integration suites create synthetic rehearsal revisions/cases; run them before presenting.
