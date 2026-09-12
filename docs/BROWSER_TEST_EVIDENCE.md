# Browser verification evidence

**6/6 production browser workflows passed**, with no failures, skips, retries or flaky results. The complete run took **150.044 seconds**.

Command: `pnpm test:e2e`. Playwright **1.63.0** ran against `http://127.0.0.1:3000`, using one worker, a 1440 × 900 presentation viewport and Chromium WebGL through SwiftShader.

Run: **12 September 2026, 09:50:52–09:53:22 UTC** (15:20:52–15:23:22 India time). Production build: `sUwSVhReW4W_7uN6Aa4wQ`. The build's 24 JavaScript chunks passed syntax validation.

Primary report: [browser-report.json](../test-results/browser-report.json). Test implementation: [workbench.spec.ts](../tests/e2e/workbench.spec.ts). The tables below extract the actual result records and their attachments.

## Completed workflows

| # | Exact test title | Result | Duration |
| --- | --- | --- | --- |
| 1 | rehearsal 1: c001 sources, overlap, explicit evidence correction | PASSED | 28.624 s |
| 2 | rehearsal 2: c001 sources, overlap, explicit evidence correction | PASSED | 23.204 s |
| 3 | rehearsal 3: c001 sources, overlap, explicit evidence correction | PASSED | 20.318 s |
| 4 | rehearsal 4: c002 sources, overlap, explicit evidence correction | PASSED | 22.585 s |
| 5 | linked editing, display-only controls, calibrated PNG/PDF tracing, rejected upload and narrow layout | PASSED | 40.677 s |
| 6 | user file chooser uploads real spatial, level and control files | PASSED | 13.682 s |

The first three runs are consecutive fresh C-001 correction rehearsals: actual input files produce **6.4 m³** overlap, revised level evidence is explicitly applied, and rebuilding produces **0 m³** positive overlap. The independent C-002 workflow verifies **14.4 m³ → 0 m³**. Browser refresh checks reopen the persisted corrected model.

The editing workflow exercises linked selection, saved elevation/footprint changes, display-only floor/isolation controls, calibrated PNG and PDF tracing, a rejected upload, and a narrow viewport. The file-chooser workflow uploads actual JSON/CSV originals and builds seven spaces through the normal processing pipeline.

## Persisted case and snapshot IDs

These identifiers come from the JSON `persisted-evidence` attachments embedded in the report.

| Rehearsal | Case ID | Draft snapshot | Revised source | Corrected snapshot |
| --- | --- | --- | --- | --- |
| 1 | `95684273-312f-4dbb-bdc8-8dbda0812994` | `9eab93a8-ae05-4299-a004-a629ef503d73` | `4c3cd003-6482-4511-8183-c05f3e0ea1b6` | `89270872-7444-41b6-b46d-4d004da685b6` |
| 2 | `a080eba5-c647-4c66-a3f6-208ea14b875e` | `7eef7be7-196f-4db9-8460-06366017c8c3` | `7025adea-3cee-4428-8458-658f5383ab2b` | `5ffd3a0c-b65f-46fd-822e-2eee100e2ea4` |
| 3 | `707364a2-21f5-43b8-856b-7a1046e335ed` | `7a395a22-9af8-4471-85ac-1f1c17243eea` | `dee7ff1e-a744-44f3-b8aa-3236f9a30838` | `cc9308c3-2c48-4c75-952a-02ab997b1aa7` |
| 4 | `68951666-8991-47fa-a7be-87558ec438a8` | `cad2c05b-57c5-48ec-8065-0052c64de016` | `880b7ac3-5797-4373-b1bb-79a1110e720f` | `242a6f03-f6ca-4709-8396-abb44c3bb02d` |

The `editing-evidence` attachment records case `1f2927fe-21d9-42f5-bc01-0948c7fffb86`, final snapshot `4c55b831-fa60-408f-9119-47c0494bfe49`, and **9 spaces**. Independently computed areas from the selected calibration/trace pixels were **3.924731330 m²** for PNG and **3.924964939 m²** for PDF. Screen-pixel rounding is included in those expectations.

The file-chooser test attaches its completed-model screenshot and video; its report does not include a separate case/snapshot ID payload.

## Screenshots and recordings

Each link is the exact local artifact path from the passing report. Videos are WebM recordings.

| Workflow | Screenshots | Recording |
| --- | --- | --- |
| 1 | [draft-overlap](../test-results/browser/workbench-rehearsal-1-c001-a57c5-xplicit-evidence-correction/attachments/draft-overlap-d102a5df1990ecf20bdb260e885f8da3e720f9e6.png) · [corrected-model](../test-results/browser/workbench-rehearsal-1-c001-a57c5-xplicit-evidence-correction/attachments/corrected-model-39eda42f48057749d749f96ea704df25b52f0112.png) | [video](../test-results/browser/workbench-rehearsal-1-c001-a57c5-xplicit-evidence-correction/video.webm) |
| 2 | [draft-overlap](../test-results/browser/workbench-rehearsal-2-c001-06606-xplicit-evidence-correction/attachments/draft-overlap-c67cb1255efc01be600950d982102c0bf5e0b900.png) · [corrected-model](../test-results/browser/workbench-rehearsal-2-c001-06606-xplicit-evidence-correction/attachments/corrected-model-a8d230d888628a7921d5fad6486b31329f76a2a8.png) | [video](../test-results/browser/workbench-rehearsal-2-c001-06606-xplicit-evidence-correction/video.webm) |
| 3 | [draft-overlap](../test-results/browser/workbench-rehearsal-3-c001-1e08d-xplicit-evidence-correction/attachments/draft-overlap-34fa65b51a1b6e76adf708115c761d8245a2504c.png) · [corrected-model](../test-results/browser/workbench-rehearsal-3-c001-1e08d-xplicit-evidence-correction/attachments/corrected-model-b4e9d887d9b7d7fe01a429ffa1855cbc5e67eaa7.png) | [video](../test-results/browser/workbench-rehearsal-3-c001-1e08d-xplicit-evidence-correction/video.webm) |
| 4 | [draft-overlap](../test-results/browser/workbench-rehearsal-4-c002-64757-xplicit-evidence-correction/attachments/draft-overlap-889d73c5281a9b0060a416ebd5ba615675a1fe72.png) · [corrected-model](../test-results/browser/workbench-rehearsal-4-c002-64757-xplicit-evidence-correction/attachments/corrected-model-30130f02c9bc51cdd5fdd986e1ff72982dfcb1fb.png) | [video](../test-results/browser/workbench-rehearsal-4-c002-64757-xplicit-evidence-correction/video.webm) |
| 5 | [isolated-upper-space](../test-results/browser/workbench-linked-editing-d-05808-ed-upload-and-narrow-layout/attachments/isolated-upper-space-69d1f2ad5e9bade41b03332218d96a8de5790bf2.png) · [png-calibrated-trace](../test-results/browser/workbench-linked-editing-d-05808-ed-upload-and-narrow-layout/attachments/png-calibrated-trace-7db3592d3685ef5353a62b5d738756d3c7380bbd.png) · [pdf-calibrated-trace](../test-results/browser/workbench-linked-editing-d-05808-ed-upload-and-narrow-layout/attachments/pdf-calibrated-trace-86f9998de6243a2a741b4142d061c5c23221b48a.png) · [narrow-layout](../test-results/browser/workbench-linked-editing-d-05808-ed-upload-and-narrow-layout/attachments/narrow-layout-6d450028bc1d38d86b05c0cd407601f29ef9812b.png) | [video](../test-results/browser/workbench-linked-editing-d-05808-ed-upload-and-narrow-layout/video.webm) |
| 6 | [uploaded-originals-built](../test-results/browser/workbench-user-file-choose-b7cd2-ial-level-and-control-files/attachments/uploaded-originals-built-01ff8718e4b304363bdc144b1e8f727272f54dda.png) | [video](../test-results/browser/workbench-user-file-choose-b7cd2-ial-level-and-control-files/video.webm) |

## Runtime and presentation limits

Production client minification is disabled because the pinned minifier corrupted Cesium embedded WASM byte strings. The verified webpack build serves approximately **17.6 MB of uncompressed client JavaScript**; server optimization remains enabled. This is acceptable for the local demo and is a deployment/performance task before wider distribution.

The prepared [C-001 showcase](http://127.0.0.1:3000/?case=d34cacf3-f4fc-4ac2-a282-9058fc4ea0e5) retains seven spaces and the initial **6.4 m³** conflict. Its case ID is `d34cacf3-f4fc-4ac2-a282-9058fc4ea0e5`; model ID `681eddd1-c71f-41a5-8f64-1d6718457089` was independently checked again after a production web restart. Use a fresh workspace for another complete upload-to-correction rehearsal.

The broader service-restart evidence, geometry/API results and deferred project scope are recorded in [HACKATHON_STATUS.md](HACKATHON_STATUS.md).
