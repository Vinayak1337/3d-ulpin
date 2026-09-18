# T005 — reusable originals, sources and exact evidence links

Status: detailed plan prepared against the accepted architecture and T004's
qualified identity boundary. Implement only after its acceptance is recorded.

## Outcome and inspected starting point

Extend the same core module with datasets, source revisions, assets, exact parts
and many-to-many evidence links. The existing `SourceRevision` carries immutable
source UUID, family/ordinal, bytes/hash, profile and case. `SourceLocator` contains
page/row/feature/JSON-pointer/normalized-region fields; `DocumentPart` also retains
a verbatim locator and copy provenance. Preserve these meanings, not just labels.
`storage.ts` and existing domain writers remain authoritative; no byte copy or new
storage backend is introduced. A pure legacy-source projection is the first
consumer of the new catalog and is tested against these actual field definitions.

## Schema and module design

Add `source-schema.ts` and `sources.ts` under `spatial/core`. Export structural
schemas with the existing generator and validate the same source-catalog corpus
in Python. Use typed registered/unavailable storage states, explicit checksum/byte
metadata, access and retention declarations, and exact source/part revisions.
An opaque blob reference resolves server-side to the original source row; no
bucket keys, source URLs, credentials or duplicated file bodies enter the shared
public metadata model. A registered hash is metadata, not proof of a new read-back.

Keep the catalog record revision distinct from the source family's ordinal. The
legacy immutable source UUID maps directly to a `source_revision` reference with
catalog revision one; the original family ordinal is retained separately. A
missing ordinal is null, not a fabricated number. Cases are workflow memberships,
not automatically datasets. Original asset identity is not a hash-only dedup key
that could join independently restricted sources.

Exact locator variants cover whole asset, feature/layer, page and normalized
region, row/line range, JSON pointer, named model element and a retained verbatim
legacy locator. Validate region ordering/bounds, integer page/range fields and
JSON pointer escapes. Unparsed verbatim locators remain available without being
misrepresented as machine-exact geometry evidence. Future IFC/cloud locator types
do not imply that those parsers or analytical profiles are implemented.

A part holds a bounded conjunction of locator variants, retaining combined legacy
feature/pointer/page/row information instead of selecting one and discarding the
rest. File parts identify their specific asset. MIME metadata retains safe
parameters such as a charset, without treating them as a parser capability.

## Linking, inheritance and privacy

Evidence links target stable identity references and a specific part revision.
Direct links can be associated independently with several buildings/floors/units.
Inherited context/record links name an active direct parent link plus a verified
part-of/occupies-level path. They cannot silently claim exact unit geometry from a
parent PDF or inherit from unrelated utility/road relationships. Missing/stale
parts, sources, datasets, assets, parent links or entity endpoints are errors.

Access declarations are not authentication. Existing server permissions remain
the security boundary. A geometry-safe public index is an explicit allowlist and
includes only sources whose required dataset/asset declarations are public;
private parts, locators, original blob references and file contents stay out.
No promise of production multi-user authorization is made by these enum fields.

## Unlink command and preservation

A pure unlink plan uses expected link revision, changes that one link to unlinked,
and preserves all original assets/sources and other direct links. It never emits
a storage-delete action. Active inherited dependents block a parent-only unlink
until a later explicitly scoped cascade is reviewed; do not quietly invalidate
other evidence. Missing/stale/already-unlinked inputs are explicit outcomes.
No database or object-store mutation occurs in this task.

Review correction: child-unlink followed by parent-unlink reproduced a stale
parent-reference failure. Keep previous link revisions in a bounded optional
`linkHistory` collection. Current active inheritance must still resolve the
current parent revision; archived or unlinked associations may resolve an exact
preserved older parent revision. Never weaken that rule to accept an arbitrary
older number without the referenced record. Historical links are not active
associations, and unlink appends the previous version without changing siblings.
Reject duplicate, orphan, future and same-revision history records. This remains
a pure candidate; transactional storage/replay belongs to later writers.

## Tests and exit

Prove one original supports several targets; zero attachments is valid; exact
revision/locators survive; missing and conflicting metadata remains explicit;
inherited paths are bounded and validated; direct unlink cannot remove other
references or original bytes. Include duplicate IDs, stale refs, reverse ranges,
invalid regions, unsafe pointer escapes, public/private projection, wrong parent,
dependency-blocked unlink, mutation attempts and malformed legacy source fields.
Run shared TS/Python positive/negative cases, generated drift checks, existing
type/spatial/UI tests and current integration when affected. The output is an
additive catalog/read boundary, not a new parser or storage writer. Rollback is
code/schema/test-only; stored records and original bytes remain unchanged.
