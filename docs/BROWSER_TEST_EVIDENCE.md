# Browser verification evidence

**8/8 production browser workflows passed**, with no failures, skips, retries or flaky results in the final run. Duration: **268.539 seconds**.

Run: **12 September 2026, 10:57:14–11:01:42 UTC**. Production build: `tA-r6-W7-TZbLfnzngm5t`. Playwright used one Chromium worker at 1440 × 900 with WebGL through SwiftShader; the presentation workflow also checks 390 px width and reduced motion.

Command: `ULPIN_BROWSER_REPORT=test-results/redesign/final-browser-report.json pnpm exec playwright test --output=test-results/redesign/final-browser`.

Primary evidence: [final JSON report](../test-results/redesign/final-browser-report.json). Test implementations: [presentation](../tests/e2e/presentation.spec.ts) and [complete workbench workflows](../tests/e2e/workbench.spec.ts).

## Completed workflows

| Exact test title | Result | Duration |
| --- | --- | --- |
| c001: architectural presentation preserves exact property geometry | Passed | 36.090 s |
| c002: architectural presentation preserves exact property geometry | Passed | 22.368 s |
| rehearsal 1: c001 sources, overlap, explicit evidence correction | Passed | 39.383 s |
| rehearsal 2: c001 sources, overlap, explicit evidence correction | Passed | 32.731 s |
| rehearsal 3: c001 sources, overlap, explicit evidence correction | Passed | 33.462 s |
| rehearsal 4: c002 sources, overlap, explicit evidence correction | Passed | 33.614 s |
| linked editing, display-only controls, calibrated PNG/PDF tracing, rejected upload and narrow layout | Passed | 47.088 s |
| user file chooser uploads real spatial, level and control files | Passed | 22.950 s |

The two architectural workflows exercise Building and Property volumes, selection, floor filtering, isolation, floor separation, reset, and automatic exact-overlap presentation. The C-001 workflow also exercises basement reveal, focus mode, narrow layout, reduced motion and dialog focus/Escape. Candidate spaces, sources, snapshot data and case revisions remain unchanged by presentation controls.

Three consecutive C-001 rehearsals verify **6.4 → 0 m³** through explicit revised evidence and rebuilding. C-002 independently verifies **14.4 → 0 m³**. The editing workflow exercises actual elevation/footprint edits, calibrated PNG and PDF tracing, rejected upload and persistence; the file chooser workflow uploads original JSON/CSV files.

## Persisted evidence

These values are decoded directly from the final report's JSON attachments.

```json
[
  {
    "workflow": "c001: architectural presentation preserves exact property geometry",
    "caseId": "c6d1ed55-6dd2-420f-afc2-2eb846764e3f",
    "snapshotId": "dc6111ce-cf13-4fe1-aa24-9f2b8adcce58",
    "revision": 1,
    "unitCount": 7,
    "dataset": "c001"
  },
  {
    "workflow": "c002: architectural presentation preserves exact property geometry",
    "caseId": "4e3ce789-93d1-4a67-9eac-4e773efefa67",
    "snapshotId": "a96c5f39-051d-4437-bcd4-e147ce8d3be5",
    "revision": 1,
    "unitCount": 5,
    "dataset": "c002"
  },
  {
    "workflow": "rehearsal 1: c001 sources, overlap, explicit evidence correction",
    "caseId": "8151da43-c095-42ef-b1e4-68b4f167bc43",
    "draftSnapshot": "a7d70311-76b9-4d3f-98de-09d43d924886",
    "revisedSource": "adf5f173-87f4-48d2-bfd9-175e6ee461a0",
    "correctedSnapshot": "bfab94ec-5889-4b02-a815-c1bdfe7b03a1",
    "overlapBefore": 6.4,
    "overlapAfter": 0
  },
  {
    "workflow": "rehearsal 2: c001 sources, overlap, explicit evidence correction",
    "caseId": "76ecb379-5903-45dd-97a4-907fe0460f7d",
    "draftSnapshot": "2f55429f-ee8a-4d32-a87a-03f6dbb46449",
    "revisedSource": "78c89fb1-c8dc-480e-b9df-46a6fb55135a",
    "correctedSnapshot": "d29b3bc2-7692-413a-8827-936bb35308da",
    "overlapBefore": 6.4,
    "overlapAfter": 0
  },
  {
    "workflow": "rehearsal 3: c001 sources, overlap, explicit evidence correction",
    "caseId": "0fedee80-7944-4b7d-8c86-a84f1bef9c1a",
    "draftSnapshot": "708512b2-f6fb-477c-ad5d-dcb017ba298b",
    "revisedSource": "30cdc59b-fb62-4fb3-9c55-b196d177ab90",
    "correctedSnapshot": "7d6d57af-0d2b-47ab-b443-b42b32df746b",
    "overlapBefore": 6.4,
    "overlapAfter": 0
  },
  {
    "workflow": "rehearsal 4: c002 sources, overlap, explicit evidence correction",
    "caseId": "5c8076d6-60a5-478a-ac9e-0fd59ecef5f7",
    "draftSnapshot": "82d724f7-7224-4104-b323-7612d74cf96c",
    "revisedSource": "4f46b37c-f4ab-462a-b8e4-5cfddd70f8bd",
    "correctedSnapshot": "4bb31dc0-8a1b-49d3-9b28-b69807794b86",
    "overlapBefore": 14.4,
    "overlapAfter": 0
  },
  {
    "workflow": "linked editing, display-only controls, calibrated PNG/PDF tracing, rejected upload and narrow layout",
    "caseId": "87135fd0-5257-4587-89dd-6b723919935a",
    "snapshotId": "b3764c50-ce6a-4502-b903-3f3f0eb77c68",
    "units": 9,
    "traceAreasFromPickedPixels": {
      "TRACE-PNG": 4.017709909650327,
      "TRACE-PDF": 4.017668145098293
    }
  }
]
```

## Screenshots and recordings

| Workflow | Actual report artifacts |
| --- | --- |
| c001 | [narrow-building](../test-results/redesign/final-browser/presentation-c001-architec-603bf-ves-exact-property-geometry/narrow-building.png) · [basement-section](../test-results/redesign/final-browser/presentation-c001-architec-603bf-ves-exact-property-geometry/basement-section.png) · [analytical-overlap](../test-results/redesign/final-browser/presentation-c001-architec-603bf-ves-exact-property-geometry/analytical-overlap.png) · [property-volumes](../test-results/redesign/final-browser/presentation-c001-architec-603bf-ves-exact-property-geometry/property-volumes.png) · [building](../test-results/redesign/final-browser/presentation-c001-architec-603bf-ves-exact-property-geometry/building.png) · [video](../test-results/redesign/final-browser/presentation-c001-architec-603bf-ves-exact-property-geometry/video.webm) |
| c002 | [analytical-overlap](../test-results/redesign/final-browser/presentation-c002-architec-94519-ves-exact-property-geometry/analytical-overlap.png) · [property-volumes](../test-results/redesign/final-browser/presentation-c002-architec-94519-ves-exact-property-geometry/property-volumes.png) · [building](../test-results/redesign/final-browser/presentation-c002-architec-94519-ves-exact-property-geometry/building.png) · [video](../test-results/redesign/final-browser/presentation-c002-architec-94519-ves-exact-property-geometry/video.webm) |
| rehearsal 1 | [draft-overlap](../test-results/redesign/final-browser/workbench-rehearsal-1-c001-a57c5-xplicit-evidence-correction/attachments/draft-overlap-d16fb2fd00e88d20bfa02db44816266c89c67594.png) · [corrected-model](../test-results/redesign/final-browser/workbench-rehearsal-1-c001-a57c5-xplicit-evidence-correction/attachments/corrected-model-31380ed484f54c20c3b62d648c28bd68cf251fad.png) · [video](../test-results/redesign/final-browser/workbench-rehearsal-1-c001-a57c5-xplicit-evidence-correction/video.webm) |
| rehearsal 2 | [draft-overlap](../test-results/redesign/final-browser/workbench-rehearsal-2-c001-06606-xplicit-evidence-correction/attachments/draft-overlap-babd8c550ac3d8787485d293e82b280b18c09929.png) · [corrected-model](../test-results/redesign/final-browser/workbench-rehearsal-2-c001-06606-xplicit-evidence-correction/attachments/corrected-model-6326ce4ea2079bc8764c1130fc71f8b56f62046a.png) · [video](../test-results/redesign/final-browser/workbench-rehearsal-2-c001-06606-xplicit-evidence-correction/video.webm) |
| rehearsal 3 | [draft-overlap](../test-results/redesign/final-browser/workbench-rehearsal-3-c001-1e08d-xplicit-evidence-correction/attachments/draft-overlap-d79c776feabf1ca728d397532ae8f9f8c8b1ed72.png) · [corrected-model](../test-results/redesign/final-browser/workbench-rehearsal-3-c001-1e08d-xplicit-evidence-correction/attachments/corrected-model-1a28c0b6286761671c3f61d25a78f3c5bb7516b9.png) · [video](../test-results/redesign/final-browser/workbench-rehearsal-3-c001-1e08d-xplicit-evidence-correction/video.webm) |
| rehearsal 4 | [draft-overlap](../test-results/redesign/final-browser/workbench-rehearsal-4-c002-64757-xplicit-evidence-correction/attachments/draft-overlap-3a206e5742d9ad3a9e0c2597446b6f0aaa9206f6.png) · [corrected-model](../test-results/redesign/final-browser/workbench-rehearsal-4-c002-64757-xplicit-evidence-correction/attachments/corrected-model-adf5d615cc38058d2e655a9638a3f68c7c779b8f.png) · [video](../test-results/redesign/final-browser/workbench-rehearsal-4-c002-64757-xplicit-evidence-correction/video.webm) |
| linked editing, display-only controls, calibrated PNG/PDF tracing, rejected upload and narrow layout | [isolated-upper-space](../test-results/redesign/final-browser/workbench-linked-editing-d-05808-ed-upload-and-narrow-layout/attachments/isolated-upper-space-95f716b1c4aaa661c323d2647ed0ac1ece71b8b8.png) · [png-calibrated-trace](../test-results/redesign/final-browser/workbench-linked-editing-d-05808-ed-upload-and-narrow-layout/attachments/png-calibrated-trace-b9a611c513d98959e46666c53118bd7b74a59b1b.png) · [pdf-calibrated-trace](../test-results/redesign/final-browser/workbench-linked-editing-d-05808-ed-upload-and-narrow-layout/attachments/pdf-calibrated-trace-a8173ec6b9b537b716e680bb7845d8daa787b286.png) · [narrow-layout](../test-results/redesign/final-browser/workbench-linked-editing-d-05808-ed-upload-and-narrow-layout/attachments/narrow-layout-5bef9cb45864c9dcbdf7d3052a29759b49aa21a2.png) · [video](../test-results/redesign/final-browser/workbench-linked-editing-d-05808-ed-upload-and-narrow-layout/video.webm) |
| user file chooser uploads real spatial, level and control files | [uploaded-originals-built](../test-results/redesign/final-browser/workbench-user-file-choose-b7cd2-ial-level-and-control-files/attachments/uploaded-originals-built-96136b29c2d200fd93d53283780ef93e6dd8a35d.png) · [video](../test-results/redesign/final-browser/workbench-user-file-choose-b7cd2-ial-level-and-control-files/video.webm) |

## Startup timing and scope

An earlier complete run passed seven workflows and hit one 15-second dialog stability timeout during cold 3D initialization. The unchanged failed workflow passed alone in 29.6 seconds. Its trace showed a 16.95-second settled frame while the viewer was loading; the Cesium chunk downloaded in 1.56 seconds. The trace does not distinguish module evaluation from synchronous WebGL initialization. Workflow setup now waits for the initial viewer to be ready before opening the next workspace; click timeouts and retries were not increased. [Initial report](../test-results/redesign/production-browser-report.json) · [isolated rerun](../test-results/redesign/rehearsal-2-recheck.json).

Client minification remains disabled for the pinned Cesium compatibility issue. The client output is approximately **17.8 MB uncompressed**. Cold startup under software WebGL can pause interaction; this remains a performance limitation before wider distribution.

The [prepared C-001 showcase](http://127.0.0.1:3000/?case=d34cacf3-f4fc-4ac2-a282-9058fc4ea0e5) preserves snapshot `681eddd1-c71f-41a5-8f64-1d6718457089`, revision 1, seven spaces and its initial **6.4 m³** overlap. A full comparison confirms unchanged case, candidate spaces, sources and model: [comparison](../test-results/redesign/showcase-preserved.json).

See [UI_REDESIGN.md](UI_REDESIGN.md) for the installed skills and presentation rules, and [HACKATHON_STATUS.md](HACKATHON_STATUS.md) for previous geometry/API verification and deferred scope.
