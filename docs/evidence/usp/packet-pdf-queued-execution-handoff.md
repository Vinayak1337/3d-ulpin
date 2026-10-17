# PACK1-PDF-04 — durable queued PDF execution

Code: `551bbdf0317c45b2c01c6415f141add00300bf46`, from assigned base `1c0249592e363944db652e2bf2e90ba041c95ed8`, in exclusive `task/desktop-packet-pdf-queued-execution` at `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`. Staging was read-only; latest observed head was `f1343eb9ca79a3220625f4bebae98b68b1f2caf2`. Previous completed multiple-original branch remains preserved.

## Usable flow

The existing private Nest controller adds these routes. Enqueue takes the existing exact execute command for a confirmed PDF plan and returns after durable enrollment; the existing independent dispatcher owns execution.

| Route | Result |
| --- | --- |
| `POST /api/v1/usp/packets/plans/enqueue` | 202; exact canonical job status |
| `GET /api/v1/usp/packets/jobs/:jobId` | Authorized status, attempt/fence, bounded error code, accepted result reference |
| `POST /api/v1/usp/packets/jobs/control` | Guarded cancel or explicit retry using job version and request key |
| `GET /api/v1/usp/packets/jobs/:jobId/download` | Only the accepted complete private PDF |

Synchronous execution and old recipe/receipt/hash behavior remain compatible. There is no new queue, packet store, migration, caller context or HTTP background promise. One deterministic real selected original supplies the mandatory job case/source columns; complete plan/source/case/target/binding authorization remains separate. Queued input contains actor/access/policy digests and subject, never roles. Current trusted server context is reconstructed before execution.

The worker shares preparation, staging and publication with synchronous execution. Complete source protection precedes job/attempt locks; status recaptures the job after acquiring protection. Fenced job success, packet/execution/request receipts and outboxes commit on one client. A synchronous winner is reused. Expired/newer/cancelled attempts cannot publish; ambiguous COMMIT preserves potentially committed outputs. Generic job status/cancel/copying retry/ingest refuse this operation. Packet-specific notifications use `packet-job:<id>`, rather than the anchor intake stream.

Bounds remain 35 seconds overall, existing child limits and cleanup allowance, 2–4 ordered pages, 32 MiB PDF/distinct originals, 48M cumulative crop pixels and 16 MiB per original. The narrow region seam accepts a finite fourth server-only parent deadline and keeps three-argument callers. Deferred value imports inside that leaf resolve the observed direct-import cycle without changing the runtime/profile/recipe. Unaccepted work may repeat after interruption; no per-entry resume/cache qualification is claimed.

## Checked result

Evidence root: `E:/BhuAayam-data/task-data/desktop-packet-pdf-queued-execution-20261003`.

Actual enqueue → independent dispatcher claim → accepted packet → private download methods produced `complete-flow/packet.pdf`: **337,862 bytes**, SHA-256 `cda69b79c3aeccac153b624bb70cb62add81889e7add54a323e0426feb638172`. It orders the genuine retained Haryana Tower-3 section/elevation crop before the plan/area crop, byte-identical to the preceding accepted multiple-original PDF. PyMuPDF inspection verifies one painted RGB image per page, exact retained crop pixels/order and no text/annotations/links/attachments/forms. Both Poppler-rendered pages were visually inspected. No native extraction was rerun.

Verification:

- Three queue controls pass: duplicate enrollment/independent dispatcher/private result; expired owner/recovery/source revocation/retry; synchronous winner/lost COMMIT acknowledgement/cancellation. Zero skips.
- The scoped compatibility run retains 30 passing checks, zero skips, with one direct-region module failure. After its narrow fix, the affected region file passes all six controls, including expired-parent/no-I/O, bounded propagation and old callers. Earlier failures remain preserved; the 30 passing checks were reused.
- `pnpm typecheck:backend` passes after the final region change (`backend-types-03.log`). The registered Nest controller leaf/schema check passes without a listener (`api-leaf-01.log`). `git diff --check` exits 0.
- Reproduction uses the genuine second crop: `ULPIN_PACKET_MULTI_SECOND_ROOT=E:/BhuAayam-data/task-data/desktop-packet-pdf-native-continuation-20261003/second-region` for the older multi-region checks, and the retained multiple-original crop at the existing default `desktop-packet-pdf-multiple-originals-20261003/second-original`. Leave saving variables unset on reruns; saved evidence uses exclusive creation.

Exact immutable receipt: `completion-551bbdf0.json`, **32,398 bytes**, SHA-256 `2795b9d0af3a4209313e7ffc01c33c18863a37b9480aea6a8f87cc29af107882`. It pins owned/protected code, original/crop/prior receipts, frozen assigned-base/current inventories, output and closed logs. Its writer log is deliberately excluded from its own pins.

## Reader compatibility and qualification limits

Seven approved reader seams append only exact assigned-base Git/LF and captured physical code digests: IFC, DXF, KML, CityGML, GeoParquet, MVT and semantic publisher. Current full inventories and non-code/runtime/access/source pins remain exact; writers stay strict-current. Predicate controls use actual current code hashes and refuse modified non-code/current-code/unknown-code pins. Frozen `base-fingerprints.json` is unchanged; `current-fingerprints.json` records all eight affected families.

The eighth family, CityJSON validation, is unchanged and remains strict/stale. Current validation code digests: Git/LF `dfca9a328e051b103a2a91413374ed8043c6281530a16fdfaba8ef5659d183df`; physical `999c959a42bbe5e6f83bb233a8b064fee8429d25313b86d89aa340fcb26587ba`. No historical validation approval or promotion was added.

SQL/storage/extractor transports, target/applicability and snapshot authority are explicitly controlled. This does not qualify current HTTP/PostgreSQL/private persistence, authentic applicability/approved revision, rights/geometry/learning, performance/scale or GF4/release. Source-specific Haryana permission and approved-revision gaps remain in the unchanged source manifests. Original/source/crop/profile bytes remain unchanged; no operational records or learning labels were created.

Lead owns final public contract exports/event union, module/OpenAPI/client and source catalogue/ledger publication. No frontend, service/listener/Docker/native/parser/provider/GPU, environment/dependency/cache/profile change, push or deployment occurred. Requested Sol6.1/xhigh/default-standard; actual per-turn model/effort/tier are unexposed. Supplied `never` / `danger-full-access` permissions apply.
