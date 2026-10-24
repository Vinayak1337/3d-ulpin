# K3b — reviewed level schedules

**TASK** GF-T16/GF-SCENE prerequisite records delivered; this is not a complete gate pass.
Branch `task/k3b-level-schedule`, from assigned `staging@9976518e`; no merge/rebase/push.

**WORKS**
- Cited proposals remain candidates until an explicit digest-pinned review command appends history.
- Tower revision 4 retains reviewed-as-conflicting G+41/G+42 alternatives and zero expanded levels.
- Magnolia has three reviewed caption levels: GROUND, FIRST, SECOND. Its final record revision is 5.
- One GROUND room association is reviewed; all 18 room polygons/frames remain unchanged and unplaced.
- All real bounds/base/heights remain null/unknown. Zero prisms, registry spaces or measurement grants.
- Demo-only OCR override selects the existing complete prefix. No OCR execution was repeated.

**SEE IT** `http://127.0.0.1:3194/api/v1/buildings/{buildingId}/canonical`:
Tower `6f95d04e-2067-4ac8-a3c2-6cc21ea46325`; Magnolia `e8777ffc-9409-4129-bacf-f680160d8795`.
Inspect `levelSchedule`, `levelScheduleProposals`, `levels[].prismAssessment` and `roomCandidateIds`.
Receipts, before/after JSON and exact history are alongside this report.

**INPUTS** Existing retained PDFs and their source/page/region SHA pins; P1 full-precision derivative
hash verified before use; A5's localized G+42 citation and the retained G+41 alternative. No acquisition.
Independent RERA floor expression remains literal `3` in unchanged D2 truth, not a rewritten numeric fact.

**GAPS** P1's TERRACE is a space label inside SECOND FLOOR PLAN, not a separate level caption in that
retained output. No fourth level was invented; a separate cited inventory assertion is needed to add one.
The HTML registry literal is not an installed canonical count; `storeyCount` remains its prior unknown.
No stated vertical limits or reviewed placed footprint exist for these records. Known prism execution
has not been demonstrated on a real K3b input. Human production authentication is not proved by the local actor.

**DESIGN**
Reuse existing append-only registry/physical histories and package lineage; no new table/authority.
Keep revision-zero roof drafts and all geometry-admission/qualification gates unchanged.
Accumulate only cited heights from a stated base/interval; unknown intervals break accumulation.
Room review links an explicit current-building reviewed level without adopting geometry; replacements cannot orphan it.

**COMMITS** `61ec7ed3` schedules/contracts; `34e2cb3e` room association/safeguards/tests;
`40f077d0` demo OCR/runtime; final evidence commit is the last branch commit.
Served native checkpoint is `40f077d0`; later evidence-only changes need no restart.

**CHECKS** Backend typecheck, 18 focused tests, extended canonical/history/replay/refusal verifier,
22 imagery original hashes, both cited PDF byte hashes, all 80 roof candidates, doctor and code/diff checks pass.
One verifier comparison initially confused new projection stamps with changed officer decisions; only
`revisionId` is normalized for that comparison. The corrected bounded live check passes; history stays exact.
Strict `check.py` on a fresh genuine LF Git archive of `40f077d0` exits 1. Diagnostic continuation finds **only**
`API-DOC: runtime receipt changed` (four receipts); no other check fails. No receipt or runtime pin was changed.

**NEXT** Lead reviews/integrates; owner resolves receipt encoding/re-pin separately. Supply a cited
separate terrace inventory and stated height/base/placed-footprint authority before further schedule/prism work.
Demo stays running on `ulpin-geo:demo-k3b`; all storage volumes preserved. No GPU, ML rerun, reset or reseed.
