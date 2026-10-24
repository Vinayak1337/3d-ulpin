TASK   CA1 — record the committed native exterior                 GATE GF1
WORKS  Reviewed native building commits gain cited revision-1 records without detailed geometry or rights.
SEE IT Run the three adjacent tests listed in result.json; this is memory-only, not a live URL.
INPUTS NYC upload-pack features 345 and 1272393; the latter has null ground elevation. Originals unchanged.
GAPS   PostgreSQL durability/concurrency and real API readback remain unqualified; two pre-existing checks fail.
DESIGN exterior-only.ts unifies reader rules; recordCommittedExteriorsTx batches reserved records in commitPackage.
COMMITS e11afa9a reader repair; e1dedc5a area recording; this handoff commit supplies evidence and generated pins.
CHECKS Backend typecheck 0; new tests 15/15; existing 49 pass, 1 fail, 1 skip before/after; source pins 583/583.
NEXT   Lead review, then runtime rehearsal. CA4 owns native citation admission, exact GET/export and packet extraction.

Details, commands, exact source references and the two unchanged failures are in [result.json](result.json).
The accepted [step0.json](step0.json) remains untouched. No branch switch, push, runtime or original write occurred.
