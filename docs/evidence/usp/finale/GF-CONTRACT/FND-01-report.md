# FND-01 · GF0 contract and seam inventory

## Assignment and scope

- Assignment `FND-01`, attempt 1, callback `ulpin-FND-01-attempt-1`.
- Worker `01a0d5d3-c8dd-7472-8ea4-4decef30f0c7` on host `local`; requested and observed agent `Codex/gpt-6-sol/high`. This turn's own `turn_context` metadata reports `model=gpt-6-sol`, `effort=high`.
- Accepted base `10503934234055faf5dc23f26007b717062b68bf`; isolated worktree `/Users/vinayak/.codex/worktrees/51a5/3D Ulpin`; branch `agent/FND-01-contract-inventory` created from that exact base without reset or merge.
- Inventory implementation commit tested: `dfe0d36e078f696918c21a73cbc596347c480abb`. The final evidence/H01 annotation commit follows it; no application, schema, migration, dependency, data, credential or historical receipt was edited.
- Owned changes: `scripts/usp/gf/GF-CONTRACT.mjs`, `tests/usp-gf-contract.test.mjs`, this `GF-CONTRACT/` evidence folder and section 10 status annotations only in `docs/usp-agent-handoffs/01-shared-contracts-and-ownership.md`.

## Current interfaces and findings

[`inventory.json`](inventory.json) records all seven seams with producer, production consumer when present, contract, test command, source-file hashes, status and limitation. [`GF-CONTRACT.mjs`](../../../../../scripts/usp/gf/GF-CONTRACT.mjs) regenerates and checks it against current files and markers. Its focused test removes consumer/test files and changes producer bytes to prove the inventory fails on missing or stale evidence. A static marker is presence evidence, not a runtime pass.

| Seam | Status | Main finding |
| --- | --- | --- |
| Schema | `partial` | Current `usp/1` snapshot/job DTOs have route consumers; several declared `UspPorts` still lack live bindings. |
| Registry | `works` | Pinned snapshot capture/read has a real local route and a current isolated D0 integration result. Page-two/mutation stability remains a separate test gap. |
| Source | `works` | Original and exact-part reads use current source pins and hash checks. PACK0 is text/CSV, not PDF qualification. |
| Geometry | `partial` | The retained D1 CityJSON exterior traverses the shared Cesium viewport; local shape/identity qualify only for this one source. |
| Job | `partial` | SQL fencing works in the isolated fixture; no production caller of `claimUspJobAttempt`/`acceptUspJobAttempt` was found. The test runner is not dispatcher integration. |
| SSE | `missing` | The ordered outbox writer exists, but no USP outbox delivery/SSE route or production stream consumer was found. |
| UI | `partial` | Current functional Studio D0/PACK0/D1 flows pass locally. Formal UI work is deferred; full selection/cache/access behavior is not qualified here. |

H01 section 10 items 1–6 are annotated as `remaining`, `remaining`, `remaining`, `remaining`, `done@dfe0d36e078f696918c21a73cbc596347c480abb`, `remaining`. Item 5 is limited to the local V0/PACK0 functional path. The other items need the specific listed fixture, mutation, fault-injection, dispatcher or feature-adapter evidence; the present runner does not silently close them.

## Fresh checks at the implementation commit

| Command | Exit | Result |
| --- | ---: | --- |
| `node scripts/usp/gf/GF-CONTRACT.mjs --write` | 0 | Seven-row source inventory generated. |
| `node --test tests/usp-gf-contract.test.mjs` | 0 | 3 focused tests passed. |
| `node scripts/usp/gf/GF-CONTRACT.mjs --check` | 0 | Inventory matched current source. |
| `pnpm install --frozen-lockfile` | 0 | Lockfile reused; no dependency declaration changed. |
| `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-*.test.ts` | 0 | 101 passed, 0 failed/skipped. |
| `pnpm typecheck` | 0 | TypeScript passed. |
| `pnpm build` | 0 | Production build passed; existing GeoTIFF `web-worker` dynamic-dependency warning remains. |
| `node scripts/usp/local-isolation.mjs --run` | 0 | 19 recorded commands exited 0, including guarded owned-service cleanup; 3 browser tests passed with 0 skipped, unexpected or flaky. |
| `pnpm test:register-scope` | 0 | 3 focused scope tests passed. |

The isolation runner was inspected before execution. It refused a repository `.env`, generated a unique loopback Compose project/database/bucket, checked the project and volumes were absent, checked its fixed ports were free, verified retained bytes, restored only into its new database, compared table hashes through D0/D1 replay, and cleaned only its owned services. No linked environment, populated volume or provider was used. `pnpm test:registry` was not run: its script targets a fixed live port and mutates a seeded registry, while the isolated runner already exercised the relevant fresh services safely.

The saved sanitized [`run-summary.json`](run-summary.json) pins the actual code revision, all 19 command names/exits, source hashes, D0/PACK0 locators, job fences, D1 identity, browser statistics and original raw-receipt hashes. The retained D0 manifest SHA-256 is `2be6119d9bac27c5f1ce273ab1aad093ff623e2a4ff72c13892e0d43c70a619f`; D1 manifest is `1cf9ebb88700669c3eb64e6b7a55c5edd7a176c44d7ecce63b188a0767250b71`; original D1 bytes are `5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2`. D0 selected `line 3`, `line 5`, `CSV row 2`, `CSV row 4` and rejected the cross-building selection with `invalid_vertical_membership`. D1 retained native building ID `NL.IMBAG.Pand.1655100000500568`, its roof-face identity and unavailable interiors.

Fresh screenshots are [`d0-neighbourhood-desktop.png`](d0-neighbourhood-desktop.png), [`d0-packet-reloaded.png`](d0-packet-reloaded.png) and [`d1-roof-desktop.png`](d1-roof-desktop.png). I inspected these images; the D1 view labels local metres, unqualified global placement and unavailable interiors. [`artifact-manifest.json`](artifact-manifest.json) hashes the inventory, sanitized summary and screenshots. The raw local receipt and browser report remain untracked under `.runtime/` and `test-results/`; their SHA-256 values are pinned in the sanitized summary.

Historical comparison only: `docs/evidence/usp/fnd/d0/{isolated-local-receipt,d0-live-receipt}.json` and `docs/evidence/usp/continuation-2026-09-23/final/{isolated-live-receipt,browser-summary}.json` were not overwritten. This run supplies new evidence at `dfe0d36` rather than reusing historical passes.

## Qualification boundary and next bounded work

The present evidence supports code/unit checks and one isolated local D0/PACK0 plus single-real-D1 journey. It does not pass the whole GF-CONTRACT/GF0 gate: SSE delivery is missing; USP job production dispatch, H01's fault/mutation matrices and several port bindings remain open. Source accuracy beyond the retained D1 roof, analytical volume, global placement, GPU/scale performance, protected access, provider permission and deployment were not tested. Independent review and lead acceptance are pending.

Suggested narrow follow-ups are a production USP job-dispatch/fence integration with an expiry/cancel acceptance test; an ordered outbox delivery/SSE route with replay and polling fallback; and independent snapshot pagination/mutation plus atomic fault-injection tests. These require explicit ownership from the lead before any shared application edits.
