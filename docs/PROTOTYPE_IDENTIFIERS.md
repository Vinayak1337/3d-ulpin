# Proposed 3D ULPIN identifiers

These are application prototype identifiers, not government-issued ULPINs.

The default application now uses persistent **site-based registry IDs**, documented
in [REGISTRY.md](REGISTRY.md). These are independent of workspace IDs, with
parcel/building/floor/space suffixes. The format below describes the preserved
legacy preparation workspaces.

## Legacy workspace format

| Entity | Example pattern | Meaning |
| --- | --- | --- |
| Property parent | `3DU-<26-character code>` | One parent for this property workspace; 30 characters total. |
| Floor/level group | `3DU-<code>:F001` | Persistent child of the property parent. |
| Space | `3DU-<code>:S001` | Permanent space identity; its current parent is a floor/group. |
| Hierarchy path | `3DU-<code>:F001:S001` | Current location in the hierarchy; changes if the floor assignment changes. |

The parent encodes all 128 bits of the existing random case UUID using a
26-character Crockford Base32 alphabet. It does not concatenate children, depend
on geometry, or truncate a UUID into collision-prone initials. Additional spaces
never lengthen the parent. Child counters grow only when their own number needs
more digits (`S999` → `S1000`). The code is allocated when the workspace is
created, even before geometry exists.

Floor and space suffixes are persisted in separate database tables. A case row
lock serializes allocation. Unique constraints protect counters; inactive units
retain reserved identities. Migrations backfill existing cases without rewriting
their source bytes, unit revisions or model snapshots. Identifiers are separate
from geometry fingerprints and do not trigger a rebuild.

## Identity versus geometry

- Height corrections, geometry edits, source r2 application and model rebuilds
  retain the property, floor and space IDs.
- Re-preparing the same unit alias reuses its underlying UUID and space ID.
- If a source assigns that unit to a different named level, the permanent space
  ID stays unchanged while its parent and hierarchy path change.
- Inactive units are omitted from the current register; reintroducing the same
  unit restores its reserved ID. Counters are not recycled.
- Floor labels are trimmed; missing labels use an **Unassigned** group. `F001`
  is an allocation code, not a claim about vertical order. Geometry and explicit
  level labels supply that meaning. Renaming a level through imported evidence
  currently creates a new group; it is not a floor-rename workflow.
- Each workspace receives its own parent, including duplicate workspaces for
  the same physical property. This is not a global property deduplication or
  national registry service. The parent groups the workspace as a whole; a
  multi-building site does not yet have an intermediate per-building ID layer.

## Where the user sees it

The parent appears above the viewport. **View identifiers** opens the complete
tree, including floor IDs, permanent space IDs, optional hierarchy paths, copy
actions and a downloadable JSON register. A space can be selected from this
tree. Its permanent identifier also appears in the space inspector; compact
codes appear in the model tree. Historical geometry/source snapshots stay
unchanged; the downloaded identifier register describes the current workspace.

## Verification commands

```sh
pnpm exec tsx --test tests/identifiers.test.ts
pnpm exec tsx scripts/verify-identities.ts
```

The integration script requires the running local platform and web app. It
creates isolated verification workspaces, checks the r1/r2 correction loop,
reassignment and reintroduction behavior, repeated migration stability,
concurrent allocation, and the NYC sample's quantities and original-file hash.
