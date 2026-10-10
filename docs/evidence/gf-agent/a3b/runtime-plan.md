# A3b runtime handover plan — not run
Prerequisites: lead patches `jobs.ts` to `AnyStreamingInputSchema`; runtime owner configures Python and learner.
Data gap: no distinct current D8 original exactly matches `mi-d10-01.csv`; 02 and 03 match each other, not 01.
Offline preflight (01/02 fails closed; 02/03 passes; neither command makes HTTP requests):
```sh
pnpm exec tsx scripts/agent/a3b-runtime.ts layout mi-d10-01.csv mi-d10-02.csv
pnpm exec tsx scripts/agent/a3b-runtime.ts layout mi-d10-02.csv mi-d10-03.csv
```
After explicit handover, the requested 01 first-file command is:
```sh
pnpm exec tsx scripts/agent/a3b-runtime.ts propose mi-d10-01.csv --run-after-handover
```
Lead must provide an admitted exact-layout second original for 01, or authorize this existing real 02→03 pair:
```sh
pnpm exec tsx scripts/agent/a3b-runtime.ts propose mi-d10-02.csv --run-after-handover
pnpm exec tsx scripts/agent/a3b-runtime.ts approve <receipt-directory> <officer-answers.json> --run-after-handover
pnpm exec tsx scripts/agent/a3b-runtime.ts second <receipt-directory> mi-d10-03.csv --run-after-handover
```
The runner prints the external receipt directory; officer `{mapping,decisions}` JSON is never generated automatically.
Approve waits for its existing job. Second asserts `layout: memory`, teacherCalls=0 and retained `mapping.chunk` SSE.
