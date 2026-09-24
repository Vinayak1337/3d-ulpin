# 26 · Proposed project identifiers and standard exchange

Owner **FND** for allocation, transactions and registry projection; **HISTORY** for lineage reads; **DATA** for independent fixtures; **UI/PACK** consume the resolver. This is a `finale_v1` implementation specification, not an assertion that the code, official issuance or standards conformance exists. Read [01](01-shared-contracts-and-ownership.md), [15](15-property-history-and-comparison.md), [16](16-shared-spaces-and-vertical-rights.md) and the acquisition/test authority [28](28-data-acquisition-and-finale-tests.md). Implement after GF0 data/contracts; qualify at GF1 identity/exchange. The complete product retains wider exchange formats as later profiles.

## A. Identity and authority

Three identifiers remain separate:

| Field | Meaning and authority |
| --- | --- |
| `recordId` | Existing immutable registry UUID; primary key and all foreign keys. Never derive it from a label, parcel, geometry or proposed code. |
| `projectCode` | Immutable proposed application identifier for a reviewed independent space in this project's `P3` namespace. Unique globally in that namespace; never reused. It is **not** an official 3D ULPIN or title grant. |
| `officialParcelAssertion[]` | Zero or more literal official parcel ULPINs, only when a source supplies them, with issuer/source/revision, review state, associated role and validity. No application code may manufacture one. |

Physical building, level and space references use existing canonical identities; a duplex keeps one `recordId`/`projectCode` and has multiple level components. A building can touch several parcels. `projectCode` contains no parcel, level, use, geometry or date, so later corrections do not change it. Human labels such as `Flat 704 · Tower A`, parcel relationships and levels are revisioned attributes. A historical alias with meaningful fields may be retained as `aliasValue`, `scheme`, `assertedAt`, `source`, `meaningAtAssertion`, `status`; it must never be parsed as current truth or reused as a primary key.

Official-anchor state is explicit: `not_supplied`, `supplied_unreviewed`, `reviewed_partial`, `reviewed_complete`, `conflicting`, `withdrawn`. A space with no official parcel assertion can receive a project code after reviewed independent-space identity and scope are established; its UI/card says “official parcel anchor not supplied” and readiness remains partial. Multiple parcels are a set of sourced associations, with roles and each assertion's source. Ties and incomplete coverage remain unresolved; the largest geometric overlap must not select a legal parent. Correcting an anchor revises the association and linked manifests; it never rewrites the project code. QR and export show only the reviewed, authorized assertions and their exact revision. The [Department of Land Resources ULPIN](https://dolr.gov.in/en/ulpin/) remains a distinct official parcel scheme; this `P3` proposal cannot stand in for it.

`draft` has a stable internal UUID but no project code. `assigned` has a reviewed code. `retired` remains resolvable with successor lineage. `cancelled_error` remains reserved and resolvable to an authorized cancellation explanation; it cannot be reassigned. `superseded_alias` applies to a label or legacy code, not to the immutable project code. Demolition retires the record; rebuilding is a new identity unless reviewed evidence establishes continuity under the governing recording policy. Duplicate-record correction must select a reviewed survivor or new successors, retire the other record, and preserve both old IDs and evidence; never silently merge histories.

## B. Project-code wire profile `P3/1`

Canonical printed form: `P3-<20-symbol payload>-<2-symbol check>`. The alphabet, in value order, is `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (32 symbols; no I, L, O or U). The 20 payload symbols encode exactly 100 uniformly generated cryptographic random bits, five bits per symbol, most significant first; no timestamp or meaningful field is embedded. Rejection/unique-index retry handles a collision. `P3` is a literal namespace/version prefix. Persist the canonical uppercase form and exact profile version. Future versions receive new prefixes and never reinterpret an old code.

The check is a **project-defined error-detection code, not an ISO 7064 claim or authentication mechanism**. For each symbol of `P3` followed by the payload, set `h = (33*h + alphabetIndex(symbol) + 1) mod 1021`, starting at `h=0`. Encode `h` as two base-32 alphabet symbols, high digit first (`floor(h/32)`, `h mod 32`). Since `h≤1020`, final pairs with numeric value 1021–1023 are invalid. For input, trim ASCII spaces at the ends and uppercase ASCII letters; accept only the exact canonical grouping or its unseparated 24-symbol form. Reject internal spaces, misplaced/extra hyphens, all other whitespace, Unicode lookalikes, unknown symbols and missing/extra symbols. The public resolver returns the canonical form. Only the two separators shown above are emitted. Compare the computed check to the supplied pair in constant-time where available; this is still not a security boundary.

Fixed independent vectors for implementers (computed with both forward recurrence and reverse polynomial sum; do not generate expected values with the production encoder):

| Prefix + payload | Check | Full canonical code |
| --- | --- | --- |
| `P3` + `00000000000000000000` | `RP` | `P3-00000000000000000000-RP` |
| `P3` + `ZZZZZZZZZZZZZZZZZZZZ` | `VP` | `P3-ZZZZZZZZZZZZZZZZZZZZ-VP` |
| `P3` + `0123456789ABCDEFGHJK` | `E8` | `P3-0123456789ABCDEFGHJK-E8` |
| `P3` + `7Q4M2R8T6V0W3X5Y9ZAB` | `R4` | `P3-7Q4M2R8T6V0W3X5Y9ZAB-R4` |

`P3/1` detects every single-symbol substitution in the checked prefix/payload/check pair and each adjacent unequal-symbol transposition inside the checked body; verify these as bounded exhaustive property tests. It cannot detect every multi-symbol edit, malicious forgery or a wrong but valid code. Validation is four distinct steps: grammar/normalization → checksum → registry lookup → status and current authorization. Never call a syntactically valid code “issued” without an assigned registry record. The checksum gives no official authenticity, title or QR integrity. [Reviewed audit source on checksum systems](https://www.iso.org/standard/31531.html).

## C. Allocation and lifecycle command

`assignProjectCode(ctx,{recordId,scope,expectedRecordVersion,expectedManifestId,reviewId,requestKey})` is an officer-reviewed, explicit command. It accepts only an existing supported independent-space target with exact current membership and evidence; no model or rendering job calls it directly. The same-client transaction locks the canonical registry record and identity namespace, validates reviewer capability and exact manifest/review pins, checks no active or reserved code, allocates random payload plus check, inserts the immutable namespace-unique assignment, writes post-state record and `CommitReceipt`, audit and outbox, then commits. A namespace-unique conflict retries with a new random payload within the same bounded command. No external provider call occurs inside the transaction.

Idempotency uses H01 `(subject,scope,operation,requestKey)` plus canonical payload hash: same accepted request returns the same authorized receipt/code; changed payload returns 409. Two distinct concurrent requests for one record cannot both assign codes. A stale manifest/version returns 409 with no reservation or partial receipt. A failure between insert and receipt rolls back both. Redis/cache state cannot decide allocation. Corrections to labels, geometry, source or parcel anchor create exact new revisions and retain the code. `cancelProjectCode` requires a reviewed reason and is only for erroneous issuance; the cancelled code remains a permanent reserved tombstone. `retireProjectSpace` records demolition or other terminal event without deleting the record.

`split` requires one predecessor and at least two distinct successor UUIDs/codes; `merge` requires at least two predecessors and one successor. A reviewed same-client command locks all involved IDs in sorted order, validates source and scope, retires predecessors, assigns never-used successor codes, writes directed acyclic lineage, exact post-state receipt and outbox atomically. No old code is transferred to a successor. Corrections that preserve one legal space use revisions, not artificial split/merge. The old URL and any historical alias resolve to a status-aware retained record with authorized successor links; do not auto-redirect across identity. QR resolution is an exact-revision or active-release request, never an access grant. [H15](15-property-history-and-comparison.md) owns read/display of this lineage.

## D. LADM mapping profile `P3-LADM/1`

This is a documented conceptual mapping to [ISO 19152-1:2024](https://www.iso.org/standard/81263.html) and [ISO 19152-2:2025](https://www.iso.org/standard/81264.html), not a conformance or government-adoption assertion. Obtain the applicable specifications before claiming detailed profile compliance. Keep source terms and source jurisdiction alongside mapped terms; do not infer a right from a mapped physical volume.

| Registry concept | Proposed LADM role | Required qualification |
| --- | --- | --- |
| Authorized party assertion | Party | Source, identity confidence, consent/access and assertion/review state; party text alone is not a verified person. |
| Ownership/use/easement/restriction or responsibility assertion | RRR role | Exact clause, scope, beneficiaries, validity, acceptance; record technical acceptance separately from legal validity. |
| Independent space or shared allocation subject | Administrative unit role | Stable UUID/code, declaration and unit population; one unit can have several component legal spaces. |
| Bounded apartment, basement, elevated or underground extent | Legal space role and spatial unit profile | Supplied geometry, 3D frame/benchmark, component limits, quality and unknown extent. Physical mesh is a separate representation. |
| Level and building relationships | Level/structure association | Multiple levels/parcels allowed; no implied parent from geometric overlap. |
| Source revision, plan, instrument, survey and review | Spatial/administrative source role | Preserve original bytes/hash, locator, rights, source revision and review decision. |

Mapping coverage is measured per field/fixture as mapped, extension, unsupported or withheld. Missing parties/clauses/geometries stay absent or unknown. Report profile version and unmapped fields. LADM role names are a design mapping; source statutes and recorded evidence control the actual interpretation.

## E. Minimal CityJSON exchange `P3-CJ/1`

Export one selected, authorized snapshot: CityJSON header/version, named CRS/reference frame metadata, indexed vertices, and `CityObjects` for building and supported unit/shared physical or legal representations, each with stable registry UUID, project code when assigned, exact manifest/revision references, parent/level links, geometry type/LoD and quality. Use the actual supported CityJSON version and geometry validation library selected at implementation, pinning their versions in the test receipt. Unsupported solids are omitted with an explicit loss entry, never replaced with a fabricated box. A display-only roof mesh stays marked physical/display, not a legal boundary.

A separate, versioned sidecar keyed by the same manifest digest and object UUID carries official parcel assertions, declaration/UDS, RRR/party assertions, evidence locators/hashes, permissions/classification, source and review revisions, lineage/status and withheld-field markers. It is private by default; public derivatives require an H01 `ReleaseDecision` for exact exported bytes and sidecar separately. Export the canonical project-code namespace/profile in metadata and do not present a code as an official ULPIN. The sidecar is essential for rights/provenance round trip; raw CityJSON alone cannot promise those semantics.

The importer validates schema, reference frame, sidecar binding hash, UUID/code uniqueness and exact source revision availability. For same-registry round trip it produces a **comparison report**, not direct registry mutation: field-level `exact`, `normalized_equivalent`, `omitted_by_profile`, `unsupported`, `withheld`, `conflict`. Only separately reviewed commands may apply changes. Test a fixture with two levels, a duplex component pair, two parcel associations including one missing anchor, a shared/limited-common interest, source revisions and a split/merge lineage. Reimport into an isolated copy and compare UUIDs, codes, coordinate values/units/frame, components, rights, sources, status and hashes; every lost fact has an explicit loss record. Reject sidecar mismatch and a changed source hash. Plain CityJSON reimport reports rights/provenance as missing, not equal.

CityGML, IFC and GeoPackage receive separately versioned profiles and tests before claims of support or external acceptance. A future [3DCityDB](https://docs.3dcitydb.org/1.3/compatibility/) adapter is a rebuildable, versioned projection for exchange/display only; the existing registry, manifests and source storage remain authoritative. Record converter/version and loss report, and do not assume compatibility across its tooling generations or infer PM Gati Shakti acceptance from an export file.

## F. Gates and acceptance evidence

GF1 consumes GF0's matched source/fixture manifest. **GF-T15** covers independent code vectors, exhaustive single-symbol substitutions, normalization rejects, uniqueness, concurrent assignment/retry, missing/partial/multiple official anchors, corrected labels/anchors, error cancellation, retirement and atomic split/merge with exact old URL/QR behavior. **GF-T16** is owned by H16 for declaration and common-area semantics. **GF-EXCHANGE** adds a separate GF1 round-trip receipt: CityJSON validation, sidecar binding, exact/loss categories and reviewed-only import. **GF-T21** later checks the same code/revision in viewer, card, export and QR with revocation/retirement behavior. Central dataset, independent oracles, tolerances and evidence matrix live in [28](28-data-acquisition-and-finale-tests.md); its tests are not historical backlog T15–T21.

Run focused contract/registry/transaction tests, DB rollback and two-writer concurrency tests, round-trip import/export, access/release tests and actual resolver/PDF integration when built. Return command/receipt IDs, manifest and source hashes, independent vector outputs, before/after rows, rejected stale/duplicate outcomes, exact loss report, software versions and an explicit list of still-unqualified profiles. Keep existing source preservation, job fencing, review and release tests.

## Z. Hardening addendum (H97)

Added 24 September 2026 by the cross-family review in [H97](97-review-findings-and-alignment.md). Where this section conflicts with text above in this file, this section wins. Task cards: [H29](29-agent-task-cards.md) FND-02 and FND-03.

### Z1. Display-only vertical locator

`P3` codes are deliberately meaningless, so judges and officers also need a readable "where is this space" string. Add a derived, display-only field:

| Field | Rule |
| --- | --- |
| `verticalLocator` | Derived from the current revision at read time; never stored as identity, never accepted as input, never parsed. |
| Format | `<anchor> / <structure> / <level> / <space>` |
| `<anchor>` | The reviewed official parcel ULPIN when anchor state is `reviewed_complete` with exactly one `primary` association; `MULTI(n)` for n reviewed parcel associations with no single primary; `NO-ANCHOR` for `not_supplied`, `supplied_unreviewed`, `conflicting` or `withdrawn`. Never pick the largest overlap. |
| `<structure>` | `S` (surface), `U` (underground) or `A` (elevated/air) plus a two-digit structure number within the anchor, e.g. `S01`. |
| `<level>` | The source level token after review: `B2`, `B1`, `LG`, `UG`, `G`, `ST` (stilt), `M1` (mezzanine), `P1` (podium), `F01`…`F99`, `T` (terrace), `R` (rooftop structure). Multi-level spaces show `F07-F08`. Unknown level shows `L?`. |
| `<space>` | Space kind letter (`R` residential, `C` commercial, `P` parking, `X` common, `U` utility, `V` volume/corridor) plus a three-digit sequence within the level. |

Example: `MH2507A1B3C4D5 / S01 / F07 / R003` next to `P3-7Q4M2R8T6V0W3X5Y9ZAB-R4`. The UI labels it "Location", never "code" or "ULPIN", and shows no check character. A level correction or anchor review changes the locator and never the `projectCode`. The resolver rejects locator strings with 422 `locator_not_an_identifier`. CityJSON export writes the locator only as a sidecar display attribute, not as an ID.

GF-T15 adds three cases: a level correction changes the locator but not the code; `MULTI(2)` for a basement spanning two reviewed parcels; resolver rejection of a locator string.

### Z2. Lineage kind for boundary adjustments

Split and merge do not cover a partial transfer between two continuing spaces (a terrace portion re-allotted, a wall shifted between adjacent flats). Add `boundary_adjustment`: both identities keep their codes, both get new revisions, and a lineage link records the transferred portion's geometry and evidence. Any other shape returns 422 `unsupported_lineage_kind`. Add one GF-T15 case.

### Z3. Exchange pins

- Pin **CityJSON 2.0** for `P3-CJ/1` (it has `BuildingStorey`, `BuildingUnit` and `BuildingRoom`). Validate with `cjval` and `val3dity`; record both versions in the GF-EXCHANGE receipt.
- Put the horizontal EPSG code in `metadata.referenceSystem`. Indian vertical references often have no EPSG code: write the named vertical reference (benchmark, datum or "local site datum") in metadata and the sidecar, and never relabel a GNSS ellipsoidal or local height as mean sea level.
- Propagate `licenceFamily` per object (for example ODbL, CC BY 4.0, government terms) into the sidecar. Export refuses to mix share-alike objects into a non-share-alike public export and lists them as a loss entry instead.
- CityGML 3.0 is a stretch export produced by conversion from the CityJSON output with its own loss report; it is not a GF1 exit requirement.
