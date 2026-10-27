TASK   INT2 — post-roll integration            GATE GF1/AUD1 offline
WORKS  RT1, NR2, NR1, NR3 and CSV2 are merged in order on the requested base; named offline checks pass.
SEE IT pnpm exec tsx --tsconfig docs/evidence/int2/tsconfig.tests.json --test tests/intake-pdf-batch.test.ts
INPUTS Real NYC footprints and Magnolia PDF named plan.json; OSM road lines and Delhi boundary, test_only.
GAPS   Newer staging has one generated source-pins conflict, no source conflicts; 27 explicit test skips.
DESIGN service.ts preserves retain-first checks and old table replay; native readers share existing job authority.
       ifc-processor.ts omits absent structure before hashing; image crop service construction is deferred.
       CSV helper pins and profiling scratch are complete; OpenAPI, source pins and API types are regenerated.
COMMITS First-parent source commits and exact commands/exits are in result.json; source head is 1291b138.
CHECKS Backend: 1,989 pass, 25 skip; Studio: 611 pass, two skip; geo: 46 pass; no remaining test failures.
       Contract refresh/check, API types, API audit, SQL extraction audit and both typechecks: exit 0.
       Routing/PDF final: 45 pass; NR3 reader pins: two pass; real streaming reads, UI/style checks: exit 0.
       Merge simulation against newer staging: exit 1, docs/api/source-pins.json only.
NEXT   services/geo changed (CSV2, NR3), so the processor image must be rebuilt before a roll.
       RT1, NR1 and NR2 need a rehearsal; qualify uploaded CityJSON and CSV table/evidence readback too.
       Keep staging's generated pins while merging, then refresh against the combined source tree.
       No Docker, live runtime, push, original change or credential access was performed.

The base remains the requested `e9c12699`. During verification, staging gained DG1, RC1 and PF1.
No unrequested staging merge was made. A final `git merge-tree --write-tree` against `1a226949`
has no source conflict after relocating two routing controls. The combined newer tree was not tested.
Use the task's generated-file resolution policy, regenerate, and rerun the combined tree's checks.
All 39 initial failures and the later legacy-CSV replay regression have diagnoses in `result.json`.
Full logs are outside Git in the run directory recorded by each command entry.
