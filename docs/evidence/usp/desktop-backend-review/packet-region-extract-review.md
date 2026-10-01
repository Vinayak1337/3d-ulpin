# PACK1-CROP-01-R — private PDF region review

2 October 2026. **Two P2 findings; return for correction before production registration.** The retained crop is valid for the tested source/selection. Recipe integrity and unresolved-cleanup handling need correction. No production fix was made.

## Pins and scope

- Base `142a7c3f65c36d92359d8c65a923a88737f67fa6`; code `9e74109fb74420cc6360bbcf5c0b85e18b844861`; reviewed candidate `f668c6f60a3bc9ca1b56722603fb682839e578dc`. Read-only staging observed at `6d717fe8f143bda8eaf198732400cfc21918cf0b`.
- Reviewer `C:/Users/kvina/.codex/worktrees/point-review/3d-ulpin`, branch `task/desktop-packet-region-review`; prior completed review branch/checkpoint `875ae6b9798090175bc644b1cd92583a6b2e82a3` preserved. Own only this report and private evidence below.
- Read the standing entry documents, review/implementation assignments, H10, source index/catalogue, candidate handoff, nine new code/test files and the relevant unchanged authority, scratch, admission and supervisor dependencies. Applied the PDF skill to the retained crop inspection. Existing source/OCR/security reviews were reused.
- Requested Astra/xhigh/default-standard; actual model/effort/request tier unexposed. Supplied permissions `never` / `danger-full-access`. No settings changes or delegation.

## Findings

### R1 — [P2] Bind the recipe to the code actually admitted and executed

Primary location: `packages/server/src/modules/usp/packets/region-runtime.ts:13–16`; matching Python recipe at `services/geo/geo/usp_packet_regions.py:20–23`, imported admission helper at `:63–64`, version/asset checks at `:69–75`.

The four-file digest omits `run_pdf_pages.py`, whose `_deny_external_files` determines JavaScript/external-resource admission. It also hashes Python source while normal imports can execute a valid cached bytecode file with different behaviour. The version strings and PDFium DLL hash do not detect either case. Thus the service's before/after recipe equality does not establish which admission/render code produced the PNG.

**Reproduction:** `reproduce.py` copied the exact owner bytes into the private review directory and ran the unchanged CLI/Windows Job supervisor against a generated 40-point colour PDF. No shared file/cache or operational source was changed.

1. The normal annotated control returned green pixels with annotations excluded. Adding a harmless JavaScript OpenAction returned `PACKET_REGION_ACTIVE_OR_EXTERNAL_UNSUPPORTED`.
2. Changing only the copied, omitted admission helper to return without checking made that same active input succeed with the unchanged recipe `e644a74b6c814a49b4a5278081f07bc65db6802f8b18034e13ff4a356b0f6155`.
3. After restoring the helper, a timestamp/size-valid cached renderer with `FPDF_ANNOT` enabled rendered **2,700 blue annotation pixels** into the 60 × 60 crop. Every recipe source byte remained unchanged; the result still declared `annotations: excluded` and the same recipe and renderer pins. Disabling bytecode writes did not stop existing bytecode reads.
4. `protocol-controls.mts` passed both resulting PNG/result pairs through the actual `PacketRegionService` with technical authority dependencies. Both returned after all three authority checks, exact transform/hash/schema and clean-PNG validation. No current HTTP/SQL authority is claimed by this control.

This demonstrates host code/cache drift defeating the new leaf's integrity claim, **not an exploit achievable by uploading a PDF**. The active JavaScript was not executed. Pin the complete executable admission/render dependency set and ensure execution uses those verified bytes; a narrow leaf-owned loader or verified immutable runtime can address this without changing the shared supervisor. Include resolved runtime dependencies in that boundary rather than relying solely on distribution version text. Correcting only the missing filename leaves the demonstrated cache case open. Add focused controls for both cases.

### R2 — [P2] Preserve and block on supervisor-reported cleanup failure

Primary location: `packages/server/src/modules/usp/packets/region-runtime.ts:63–68`, with unconditional cleanup at `:83`; CLI propagation at `scripts/usp/document-models/run_packet_region.py:70–76`.

Only rejection of Node's `execute()` sets `keep` and `blocked`. The existing supervisor can instead raise `owned_process_tree_survived_shutdown`, `bounded_log_reader_survived_shutdown`, or a termination error; the new CLI lets that exception exit normally with a nonzero process code and no trustworthy completion receipt. Node resolves on the supervisor process's close, classifies missing artifacts as `PACKET_REGION_RUNTIME_FAILED`, schedules the private attempt for removal and permits the next launch. Supervisor exit alone is not confirmation that its owned tree cleaned up.

**Reproduction:** the protocol control executed the unedited runtime source with imports directed to the private copy/scratch. A real CLI child received an injected `_run_worker` exception `owned_process_tree_survived_shutdown`. Two consecutive calls each returned generic 503, both attempts were scheduled for removal, and `assertPacketRegionRuntime()` continued to succeed. Scratch removal was intercepted to preserve evidence; **no surviving native child was deliberately created**. This is a demonstrated error-propagation/state defect, not a claim that the successful render leaked a process.

Propagate a distinct, bounded cleanup outcome from the leaf CLI and require positive cleanup confirmation before releasing admission/removing an attempt when supervisor termination is uncertain. Retain the attempt and set the existing blocked state on that path; ordinary completed PDF refusals should still release admission. Cover supervisor exceptions as well as Node timeout rejection.

## Checks and retained observation

Source authorization is reused from `documentPageAuthorityTx`: current retained family/revision/hash, canonical subject/access binding and authority fingerprint. The new service rechecks after source I/O and immediately before publication. Source bytes/hash, exact selection, independent inward transform, RGB PNG dimensions/chunks/CRCs and output hash are checked. The controller has the private guard, no-store/nosniff, fixed filename and safe provenance projection. No additional finding was established in these paths.

Reused pinned logs/receipts, without rerunning their campaigns: **five service controls, one controller/Swagger control without a listener, three Python controls, API typecheck, saved projection validation**, all recorded exit 0. Python controls cover nonzero CropBox and 0/90-degree display rotation, selected/adjacent colour fields, annotations, metadata/attachments, source/frame rejection and active/forms rejection. The retained wrong-CropBox run exited 1 with `PACKET_REGION_FRAME_MISMATCH` and no PNG.

Independently viewed the retained Haryana T3-1 title/date/sheet crop; it is legible and shows the selected block. Original **1,655,334 bytes**, SHA `2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865`; crop **795 × 405**, **123,120 bytes**, SHA `b9b6b487ac309582dc79fa03b2651e0698c5f68f8b6eb4fb27f632b658266d7c`. Independently reconciled PNG CRCs/allowed chunks/decompressed scanline size, canvas `[7758,5085]`, region `[6795,4635,7590,5040]` and affine `[1/3,0,0,1/3,2265,1545]`. Included normalized bounds stay inside the acknowledged selection. No new operational render or OCR was performed.

The saved successful native crop had gated start, exit 0, 0.531 s, peak Job private 117,854,208 bytes and RSS 131,948,544 bytes. Additionally, one fresh technical sleeping process tree exercised the **unchanged native supervisor's actual timeout**: `runtime_cap_exceeded`, exit 1, 1.031 s, Job peak 17,666,048 bytes, RSS 40,964,096 bytes; both recorded PIDs were gone. The Job gate, kill-on-close and normal timeout cleanup are supported by this control. It does not close R2's exceptional path. Final owned-process observation was empty.

## Evidence and reproducibility

Private root: `E:/BhuAayam-data/task-data/desktop-packet-region-review-20261002/`. It contains isolated technical PDFs/copies/cache, supervised outputs, native timeout proof, protocol fault injection, scripts and hashes. Originals remain under the owner's unchanged evidence root. Final reconciliation matched the source, **47 historical files, five unchanged dependencies, nine code files and 27 saved artifacts**; nine candidate Git pins also matched.

| Review artifact | SHA-256 |
| --- | --- |
| `reproduction.json` | `44762627028ccf200960457467ec31823a85aad8fd4e021c3d906eff4dd083be` |
| `protocol-controls.json` | `2ef8ec4667f6ef11198d8de62f9e01d510c7892165e051b848b63e03593ddff8` |
| `final-verification.json` (15,853 bytes) | `75622e5bc880749d80a9f0ade97068a7d6f8ea4edfb198ee3a88c8d3cfd78e33` |

Fresh commands, run from the reviewer checkout:

- `E:/BhuAayam-data/task-data/desktop-ai04f-docling-tesseract/venv/Scripts/python.exe -B E:/BhuAayam-data/task-data/desktop-packet-region-review-20261002/reproduce.py` — exit 0.
- `pnpm exec tsx E:/BhuAayam-data/task-data/desktop-packet-region-review-20261002/protocol-controls.mts` — first exit 1 before controls because Windows ESM imports needed file URLs; corrected harness exit 0. This was a harness error, not a product failure.
- The same Python with `-B E:/BhuAayam-data/task-data/desktop-packet-region-review-20261002/finalize-evidence.py` — exit 0; final deterministic pass added the line-ending reconciliation.

Physical recipe hashes differ solely through line endings: executed owner/copy `e644a74b6c814a49b4a5278081f07bc65db6802f8b18034e13ff4a356b0f6155`; reviewer checkout `3eb7167e7569cf677f31e219d98d5bbd3808290e0b182ec56ad63fb0a11288b0`; candidate Git bytes `d19b61cab6cdf94026fbd3330a67d79d42e6bd8ff62b1aba2d0aed6f3b75c0ff`. Comparisons normalized line endings only to explain this difference; no source or historical execution pin was rewritten. Retained owner `verification.json` still hashes to `a6f8097132e16044428404f4d7860bc59eb84b088513258d6601beb7faed732a`.

## Boundaries and return

The leaf remains unregistered in production `EvidenceModule`; that is lead-owned integration after correction. No services/listeners, database/Docker, model/GPU/provider, source acquisition, frontend/generated file changes, push or deployment occurred. Installed runtime assets were read, never changed. No complete interpreter/package executable-integrity or OS network-containment qualification follows; Python socket monkeypatching is not OS containment.

Natural official rotated/nonzero-origin coverage remains absent. Source preview establishes no property applicability, approved revision, immutable packet/export/card, release or GF4 qualification. Return this report and the two focused correction requests to the lead; preserve retained successful proof and close only the observed failures.
