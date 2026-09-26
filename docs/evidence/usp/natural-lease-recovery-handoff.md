# RECOVERY-01 natural lease handoff

Natural-expiry recovery passed once in fresh nonce `c237ec466729df1d` on API3191, runtime code `f0df0adea9ada663f59317cbdee87ec8e8d59742`, based exactly on `6e02af4d270ac5b73ac5e1f9a66d23ebe839cab8`. The new recovery-only entry uses the existing source/semantic smoke and reviewed dispatcher-resume helper. It ran one unchanged NWIC source, zero normal cold/warm imports and no broad fault matrix. Preflight found zero source derivatives/display jobs/reservations; the three milestone slots fit the unchanged eight-job history cap. All three reservations were verified before the fault.

Actual case `70255788-52a2-40f9-a9ac-a9885784aa30`, source `e86f1b08-b730-4efc-b2bf-7e43a2a57733`, parent job `bd4d21b7-b075-4ea6-b937-8e6058daf2a6`. The parent was running with9SQL records when seal1 became readable:9 admissions,43,585 positions,724 remaining records. Its chunk SHA256 was `c926d410202eabd3219bd6e2d840db4942b8486c372171f316391dfdab670082`; the API reported currentSourceAccepted=false. The actual attempt1/fence1/owner/input/lease tuple and verified dispatcher executable, cwd, nonce, PID/PGID, start time, command hash and group members are retained privately.

| Event (26 September2026) | Actual UTC observation |
| --- | --- |
| Attempt1 observed active with incomplete source | 16:05:35.487 |
| SIGKILL to verified owned dispatcher71470/group71470 | 16:05:35.532 |
| Entire dispatcher group observed gone | 16:05:35.655 |
| Captured leaseUntil | 16:08:35.139 |
| Database clock first observed past unchanged lease | 16:08:35.144 |
| Guarded canonical dispatcher resume requested | 16:08:35.146 |
| Resume helper returned with replacement73017 and five-service health | 16:08:35.494 |
| Source closure observed | 43,853ms after captured expiry |
| Final62-cell catalogue observed | 79,926ms after captured expiry |
| All recovery checks finished | 16:09:56.388;81,249ms after expiry |
| Fixed observation deadline | 16:10:35.139; expiry+120,000ms |

The configured lease stayed180s.179 observer queries saw the captured old lease unchanged until the database clock crossed it; no timestamp update, lease shortening, synthetic records, artificial source delay, cap change or manual claim occurred. The source publisher had renewed its live lease before the fault; the captured remaining lease was179.607s at the signal. Signal→resume-helper return was179,962ms. This is an observed helper/process/health span, not a precise measurement of when the replacement began dispatching.

Canonical recovery created attempt2/fence2 and accepted the parent. Attempt1's stored state remains `active` with an expired lease; it was not relabelled as an expired-state row. Calling the existing failure authority with the real old attempt returnedfalse after recovery, with the accepted status/fence/result digest unchanged. The original sealed row set retained its exact SHA256 `cd9c72f1ed675205ffe80087c7a37b5a97c0b227426acbe43cf2858066a7441a`; the exact early prefix remained readable and reported currentSourceAccepted=true after full adoption.

All67seals survived/closed. Actual SQL closure:733records,720admitted,13quarantined,0unsealed. Early, middle and final tile jobs all succeeded, with6/17/11immutable generation versions respectively. Final job `2c4777a4-e5db-41f0-ad2f-6162ef2a18a8`/generation11 has62cells, manifest SHA256 `16417685a273c403d51bbe74a5bba54a2c0517aef500e9129c12f1885b735993`. Its actual2/2/1 tile is216,209B SHA256 `55517ae1e416d32cdc26d4f66489403ae53baeec64b8f924e45f14cc83720a93`; decoding and canonical lookup agreed on nativeID4/unit `631fbb49-54a0-4c21-8cfd-f8df251eff65`. The reached model-call assertion found zero calls.

API71592 kept the same recorded process identity across dispatcher resume. Fifteen API/dependency health snapshots all returned200/ok and all five services healthy;12 were during the dispatcher outage, nominally every15s with maximum start gap15,202ms. No unhealthy interval was observed in those samples. The recovery phase has an80,784ms gap between resume and the final health check; these snapshots do not prove uninterrupted availability or sub-interval downtime. Only the owned dispatcher was faulted; API/database/storage/processor/Redis/Celery were not deliberately stopped during recovery.

Source ZIP71,238,839B SHA256 `44c734cc72139f2447dcebfe2791cac862dc5ba265e158912d797cf3410d5c37`; unchanged member168,356,689B SHA256 `2b27a478e24d8c51b0655e74ce3f4f880e75c752e4597550d6fc925ed06ac201`. Retained official NWIC permission/reference limitations apply:733MultiPolygons/3,125,505 positions, EPSG7755→4326 always_xy, no vertical reference. Geo/worker image `sha256:be92666e1d142753bc0643e246cd354618462fe64f397d644ac8436f57014919`, geo tree `04159ccd290adf8d8457ee94f326df4c678e2f47`, parser SHA256 `ba5ff17a255f8161c1b73d19b0961549f73b9cc0a9e94f9faeca1c73387bb633`. The durable pre-source plan pins hardware/images/code/capacity and bounds. No resource/performance benchmark was repeated. Future preparation metadata is labelled `createdAt` with an explicit SQL transaction-creation meaning; no commit-latency claim or historical receipt rewrite.

Private directory: `/Users/vinayak/.codex/worktrees/0bc6/3D Ulpin/.runtime/run01/c237ec466729df1d/`.

| Receipt | Bytes | SHA256 |
| --- | ---: | --- |
| `semantic-natural-recovery-plan.json` | 7,657 | `85241e4ca7f5dffad2355b5e9ddd81099a1c958a52a1e01ac3d7da674dcbfb23` |
| `semantic-natural-recovery.json` | 31,221 | `a35de4354fb9ea748557df1907e1acb8b2fc660fcc597f221557f516e4e5d57a` |
| `stream-dispatcher-crash.json` | 402 | `e728f4248983364421b6d54fb2563f719152ec2ea6bdd1b1a13199965fcda5db` |
| `stream-attempt-control.ts` | 810 | `c0f25d7ec3e60e6c19894b6bdef6a757bf926135274385c06faa7baacf728102` |
| `recovery-status.json` | 230 | `7e434111a37ea73aa17a7cfa04854b8a5dddac40b112c6f997b45b8edd4a72e7` |

Actual commands: syntax checks of the two edited harness files, `git diff --check`, `pnpm typecheck:backend`, guarded `prepare --api-port3191`, `start`, `node scripts/usp/semantic-chunks-smoke.mjs <owned-dir> --recovery-only`, guarded `stop` and `status` all exited0. Final status has no nonce containers/live leaders/group members; API71592, old dispatcher71470 and replacement73017 are gone. All three named volumes remain. The prior pair's failed receipt SHA256 `816ba618f9c84eebe094b9a9cda281c53c2eeab06ce1d79b0c815c2cfea43025` and three volumes were preserved; serving3188, other nonces, originals and credentials were untouched. Sol/max requestedDEFAULT tier; observed per-turn tier unavailable.

This qualifies the bounded operator-triggered dispatcher restart after natural lease expiry for this unchanged vector profile, pending lead review. It does not establish automatic failover, uninterrupted availability, a repeated normal performance result, a second changed official revision, complete GF-STREAM/GF-SCALE, frontend/GPU/city/3D/public/replica performance, source positional/legal/currentness/rights accuracy or provider/training permission.
