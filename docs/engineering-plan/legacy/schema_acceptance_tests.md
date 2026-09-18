# Unified-schema acceptance specification

**Status:** Planned tests. None of these application-level tests was run for this assessment. The small planning-file sanity checks are separately recorded in `09_PLAN_CHECK_RESULTS.json`.

## T01 — Original preservation

Import two permitted source revisions; verify acquired-byte hashes, exact source names and locators remain attached to the correct revision. Derivative output never replaces original bytes.

## T02 — Normalization equivalence

Use matching GeoJSON/GeoPackage/canonical fixtures with independent expected coordinates. Assert matched identity, hole/multipart preservation and quantity equivalence within an explicitly declared test tolerance.

## T03 — Z and M semantics

Try explicit XYZ and XYZM fixtures against each adapter. Unsupported dimensions fail with a retained-source/loss report; supported profiles preserve height and stationing separately.

## T04 — Coordinate axes and units

Use metres, feet, millimetres, swapped axes and reflected/rotated local geometry. Only declared operations produce accepted output; negative cases cannot pass by relabeling.

## T05 — Vertical reference

Mix ellipsoid, orthometric, terrain-relative and building-relative observations. Require valid transformation/benchmark ties for dependent comparisons; no default zero-offset acceptance.

## T06 — Plan calibration

Separate scale-only, mapped control points and vertical reference. Distorted or underdetermined scans remain unresolved; independent checkpoints expose overfit transformations.

## T07 — Semantic mismatch

Supply roof outline, ground occupation, approved envelope and parcel boundary. They remain separate roles; automatic conflict rules compare only compatible definitions.

## T08 — Identity resolution

Use equal labels at different sites and duplicate geometry at the same site with different worlds. Require explicit/source-backed matching; do not merge by name or proximity alone.

## T09 — Replay and changed mapping

Repeat identical source/profile/frame mapping without duplicates. Change the field or frame mapping and verify the system creates a new tracked interpretation rather than reusing the wrong receipt.

## T10 — Split and merge

Split one parcel or flat into two, then revise a merge. Preserve lineage and historical resolution; retired IDs are not silently reassigned.

## T11 — Multi-source composition

Footprint B, levels C, units D and parcel E produce one coherent selected object graph. A failed unrelated utility contribution does not erase valid building output.

## T12 — Conflicting observations

Two comparable sources disagree on height. Preserve both; explicit decision selects the intended purpose/time/world value. Planned versus observed states are not collapsed.

## T13 — Cross-block identity

One building straddles two authoring blocks with different local origins. Transform analytically into a common frame and assert one canonical object with multiple memberships.

## T14 — Cross-tile semantics

Clip/pack a building or road into several render chunks. Every fragment resolves to the same entity and exact selected representation; duplicate quantities and stale picks are prohibited.

## T15 — Topology

Supply grade-separated roads and pipes with coincident XY but different utility systems/heights. No false network node/connection is created; explicit topology remains auditable.

## T16 — Level and shared-space model

Create split levels, a duplex, two same-label storeys in different building parts and a common stair. IDs, membership, quantities and selection remain coherent.

## T17 — Geometry capability

Open mesh, closed solid, polygon with hole, multipart prism, degenerate input and unsupported curve. Renderability and volume/intersection suitability are separate test outcomes.

## T18 — Optional documents

Start with sufficient geometry and zero documents. Attach a source at building, floor and flat scopes, then remove one link. Geometry and unrelated links remain intact.

## T19 — Evidence specificity

One plan supports two flats and two revisions. Correcting one flat must not overwrite another flat question/decision; page/row/object locators resolve exactly.

## T20 — Private parties and source permissions

Public tiles, world resolver, metadata, thumbnails and exports contain no unauthorized party or document data. Purpose-specific source restrictions remain enforced.

## T21 — Temporal correctness

View source capture time, validity interval, system-recorded history and publication revision separately. Backdated corrections and future designs do not silently rewrite prior views.

## T22 — Render/measurement independence

Change LOD, clipping view, explosion amount, style and tile partition. Canonical IDs and analytical quantity results remain invariant for unchanged inputs.

## T23 — Incremental invalidation

Geometry changes invalidate dependent neighbours/tiles. Evidence-only changes can stale a decision; unrelated PDFs/occupancies do not regenerate stable facade geometry.

## T24 — Bulk recovery

Kill an ingestion or compilation worker mid-chunk. Resume from recorded checkpoints, reconcile every item and activate no partial manifest as complete.

## T25 — Publication consistency

Publish adjacent changed tiles and their metadata atomically. Old clients can retain their snapshot, and failed builds leave the previous publication available.

## T26 — Scale and boundary geography

Exercise several analytical frames, antimeridian/polar cases where in declared coverage, paging and bounded caches. Unsupported extents/operations fail explicitly rather than silently distort.

## T27 — Backward compatibility

Compare retained IDs, original source hashes, old local geometry, revision history and relevant workflows before/after an additive migration in an isolated test database.

## T28 — Input safety and counts

Malformed archives/XML/CAD references, huge declarations, native container limits, prohibited external fetches and interrupted API paging are safely handled with explicit complete/partial/error counts.

## Tolerance policy

Select numeric tolerances for each supported operation/profile using input units, source quality, independent references and numerical behavior. Do not turn a synthetic small-coordinate tolerance into a blanket real-survey accuracy claim. Keep coordinate, source, computational and render error budgets separate. Record toolchain, hardware, dataset size and actual benchmark conditions when implementation tests are run.
