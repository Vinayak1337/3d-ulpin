TASK   K4d — demo document-pages and packet-region runtimes            GATE GF1 / GF4
Branch `task/k4d-demo-document-runtime`, `E:/Projects/ulpin-wt/k1`; offline only, no demo/runtime configuration changes.

WORKS
The demo launcher can supply both runtimes from a validated non-secret path file. Doctor fails if either is absent
or the profile/hash/asset closure does not match the serving checkout. Native Tower 3 metadata is 2586 × 1695 pt.
I inspected both crops: `[850,875,1020,910]` shows `2ND FLOOR PLAN`; `[596,390,644,409]` shows only boxed `UNIT-3B`,
not UNIT-3A or another label. Both use the unchanged 3× renderer choice (510 × 105 / 144 × 57 px).

SEE IT
Open the two PNGs in `E:/BhuAayam-data/task-data/k4d/native-proof-run2/`; pins are in `result.json` beside this report.
Run `node --test scripts/platform/demo-document-runtime.test.mjs` for the temporary path-file controls.

INPUTS
Good: the caption on the retained Tower 3 plan1 original. Difficult: the same oversized sheet and its small boxed label.
The 2000-pt whole-page side bound makes the full-page raster unsupported. Region extraction instead permits a source
side up to 14,400 pt and applies 2000 pt to the selected sides (170 × 35 / 48 × 19 pt). Its 7758 × 5085 canvas is
transform metadata, not an allocated bitmap. Only the bounded selected pixels are allocated and rounded inward.

GAPS
Local authority/storage doubles, not current HTTP/PostgreSQL/private-access proof. No source-space, P3, packet or card
was issued. Labels do not establish unit boundaries, level ordinals, measurements, rights or current approval.
Whole-page rendering remains unsupported; G+41/G+42 is unchanged. No scale, limit, recipe or old crop bytes changed.

DESIGN
`demo-config.mjs`: `readDemoDocumentRuntime()` permits only the six page/region keys; complete groups, real path kinds,
resolved scratch outside every checkout, lowercase hash, value-free errors. `readDemo()` merges them without .env edits.
`demo-document-runtime.mjs`: reuses `privateOcrDirectory()`, the existing Python frozen-profile builder and
`packetRegionRecipeSha()` → `verifiedProfile()`. New profiles/scratch are private and immutable; only the path pointer
is replaced. Normal builds require the stopped demo checkout; other checkouts require an external dry-run output.
Doctor adds one configuration/closure check and preserves G1 gateway checks. No backend renderer/authority changed.

COMMITS
- `425f36cc` runtime path validation, build command, doctor and temporary-folder tests.
- `cfbdbdfe` rebuild the frozen profile at each rollout.
- `a3f57f11` self-review fix: refuse resolved dry-run junctions into the shared runtime; tests safe in demo too.
- This commit: offline proof, compact results and this handoff.

CHECKS
`node --test scripts/platform/*.test.mjs` with the retained test interpreter: 18 pass, 0 skipped; backend typecheck 0;
dry-run build 0; native proof 0; syntax, 120-column check and `git diff --check` 0. Source unchanged; scratch empty.
Logs stay external. Three bounded failures/fixes are recorded in `result.json`: numeric query fields before native I/O,
a missing CLI message prefix, and the output-junction regression (invalid interpreter prevented any build writes).

NEXT
Runtime owner only, after lead review/integration. Exact ordered commands, from Git Bash; replace the commit placeholder
with the accepted staging HEAD. Run the install only if the reviewed lockfile changed. Do not rerun successful R1 jobs.
```sh
cd E:/Projects/ulpin-wt/demo
node --input-type=module -e "import('./scripts/platform/processes.mjs').then(m=>m.stopProcesses())"
git checkout --detach <lead-reviewed-staging-commit-containing-K4d>
# Only if pnpm-lock.yaml changed:
pnpm install --frozen-lockfile
node scripts/platform/demo-document-runtime.mjs build
pnpm platform:start --profile demo
pnpm platform:doctor --profile demo
# Require PASS Document runtimes and all existing checks; stop on failure.
API=http://127.0.0.1:3194/api/v1
SOURCE=5293cd72-2377-4deb-a51c-c76d11ccb429
SHA=2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865
BUILDING=6f95d04e-2067-4ac8-a3c2-6cc21ea46325
curl --fail "$API/sources/$SOURCE/pages?revision=1&sha256=$SHA&offset=0&limit=1"
curl --fail "$API/buildings/$BUILDING/canonical"
```
Then resume R1 identity step 2 using K4c's request and NEXT sequence: current canonical digest, officer-approved labels
and fresh/exact keys. R1's prior 503 stored no source-space receipt; do not repeat successful mutations.
The fresh profile must bind `demo`, not this worker profile. Unproven: live record/replay, snapshot/review/assign,
canonical/resolve read-back, plan/confirm/execute, PDFs, QR verification and tamper refusal. Whole-page or
recipe/limit changes require a separate task; no historical receipt, crop or runtime pin may be relabelled as this run.
