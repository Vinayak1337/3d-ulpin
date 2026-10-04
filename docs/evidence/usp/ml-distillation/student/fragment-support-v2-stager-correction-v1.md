# STUDENT-24 — v2 reload stager correction

Code `c275a504f588ed990471c9a4de4ffaf1238a4c9b`; base `4a12ceb10720b177a646db8d95404cb6d3aab510`. The v2 authority now re-exports the existing v1 `BATCH_SHA` unchanged (`a89a7eaa4917a398b78ac0457eb7fa55223fd877b12306f03ca7801939f4e536`). This fixes the observed shared reload input-map lookup.

One focused regression invokes the real v2/shared stager with retained saved-fit metadata and unchanged development inputs. Before the fix it reproduced the original `AttributeError` (exit 1). After the fix it passed binding, full development admission, all 16 input digest checks and freeze construction, then intercepted the first `root.mkdir` (exit 0). Native imports and write/copy operations were blocked; no directory or stage was created. Two changed sources compiled in memory once (exit 0). The prior five-control suite was not rerun.

Technical source/assignment binding, donor metadata and prior proof/file digests were mocked as described in the [JSON report](fragment-support-v2-stager-correction-v1.json). Batch lookup, development admission, source hash loop, saved-fit binding and freeze construction used their real implementations. This is a CPU staging-boundary result; actual copy/profile/native reload remains unrun.

All other 32 execution sources are physically and Git-identical to the base. The only production delta is one imported symbol; existing tests are AST-identical apart from the added standalone regression. Exact commands/exits, before/after logs, two changed-file pins and all 33 physical/canonical/Git source pins are retained under `E:\BhuAayam-data\task-data\ml-distillation\student\fragment-support-v2-stager-correction-d02a893913d34251b49b375613cb5d29`. Accepted fit, spent STUDENT-23 packet/failure, originals and host expectations are preserved.

No model/GPU, actual stage, host comparison or expectation access occurred. No owned process/service/tool session remains. A reviewed corrected head and separate STUDENT-23 attempt2 freeze are required before native work. Requested Sol6.1/high/default-standard is recorded; actual model/effort/tier remains unexposed.
