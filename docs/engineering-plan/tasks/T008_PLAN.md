# T008 — observations, explicit composition and coherent snapshots

Detailed plan, 18 September 2026. Implementation begins after T007 acceptance.
Baseline: `402649f`; preserve all existing v1/canonical writers and consumers.

## Inspected boundaries

Read the T004-T007 identity/source/frame/geometry modules and shared validators,
v1 `SpatialSnapshot`, the existing spatial area GET and its local-only/no-store
contract. There is already a renderer DTO and compiler; this task does not replace
them. It establishes the input/revision selection boundary used by T009 and T012.

## Data contract and first consumer

Use one bounded snapshot input containing existing identity/source/frame/geometry
catalogs plus named worlds, observations, resolutions and compositions. Worlds retain
the existing observed/planned/hypothetical/synthetic meanings. Observation payloads
are explicit existing geometry, sourced vertical interval, reported quantity or
unavailable contribution; no arbitrary rule language or JSON attribute dumping.
Original candidates remain untouched. Every world, source, frame and representation
reference is exact. Temporal validity uses signed integer epoch milliseconds with
nullable unknown bounds; no datetime parsing ambiguity or false currentness claim.

Resolutions name comparable candidate observations and an explicit selected candidate
or unresolved choice with a reason. Selection is never inferred from source order,
filename, latest receipt or a shared label. Compositions either retain the selected
representation or generate a source-linked prism from a selected polygon footprint
and selected vertical schedule in the same exact frame. Cross-frame normalization
must be an explicit preceding T006 operation, not an invisible guessed offset.

The first real consumer is a pure snapshot builder returning selected geometry,
per-composition results and immutable manifest signatures. Missing or failed selected
contributions return an unavailable result for that composition; other valid output
survives. Structural stale/missing references, ambiguous identity, world mismatches
and unauthorized input are errors, not silent skips. Generated IDs are explicit and
must not collide with preserved or other generated IDs. Source parts are unioned
without duplicating or fabricating originals. Zero PDFs is a valid fixture.

## Snapshot, access and signatures

Pin an explicit world, optional as-of time, caller-supplied authorization-scope ID
and policy revision. The API must establish that scope before calling this core;
the contract is not authentication. Enforce declared scope ceilings across source
parts, source revisions, datasets and asset ancestry; do not downgrade restricted
metadata by moving it into a selected geometry record. Core input/output is private
operator data, not a public tile payload. Public scenes need an explicit projection
in their delivery layer. No personal fields or credentials enter cache keys.

Use a documented bounded tagged canonical encoding with UTF-8 strings, sorted
object keys and IEEE754 binary64 numeric representation (negative zero canonicalized
to zero). Reject unpaired surrogates and oversized encodings. SHA-256 via Web Crypto
and Python hashlib avoids an invented JSON-number canonicalization standard. Sort
record collections/set-like references, not ordered geometry, locator paths or
transform paths. Publish the encoding version and fixture digests; do not call it
RFC8785. Input signatures cover mappings, selected revisions, context, source and
coordinate changes. A separate geometry dependency signature excludes evidence-only
names and associations while including selected geometry and its used frames.

The manifest is a candidate, not automatic publication. It pins input and geometry
signatures and exact output revisions. Persistence, expected-current activation,
object upload/DB transaction coordination and incremental world publishing remain
T010/T030 and are not simulated with an in-memory success flag here.

## Edge cases and tests before acceptance

Exercise same-building footprint plus separately sourced level schedule; unit and
building independent selections; a 10x8x6 authored result; unavailable height while
unit/footprint results remain usable; no documents; candidate disagreement retained;
world/time mismatch; out-of-validity choices; unknown time bounds explicitly noted;
stale resolution/observation/output/source/frame refs; incompatible footprint role;
missing normalized frame; generated-ID collision; public/operator/restricted scope;
hidden restricted asset ancestry; source classification inconsistent with observed
world; input reorder invariance; changed mapping/units/world/scope changing signatures;
attachment-only metadata leaving geometry signature stable; nonfinite/unsafe input;
bounded canonical encoding and Unicode/numeric conformance in both runtimes.

Run actual TypeScript/Python semantic/numeric/digest corpus, generated drift checks,
all core tests, existing spatial/UI regressions, typecheck and full build. Review
the produced object graph, not just whether the schema accepts its JSON. Code-only
rollback: new builder is additive, no DB/API writes, no source mutation or migrations.
Keep one active task and record actual CI results before claiming hosted completion.
