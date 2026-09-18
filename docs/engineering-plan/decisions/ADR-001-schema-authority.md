# ADR-001 — one structural schema authority with explicit semantic validators

Status: accepted for the tested subset. Date: 18 September 2026.

## Decision and evidence

Author the new thin common contract using the already installed **Zod 4.6.2**.
Infer its public TypeScript types and deterministically export JSON Schema draft
2020-12 for **Python jsonschema 4.26.0**. Add Zod as a direct contracts dependency
when the first production core module needs it; this is not a general dependency
upgrade. Do not independently rewrite its enums, variants or nullability in
Pydantic. Existing legacy formats keep their current validators until migrated.

The bounded experiment in `scripts/contracts/authority-experiment.mjs` exercises
23 shared cases: variants, explicit null, integer/safe-integer revisions, tuples,
array bounds, unknown keys, source units, controls and supplementary-plane Unicode.
The same generated schema/corpus passes Python parity. Non-finite wire constants
and overflowing JSON exponents are rejected before Python schema validation.
The installed Zod release counts code points for string bounds; this was measured,
not assumed from older versions. The explicit portable text pattern is also
qualified. Initial experiment assumptions that disagreed with the installed
version were corrected as test-oracle corrections, not hidden product failures.

## Alternatives and limits

Hand-authored JSON Schema with TypeScript generation is viable but adds a second
toolchain before the existing application's Zod boundary has a demonstrated
limitation. Separate handwritten TS and Pydantic models invite drift and are
rejected. A generic unvalidated JSON bag is not a common schema.

Only the qualified JSON-representable structural subset is permitted in the
authoritative schema. Never use `unrepresentable: any`. Do not put transforms,
coercion, implicit defaults, custom refinements, dates, Map/Set or arbitrary code
into the portable structural layer. Cross-record identity, frame compatibility,
geometry topology, source authorization and capabilities remain explicit domain
operations with independently expected fixtures. Exporting a schema is not proof
of those semantics or of every regular-expression dialect.

The new common read model will be `ulpin-spatial/2`, composed incrementally in the
existing contracts package. `ulpin-spatial/1` remains a bounded compatibility
renderer profile; `ulpin-canonical/2` remains an existing input format. The older
`ulpin-unified/3-draft-2026-09-18` document is not a deployed parser version.
These boundaries need named adapters, not schema-version relabeling.

Generated schemas are checked for drift in CI. Local schemas are bundled; callers
cannot supply schema URLs or external references. Reconsider this decision only
for a demonstrated exporter/parity limitation or substantial performance evidence.

Primary references checked: Zod JSON Schema documentation (`https://zod.dev/json-schema`)
and the maintained jsonschema release (`https://pypi.org/project/jsonschema/4.26.0/`).
These describe tooling, while the repository's executed corpus establishes the
qualified subset. They do not certify cadastral or source accuracy.
