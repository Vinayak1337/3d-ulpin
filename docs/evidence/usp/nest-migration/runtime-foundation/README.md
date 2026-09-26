# Nest foundation runtime — phase 2A

Observed on 26 September 2026 from accepted staging `055534deb93eef0b85e8251b88cc40bc9a691fec`, with runtime code `40d70cbf20c7d32d0263839bf157d1b14e0bf1ed`. The [receipt](phase-2a-2026-09-26.json) contains commands/exits, SQL metadata, code/image hashes, resource identities and cleanup results without credentials.

## Observed result

| Check | Result |
| --- | --- |
| Frozen install and API build/typecheck | Exit 0 |
| Fresh canonical SQL migration and private bucket setup | Exit 0 during startup |
| Repeat migration in the same database, without reset | Exit 0; selected schema/ledger/role metadata unchanged |
| Nest health | HTTP 200; database, storage, processor, Redis and worker ready |
| Owned processor stop/restart | Health degraded honestly, then all five checks recovered |
| Owned API/dispatcher and container shutdown | Exit 0; both PGIDs empty, no labelled containers or checked listeners |

The database contains 64 public tables, one display table, three USP migration markers, five restricted reader roles and six retained `NOT VALID` geometry constraints. The checked cases, sources, jobs, registry records and physical features contain zero rows. This is fresh schema execution, not populated-data or job-processing qualification.

## Owned environment

- Nonce/project/bucket: `17d34069655413cd` / `ulpin-usptest-17d34069655413cd`.
- Database: `ulpin_usptest_17d34069655413cd`.
- API was `http://127.0.0.1:3188/`; listener PID `31942` belonged to API PGID `31529`. Dispatcher PGID was `31412`.
- The API's `dataMode=linked` label follows `REPO_DATA=false`; every configured endpoint was the exact fresh local nonce environment, with no root `.env`.
- Services are now stopped. The project's `postgres-data`, `minio-data` and `redis-data` named volumes are preserved. Private run files remain under `.runtime/run01/17d34069655413cd/`.
- Resuming this nonce requires its original clean checkout at recorded code pin `40d70cbf20c7d32d0263839bf157d1b14e0bf1ed`; a newer integrated revision needs a fresh nonce.

The first nonce `c31323ea907abb8d` failed before service creation because this Docker CLI has no Compose subcommand. The runner was corrected to the installed `docker-compose` 5.5.1 interface and committed before preparing the successful fresh nonce. The failed nonce had zero labelled containers/volumes and no API listener.

## Remaining qualification

The source smoke gate is still closed. No source endpoint, import, operational record, UI, provider or inference was exercised. The source-to-job-to-record receipt, domain-controller runtime, real-source accuracy, populated migration, learning, performance and deployment remain pending. This bounded foundation receipt does not pass complete GF-BACKEND.
