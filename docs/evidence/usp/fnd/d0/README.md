# FND D0 local verification — 23 September 2026

This records generated evidence from the former FND worktree. Its implementation
is already in `staging` as commit `97146d6`. The local receipt names `5f1a0e7`;
those commits have the same parent and stable patch ID
`c816ef956efcdb4b5e61ec759ce543c99e998f83`. The difference is the
`[skip ci]` suffix on the staging commit message.

## Isolated local result

[`isolated-local-receipt.json`](isolated-local-receipt.json) reports **PASS**
against disposable local services and a synthetic D0 pack. It verified 44
restored table hashes and 497 retained original object hashes. All 15 recorded
commands exited 0, including two migration applications, D0 import plan and
apply, the D0 live check, the Studio browser test, and cleanup of the owned
Compose project. This did not test the linked private environment.

[`d0-live-receipt.json`](d0-live-receipt.json) reports the `golden-v1` D0 pack
**passed**: exact locators `line 3`, `line 5`, `CSV row 2`, and `CSV row 4`
produced a complete 1,301-byte packet. A cross-building selection returned
`invalid_vertical_membership`.

The saved browser report recorded one expected test, one pass, zero unexpected,
skipped, or flaky results. The test selected exact evidence in Studio, compiled
PACK0, and reopened its saved receipt. These captures show the selected source
line and the reopened packet:

- [Exact source evidence](d0-exact-evidence.png)
- [Reopened scoped packet](d0-packet-reloaded.png)

`SHA256SUMS` records the byte hashes of the four copied receipts and captures.
The original generated output remains in the local recovery bundle.

## Hosted boundary

The earlier FND hosted checks [35830812877](https://github.com/Vinayak1337/3d-ulpin/actions/runs/35830812877)
and [35831399185](https://github.com/Vinayak1337/3d-ulpin/actions/runs/35831399185)
passed for the retained baseline, as detailed in the
[FND hosted receipt](../HOSTED_RECEIPT_2026-09-23.md). Three later hosted D0
attempts failed during import/apply:

| Run | Observed failure |
| --- | --- |
| [35835737030](https://github.com/Vinayak1337/3d-ulpin/actions/runs/35835737030) | Detailed geometry profile rejected a non-simple outline |
| [35836725703](https://github.com/Vinayak1337/3d-ulpin/actions/runs/35836725703) | Building `B-A` build timed out |
| [35837296364](https://github.com/Vinayak1337/3d-ulpin/actions/runs/35837296364) | Import geometry contained unsupported fields |

The final local result followed those attempts. There is no recorded hosted D0
pass for that final patch. Real D1 source qualification and public deployment
are separate gates.

## Continuation started 23 September 2026

The lead fetched `origin/staging` at `2838e798af838d7646ff92b1120c62c8458103da`
and created `codex/usp-staging-continuation-20260923` in an isolated worktree.
The original main checkout was clean; no unpushed commits or competing active
writer were found. Commit `b3fb0607ab05fbe6e329223131c3dc351c397041` preserves
the main-only `4551ef7` deployment/API-index changes by exact cherry-pick; no
deployment was run. The fresh D0 reproduction at that commit passed all 15
recorded commands, including original checks, migration replay, live D0,
browser PACK0 reload and cleanup. Expanded V0/D1 acceptance remains in progress.

Requested lead Astra Max and inventory worker Sol Medium were confirmed from
local session `turn_context` metadata. Bundle implementation used explicit Sol
High spawn settings; independent baseline review used explicit Sol XHigh.

Independent read-only baseline review reported these findings before correction:

- P2: original bundle column type drift could pass the initial compatibility
  patch and be hidden by PostgreSQL's current-type JSON conversion. Pin original
  definitions and add a narrowing-type regression before acceptance.
- P3: the historical renderer omitted T075's supplied `planning_reference`.
  Preserve that reference and recorded sequence without changing `backlog.json`.

These findings and the expanded live checks are not a V0 acceptance statement.

Fresh read-only milestone review reported these D1 findings before correction:

- P2: navigation depended on a newly allocated object, so inspector rerenders
  could replay a consumed Fit/zoom command and reset a manually adjusted camera.
- P2: display faces retained semantic type but omitted the original semantic
  index and source face index needed for exact surface picking.
- P2: the external adapter ignored shared building visibility and opacity.

The first combined D0/D1 live attempt failed at D0 replay: preparation packages
share the original dataset namespace, so the corrected namespace lookup also
matched child preparations. The failed run cleaned its owned disposable project;
no data was reset. Corrections and fresh integrated evidence are required.

The next combined attempt reached replay but found that the first D0 receipt
omitted the three reviewed detail derivatives created during recording. Replay
reported those existing sources. Refresh the committed preparation before saving
the first receipt and compare all public-table digests across both D0/D1 replays.

The next run passed both imports/replays and both D0 browser journeys. D1 reached
its real mesh and exact-byte checks, then the test omitted the Layers tab inside
the opened dialog. Correct that actual interaction. Visual inspection also found
the initial roof framing cropped the building and the attribution overlapped
Checks: use the runtime's aspect-aware sphere fit and reserve control space.

Independent review of the passing `c81ce5d` run found a V4 blocker before
acceptance: the selected basement geometry was hidden by the parcel fills at
`+0.025 m` and decorative terrain slab at `−0.5…−0.02 m`. The actual supplied
basement is `−3.2…0 m`. Correct only display visibility for overlapping surface
context; retain source coordinates, records and measurements. The reviewer also
requested a clear active D1 frame label and an unobscured mobile roof.

The `2801893` run passed PACK0 and the expanded D1 journey. Its new basement
pick assertion failed because it clicked the floor's centre, outside the
off-centre supplied basement unit. The actual failure capture shows the unit
visible below ground. Correct the test to select and focus U-AB01 using the
real controls, then require an actual Cesium pick; keep the visibility and
record-preservation assertions.

The focused `9a87498` rerun again passed PACK0/D1, but the real basement pick
remained unproven. Its capture shows the selected unit centred and unobscured;
the focus-movement check passes. Independent review identified incomplete pick
telemetry (only the Entity branch was recorded). Inspect the actual pick branch
and identity before another correction; do not weaken the geometry assertion.

The diagnostic `27c6712` run confirmed `pickKind:none` at the first click.
Independent source/trace diagnosis found that selected Entity primitives are
asynchronous, but readiness covered only the map tiles. The screenshot was
captured 15 seconds after that early miss. Add a version-pinned, fail-closed
Entity readiness adapter for the locked Cesium engine, expose ready overlay
identities and await the selected unit's actual geometry before the single pick.
Cesium's public `DataSourceDisplay.ready` is latched and cannot qualify later
selections; the isolated adapter's private method must be requalified on upgrade.

The `433ef3a` rerun still returned `pickKind:none` after the selected Entity
readiness check passed. The readiness gap is therefore not a sufficient root
cause for the pick failure. Milestone acceptance remains open; a bounded Astra
Max diagnosis owns only the map pick/readiness adapter and its browser test.
The user then directed the lead to finish this current milestone, push all task
changes/evidence to GitHub and stop before the later feature milestones.

The first diagnostic run with temporary render/pick telemetry hit a separate
test defect: repeating Focus can correctly leave the camera unchanged after the
unit-selection action already focused it. Requiring another large camera delta
was invalid. Remove that extra precondition while retaining real Focus, initial
orbit/zoom checks, current geometry readiness and the exact scene-pick assertion.

The second bounded diagnostic established the rendering boundary before the
functional correction: the selected U-AB01 polygon projected onto the click and
returned bounding-sphere DONE, but both current render and pick command lists
contained only four tile/model commands and no Entity primitive. In the locked
Cesium engine, asynchronous Primitive readiness flips in `afterRender`; the
static geometry batch enables its `show` flag on the next data-source update.
The initial adapter therefore advertised readiness one frame too early. Qualify
the current Entity's actual draw submission before exposing its ready identity;
do not change geometry, substitute selection or add a fixed time delay.

The `e571830` run verified that the submitted-draw adapter reports the actual
U-AB01 overlay, but failed a newly added screenshot precondition before picking:
the test expected a separate Basement-floor mesh. That floor selection renders
its supplied child unit; the floor record itself has no separate volumetric
overlay. The receipt confirms the reported ID is U-AB01. Correct only that
capture wait while retaining the Basement URL/camera and exact subsequent unit
pick. PACK0 and the expanded D1 journey passed again.

## Current milestone checkpoint

The final run at `304725d67e928f064d3951c3781592c3d706e377` passed all 19 commands
and all three browser journeys without skips/flakes. Exact single-click picking
resolved to U-AB01; both import replays preserved all 59 public tables and owned
service cleanup exited zero. The independent Astra High reviewer accepted this
bounded local milestone with no remaining blockers after inspecting the actual
diff, receipts, baseline/final images and retained design reference.

See [the complete continuation evidence](../../continuation-2026-09-23/README.md),
including original hashes, final SQL/storage/job receipts, browser captures,
side-by-side comparison, failed diagnostics and observed worker settings. D0
is locally integrated. D1 qualifies one actual exterior's local shape/identity;
global placement, analytical volume, GPU performance, wider scale and public
deployment remain separate gates. Text/CSV PACK0 does not qualify PDF packets.

The user requested that work stop after completing and pushing this milestone.
READY/FIND/PDF/INGEST/history/rights/impact/runtime-AI/public milestones are not
implemented by this continuation checkpoint. No deployment or integration-branch
merge was run. Reproduce this exact receipt before undertaking any later work.
