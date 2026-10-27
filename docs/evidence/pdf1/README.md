# PDF1 — batch PDF OCR on press

```text
TASK   PDF1 — batch scanned PDF OCR on press            GATE GF-AI (AUD1 gap 6; offline slice)
WORKS  An officer can request one bounded scanned-page OCR job and read its state and cited candidate passages.
SEE IT pnpm --filter @ulpin/studio exec vitest run src/features/intake/BatchPdfSection.test.tsx
INPUTS Magnolia sanctioned layout (good) + Tower 3 section (difficult), checked read-only for scanned-page selection.
GAPS   Actual document-runtime OCR unqualified; generated API source pins need an integration refresh.
```

## Design and bounded decision

- `BatchPage.tsx` exposes PDF-reading navigation in mixed batches and renders one selected `BatchPdfSection`.
  Neither `IntakeTray.tsx` nor `BatchTableSection.tsx` changes.
- `BatchPdfSection.tsx` shows the action, the job's words and candidate passages, with pinned page-region viewer
  buttons. `pdf-reading.ts` reuses private page metadata, case revision, document retry and paged status routes.
  Runtime preflight refusal is visible on the item and sends no enqueue request. Existing server enqueue logic
  reuses an active job even if a second press has a fresh request key; lost answers also retain the original key.
- The existing OCR selection is singular: one whole page per job, numbered 1–8. This task does not widen it.
  The first eligible scanned page is offered, with the unread remainder stated. Successful OCR does not queue
  more pages automatically. Large-frame/crop and dependency restrictions remain the existing reader's limits.
- `document-ingestion.ts` names those existing OCR bounds and shares scanned-page detection through the existing
  browser-safe contract export. Wire schemas and routes stay unchanged. `intake-draft.ts` changes only the
  scanned/OCR sentences; a native reading no longer claims that OCR cannot run in a batch.

## Verification and next step

[Result and exact commands](result.json): backend and Studio typechecks pass; 27 server tests and 17 Studio
checks pass. Two unchanged real PDFs give the same scanned-page coverage as the retained G10 native receipt,
using a read-only bounded PDF.js comparison. This is eligibility evidence, not OCR accuracy or an application
runtime receipt. OCR passages in unit controls are explicitly `test_only`, not source truth.

[UI design report](ui-design-check.md): no blocking or design-system findings from source review. Actual browser
focus/zoom and screenshots were not checked.

No Docker, provider, deployment, database or original-data write was used. The optional OpenAPI check confirms
that `docs/api/openapi.json` matches, then stops on the expected `docs/api/source-pins.json` hash drift. That
unowned generated file was not changed: regenerate it after integration, when the other shared-seam changes
are also present. Then rehearse the press and cited result on the authorized document runtime, including a
large scanned plan; no room, level, unit, geometry, ownership or record field should be produced by OCR.
