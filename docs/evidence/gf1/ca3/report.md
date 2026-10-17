TASK   CA3 — Building identity design/code audit            GATE GF-T15
WORKS  The lead can distinguish a building's existing application identifier from an assigned P3 code.
SEE IT node docs/evidence/gf1/ca3/verify.mjs
INPUTS H26's reviewed-space specification; AU1's footprint-only building failure (static evidence, no new execution).
GAPS   Building P3 policy is not explicit; no runtime gate passed.

## Finding: designSays = conflicting (scope language, not two building formats)

**Explicit P3 design: spaces only.** H26 §A/C gives a reviewed independent space an opaque P3/1 code;
physical buildings and levels use existing canonical identities. Units/duplexes keep one code across components.
H26's scope header is 26 September 2026, its locator addendum 24 September. [D-identifiers] [D-allocation]

**Broader reading:** H23 §D (24 September) promises application parcel/building/floor/space IDs;
H22 §E gives physical candidates stable application identities. AGENTS names building/level/unit/space IDs.
These can mean the existing registry IDs, not extra P3 assignments. However, the 10–23 October sprint §1
also says levels get proposed 3D IDs, whereas P5.5 explicitly assigns P3 to spaces. No document supplies a
building P3 format/condition that resolves this wording. [D-wide] [D-physical] [D-data] [D-levels] [D-P5]

**Code:** P3 embeds 100 random bits and a project-defined two-symbol check, no site/building/level/space data.
There is no building prefix of a space P3. Structure numbers belong to reviewed display location input.
`lockedRecords` permits only recorded spaces; source-only validation also requires a space with an original
literal citation and wholly unqualified location. Review listing itself accepts any recorded record.
Split/merge retire predecessors and allocate never-used successors atomically. [C-random] [C-kind]
[C-source-only] [C-locator] [C-list-kind] [C-mutation]

**Building already has identity:** `<site>:B<ordinal>` is reserved before recording, distinct from UUID,
source alias, parcel ULPIN and P3. It is shown as Building identifier in Register and Registry identifier
on the server card. Source-stated space registry IDs can contain that prefix; their P3 codes do not.
[C-area-id] [C-building-id] [C-child-id] [U-building-id] [C-card-target]

**Card today:** conditional on an executable exact packet plan, a building prints its identifier and
`Application identity — Unavailable: No captured P3/1 identity`. `project_identity_not_recorded` is the
reason code, not the PDF's printed value. Location/parcel assertions are unavailable; geometry, quantities,
render and rights remain explicitly unqualified. `result.json` lists every fact, heading/footer/QR line.
The Studio preview displays the value plus `unavailable · project_identity_not_recorded`; its dialogs are
unit-only, not building-target dialogs. The map building inspector is a separate surface.
[C-card-identity] [C-card-rest] [C-word-state] [U-wording] [U-unit-gate] [U-inspector]

**Official parcel ULPIN:** sourced `external_identifiers.scheme = official_ulpin` belongs to a parcel,
with issuer/evidence. Multiple confirmed associations are supported. The design allows a set of authorized
source assertions on a card, but today's building card prints **zero** structured parcel assertions because
that branch requires P3. The text/CSV identity path supports up to 100 associations, subject to selected
proof, 20 entries, fact length and one-page bounds; PDF crops support zero structured assertions. It prints
issuer *state*, not issuer name. Do not claim building cards already print issuers' cited parcel statements.
[P-bind] [P-ledger] [D-identifiers] [C-location] [C-card-identity] [C-card-schema]

## One owner question

**Should a recorded building with no units get its own reviewed P3 code, or use its existing building identifier?**

- **Existing identifier:** retain space allocation. For new building cards, use the existing label
  `Registry identifier` and the architecture's exact scope words `Identity codes are for recorded spaces only`.
  Cost: projection/wording and building card path, not allocator changes. Stored cards stay immutable.
- **Own P3:** reuse random P3/1; add building review-kind/evidence/location policy, projections and a Studio
  building subject. A kind-check relaxation alone is insufficient. Preserve all space codes, guards and lineage;
  do not automatically extend split/merge to buildings. Recording/packet evidence blockers are separate tasks.
  [D-architecture] [C-assignment-location] [C-target-identifiers] [C-canonical-kind] [U-assignment] [F-card-block]

Detailed answers, conditional work map, not-found statements and search scope are in `result.json`.
`citations.json` resolves every bracketed citation to a file and line range. No product files changed.
