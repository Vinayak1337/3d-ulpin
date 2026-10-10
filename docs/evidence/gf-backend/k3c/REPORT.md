TASK   K3c — Demo resume and source-candidate rejection commands       GATE GF-AI/F2 prerequisite
WORKS  Record a room rejection or a roofprint rejection alone, with reasons, replay and canonical review history.
SEE IT curl -s http://127.0.0.1:3194/api/v1/buildings/e8777ffc-9409-4129-bacf-f680160d8795/canonical
INPUTS Real Magnolia unplaced P1 room; a Karnataka roofprint on an image with no prior decision (test_only).
GAPS   Studio needs a null guard; fresh-bootstrap migration registration is outside scope; admission stays deferred.

## Delivered and observed

- Resumed existing demo only, never `--create`. First Desktop start timed out with the known inaccessible
  `sailor-ingest.sock` rename. Preserved the exact inspected socket-only directories using the documented
  recovery; second bounded start, resume and doctor exited 0. Storage/container identities were preserved.
- On resume, Tower revision 4 and Magnolia revision 5 still read their K3b schedules (`resume.json`).
- One Magnolia room was rejected through the existing API: registry revision 5 → 6; candidate reviewed/rejected,
  level null; polygons, planFrame and citations unchanged. No level's roomCandidateIds contains that room.
- One reject-only roofprint decision returned package null and selections []; area revision stayed 0.
  Exactly one receipt row was added. Packages stayed 7, features 67, registry records 65. No imported geometry.
- Request-key replays were unchanged. Reject → attach and attach → reject are 409 `CANDIDATE_DECIDED`.
  Later roof acceptance is 422 `ML_REVIEW_SELECTION`; empty decisions are validation 422.
- Previously, attach_level could overwrite an already attached candidate's level/review under a new request.
  It now refuses every prior review as requested; old stored decisions and replay receipts are not rewritten.

## Design

`rejectCandidate`/`assertCandidateUndecided` extend existing room metadata/history commands, not routes.
Shared page bound and schedule-gap constant remove the specified duplication; cyclic imports are used in functions.
`footprintContextTx`/`footprintDecisionTx` share source, revision and component checks; the reject-only helper
writes only the existing receipt table. `retainedReviews` needs no change. Accepted draft creation stays separate.

## Migration / integration gaps

The existing receipt package_id was NOT NULL. Added and applied only the forward-only
`database/sql/50-spatial-ml/01-reject-only-footprints.sql`; it drops NOT NULL, preserves the FK and every row.
`database/manifest.json` and `spatial-ml-db.ts` are outside owned paths: lead must register/load this SQL in the
existing migration authority before a fresh-bootstrap release. The present demo is migrated and verified.
The regenerated client honestly permits package null. Studio typecheck exits 2 at DecisionSheet.tsx:33
(`TS18047`); Studio is read-only, so the F2 owner must guard that dereference and switch to the new commands.

## Checks / checkpoint

Backend typecheck 0; 33 focused tests pass; 6 payloads validate against published schemas; doctor 0; diff/style 0.
Strict check.py on a fresh genuine LF archive of 8f23b777 exits 1: only four `runtime receipt changed` failures.
No runtime receipt was re-pinned. Subsequent production edits only wrap a schema line; its source pin was refreshed.
Evidence-only helper defects (wrong GET route, SQL alias case) were corrected from saved successful artifacts,
never by repeating either rejection. Details and bounds are in recovery.json. Evidence remains under 100 KB.
Commits: b0afbfcc cleanup; d4853ba0 room reject; 8f23b777 reject-only roofprints; final HEAD evidence checkpoint.
Demo left running from 8f23b777. No new OCR/model inference, qualification changes, reset, reseed, merge or push.
