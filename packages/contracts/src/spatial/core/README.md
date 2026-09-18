# Incremental common spatial contract

This module is the `ulpin-spatial/2` development boundary. Existing
`ulpin-spatial/1` renderer DTOs and `ulpin-canonical/2` inputs remain supported
through their existing entry points. Do not relabel those values as v2.

The first increment owns stable `{namespace,id}` references, entity metadata,
typed relationships, unknown/withheld value states and pure identity-change
planning. It has no database writer and does not invent geometry or rights for
split/merged identities. `coreRefKey` is an encoded UI/cache key, not an official
identifier or a replacement for the original reference fields.

`validateCoreIdentityGraph` requires the complete referenced identity metadata
graph (not all geometry or source bytes). A view needing unloaded objects obtains
their bounded metadata before validating references; it must not silently drop
edges to make a partial graph appear complete.

Zod is the structural authority. `scripts/contracts/export-core.ts` generates
the bundled JSON schemas and endpoint-policy data consumed by Python. Run it in
`check` mode during validation; `write` is an intentional source-change step.
Graph semantics have shared expected positive/negative fixtures, not duplicated
handwritten enum definitions. No external user-supplied schema URL is accepted.

The identity-command planner is a deterministic candidate operation. Its delta
requires a separately implemented transaction/expected-revision check at a future
authoritative writer. It is not persisted idempotency, geometry subdivision or
legal issuance. A repeated command against unchanged input yields the same
candidate; operation replay after persistence belongs to the writer's receipt.
