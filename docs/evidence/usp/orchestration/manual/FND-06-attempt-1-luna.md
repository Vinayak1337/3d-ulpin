# FND-06 attempt 1 — Luna manual UI check

## Result

**Blocked before live UI interaction.** No product UI defect was observed or ruled out; this is a preview setup gap, not a manual pass.

- Assigned code pin: `66e3dffb9c653d52a13b8ee2046f3c72b550f587`.
- Result/report base: `bc115d2bc4815a2d91b7a44a286a0ed48c75cfd3`.
- Worktree: `/Users/vinayak/.codex/worktrees/manual-fnd06-attempt-1-luna`, branch `manual/FND-06-attempt-1-luna`.
- Lane requested: GPT-6 Luna, xhigh. Per-turn model/effort metadata was not exposed here, so the applied setting is unverified.
- App URL / viewport: none; no preview was started and no computer-use browser steps were performed.

## Setup gap

The existing `node scripts/usp/local-isolation.mjs --privacy-run` always runs `scripts/usp/gf/FND-06-isolated.mjs`. That runner starts Next on `127.0.0.1:3108`, invokes `scripts/usp/gf/FND-06-browser.mjs`, then terminates Next and removes its nonce-owned Compose services in `finally`. The existing `--preview-run` path similarly invokes `scripts/usp/ui/UI-03-isolated-preview.mjs`, which runs automated Playwright captures and tears down the server and owned services. Neither path offers a hold-open mode for manual interaction.

Running either path would repeat automated browser captures already covered by the pinned report. The smallest useful setup addition is an explicitly guarded option that performs the same unchanged, hash-pinned snapshot restore into verified empty nonce-owned services, starts the loopback preview on port 3108, and leaves that preview available for manual interaction until an explicit cleanup action. No runner or application code was changed here.

## Requested UI coverage

These checks were **not attempted** because no live preview could be kept open:

| Step | Expected | Actual |
| --- | --- | --- |
| Open `http://127.0.0.1:3108`, navigate Batches / Map, open Local workspace status | Real local app loads the changed workspace status UI | No running preview URL was available |
| Read provider, service, and residency copy at desktop and enlarged layout | Honest blocked/unverified states remain visible without clipping | Not live-tested |
| Close the status panel with the keyboard and verify focus return | Keyboard close works and focus returns to the opener | Not live-tested |
| Reach an AI-unavailable/native-preparation path from unchanged saved records | Native preparation remains available while AI is unavailable | Not live-tested; no records were altered or supplied |

The existing automated screenshots at [desktop](../../finale/GF-PRIVACY/FND-06/attempt-1/local-f241696bc6e812f7/screenshots/workspace-processing-status.png) and [200% viewport equivalent](../../finale/GF-PRIVACY/FND-06/attempt-1/local-f241696bc6e812f7/screenshots/workspace-processing-200-percent.png) are context only. Their visible status copy states that services use loopback addresses, physical hosting location and full data residency are unverified, non-India AI access is blocked, native preparation remains available, and image egress is blocked pending visual redaction qualification. The enlarged screenshot appears to keep that copy within the panel. These prior automated captures do not establish a live manual result, keyboard behavior, or the saved-record preparation path.

## Cleanup and scope

No preview process, service, container, volume, or port was claimed or created by this check; there was nothing to clean up. The original checkout's protected staged edits were left untouched. This worktree contains only this report. No import, mutation, provider request, seed, reset, code change, or test run was made.
