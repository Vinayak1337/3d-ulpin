# STREAM-02 — committed NWIC chunks and private display handoff

The exact candidate `de941321271575cd569cd8a520b81aceadaa3941` passed the guarded local backend journey on 26 September 2026. Production source review covered `b7d8015607e07af0d06b135e77b98d5151494e5d`; the later commit strengthens only the persistent-lock harness. Lead and Sol accepted its bounded local integration evidence; see the [sanitized runtime receipt](semantic-chunks-runtime.json). This is not release, frontend, deployment, complete GF-STREAM or GF-SCALE acceptance.

## Behavior and authority

Explicit `semanticChunks: "nwic-semantic-chunks/1"` on the existing projected-vector request enables complete-record chunk publication. The legacy whole-source request remains available. Original ZIP finalization and complete member/index verification precede semantic SQL import; parsing/transform overlap is not claimed.

Immutable preparation and chunk seals bind the existing source/job, case/source revision, access context, parser/publisher, frame, canonical unit IDs, source/geometry hashes and the publishing attempt/fence. Exact-prefix readers exclude unsealed and later observations. Failed/stale cleanup preserves every sealed row and published tile generation. Full source adoption separately verifies all 733 dispositions, 720 admitted observations and 13 quarantines.

Three existing canonical private-MVT jobs are reserved for early, middle and final milestones. Capacity includes each live/succeeded or ever-published job once, including failed/stale jobs. Limits remain 32 jobs and eight history jobs. No second job authority, capacity increase or retained-history deletion was introduced.

Chunk bounds are 100 complete records, 50,000 positions, 8 MiB referenced bytes, 60 seconds and at most 128 chunks. Preparation/chunk metadata are separately bounded to 1 MiB each; retained global metadata is bounded to 256 MiB. Source publication retains its 120-second attempt deadline. Internal display attempts use at most 60 seconds, reduced by parent time for creation/await; legacy MVT attempts retain their 240-second profile. SQL/lock/object bounds and finite USP attempts remain enforced.

Display failure bookkeeping uses the current source/access/publisher and canonical parent fence plus the exact reservation row, without reacquiring the failed tile advisory lock. Final tile-lock acquisition occurs before case/source/job locks inside a savepoint. Failed acquisition can record final display unavailable while independently valid full source adoption remains atomic. Actual parent expiry or stale source/access/attempt still fails closed.

Private metadata/geometry can pin an exact source job and chunk sequence/hash. Chunk receipts and tile lookup carry that prefix pin. `Manifest.complete` means requested cell-catalog readiness; `sourceCoverage` separately reports partial/complete source coverage and remaining records. Display clipping/quantization is not measurement or property geometry.

## Unchanged official source

Reuse [the source index](../../api/real-sources.md), [issuing-source receipt](nest-migration/nwic-boundaries/source-check.json), [manifest](../../../fixtures/usp/D3/nwic-boundaries-v1/manifest.json) and [admission profile](../../../fixtures/usp/D3/nwic-boundaries-v1/vector-admission-profile.json). No new discovery or operational records were introduced.

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| Retained `district_nwic_geojson.zip` | 71,238,839 | `44c734cc72139f2447dcebfe2791cac862dc5ba265e158912d797cf3410d5c37` |
| Unchanged `district_nwic.GeoJSON` member | 168,356,689 | `2b27a478e24d8c51b0655e74ce3f4f880e75c752e4597550d6fc925ed06ac201` |
| Pinned Python converter | — | `ba5ff17a255f8161c1b73d19b0961549f73b9cc0a9e94f9faeca1c73387bb633` |

Originals remain outside Git. Native EPSG:7755 → geographic EPSG:4326 conversion retains the qualified no-network/no-ballpark/no-grid, always-XY policy and distinct unqualified boundary accuracy/currentness. Native transport IDs and application UUIDs are not official parcel ULPINs.

## Passing guarded journey

Nonce `23efff47f982ef17`, project `ulpin-usptest-23efff47f982ef17`, API3191, exact clean candidate above. Private receipts are under `.runtime/run01/23efff47f982ef17/`; credentials were not published. Source case `68c9ad59-de54-4e50-b65d-ad0f78106be0`, retained source `64efdf79-9256-4fdc-b0a0-9d9ed026de5f`.

- Actual early read at **17,926 ms after source queue**: complete original/member/index preparation with 733 indexed records, but only nine SQL observations/one sealed chunk, 43,585 positions and 724 remaining records. Source was running and unaccepted. Private 2,836-byte MVT emitted eight real features; native ID 378 mapped to canonical unit `8a24e852-6db6-4d30-a375-27a81b586d5b`. No artificial import delay preceded this read.
- Exact owned dispatcher SIGKILL, supported whole-service stop/resume and A1 → temporary B2 → dispatcher C3 source ownership recovery preserved the first seal hash/fence. **Controlled forced lease expiry:** the harness directly sets `lease_until = now() - interval '1 second'` before the B and C claims (harness lines77/79 at the pinned revision). This verifies fencing and seal reuse, not natural lease expiry or autonomous crash-recovery timing. Expired A could not retire B. The same source job `9bab6355-0e5a-463b-9258-e1c1d995fe20` independently adopted 67 chunks and all 733/720/13 observations; none remained unsealed.
- All early/middle/final canonical display jobs succeeded. Final job `8559f82b-8508-46c0-926d-c07dd67f49a1`, generation 11, closed 62 cells with explicit complete source coverage. First early generation was independently readable during incomplete import.
- Preparation was 773,691 stored JSONB bytes; chunk metadata totaled 559,606 bytes. Largest chunk had 30 records, 49,921 positions and 4,608,457 referenced bytes. Mutation of a sealed observation was rejected with SQLSTATE `P0001`.
- A second real import was invalidated by an actual case-revision change after a published child generation. Its nine sealed observations/hash remained; unsealed staging was absent, old reads denied and unused slots released. Published failed/stale child `45c4f2cd-60c2-4352-b2ae-ae3315ccabc3` remained charged once: four history jobs, one failed-published job.
- A third real import held the nonce's exact tile advisory transaction continuously. Durable early `MVT_DISPLAY_LOCK_TIMEOUT` and sealing through sequence two were observed after 2,368 ms on the same canonical parent attempt. The lock stayed held through source success and sequence 67: 733 records, 720 admitted, 13 quarantined, zero unsealed, and `currentSourceAccepted=true`. All three slots, including final, became explicitly lock-unavailable; zero child jobs were created. The lock was released only in `finally`; retained history stayed four jobs.
- 211 compact case-ingestion events, maximum 236 serialized bytes; zero model calls. Prefix/hash mismatch, incomplete full-source reads and cross-origin reads denied in the journey. Earlier TILE-01's broader decoding/invalidation qualification remains separately recorded.

## Commands, receipt pins and resources

Actual exits were zero for `pnpm typecheck:backend`, `pnpm build` (server/API only), SQL provenance audit, `git diff --check`, harness syntax check, fresh prepare/start, the complete harness, stop and final status. SQL audit reported 25 historical files/136 statement hashes, eight authored additions and 32 named queries. The previously obsolete native-metadata test expectation was fixed on lead staging; it was not cherry-picked into this pinned runtime.

| Private artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `semantic-chunks-smoke.json` | 9,213 | `aabe8486d50330c8c1cf4ccfa6c410441e70ad078ad89befeee54232179dd94f` |
| `stream-dispatcher-crash.json` | 413 | `3e7fa673f29abba801728595bf83ef3bafe1b1f7aa985715e3cc30fdb1a112bb` |
| `verification.json` | 2,956 | `a5f9b03108521a74eca51f963894459e41d7ca4bf5cc8d8b535552a01a7864bf` |
| `stream-stop.log` | 65 | `3d26d294e705233da4086d203993a1d1c2a4ee2ceebed796a51493a730b5e0db` |
| `resource-snapshot.jsonl` | 1,263 | `a2dd5baffcfc11ecc55218691b47e22808fc4152258a665ac388c8f2388decd8` |
| `resource-final.jsonl` | 1,262 | `27a1a96d5b5ca10ed32340d03f6e3a7e0ed88c1b6dba95aca92d062cd538be54` |
| `runtime-images.txt` | 1,129 | `f7e81c8dabc548e1eba2899015c9e0af9196ca456696bfabeaab8d11807cc2ce` |

The mid-run snapshot recorded PostgreSQL 208.2 MiB/42.82% CPU, MinIO 354.4 MiB/0.38%, Redis 4.027 MiB/0.26%, geo API 64.61 MiB/0.12%, worker 95.29 MiB/0.03%, against a 5.773 GiB VM. These are snapshots, not peaks or scale benchmarks. Runtime image IDs, relevant file hashes and command exits are retained privately. Model: observed `gpt-6-sol`, max reasoning; requested default tier, per-turn observed tier unavailable. No Fast/priority request, usage monitor, new worker or automation was used.

Owned shutdown exited zero. Final status reported zero nonce containers, no API/dispatcher leader or member processes, and named volumes preserved. Serving3188, frontend, root generated API/source documents and other worktrees were not changed.

## Preserved prior attempts and qualification limits

- `51f297f9c13adf2b` / `09bfffb`: semantic closure succeeded but all display milestones were unavailable because the internal request omitted required `window:null`. Failed receipt/volumes preserved; no streaming qualification claimed.
- `a277630684f59f83` / `f2e09bc`: actual early read/recovery/full/stale journey passed its assertions, but the main harness failed on a late incorrect outbox column. A separately hashed postcheck completed those assertions; both receipts remain unchanged. Main SHA `815ab001f1ce0aa46cfa684b032faa1193518ed46330e30cd2fc2e80ba7a86f0`. Source capacity/deadline review findings were subsequently corrected.
- `83bff9096b280a2a` / `40f8162`: disk/daemon I/O failure terminated the observer before a complete receipt. Raw logs/volumes preserved; lead later stopped the exact containers. No runtime gate claim.

This passing run demonstrates backend local integration and real-source committed-prefix behavior under the disclosed controlled recovery fault. Natural lease expiry and autonomous recovery timing remain unqualified. It does not qualify parsing/transform overlap, a second official changed-geometry/deletion revision, boundary positional/legal/currentness accuracy, property/rights/height facts, ML training permissions, public/multiuser/replica deployment, generative preview, frontend acceptance or GF-SCALE. No deployment, push, provider call, populated reset or pruning was performed.
