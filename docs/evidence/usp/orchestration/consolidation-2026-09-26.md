# Local staging consolidation — 26 September 2026

The original checkout at `/Users/vinayak/Desktop/3D Ulpin` is the sole registered worktree. Local `staging` merged the finale integration branch, FND-03 exchange correction, FND-06 scalar/privacy and persistent preview corrections, UI-08 priority/provenance correction, three risk reviews, and three manual/data reports. The preview branch's duplicate cherry-picked patches were recorded by an `ours` merge after patch-equivalence checks; its code was already present in the corrected integration. Merge head before this receipt: `4e7588de69e583a8063ea029e42d9637502e5ec2`.

All 20 removed worktrees had branch heads reachable from `staging` before removal. The remaining unmerged local branches were inspected: `agent/BOOT-001-callback` has a patch-equivalent report already integrated; `agent/UI-08-record-backed-content` and `docs/design-mockup` are earlier superseded work whose old trees would replace later guarded code and evidence; `agent/DATA-02-adversarial-fixtures` contains synthetic fixtures barred by the 25 September source rule; `main` was deliberately unchanged. Their branch refs remain available. No remote push, deployment, provider call, volume reset or data reseed occurred.

Before consolidation, the original index and working-tree patches, guide, branch/worktree inventory and non-build unique ignored evidence were copied under `/Users/vinayak/.codex/backups/ulpin-consolidation-20260926` with private directory permissions. The original user's skill and `AGENTS.md` edits remain staged; the original unstaged guide pointer and untracked guide became identical tracked content through the merged branch. The retained WIP stash is pinned at `refs/backup/ulpin-user-wip-20260926`; the prior local staging tip is `backup/ulpin-pre-consolidation-20260926`.

## Verification

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Exit 0 |
| `pnpm exec tsx --test tests/ai-extraction/grounding.test.ts` | Exit 0; 22 passed |
| `node --test tests/engineering-isolation.test.mjs` | Exit 0; 31 passed |
| `git diff --check` and `git diff --cached --check` | Exit 0 |
| `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs 80e1e9cf46a49eefb1d4024efe14f82c177ec85d` | Exit 0; 1,239 added web lines scanned, no candidates |
| `git worktree list --porcelain` | One checkout after removal |

## UI design check

**Blocking:** None found in the merged code scan. **Design system:** No literal colour/font, banned provenance word, placeholder, icon-library or theme-switch candidate was found. **Checked, no issue:** The merged work queue and saved dataset surfaces read classification from stored provenance through `sourceClassificationLabel`; the live Studio work route returns 200. This is a bounded handoff check, not a new manual V-shot acceptance or real-source accuracy qualification.

## Preview verification and shutdown

The guarded app-only launcher points to the original checkout. Before shutdown, it served `http://127.0.0.1:3187/studio/work` from local `staging@9e7a7ad19b2e6af545da304403dcd7f551cbfe33`; the Studio route returned 200, database and storage health were true, the linked work queue total remained 38, and a forged Host returned 403. Provider egress was disabled. The user then released the standing preview. Verified app PID 51364 and its listener stopped, and the three nonce-owned isolated PostgreSQL, MinIO and Redis containers stopped without deleting their volumes or data. Port 3187 is no longer serving. Manual UI acceptance, official-source accuracy and milestone release gates are still open.
