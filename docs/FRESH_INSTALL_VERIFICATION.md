# Fresh local data installation rehearsal

**Passed on 15 September 2026** (14 September, 19:10:27–19:11:23 UTC). This is T10 evidence for starting an empty local data stack using the installed dependencies, current local geo image and an existing production build. It does not claim installation on a clean operating system or a new provider download.

The executable harness is [`scripts/verify-fresh-install.ts`](../scripts/verify-fresh-install.ts). Its standalone TypeScript check passed before execution. The successful run used production build `k1R1Ws5OofY3qu4akUMfJ` and project `ulpin-fresh-20260914191027-19c1fefe`.

## Isolation and executed result

The harness copied Compose to a private temporary directory, selected an explicit unique project name, and gave PostgreSQL, MinIO and Redis new explicit volume names. It verified the alternate ports were free before allocating services. Credentials were read from the existing local setup in memory and were not printed or placed in the report.

| Service | Separate loopback port |
| --- | ---: |
| PostgreSQL | 25432 |
| MinIO API / console | 29000 / 29001 |
| Redis | 26379 |
| Private geo processor | 28000 |
| Production web | 3001 |

The second web and job dispatcher used the new database, private bucket, processor and Redis endpoints. No application table existed before migration. The private bucket upload/readback/privacy check passed. Web health then reported database, storage, processor, Redis and worker ready.

The saved acquisition API loaded the unchanged **62-building NYC snapshot**. Normalization preserved observed exterior geometry and source identifiers; no current observations appeared before review and commit. The source bytes served by the application matched the catalog SHA-256:

```text
869c5dc4fb50d71be4f62f4a2936c29bd95ade14c712bdf4f51986841d82771a
```

Review produced an input fingerprint, commit recorded all 62 exteriors, and the selected building had no fabricated detailed floors or spaces. The real-data check produced no vertical collision volume. A browser selected the saved map area and searched source identifier `353927`; the resulting dossier referenced that exact canonical building ID, with no browser runtime error.

The existing `scripts/verify-officer.ts` then passed against the isolated API/database/storage endpoints. This exercised authored synthetic geometry, native CSV plan/level candidates, reviewed preparation, dispatcher/Celery builds, detailed publication under existing reserved property identities, investigation and export regressions. Those synthetic fixtures remain separate from the real 62-building snapshot and were cleaned by their verifier.

All isolated services, the second web and its dispatcher were stopped. The same new volumes were reopened, migrations repeated, and all services restarted. The harness verified identical 62 feature IDs, registry identifiers and source keys, the identical committed package, the retained non-stale area check, and unchanged original hashes. Browser source-ID search opened the same property's dossier again.

Finally, the harness removed **only its newly allocated project containers, network and volumes** and confirmed no containers or volumes remained under that project's label. Port 3001 had no listener afterward. The operator's PostgreSQL, Redis and MinIO containers remained healthy with their prior uptime.

## Evidence and limits

The sanitized report and browser captures are local verification artifacts:

- [`report.json`](evidence/fresh-install-report.json)
- [`before-restart.png`](evidence/fresh-install/before-restart.png)
- [`after-restart.png`](evidence/fresh-install/after-restart.png)

The screenshots were captured immediately after the dossier response. They verify the same-property interaction, but the Cesium region was still blank in those captures. They are **not evidence of completed 3D rendering or frame rate**; the dedicated viewer/performance verification must establish that separately. No surveyed Indian utility depth, live GMDA acquisition, real utility collision or unrestricted native file coverage is claimed by this rehearsal.

## Repeat

Once the production build is ready and the alternate ports are free:

```sh
pnpm exec tsx scripts/verify-fresh-install.ts
```

For coordinated work, `--wait-for-build` starts and migrates the isolated services, then prints a `BUILD_GATE` marker path. Create that marker only after the production build is complete. Avoid rebuilding the shared `.next` output while this rehearsal's production server is using it. Each run writes a separate report and removes only its allocated resources in `finally`; if cleanup fails, the report identifies the isolated project requiring attention.
