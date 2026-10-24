TASK   F2c — Studio candidate rejection commands                     GATE GF-AI (UI side)
WORKS  Record reject-only roofprints and reject rooms; decided candidates show their review without decision controls.
SEE IT node docs/evidence/gf-ai/ui/f2c/capture.mjs
INPUTS Karnataka test_only roofprint and live Magnolia levels; difficult Tower 3 with no room records or geometry.
GAPS   Room success/refusals are intercepted; registry admission and inherited zoom reflow remain unqualified.

## Evidence and reproduction

`result.json` distinguishes live and intercepted captures. Exactly one live reject-only roofprint command
returned 200 with package null. `live-attempt.json` prevents accidental repetition; `live-decision.json` retains
a compact response excerpt. Its original full response and request validated against the published schemas
before compaction (`contract-check.json`). No room write, model inference, runtime restart, reset or reseed.

The default capture command makes only live GETs; room success/refusal commands are intercepted and labelled.
It asserts accepted and rejected roofprint/room cards have no accept, reject or attach controls, checks the
three Magnolia levels, verifies its canonical read is unchanged, and exercises keyboard/200% equivalent zoom.
It does not overwrite screenshot 01, which retains the original live-write success toast.

If the worker's Studio server is no longer running, start only Studio in this worktree:
`ULPIN_API_TARGET=http://127.0.0.1:3194 pnpm studio:dev`.
Do not pass `--record-one` again: the committed attempt guard deliberately refuses another live submission.
Backend remains owned by K. Tower's live canonical response currently has zero room candidates; the reader's
reported raster candidates are not available in this building projection. No candidates were invented.

## Design and checks

`decisions.ts` builds generated-schema request bodies; `commands.ts` and `useCandidateMutations.ts` use the
existing route, unwrap and query invalidation. `RoomDecisions` reuses `ReasonDialog` for either action.
`model.ts` derives `canDecide` from review/state; both decision components hide controls on decided records.
Existing card/history rendering already supplies outcome, reason, actor and time, so it was retained.

Typecheck 0; all 79 Studio/workspace tests pass; capture 0; original skill scan 0; Studio-adapted scan 0;
diff/style 0. UI findings are in `ui-design-check.md`, including inherited header overflow at 200% equivalent.
Earlier capture failures were evidence-reader assumptions or a keyboard-test assertion, not command failures;
`result.json` records their correction. The one live command was never repeated.

COMMITS e55d70ae feat(studio): record reject-only roofprint decisions
        70e54703 feat(studio): reject room candidates and show decided candidates without actions
NEXT    Lead review/integration; separately qualify header reflow and Tower raster-candidate publication if needed.
