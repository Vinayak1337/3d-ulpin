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
