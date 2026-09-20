# T065 result — persisted preparation and focused source review

Implemented, parent-reviewed and browser-verified 20 September 2026. Not a claim of user acceptance.

Continuation now comes from the current preparation receipt, derivative hash, reviewed placement, canonical building revision and exact case/model/build fingerprint. Refresh restores review or the existing recorded result. Changed inputs invalidate old build evidence; retries reuse retained prepared inputs. The server's review/record guard uses the same currentness checks. Exact build lookup is independent of the latest thirty unrelated jobs.

The review panel puts the next action first, collapses reviewed facts and advanced placement/tools, distinguishes contradictory from corroborating values, preserves alternative candidates, and opens source/page together. Source rows are compact. All manual edits and evidence remain accessible.

## Evidence

- 25 focused continuation/fact/source navigation tests passed; typecheck passed.
- Final production build passed after final source-navigation fix. App restarted with this build.
- `scripts/ux/verify-preparation-state.ts` passed against actual retained T061 state without writes; same 9 sources, 9 jobs, one draft and one review. Includes current build beyond bounded job-history window.
- `node scripts/ux/verify-preparation.mjs`: six browser groups passed. Server restores recorded state; initial load and reload offer existing canonical register; no duplicate Build action; tablet fits; onward register opens; package/model/source/build fingerprints unchanged and zero API writes/page errors.
- Evidence `docs/evidence/t065/{worker-state,results}.json`, desktop/tablet/onward screenshots. Parent visually compared current review composition against corrected 01-plan-review/06-check-and-record references.

Stale/failed input combinations use targeted state tests; no destructive mutation of the retained recorded case was made. Full first-source-to-new-record flow is reserved for final integrated qualification. Wider header/navigation, default-collapsed workspace documents/tools and duplicate floor-preview clutter remain explicitly T067. In the recorded state, change wording from proposed to recorded where appropriate during T067 copy pass.
