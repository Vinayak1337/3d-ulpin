# K4a — P3 identity readiness (10 October 2026; target 19 October)

TASK K4a — migration registration + read-only identity analysis · GATE GF1 (readiness, not pass)
WORKS Registered reject-only migration; cited prerequisites/options, not a newly assigned space or code.
SEE IT GET http://127.0.0.1:3194/api/v1/buildings/e8777ffc-9409-4129-bacf-f680160d8795/canonical
INPUTS Magnolia retained layout/annexes; Tower 3 conflicting site plan + three scanned drawings.
GAPS No recorded floors/spaces on these buildings; no established unit-to-panel crosswalk or placed extent.

## 1. Observed records and scope
- [canonical-readiness.json](canonical-readiness.json): Magnolia revision 6, three reviewed schedule levels,
  18 plan-local room candidates, one associated with GROUND, one rejected; no registry spaces or parcel refs.
  Tower 3 revision 4: reviewed conflicting G+41/G+42 schedule, zero levels; no parcel refs. Bounds remain null.
- Read-only original/native-text/visual inspection only; no OCR, provider, acquisition, inference or snapshot write.
  These sources remain `test_only`, permission unconfirmed; model output is not evaluation truth or legal evidence.
- [K2 imports](../../gf-backend/k2/) pin the PDFs below; agent claims are transcription candidates, not source truth.
  [D2 demo literals](../../usp/finale/GF-DATA/storey-truth/demo/) are development-only; no holdout was read.
  [A5](../../gf-ai/storeys/a5/candidates/haryana-2831-tower3.json) has `unitCounts: []`, not proof of no units.
  [P1](../../gf-ai/plans/vector/20261010-p1-panels/bihar/candidates.json) supplies room polygons, not unit grouping.

## 2. Literal unit evidence (separate cells are quoted separately)
Aliases below identify originals, not new records. [unit-statements.json](unit-statements.json) pins hashes/locators.
PDF boxes are [x0,y0,x1,y1] in displayed-page points; `norm` boxes use the same page axes scaled to [0,1].
HTML page is null; its region is a DOM/table locator. HTML originals have no enrolled application source UUID.
- **M**: source `10946c4c-0cae-41f7-8303-41f2512e630d`, Magnolia sanctioned-layout PDF, revision 1.
- **MS**: retained Bihar project HTML, external projectSourceId `RERAP2311201700019-3` (not an API sourceId).
- **T**: source `c59d2027-f176-4773-a799-5f0eb682fa2a`, Tower 3 site-plan PDF, revision 1.
- **T1**: source `5293cd72-2377-4deb-a51c-c76d11ccb429`, Tower 3 plan1 PDF, revision 1.
- **T2**: source `25a8fbcb-2607-4a88-81e2-f2a247deb56f`, Tower 3 plan2 PDF, revision 1.
- **TS**: source `357b6258-4f19-4a81-83b6-6da93874dd31`, Tower 3 section PDF, revision 1.
- **TR**: retained Haryana project HTML, external projectSourceId `2831` (not an API sourceId).

| Source / page / region | Exact literal(s), transcription limitations and scope |
| --- | --- |
| MS / null / `#GV_Building tr[2] td[1,3,4]` | `Magnolia Residency`; `Duplex`; `12` — group row, not villa keys. |
| M / 1+2 / [2087.12,952.56,2272.32,969.22] | `VILLA TYPE 5, UNIT NO. -   _ _ _ _` — number blank on both. |
| M / 1 / type labels in unit-statements.json | `TYPE 5`; `VILLAS`, twice; not numbered villa instances. |
| M / 2 / [949.64,428.54,1022.68,441.03] | `VILLA TYPE 4` — panel/title association unresolved. |
| M / 3 / norm [.38,.54,.61,.60] | Handwritten `unit No - 1`; not linked to P1's blank-number panel. |
| M / 5+6 / norm [.68,0,1,.22] | Handwritten `12 Units`, each page; aggregate annotation, not 12 identities. |
| M / 6 / norm [.61,.29,.83,.34] | Handwritten `unit no - 10`; no retained panel crosswalk. |
| T / 1 / [280,980,650,1530] | `UNIT DETAIL`, `TOWER 3`, `G + 42`; row cells below. |
| T / 1 / same table, ground / typical / 42nd | `UNIT ON GROUND FLOOR`: `0`; `TYP. FL. UNITS/FL.`: `2`; |
| T / 1 / same row | `NO. OF TYP. (1) FL.`: `40`; `42nd FLOOR UNIT/FL.`: `1`; `TOTAL NO. OF UNITS`: `81`. |
| T / 1 / same table, aggregate footer | `TOTAL NO. OF UNITS`: `243`; `NO. OF PERSONS IN EACH UNIT`: `5`. |
| T / 1 / [300,1750,1160,2360], site calculation | `NO. OF DWELLING UNIT OF RESIDENTIAL`: `243`. |
| T1 / 1 / [206.88,254.25,1241.28,559.35] | `UNIT-3B`, `UNIT-3A`, on `2ND FLOOR PLAN`. |
| T1 / 1 / [258.60,966.15,1241.28,1356.00] | `UNIT-3F`, `UNIT-3E`, on `TYPICAL REFUGE FLOOR-02`. |
| T1 / 1 / norm [.60,.25,.83,.55] | `UNIT -3B BALCONY AREA DIAGRAM`; `UNIT -3A BALCONY AREA DIAGRAM`. |
| T2 / 1 / [232.74,186.34,1137.84,508.20] | `UNIT-3B`, `UNIT-3A`, on `TYPICAL FLOOR - 01`. |
| T2 / 1 / [1474.02,203.28,2301.54,525.14] | `UNIT-3D`, `UNIT-3C`, on `TYPICAL FLOOR - 02`. |
| T2 / 1 / norm [.50,.46,.68,.90] | `UNIT -3B`, `UNIT -3A`, `UNIT -3D`, `UNIT -3C` + `BALCONY AREA DIAGRAM`. |
| TR / null / apartments table | `Apartment/Shops/Other Buildings` in all 21 rows; exact count cells below. |
| TR / null / project status totals | `Total number of apartments`: `172`; booked/sold `Apartments`: `172`. |

TR table cells (carpet area; apartment count; towers), in source row order, not a fabricated joined quote:
`122.97;32;1`, `122.97;4;1`, `122.97;3;1`, `122.97;1;1`, `134.06;96;2`, `134.06;12;2`,
`134.06;9;2`, `134.06;1;1` (three rows), `166.42;32;1`, `166.42;4;1`, `166.42;3;1`, `166.42;1;1`,
`181.986;32;1`, `181.986;4;1`, `181.986;3;1`, `181.986;1;1`, `265.15;1;1`, `276.21;1;1`, `355.03;1;1`.
No TR row is keyed to Tower 3; do not reconcile 172/243/81 by arithmetic or assign those counts to instances.
TS has section/room/level labels, no specific unit key found; M page 4 has no unit statement found.
Visual annex transcriptions are unreviewed candidates; absence is bounded to the inspected regions/sheets.
**Missing evidence:** a reviewed independent unit identity, boundary/component inventory and source-to-panel link.
There IS aggregate/label evidence; there is NOT evidence that a room group equals a unit, or that Unit 10 is P1.
D2's terrace statement is not an operative fourth level: K3b reviewed only three captions; TERRACE is a space label.

## 3. Executable guards and wiring gaps
- `usp/project-identity.ts`: local-demo operator; recorded same-site `space`, revision >=1; exact current snapshot,
  selected target membership, matching recorded source/locator bindings, positive source revision, explicit review.
  Assign locks recording + namespace, checks expected version/manifest/reviewer, consumes review, appends audit/outbox.
  Same-key/hash replay is exact; stale inputs/opposing duplicate assignment do not create another code.
  ONLY `project-code-generator.ts:newProjectCode()` allocates P3/1; candidate, schedule and location IDs are not codes.
- `registry/registry.ts`: generic floors need >=3 footprint vertices. Spaces need geometry + use; `unitSchema`
  requires finite lower/upper. Compatible same-site floor→building and space→floor/within links are checked.
  Review/commit require exact qualified geometry for geometric records. Unknown bounds cannot be entered as 0.
  Thus current generic recording cannot honestly admit either building's unplaced room as a registry space.
- `source-building-records.ts` is a geometry-free BUILDING-only authority, not an existing floor/space admission API.
  Schedule levels and room attachment never make registry floors/spaces. No direct SQL identity creation is acceptable.
- [H26] + `ProjectLocationSchema`: parcels may be [] with `anchorState:not_supplied`; Location says `NO-ANCHOR`.
  A supplied parcel literal needs exact pinned source/locator, issuer/validity/review state; never generate an ULPIN.
  Structure/space sequences need officer scope review; `L?` is allowed, not permission to guess floor tokens.
- `canonical-building.ts:projectSpace()` currently always emits `proposedCode:null`. `sourceBuildingDossier()` reads
  only the building; `canonical-level-schedule.ts` rebuilds levels with empty spaces. Future wiring must read linked
  recorded children + exact P3 state, map schedule↔registry floors explicitly, preserve spaces on projection.
- `snapshots.ts` already captures P3 state; `card-projection.ts` reads it from the exact captured target.
  Existing packet plan→confirm→execute→`card-service.ts` can produce a local evidence-summary PDF/card revision.
  [P7] still needs unit-only reviewed crops, level context, truthful quantities/rights, highlight image,
  hash-chain/opaque resolver verification and immutable reissue. Current profile lacks qualified measurements/render;
  current resolver embeds card UUID/revision, expires within 24h, and is not the full opaque P7 profile. No gate claim.

## 4. At most three delivery options (60–90 minute implementation/review sessions)
1. **Recommend: one source-defined Magnolia drawing-room space + explicitly partial evidence card (4–6 sessions).**
   Owner must approve this narrower demo, not call it an independent property unit. Officer reviews ONE literal room,
   boundary/panel and GROUND association, including Type 4/5 ambiguity; grants no as-built/legal-unit status.
   Extend existing source-building/candidate authority with tightly discriminated source-only floor/space recording:
   allocate registry UUIDs, exact parent links, original+derivative pins, evidence and append-only reviewed revisions.
   Keep placement/bounds/parcel/rights unknown, use unspecified, geometry absent; plan polygon stays source evidence.
   This needs a narrow source-only validation/reader branch, NOT removal of SPACE_GEOMETRY or qualification guards.
   Then snapshot→P3 review/assign→canonical projection→single-room crop/card; no candidate ID becomes record ID.
   Review concurrency/staleness, missing-anchor display, no metric/analytic eligibility and no sibling pixels.
   Risk: officer may not establish independent plan-space scope; stop without assignment. Full P7/3D remains partial.
2. **Magnolia actual Unit 10 (6–9 sessions, conditional).** Officer must first establish a retained-source crosswalk
   from annex Unit 10 to a numbered villa/panel and reviewed component boundary; blank title/12 Duplex cannot do this.
   Then record its real scope with the same narrow metadata-only path, unknown placement/heights/rights, P3 and card.
   No source crosswalk established here: prerequisite may exceed 19 October; do not join three room groups into a unit.
3. **Tower 3 floor-specific unit (7–10 sessions, high risk).** Review a plan occurrence, not repeated UNIT-3B
   alone; resolve its independent unit scope and relevant level association while retaining G+41/G+42 conflict.
   Requires officer-verified boundary/components and scoped recording; raster/no-scale candidates are insufficient.
   No new source authorized here; absent prerequisites mean no promised identified unit/card by 19 October.

## 5. Honest exchange and next decision
`usp/exchange.ts` supports Building metadata + private provenance/rights-loss sidecar, `vertices:[]`, no solids.
[site-readiness.json](site-readiness.json): BOTH actual registry frames are `AREA-…`, not supported EPSG names;
`assertFrame()` would refuse these exports today with `USP_EXCHANGE_FRAME`. Do not relabel them to make export pass.
Even after a reviewed frame is supplied, neither has recorded floors/units to export; schedule IDs are not CityObjects.
Karnataka roofprint registry admission remains deferred; no positive-revision workaround or geometry-gate weakening.
NEXT Approve option 1 only as a source-defined, plan-local space/card demonstration, explicitly not a legal unit.
Then dispatch source-only recording + canonical P3 wiring; fall back to a building evidence card if review blocks.

[H26]: ../../../usp-agent-handoffs/26-identifiers-and-standard-exchange.md
[P7]: ../../../next-steps/P7-card-and-qr.md
