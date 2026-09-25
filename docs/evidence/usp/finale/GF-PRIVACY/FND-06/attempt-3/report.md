# FND-06 attempt 3 — standalone JSON numeric text

- Base: `b09e1b4c870480cb9b21ced568159a68552a67f4` (Astra attempt-2 review); branch `agent/FND-06-scalar-json-fix`; worktree `/Users/vinayak/.codex/worktrees/ulpin-sol-fnd06-scalar/3D Ulpin`.
- Code: `727e506064321dff76ba72c7374fd68d22cf2b5a`.
- Agent: Codex / requested `gpt-6-sol` / medium. Actual model and effort were not independently observable in this task.

The string visitor now sends valid standalone JSON numeric text, including exponent notation, through the existing pre-parse number masker. Object and array paths remain as before. Typed numeric domain fields are untouched. The retained grounding identifier is reused to derive exponent text; no new record or fixture was created. The assertion checks both message text and historic document part projection.

Checks on this code pin: `pnpm install --frozen-lockfile --offline --silent` exit 0; `pnpm exec tsx --test tests/ai-extraction/grounding.test.ts` exit 0 (22/22); `pnpm typecheck` exit 0; `git diff --check` exit 0. This is a narrow text-boundary regression, not qualification of real personal-data detection or the full GF-PRIVACY gate. No provider call, service, container, port, preview restart, data mutation or deployment occurred. Persistent preview 3187 remains on its earlier code pin.
