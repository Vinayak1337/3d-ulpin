# K3e — Magnolia's stated floor levels as a cited level schedule proposal

**Dry run only.** Nothing was sent to the demo. `dry-run.json` holds everything the script printed: the
literals it checked, the conversions, the three levels as the canonical read would show them, and the
two request bodies.

## What the dry run projects

| Level | lowerM | upperM | State | heightSource | prismAssessment.reason |
| --- | --- | --- | --- | --- | --- |
| GROUND FLOOR PLAN | 0.4572 | 3.5052 | reviewed | stated | `reviewed_footprint_unavailable` |
| FIRST FLOOR PLAN | 3.5052 | 6.731 | reviewed | stated | `reviewed_footprint_unavailable` |
| SECOND FLOOR PLAN | null | null | unknown | unknown | `level_limits_unknown` |

The vertical reference on both stated rows reads: "drawing-local: finished floor levels relative to the
section's ground mark; not a surveyed height". Each row cites six regions on page 2: its plan caption,
the ground mark `FFL ±00`, its two finished floor levels, the section arrow for the interval, and the note
`ALL LEVELS INDICATED ARE IN FEET AND INCHES.`

SECOND stays unknown. Its levels `FFL +22'1"` and `FFL +32'6"` give 10'5", but the printed arrow says
`10'-7"`. A reviewed schedule cannot hold one conflicting level among reviewed ones (Step 0), so both
limits stay null and all three literals are cited. Its lower level is still held as FIRST's `upperM`. The
arrows for GROUND (`10'`) and FIRST (`10'-7"`) match the difference of their levels. The script checks
this agreement for every level; it is not a special case for SECOND.

GROUND still lists the reviewed KITCHEN candidate `/pages/2/candidates/0`, and all three level IDs are
unchanged, so no association is orphaned.

## For the runtime owner (the lead decides when)

1. Read `GET` canonical for Magnolia `e8777ffc-9409-4129-bacf-f680160d8795`. Check that `levelSchedule`
   is still the reviewed three-caption schedule (revision 4, levels `5a1d717b…`, `00c167c8…`, `825119e9…`).
   If it is not, stop and re-run the dry run.
2. Send `POST /api/v1/buildings/e8777ffc-9409-4129-bacf-f680160d8795/level-schedules` with the body at
   `dry-run.json` → `requests.propose`. Set the header `Idempotency-Key` to its `requestKey`, and set
   `expectedCanonicalRevision` to the `revisionId` you just read. The response is 201 with
   `action: "propose"`, `schedule: null`, and a new `proposal.proposalId`.
3. Read canonical again. Send `requests.review` with `proposalId` set to that `proposalId` and
   `expectedCanonicalRevision` set to the new `revisionId`, under its own `Idempotency-Key`.
4. The canonical read should then show the table above. `levelSchedule.state` is `reviewed` with a new
   `revision`, `storeys.state` is `reviewed`, GROUND's `roomCandidateIds` still holds the KITCHEN
   candidate, and the footprint stays `unknown`. No prism exists.

## Part 2 — the first plan-local 3D view, as a design

**Inputs after Part 1.** GROUND and FIRST have reviewed floor-to-floor limits in a drawing-local reference.
SECOND does not. **Missing: any reviewed outline.** The outlines that exist are all candidates on the
vector reader's paper scale (`planFrame.scaleState: 'candidate'`, `placement: 'unknown'`): 18 room
candidates and one reviewed KITCHEN *association* (the association is reviewed, but its polygon is still
a candidate), plus P1's per-panel building-outline boxes, which are used only as origins. The sheet says
"ONLY WRITTEN DIMENSIONS TO BE FOLLOWED. DO NOT SCALE THE DRAWING", so none of these is a measured
boundary. A usable outline would need an officer to review one built only from written dimension chains,
with every edge cited to a dimension literal. That does not exist yet.

**"Plan-local, not placed"** means the scene's x and y are the plan's own axes (`page_right`, `page_up`)
in metres from a panel origin, and z is the drawing-local level above the section's ground mark. There
is no east/north, no map, no terrain, no parcel and no other building in the same space.

**What the contracts already say.** Room candidates carry `planFrame` with `placement: 'unknown'` and
`scaleState: 'candidate'`. `UspGeometryClassSchema` has `illustrative`. The scene's `FootprintInput` has
`candidate` (drawn ghosted) and per-storey `StoreyInput` limits. **What is missing:** there is no
building-level plan-local outline value (the `footprint` is ENU, world-placed), the scene has no
plan-local frame (`LocalXY` is documented as east/north), and nothing marks a whole scene as illustrative.

**On screen.** A fixed banner reads "Drawing view — not placed, not measured. Floor levels as stated on
the section; outline at the drawing's printed scale." There is no north arrow, scale bar or basemap. The
axes are labelled "plan right / plan up". Candidate geometry stays ghosted. SECOND is drawn as an open,
dashed band labelled "height not decided (10'5" vs 10'-7")". Picking a level shows its cited literals.
Nothing from this view feeds measurement, packets, rights or learning truth.

**Smallest build, in order (about 250 lines plus tests):**
1. `packages/scene/src/types.ts` and `engine.ts`: a `frame: 'plan_local'` option that hides the map
   layers and the north arrow and labels the axes (~50).
2. `apps/studio/src/features/map/canonicalScene.ts`: a plan-local builder that takes reviewed level
   limits and one outline, with a test (~70).
3. `apps/studio/src/portal/BuildingPage.tsx` (or the register view, whose owner decides): the banner and
   legend (~40).
4. Only if the owner agrees to the outline below: an additive `planOutline` value in
   `packages/contracts/src/canonical/building.ts` (state, `planFrame`, citations, method), an outline review
   command in `packages/server` reusing the candidate review path, and an OpenAPI regeneration (~90).

**The owner's question, in plain words:** "Until an officer has traced the villa's outline from the written
measurements, may the Studio show Magnolia's floors as a drawing view using the plan's outline at its
printed scale, clearly marked 'not measured, not placed', even though the drawing itself says not to
scale it?" If the answer is no, the honest first view is a level-stack diagram with no outline (steps 1–3
only, ~150 lines).
