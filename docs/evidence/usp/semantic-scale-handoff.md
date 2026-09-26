# SCALE-01 bounded measurement handoff

The cold/warm pair met every prospective local budget. The overall run failed before natural recovery admission: preserving six completed display jobs from the pair leaves only two of the existing eight history slots, while another semantic source reserves three. Its POST returned429 `MVT_RETENTION_BUDGET`; no recovery job/attempt, dispatcher interruption or natural expiry was observed. This is an incompatible three-source workload in one retained-history runtime, not evidence of broken recovery. No cap was increased, history retired, timestamp edited, lease shortened or pair rerun.

Implementation `eaec89c831a7fd5504ef0f38ad85c3c88e11b6e3`, based on `d98e818d2776bcfe58c51cfbcac0d44c02b5c874`, adds `--scale` to the existing semantic smoke, one measurement helper, and an ownership-checked dispatcher-only resume action. That resume action is syntax checked but unexecuted. Production services/contracts are unchanged. The former fault matrix was not rerun.

| Measurement | Cold | Warm | Fixed budget |
| --- | ---: | ---: | ---: |
| Upload/finalization | 1,822ms | 1,879ms | 90,000ms |
| Queue → committed whole-source preparation | 15,667ms | 14,656ms | Recorded separately |
| Processor execution | 14.328s | 13.731s | Existing processor profile unchanged |
| Queue → actual first tile and canonical pick | 16,903ms | 16,057ms | 30,000ms |
| Queue → semantic closure | 59,704ms | 68,450ms | 120,000ms |
| Queue → final62-cell catalogue | 97,439ms | 120,119ms | 180,000ms |
|20 sequential actual-cell tile reads, p95 | 212.668ms | 307.656ms | 750ms |
|20 sequential canonical picks, p95 | 209.836ms | 314.795ms | 750ms |

Both first reads observed9/733 SQL records and one committed seal with the parent still running. Each actual2/2/1 tile was2,836B with SHA256 `bbc75fb404b57a452eabf1f1556fb91bcc260ad6b11bb943add46a6d68dd940d`. Complete original/member/index preparation preceded semantic publication; these timings do not qualify parsing overlap. Each normal source closed67 partitions/733 records/720 admissions/13 quarantines and its complete62-cell catalogue. The two POST replays returned their original jobs and were not counted as imports. The warm run used a separate upload/source/job intent; its733 canonical IDs,733 raw hashes and720 geographic hashes matched the cold records.

The pre-import durable plan fixed budgets, source hashes, extent/reference, hardware, image IDs and concurrency. Original71,238,839B SHA256 `44c734cc72139f2447dcebfe2791cac862dc5ba265e158912d797cf3410d5c37`; unchanged168,356,689B member SHA256 `2b27a478e24d8c51b0655e74ce3f4f880e75c752e4597550d6fc925ed06ac201`;733 MultiPolygons/3,125,505 positions, EPSG7755→4326 always_xy, no vertical reference. Reused official permissions/reference limitations from the source index and retained profile; no discovery or fabricated source facts.

Host Mac15,12/AppleM3/16GiB/macOS27.0; Docker29.5.2 reports4CPUs/6,198,632,448B VM memory. Geo/worker image `sha256:be92666e1d142753bc0643e246cd354618462fe64f397d644ac8436f57014919`. One import lane, one dispatcher selecting at most12 jobs, Celery concurrency2, private MVT active limit1, serial HTTP measurements. Serving3188 and the ulpin/ulpin-repo services were co-resident and unchanged. OS/page caches were not flushed; “cold” means a fresh application/source namespace with zero source jobs/observations/preparations/generations, not disk-cold.

59 snapshots from15:38:36.933UTC through15:42:34.016UTC covered the pair. Intended sampling interval2s; maximum observed start gap4,428ms, including Docker no-stream collection overhead. Observed maximum total memory across all15 running Docker containers was approximately2,162,078,777B (budget5GiB); combined owned API/dispatcher process-group RSS maximum1,101,070,336B (budget1.5GiB). These are sampled maxima, not peaks. The three owned volumes grew1,028,407,296B (budget4GiB) from115,462,144B to1,143,869,440B; this pair measurement excludes the later retained recovery-source upload. No sampling errors or normal HTTP errors occurred.

Private receipt directory: `/Users/vinayak/.codex/worktrees/0bc6/3D Ulpin/.runtime/run01/676b375c76879bf0/`.

| Receipt | Bytes | SHA256 |
| --- | ---: | --- |
| `semantic-scale-plan.json` (written before timed imports) | 7,724 | `4dddff9490804f03fe18c51b45dd458ef6de5834d86d140ed7f2641645140e44` |
| `semantic-scale.json` (overall failed; pair measured) | 44,062 | `816ba618f9c84eebe094b9a9cda281c53c2eeab06ce1d79b0c815c2cfea43025` |
| `scale-run.log` | 934 | `1ee8f2fa0d4b5c32472deb862ddf0a40f2d9de191eb1b17a1bf7008d391fcaf7` |
| `scale-status.json` | 230 | `b8aa47334d3a8845439df321c93c62a81c0171dad3cd2e2731de1617d37f4cbd` |

Actual checks: `node --check` for all three edited harness files, `git diff --check`, `pnpm typecheck:backend`, guarded `prepare --api-port3191` and `start` all exited0. `node scripts/usp/semantic-chunks-smoke.mjs <owned-dir> --scale` exited1 at recovery admission. Guarded `stop` and `status` exited0: zero nonce containers/live leaders/group members; all three named volumes retained. API65792 and dispatcher65670 are gone. Earlier nonces, originals, linked serving and credentials remain intact. Sol/max, requested DEFAULT tier; observed per-turn tier unavailable.

Natural180s expiry/recovery, dispatcher-only resume and stale-attempt denial remain untested in this run. A bounded correction should separate recovery into an empty retained-history context without increasing the eight-job cap or deleting this pair's history. Lead must reconcile this workload before another attempt. No complete GF-STREAM/GF-SCALE, deployment, browser/GPU, city/3D, changed official revision, positional/legal/currentness, property/rights, provider/training or privacy-fault qualification follows from these measurements.
