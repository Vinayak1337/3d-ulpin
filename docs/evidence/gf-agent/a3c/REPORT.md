# A3c — tabular enrolment and live two-file run

TASK A3c — GF-AGENT / GF-T06/T07 runtime half
WORKS First: 33 rows, 3 chunks; layouts new/memory/new; calls 0/0/0; questions 16/16/16.
WORKS Second: 8 rows, 1 chunk; memory; calls 0; memoryHits 1; questions 0; learner v44.
SEE IT `curl http://127.0.0.1:3194/api/v1/cases/4ad9cb6d-56c0-445e-a9b6-357d1dc1d452`
INPUTS D8 mi-d10-02.csv → mi-d10-03.csv; native mi-d19-01.xlsx propose-only; duplicate-header CSV in tests.
GAPS Older dispatcher rollout and historical mapped-chunk reopening remain; property accuracy is not qualified.

## Delivered
- Enrolment uses `AnyStreamingInputSchema`; existing scope and fingerprint checks are unchanged.
- Wider schemas/types have their real names. Tabular row bounds and unavailable-cell marking are named helpers.
- `scripts/api/refresh-contract.ts <base-ref>` replaces both one-off scripts, refuses a missing base,
  prints repinned producers and adds no previously unpinned test files. No documents named the old scripts.
- Demo paths live in a non-secret `tabular-paths.json`: existing Python bridge, intact A4 v43 seed,
  and a new demo-local learning directory. Missing/invalid paths fail validation with a clear message.
- Gateway stays disabled. No provider call, migration, seed, reset, deletion or replacement container occurred.

## Live run
- `k4a.log` ended `exit 0` before runtime ownership was taken.
- Doctor on a2 initially saw the still-served k1 manifest and failed that exact comparison.
  Doctor using the served k1 script passed; after API rebind, a2 doctor passed before and after the run.
- Only the owned native API was restarted. The older k1 dispatcher was left running unchanged.
  Exact API-enrolled jobs were driven by existing a2 fenced worker functions, not a new job type or broker.
- One new unassigned case holds both CSV originals and the optional workbook; all source bytes remain pinned.
- First-file cold chunk proposed unknown for every column: two student fields, fourteen manual fallbacks.
  Later chunks used job-local reuse or a new layout; the one-row tail changes the inferred Sl.No type.
  `teacherFields` describes fallback slots here, not provider answers. Every teacher-call count is zero.
- The lead-authorized answer builder joins all 16 T1 profiles/labels, requires unique unknown/copy labels,
  and preserves the supplied rationale and the “not an authenticated officer decision” qualification.
- Existing author/approve routes append recipe revisions 1 proposed and 2 approved.
  The follow-up job makes one partial_fit, v43 → v44, and one accepted-memory entry.
  New weights have threshold null and abstain; the next chunk records v44 rather than retroactively changing v43.
- The second original uses accepted memory, has no questions, and retains its mapping.chunk SSE frame.
- Optional XLSX: sheet T_18, physical headers 4/5, 60 rows, four chunks, zero calls, eight questions/chunk.
  It was not approved and produced no additional learning or shared-memory entry.
- Before/after public reads: registry records 2, areas 4, sites 4, packages 7, physical features 67, unchanged.
  Only sources increase 32 → 35 and the one new source case is added.
- Successful public job/chunk read-backs were retained before the next source was appended.
  Reopening the first mapped job/chunk after source two returns 409 STALE_REVISION because the case advanced.
  Final case/source and recipe-history reads succeed. No stale-write fence was relaxed to hide this limitation.
- The second-upload helper initially used the wrong GET case envelope and received 422 at an undefined-case path.
  No source was retained; it was corrected once to `.case`, then the same-case intake succeeded.

## Proves / does not prove
**Proves:** a CSV goes through the real job, events and approval; the second file of a known layout is mapped
from memory with no teacher call; learning starts only from an approved recipe.
**Does not prove:** mapping accuracy on property columns (every answer here is unknown), the teacher route
(gateway off), student improvement, or automatic processing by the older unchanged dispatcher.
XLSX propose-only runtime is additionally proven; XLSX approval is not.

## Verification and checkpoint
Backend, agent and client typechecks: exit 0. Focused tests 18/18 and AI 22/22: exit 0.
Native contract refresh, missing-base refusal control, API generation, Ruff, pins/style and diff checks qualify.
True-LF archive at dac2a7cd: archive exit 0; check.py exit 1 only `API-DOC: runtime receipt changed`.
Owner receipt files/pins remain untouched. Artifact paths and SHA-256 values are in `result.json`.
The API is left running from `E:/Projects/ulpin-wt/a2`, code commit `dac2a7cd`, branch `task/a3c-tabular-live`.
The later evidence commit changes only scripts/evidence, not the served application producers.

## F2b next
- Roll the existing dispatcher to the same code/config as the API before promising automatic Studio imports.
- Add a reviewed read-only historical job/chunk contract so an unrelated source append does not hide old results.
- Approval currently returns a recipe, not its follow-up job id; the runner replays the existing enqueue command.
- Show all-unknown decisions as reviewed interpretation, not completed property identity or rejected original rows;
  `completed_with_rejections` currently also covers deliberately unresolved tabular rows.
- Use explicit CSV/XLSX selection and receipt pins; surface questions, per-chunk metrics and learner version.
  Admission remains exact D8 development bytes, not arbitrary user CSV/XLSX support.
