# FND-06 attempt 2 — privacy corrections and manual preview hold

- Pinned base: review commit `31fcc015c07d0aeff2d98ef12a9b028956d71f3d`, which includes the Astra FND-06 attempt-1 findings.
- Code commit: `ec0a0459d515dca241a9a294c3cf8db3194f864c` on `agent/FND-06-privacy-fix` in `/Users/vinayak/.codex/worktrees/ulpin-sol-fnd06-fix/3D Ulpin`.
- Requested lane: Codex GPT-6 Sol, high effort. This task exposed no trustworthy selected-model/effort metadata, so observed settings remain unverified.

## Finding dispositions

| Finding | Correction |
| --- | --- |
| P1: numeric JSON text bypassed masking and untrusted provider output retained arbitrary numeric leaves | The shared derivative visitor now masks identifier-shaped JSON number tokens before parsing, while keeping legitimate JSON structure. Historic document part text, native extraction text and outbound messages use this boundary. `callNous` retains only approved extraction fields, bounds typed numeric measurements and geometry, and replaces unsupported values. Hash receipts still omit the upstream envelope. Existing domain numbers remain numeric outside untrusted text/provider boundaries. |
| P2: generic apply-response redaction changed technical package and feature names | The apply route now uses a typed `ImportPackage` response path based on the canonical package-read document projection. It preserves technical names, geometry and revisions while masking document part text, locators, question/answer prose and warnings. The generic personal-key redactor remains strict for untrusted provider objects. |
| Manual preview setup gap | `node scripts/usp/local-isolation.mjs --privacy-hold` reuses the pinned snapshot, original-byte, nonce-owned Compose, migration and egress preflight. It skips automated browser capture, emits the localhost app URL, committed code pin, nonce and stop instruction, then holds until SIGINT/SIGTERM. On stop it checks retained objects and tables and runs the existing owned-only cleanup. A dirty worktree cannot advertise a misleading code pin. Default `--privacy-run` behavior is unchanged. |

No original bytes, linked services, provider credentials or public routes were changed. No live provider call was made.

## Checks

| Command or check | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit 0, 226 packages reused; lockfile unchanged. |
| `pnpm typecheck` | First run exit 2 for a duplicate import introduced in this attempt; fixed, second run exit 0. |
| `pnpm exec tsx --test tests/ai-extraction/grounding.test.ts` | Exit 0, 22 existing tests pass. Updated the three stale policy expectations and added assertions to an existing redaction test using its preexisting historic input. No new source fixture was authored. |
| `pnpm exec tsx --test scripts/usp/gf/FND-06-controls.test.ts` | Exit 0, six control tests pass, including zero-network denied cases. |
| `node --check` on the two changed isolation scripts | Exit 0 each. |
| Clean-pin `--privacy-hold` start/stop | Exit 0. Ready at `http://127.0.0.1:3108` with code pin `ec0a0459d515dca241a9a294c3cf8db3194f864c`, nonce `local-5dd059c5a4c6e9d1`; SIGINT ended as `STOPPED_INTEGRITY_PASSED`. The [runner receipt](local-5dd059c5a4c6e9d1/runner-receipt.json) records 44 table digests and 497 unchanged objects, one explicit jobs migration delta, zero provider attempts and zero dispatched non-loopback fetches. The owned Compose project/volumes and port 3108 were removed. No UI journey was run in this smoke. |
| `pnpm build` | Exit 0 under the existing port-3000 guard, Next.js 16.3.5/webpack. Existing `web-worker` dynamic-dependency and disabled-optimization warnings remain. |
| Compiled production Host probe at port 3108 | For `/`, `/api/v1/health`, `/icon.svg` and `/_next/static/chunks/9021.507420ed983c5308.js`, forged `localhost.evil:3108` returned 403 each; canonical `127.0.0.1:3108` returned 307, 503, 200 and 200. The canonical API's 503 reflects missing DB/storage in this bounded check; it does not qualify API function. The owned production server was stopped. |

The first hold smoke ran on a dirty precommit worktree and was discarded as a code-pin receipt; the clean-pin run above is the retained evidence. Real identity detection accuracy, image/EXIF redaction, full derivative coverage, physical India residency, provider permission and independent milestone acceptance remain open. Luna's separate manual UI journey should use this committed branch; this report does not substitute for it.

## Manual tester handoff

From a clean checkout at code pin `ec0a0459d515dca241a9a294c3cf8db3194f864c`, run `node scripts/usp/local-isolation.mjs --privacy-hold`. Wait for `READY_FOR_MANUAL`, open the emitted `appUrl` in desktop light mode, then interrupt the foreground command or send SIGTERM to its reported runner PID. The final receipt should say `STOPPED_INTEGRITY_PASSED`; confirm no owned containers or volumes remain. Do not reuse the nonce or port while another preview is running.
