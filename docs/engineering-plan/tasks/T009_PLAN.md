# T009 — read-only normalization of existing records

Detailed plan, 18 September 2026. Baseline `7f4b101`; execution after T008 acceptance.

## Inspected facts and risk

Read `areas.ts` areaContext/loadAreaFeatures/getArea/listAreas, `domain.ts`
sourceFrom/getCase/getSource, `registry.ts` siteDetail/recordFrom, the SQL table
definitions, v1 legacy-adapter and spatial area route. **getArea calls listAreas,
which INSERTs missing map areas.** Do not reuse that helper for a claimed read-only
baseline. Existing getCase/siteDetail do use repeatable-read transactions but
return broader private records and sources than this bounded spatial projection.

Read the installed Next.js16.3.5 route-handler guide and reference required by
apps/web/AGENTS.md. Preserve all existing v1 routes and viewer contracts.

## Proposed boundary and first consumer

Add a typed, pure legacy projection beside the existing v1 adapter, and a server
reader using one `REPEATABLE READ READ ONLY` transaction. Read existing map-area,
owner-area reference, physical feature, explicit shared-group membership, linked
registry record/site and original source metadata directly. No DDL, migration,
identifier synchronization, neighbour scenario generation, geo-service calls or
source processing on the read path. SQL parameters remain bound.

Live-row check: registry JSON payloads can omit id/site/revision/identifier because
the current `recordFrom` reader overlays authoritative columns. The new reader
does the same for missing envelope fields and still rejects explicit contradictory
id/site/revision values. This is projection, not a DB rewrite or a new identifier.

The new local single-operator GET is a separate versioned core endpoint, requires
an explicit world, uses no-store, and checks an optional expected snapshot digest.
The authorization scope is fixed by the server, never accepted from a query string.
The initial request is a bounded area slice; count+1 checks and explicit byte/geometry
limits reject excess instead of truncating it. Pagination belongs to a coherent
catalog cursor contract, not a random LIMIT presented as the whole area. An optional
feature focus may select an explicitly bounded neighbourhood later, not required now.

Live-source inspection identified an actual T008 consumer gap: one physical feature
already has both local analytical and geographic display representations with the
same semantic role. Add a bounded optional resolution purpose (`analysis`, `display`,
`record`; absent means the existing analysis behavior) to the resolution uniqueness
key. This is not a second property model: both representations retain the same
entity and source revision and enter one manifest. Re-run T008 Node/Python parity
and add a purpose-disambiguation regression before using it in the adapter.

Existing globally stable physical/source/registry IDs and revisions, including
revision zero, are retained. Physical and registry entities use the already-qualified `physical` and `registry` namespaces;
recorded geometry is not relabelled observed physical truth. Preserve confirmed
physical-to-record links as typed relations. Registry kind maps to its recorded
spatial kind (floor→level), with namespace recording its authority. Unqualified
legacy links remain explicit unmapped references/diagnostics, not fabricated
containment. Parties, rights text, inspection bodies, credentials and raw blob keys
do not enter the scene/read DTO. Originals and existing private register are unchanged.

## Coordinates, evidence and omissions

Use each feature's original owner-area analytical frame, not a request-area
reprojection that changes geometry under an unchanged ID. Preserve source reference
metadata separately; do not confuse source and normalized frames. Geographic XY
remains geographic with unknown height. A feature-scoped vertical benchmark stays
feature-scoped unless an explicit shared tie exists. Registry records share only
their explicitly recorded site frame. Unknown benchmark/height stays unknown; a
height estimate alone does not invent a zero-to-height analytical prism.

Source IDs, actual family ordinals, checksums and byte counts come from stored rows,
not guessed AreaContext metadata. Exact source locators are preserved with stable
derived part IDs and original legacy locator values. Vague old document references
remain attachments, not qualified unit geometry. Geometry sourced from an accepted
registry record has an exact native-model element locator; its original evidence
attachments are still separate links. Referenced-but-unavailable original metadata
is an explicit unresolved source, not a fabricated hash or a lost feature.

Raw source properties and rights are not duplicated into the canonical model. Keep
an allowlisted preservation crosswalk with legacy target/revision and diagnostics;
original DB bodies remain authoritative and readable. Unknown/invalid geometry can
produce a geometry-unavailable representation with a source pointer while retaining
the entity. Structural ID/revision contradictions fail the read; no silent repair,
deduplication by proximity or bounding-box substitution.

## Detailed verification and containment

First add pure fixtures with a physical/registry ID collision, imported and shared
building, floor/space relations, revision zero, both geometry copies, source hashes,
compound locators, no PDFs, unknown height/CRS, stale/missing sources, invalid geometry
and a non-synthetic record with unknown scenario. Assert input immutability, no
private-field leakage, deterministic ordering and stable source/representation IDs.

Test the read SQL through an injected client: transaction isolation precedes reads,
one connection, bound identifiers/world, no INSERT/UPDATE/DDL/geo calls, limits fail
explicitly, rollback and release on errors, exact source metadata and memberships.
Exercise the actual new endpoint against existing local data using read-only
queries and response/parity checks. Record before/after source/ID/body digests in
read-only snapshots, noting any concurrent writer rather than claiming atomicity
across separate sessions. New mutating fixtures run only in isolated hosted/local
test resources, never in the user's populated DB.

Run all core/shared spatial/UI tests, installed-type checks, build, route tests,
generated drift and hosted conformance/integration. The existing v1 route remains
available and unchanged. No data migration is needed for this task. Rollback is
removing/disabling the new read endpoint; no stored data needs reversal.

## Current continuation and user priority

Finish this existing-data bridge and one real read-only neighbourhood demonstration,
then prioritize shared renderer/3D UI improvements. Broad bulk ingest and ML remain
later work; this bridge does not need a schema rewrite. Self-review adds registry
XYZ preservation (never slice away Z/M), height-evidence locators, owner-frame
metadata, malformed Host and repeated query parameter rejection. Capture actual
read-only database fingerprints before/after the live bridge and exercise its HTTP
response against an owned loopback server before accepting the task.
