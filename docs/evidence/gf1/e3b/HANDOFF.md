TASK   E3b — One Studio confirmation and each building's card            GATE GF1 / GF5
WORKS  An officer sees package/building readiness, chooses up to 100, types their words and records once to get cards.
SEE IT node docs/evidence/gf1/e3b/run-walk.mjs E:/BhuAayam-data/task-data/e3b/recheck.json
INPUTS NYC buildings-original.geojson; hydrography.geojson held at needs_answer; buildings before review.
GAPS   Panel needs mounting; finding messages absent; stopped retry/opened-first UI journey not walked.
DESIGN IntakeRunPanel composes packages, cursor list, confirmation and persisted progress; its only input is caseId.
       model.ts uses typed API shapes and canonical limits; api.ts sends the five existing routes.
       useRunStream reuses table sequence/cursor reduction, tails current head and refetches on target events.
       Existing card paths and CopyableId are reused; unfiltered cursor discovery recovers confirmation ids on reload.
COMMITS 56efed27 docs(studio): E3b step 0, what the run offers a screen
        132e873d feat(studio): what is ready in a batch, by package and by building
        bde5fea5 feat(studio): one confirmation in the officer's words, then progress to each card
        d9dc8b63 test(studio): E3b the confirm body, the choice, the words and the refetch rule
        c91d6910 fix(studio): tail batch events and keep stopped reasons visible
        Evidence commit follows; see git log.
CHECKS pnpm studio:typecheck — 0; pnpm studio:test — 0, 381 Studio tests
       Stock ui-design-check scanner — 0, apps/web only; retargeted scan-panel.mjs staging — 0
       run-walk.mjs walk-stream.json — 0; git diff --check — 0; new source/report line lengths — 0
NEXT   Mount IntakeRunPanel from features/intake/run on the batch page inside the existing query/router providers.
       No route or server change is needed. Walk a stopped target/retry and opened-first priority in rehearsal.

The final real walk records 1,661 buildings and cards three with one press. First card visible after 9.999 seconds,
third after 11.349 seconds; PDF, verification and reload all pass. Twenty target events arrived; no stream refusal.
The first stream implementation replayed from 0 and hit the API's replay bound; one changed comparison tails the
head instead and passes, with a regression test. Every attempt's owned tmpfs container is gone, Vite/browser stopped,
and the temporary router edit restored. Captures live outside Git; result.json holds their paths and qualifications.

No generic table connection export exists: openTableStream is private; the hook ignores intake.target. The small
run-local adapter imports initialStream/reduceFrame only. Finding counts have codes but no messages, and the area
screen has no code vocabulary to import. Known rule words are taken from the existing area rules; unknown codes
explicitly lack words. No severity, ownership, geometry or identity is inferred. Hydrography has no building target:
its item waits in the tray; the panel does not turn water into a building. Compact targets.json keeps three actual
HTTP target rows plus 101 real choice ids; confirmation.json is the exact stored confirmation read over HTTP.
