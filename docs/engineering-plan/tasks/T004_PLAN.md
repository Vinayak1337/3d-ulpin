# T004 — stable identity, vocabulary and typed relationships

Status: detailed plan, implementation authorized after accepted T003.

## Outcome and boundary

Add the first `ulpin-spatial/2` contract modules inside the existing contracts
package, with inferred TS types and generated Python-consumable schemas. They
describe identity and relations; geometry, asset storage and scene publication
come in later tasks. No new registry, DB migration, renderer rewrite or automatic
entity matching is included. Existing v1 exports and every stored ID stay intact.

## Current files and changes

- Add `packages/contracts/src/spatial/core/` for portable scalars, entity/relation
  schemas, a graph validator and deterministic identity-change planning.
- Add Zod **4.6.2**, the already locked version, as this package's direct
  dependency; do not update other package resolutions.
- Export distinct `Core*` names through the contracts package without changing
  existing `Spatial*` DTOs. Future compatibility adapters consume these modules.
- Add schema export/drift checks, shared conformance fixtures, Node tests and a
  small Python validation path for the qualified identity graph. Python reads
  bundled schemas and an exported relation-policy table, not copied enums.

## Data decisions

Identity is `{namespace,id}`. Namespaces distinguish physical observations,
registry records and authored fixtures; the original opaque ID is never rewritten
or inferred from a label, area, tile or geometry. A deterministic encoded key is
only a map/cache key, not an official ULPIN or a replacement database ID.

Entity revisions include label, explicit identifiers, non-exclusive collection
memberships, kind and active/retired lifecycle. External identifier values remain
strings with leading zeros. Equal labels/identifier strings do not automatically
merge objects. A physical record and a legal/registry record may share text but
remain different references. Historical aliases stay explicit assertions, not
new identity allocation.

Typed relations cover part-of, occupies-level, parcel association, recorded-by,
service/crossing and split/merge lineage. The endpoint policy is data exported
from the TS authority. Several level relations for a duplex and several building
parents for common circulation are valid; duplicate edges, invalid endpoints,
self-relations and containment cycles are not. A crossing is not connectivity.

## Command semantics

Provide pure rename/split/merge planning against a validated identity graph with
explicit expected revisions and supplied new entity references. It produces a
candidate delta/change record, not a database write or geometric subdivision.
Reject stale revisions, retired sources, reusing any current/historical reference,
duplicate outputs, mixed namespaces/kinds and unsafe revision overflow. Splits
require at least two new entities; merges require at least two sources. All old
IDs remain as retired historical records with explicit successors. Do not infer
geometry, rights or external identifiers for the new entities.

## Tests and independent oracles

Test identical ID text in two namespaces, leading zeros, labels renamed with
unchanged identity, two authoring memberships, duplex/shared stairs, reversed
input order, missing endpoints, wrong endpoint kinds, duplicate identities/edges,
cycles, unsafe keys/control characters, non-finite/non-JSON values, depth/size
limits, stale commands, retired sources, reused historical IDs and split/merge
lineage. Check that caller inputs remain unchanged and repeated planning with
identical inputs is deterministic. Use explicit expected references/revisions,
not a helper that repeats the implementation's allocation logic.

Structural and graph-semantic positive/negative fixtures are consumed by both
runtimes where implemented; distinguish structural parity from unimplemented
semantics explicitly. No arbitrary user schema URL is accepted. Keep generated
files checked against the one source and use bounded validation before recursive
library parsing. Runtime tests complement the compiler/typecheck, not replace it.

## Acceptance and rollback

Core schema and identity operations pass their tests, corpus parity and generated
drift checks; existing spatial/UI tests and type checking remain intact. The code
has no storage side effects. Rollback removes only the new modules/dependency and
their tests. T005 may then attach reusable sources without changing identity.

## Self-review additions

The complete graph must preserve both directions of the explicit retirement and
lineage representation. A successor cannot be allocated by two unrelated change
IDs. Add independent negative fixtures for missing lineage and competing successor
allocation before tightening both runtime validators; keep the command writer's
existing successful split/merge cases unchanged.
