# FND isolated live receipt — 23 September 2026

Run: [USP foundation CI 35830812877](https://github.com/Vinayak1337/3d-ulpin/actions/runs/35830812877), job `isolated-live` **passed**. The checkout was GitHub's PR merge SHA `612a1606c6d54565b6085d4a7cc133c34efeb04b`; branch head for this run was `15388e7`. This used a disposable hosted PostgreSQL/PostGIS, MinIO/S3 and local production Next server, not the linked private PC. The run verified all 44 restored table hashes and 497 retained original object hashes, applied `pnpm db:migrate` through `scripts/migrate.ts` twice, and cleaned up only its own Compose project.

| Receipt | Observed value |
| --- | --- |
| Synthetic baseline | Retained Nandan site `c65e220d-bb6c-4bb0-9fff-8c140789602b`; **not** the full D0 pack |
| Original | 6,228 bytes; SHA-256 `56a25a4b687876612d2367afe3032562e91ababd6302cb6f8fd606041f64972a` matched the source row and HTTP download |
| Exact snapshot | `2fd5b14e-1be1-492d-81a0-edc2f3654554`; digest `168fd1e1aafc93444003d0ece2be8641907ee6fd09fcbd9307cf1c951f1d9bdd` |
| Target | `3588021e-af7b-457c-8bdb-5c6f849c027e`; reviewed registry revision 1 → 2, historical revision still readable |
| PACK0 | `0c10fcef-cc1b-47f7-9768-6ebe115d2937`; saved artifact SHA-256 `fcaaeaccb58a32419c5732edbbdc9012431a787860113556577d6430a0257942`; status **incomplete** because the legacy locator did not identify one exact extracted part |
| Commit | `9920c15d-1968-431e-842c-f4c9dbdfd1e9`; ordered outbox `registry:c65e220d-bb6c-4bb0-9fff-8c140789602b` sequence `2` |
| SQL job attempts | `b27053c3-1f84-464b-b76d-1f33f4489512` fences 1 → 2; stale fence 1 rejected, fence 2 accepted once and replayed; separate cancelled job `77043e07-4975-40e3-a231-76604c3f333c` rejected late completion |

Executed hosted commands (exit 0): `docker ... compose up --wait`, `pg_restore --single-transaction`, `node --import tsx scripts/migrate.ts` twice, `node --import tsx scripts/usp/verify-live.ts`, and owned-project `docker ... compose down --volumes`. The artifact `usp-fnd-isolated-35830812877-1` contains the sanitized `usp-fnd-live.json` and `usp-live/receipt.json` with command exit codes. The contract CI job in the same run also passed.

Independent local commands passed: `pnpm typecheck`; `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-contract-producers.test.ts tests/usp-foundation.test.ts tests/usp-data-pack.test.ts` (69); `pnpm test:studio` (55); `pnpm test:register-scope` (3); `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/core-*.test.ts` (296); `pnpm test:repo-data` (2); `pnpm exec tsx scripts/usp/data/verify-pack.ts fixtures/usp/D0/contract-smoke/manifest.json`; and `pnpm build`. The contract-smoke pack checked 1,182 declared bytes only.

**Open gates:** DATA's complete D0 pack and exact part locators, UI's live Studio mount/reload/browser V0, real D1 roof render, Redis/worker delivery for `usp:` jobs, multipart upload promotion, private derivative grants and release revocation, and F2/public deployment. The separate inherited `ulpin-integration-baseline` check stops before services at the historical planning validator's missing `sequence`; an earlier baseline attempt also exposed a pre-existing `jobs.started_at` mismatch in the Uttam Nagar bundle installer. Neither check is used as evidence for this FND receipt.
