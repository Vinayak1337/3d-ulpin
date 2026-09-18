# T004 — stable identity and typed relationships accepted

Date: 18 September 2026. Result: **Accepted for the identity-contract scope**.
Review: explicit self-review, shared independent expected fixtures and regression.

Implementation `315e2ca` adds the first `ulpin-spatial/2` core alongside the retained
v1 compatibility DTOs. Correction `84f9a1c9d8b908bdfd3e9d55745d9e7181b05173` closes
two self-review findings: missing reciprocal lineage and a successor reused by
unrelated identity changes. Both negative cases first failed with “missing expected
exception”, then passed after both runtime validators were corrected.

Qualified outcomes: namespace plus opaque ID, preserved leading-zero identifiers,
non-exclusive authoring membership, duplex/shared-space relationships, explicit
physical-to-registry links, ambiguity rather than first-match merging, retired
history, deterministic rename/split/merge candidates, finite safe revisions and
bounded JSON. Unknown, withheld, not-applicable and conflicting values remain
distinct from known zero. No new database writer, geometry subdivision, official
issuance, automatic matching or production authentication is introduced.

Verification at the correction: **52 Node tests passed**, **35 shared graph cases
passed Python**, generated schemas/corpus match the Zod authority, and TypeScript
passed. The current fast hosted contract run **35362651506** and planning run
**35362651558** passed at the exact correction commit. Full isolated storage/API/
browser/Python qualification passed at implementation `315e2ca` in **35361186343**;
the later correction's repeated full integration run **35362651488** was still in
progress when this task result was written and is not falsely listed as completed.
It repeats unchanged I/O workflows; the correction itself changes only the pure
identity validators and their corpus. Local existing spatial 29 and UI 20 tests,
type checks and production build were also rerun successfully during this task.

Zod 4.6.2 is now an exact direct contracts dependency using the already locked
resolution. No unrelated packages were upgraded. Python's jsonschema4.26.0 is a
runtime dependency because the new production validator consumes generated local
schemas. Those schemas never fetch user-provided external references.

`planCoreIdentityChange` returns a candidate delta, not a persisted operation
receipt. Transactional revision rechecks and durable replay semantics remain with
the existing/future authoritative writers. No private-PC data was changed.
Next: T005 original/source/part/evidence catalog and safe link removal planning.
