# T001 progress — resumed real repository baseline

Date: 18 September 2026. Review class: explicit self-review; the worker connector
could not identify the prime conversation, so no independent worker review ran.

## Branch and preservation

The verified clean product `main` at `1622097` was fetched and the newer remote
spatial branch found. The foundation branch was created from `f082441` without
resetting, rebasing, merging to main, or overwriting other-agent work. The original
adoption package passed its expected SHA-256 check before an additive `git apply`.
Root and app instructions, real scripts, storage writers and tests were inspected.

The earlier shared-map branch's most recent hosted run failed at its browser step,
not at type/build/pure tests. Local reproduction found missing observation markers
and a `.glb?v=...` URL assertion mismatch. The fixes restore actual markers and
validate binary GLB bytes; they do not replace the live canvas or weaken identity,
quantity, gesture, dataset-return or responsive assertions. Windows path separator
and collector-interpreter failures were also reproduced and corrected.

## Observed baseline results before adoption commits

| Check | Actual result |
|---|---|
| Spatial core | 29/29 passed after platform-neutral ownership-path fix |
| Building scene | 7/7 passed |
| Repository environment selection | 2/2 passed on isolated temporary fixtures |
| Register scope | 3/3 passed |
| UI/pure React regressions | 20/20 passed |
| Uttam bundle/attribution/policy | 14/14 passed |
| AI extraction unit tests | 22/22 passed; no live model qualification |
| TypeScript | Passed |
| Production build | Passed; inherited minification-disabled warning retained |
| Source collector | 19 passed, 1 explicitly skipped native Windows symlink test |
| Isolation and GLB network guards | 32/32 passed |
| Actual production browser | 10/10 groups passed in Windows Chromium/software WebGL |
| Plan records | 26 consistency checks passed before status update |

The browser report records `2026-09-18T13:38:24.510Z`, 33 genuine GLB requests and
a verified 76,632-byte GLB. It reports no page exceptions or failed local responses.
CSS preloading and software-WebGL readback warnings remain visible. These tests
are not mockup acceptance or target-GPU/native-phone performance certification.

## Remaining acceptance gate

`scripts/engineering/isolated-baseline.mjs` and the dedicated hosted workflow
exercise a real snapshot restore, exact originals/rows, additive replay, repeated
migrations, API negatives/closed-ring builds, browser interactions and pinned
Python tests. At this progress snapshot those integration tools are authored,
not yet executed on the hosted runner. Local Docker is stopped; startup requests
were blocked and not bypassed. No private-PC registry or object data was changed.

All T002 onward tasks retain their own acceptance criteria. Reuse inherited code
but assess gaps and write the detailed active-task plan before implementing them.
T001 is not Accepted until the isolated evidence and source manifest are recorded.
