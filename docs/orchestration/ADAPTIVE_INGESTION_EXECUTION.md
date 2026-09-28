# Adaptive ingestion — execution plan

28 September 2026. User-requested design and implementation sequence. Code inspected at staging `1b708cdfbe74f44e85d97f607086b378a11d55b2`. This is a focused execution supplement to H14/H21 and the [backend decisions](../usp-agent-handoffs/backend-streaming-plan.md), governed by the [operating guide](OPERATING_GUIDE.md). Backend and API contracts only; no renderer or frontend changes. No public-portal work.

## Outcome and scope

Accept a declared set of heterogeneous source formats, preserve their originals, extract complete source-linked units, normalize supported semantics, and progressively publish validated draft results. Unresolved units remain visible as issues while independent valid units continue. AI proposes bounded interpretations and recovery actions; deterministic readers and converters execute them. A separate learner may eventually suggest mappings from independently qualified examples.

The user now requests implementation toward the whole ingestion/learning workflow. This authorizes the dependency-ordered batches below; it does not declare GF0–GF5 or FP-LEARN passed, waive provider/training permission, or change property recording authority. No claim of universal format support or recovery of arbitrary damaged bytes.

## What exists and what does not

| Concern | Inspected implementation | Consequence |
| --- | --- | --- |
| Durable originals | `packages/contracts/src/usp/ingestion.ts`: 8 MiB parts, 128 MiB original limit, 16 parts; global retained/temporary storage limits also small. `large-original.ts` streams final assembly and verification. | Extend the existing path; increasing one constant cannot qualify 7 GB. |
| Manual GIS mapping | `ingestion/registry.ts` parses a whole GeoJSON collection, maximum 2,000 polygon features; maps literal key/name/geometry. | Useful bounded mapping executor, not a city-scale parser. |
| Semantic publication | `semantic-chunks.ts` contracts pin NWIC source/profile, at most 733 records and 128 chunks. Existing outbox/MVT publication handles committed prefixes. | Preserve the qualified reader; add a versioned general profile instead of weakening source pins. |
| Events | Existing private ingestion SSE has authorization, cursor replay and resync limits. | Extend event payloads, reuse its authority; do not add a second bus. |
| Document AI | `document-model.ts` accepts selected native text and checks exact field/value quotations. It explicitly says no reusable qualified document-layout recipe exists. | Field extraction is not a general conversion agent. OCR, cross-format interpretation and automatic mapping require implementation and evaluation. |
| Model gateway | Runtime uses a governed Sarvam adapter; configuration currently names `sarvam-105b`. | Model name is not accuracy evidence. This review made no live provider calls and did not establish live configuration availability. |
| Learner | H21 specifies a CPU mapping learner; no schema-learner training implementation found in the inspected geo/server paths. | A cache is not training. Learning and promotion remain separate, unqualified work. |
| Demo multimodal | Fixed demo adapters and retained NYC raster/point-cloud sources exist. | Reuse source knowledge, not the claim that the general NestJS pipeline already supports them. |

## 1. Linking registry documents, parcels and buildings

Do not assume every registry document has coordinates. Extract issuer/jurisdiction, document number/date, parcel/survey identifiers, official ULPIN if present, address, locality, boundary descriptions and quoted references. Preserve original spelling alongside any searchable normalization. A parcel ID is not a building or unit ID.

Matching order: explicit issuer-scoped identifier relationship; explicit document cross-reference; compatible cadastral parcel relationship; then address/spatial candidates. Address similarity, an owner name or proximity alone yields candidates, not an accepted property link. Coordinates require an evidenced CRS, axis order and units; a local plan origin is not a location on Earth. Multiple buildings on a parcel and buildings spanning parcels are supported as relationships, not forced one-to-one matches.

Store association evidence, source locator, rule/version, jurisdiction and status (`exact`, `candidate`, `ambiguous`, `unresolved` as proposed backend association states; align public status vocabulary with H99 before exposing). Documents can be usable evidence before any map placement exists. Missing identity/coordinates cannot be repaired by AI invention. Recording ownership still follows existing officer authority.

Research basis: Registration Act section 21 describes property identification through descriptions, roads, numbering and survey references; it is not evidence that coordinates are present in every deed. DoLR describes ULPIN at the georeferenced **parcel** level. State/issuer formats must be checked on actual sources. [R1, R2]

## 2. Three different kinds of chunk

1. **Transfer part:** bounded bytes for resumable upload, independent retries and hashes. No semantic meaning.
2. **Processing unit:** a complete feature, record group, table/page region, raster window or point batch, with enough context to interpret it. No splitting a polygon ring or quoted CSV record arbitrarily.
3. **Display tile:** a spatial/LOD derivative for the viewport. It may combine several processing units and sources. It is not a substitute for evidence or registry storage.

An uploaded source always gets a progress/job record; a tiny document need not be split. A document with no geometry publishes extraction/association progress, not an invented map object.

## 3. Receiving 1–7 GB safely

Target a versioned admission profile up to **7 GiB** (7,516,192,768 bytes), covering a user's decimal 7 GB example. Keep the existing smaller profile compatible. Enforce part count, source size, temporary copies, active uploads, object-store quota, disk, finalization time and concurrent worker memory together. Use BIGINT-capable persistence and check body limits/proxies independently. Do not buffer an entire upload in Node, Python or the browser API client.

Retain the present 8 MiB transport parts unless measurements justify another profile: 7 GiB needs 896 parts. A request still handles only one bounded part. Resume from verified receipts. Finalization becomes a recoverable bounded job if it cannot fit a request deadline; checksum the assembled original, never equate an object-store ETag with a source SHA-256. Preserve cancellation fences and retry ownership. Reserve enough space for simultaneous parts, assembly and processing scratch; cap work rather than overcommit the machine. [R3]

First release processes after the source is completely retained and verified. Parsing, normalization and publication can then overlap. Upload progress is immediate; geometry during an incomplete upload is not promised. Some formats require a directory/header scan or local seekable spool before their first record. Display that preparation stage honestly.

## 4. Format-aware partitioning

| Input | Processing boundary and retained context | Limitation |
| --- | --- | --- |
| GeoJSON/GeoJSON sequence | Streaming complete features; collection metadata/CRS and stable original index/byte locator | One very large feature is an oversize unit; do not cut rings to meet a batch limit. |
| CSV/TSV | Parsed rows, including quoted newlines; encoding, header, units, table key | Never split raw bytes at every newline. |
| Shapefile/GeoPackage/geodatabase | OGR layer/features after companion-file inventory; layer/schema/CRS pinned | Missing `.shx`/`.dbf`/`.prj` or unsupported drivers are explicit; bounded repair only where valid. |
| PDF/DOCX/scans | Native layout first, OCR when necessary; section/page/table row groups with repeated headers and original bounding boxes | Page boundaries can cut a table; preserve continuation and neighboring context. Unsupported OCR is a tool gap. |
| GeoTIFF/DEM/orthophoto | Tiled windows plus affine transform, CRS, nodata, bands and vertical units/datum | Use COG ranges where available; ordinary TIFF may require bounded local staging/conversion. |
| LAS/LAZ/COPC | Complete point records/batches or octree nodes; scale/offset, CRS, classification and time metadata | Streaming depends on every PDAL stage; global algorithms need an explicit preparation pass. |
| ZIP or other bundle | Inventory members/relationships; route each supported member to its reader | Archive bytes are not semantic chunks. Enforce member/count/expanded-byte/depth limits, reject unsafe paths. |
| Unknown extension/encoding | Magic bytes, safe metadata inspection and bounded diagnostic sample; select an installed allowlisted reader | Unknown binary format is not made readable by making chunks smaller. |

GDAL exposes format-dependent random/range access; COG and COPC offer native spatial access. Document systems such as Unstructured/Docling partition layout before creating LLM-sized chunks. Adopt these patterns without installing an entire new platform by default. [R4–R8]

Known **format** and known **schema** are separate. A valid GIS container may have unfamiliar field meanings. A known reader can produce large efficient record batches while AI sees only small representative schema samples.

## 5. Choosing chunk sizes and handling failures

Start with bounded profiles, then tune from measured peak RSS and processing time. Initial vector batch budget: whichever comes first of 100 complete features, 50,000 positions or 8 MiB referenced input; these are starting settings from existing experience, not universal qualification. Lower a batch on memory pressure or long execution; enlarge only inside declared caps. Stream the manifest to storage/DB instead of keeping a city-wide index in memory.

Use a bounded queue with per-import fairness and at most a small configured number of active workers. Reader pauses when normalization/publication backlogs fill. ML has lower scheduling priority than ingestion. Avoid an unbounded task per feature or an entire city in an LLM prompt.

Recovery order: retry transient I/O; use another installed reader/encoding when supported by evidence; reduce the record/page/window batch; isolate the failing complete unit; quarantine an irrecoverable unit with an exact locator and reason. Preserve recoverable siblings. A truly truncated stream may have an unknown remainder; do not claim a known rejected count or complete coverage.

AI receives the error, reader/version, source manifest, bounded evidence and allowed recovery actions. It may recommend a reader, encoding, partition boundary or declarative mapping. Code validates and executes the choice with a finite retry budget. No generated shell, Python, SQL or parser runs on uploads. A new file format requires a reviewed adapter, not unrestricted runtime code generation.

## 6. Normalization and AI routing

Route: **verified exact recipe → qualified local suggestion plus validation → bounded AI proposal → explicit unsupported/needs-evidence result**. Use schema/layout fingerprints, issuer semantics, units, reader version and target schema version to scope recipe reuse; hash equality of column names alone is insufficient. Recheck constraints for every chunk and detect drift in later records.

Build a compact AI evidence packet: target field definitions and allowed operations; detected source paths/types/nulls; a few varied complete records or layout regions; source locators; relevant headers/units/CRS evidence; and bounded validation errors. Sample across the stream when possible. If only the prefix is inspected, mark that scope and continue drift checks. Never send a 7 GB source or all raw geometry to the model.

AI returns a strict proposal of source path → target concept + allowlisted conversion + quoted evidence + abstentions. No new identifiers, geometry, coordinates, ownership or missing measurements. Code copies values, applies evidenced unit transforms and builds geometry. First MVP recipe targets only existing supported concepts; expand target types deliberately.

Validate schema/types, unique scoped identity, geometry, CRS/units, referential integrity, source coverage and semantic evidence. Valid JSON and matching quotations alone are not semantic correctness. Trial the recipe on a small different sample before reuse; continue per-chunk checks. Routine exact, policy-qualified conversions can become draft results automatically. Ambiguous/irrecoverable chunks remain issues; the default is not a per-chunk human question. Approval of legal records remains distinct.

Published geometry is a derivative of evidence. A deterministic geometry repair retains the original, repair operation and area/topology deltas; it is eligible only under an explicit repair policy. Uncertain geometry is quarantined, not redrawn by a model.

## 7. Progressive publication and SSE

Durable original → reader/preparation → bounded unit queue → conversion → validation → DB/artifact commit → existing outbox → SSE notification → authorized manifest/tile fetch.

Use existing job/source identities and access fences. Each accepted chunk pins source hash, locator, input revision, recipe/model version and result checksum. Retries are idempotent; stale workers cannot publish after cancellation or a newer source revision. Commit output and outbox together. Display publication can advance before independent evidence-linking/learning finishes, but must not imply registry approval.

Events describe stages, accepted/quarantined counts, recoverable issues and the current immutable manifest/chunk reference. **Do not put megabytes of geometry, point clouds, originals or PII into SSE.** Large outputs travel through private HTTP assets/tiles with viewport/LOD selection. Resume with the existing cursor/Last-Event-ID behavior; an expired cursor yields a current snapshot and replay continuation. SSE reconnection alone does not guarantee exactly-once consumption. [R9]

Processing concurrency may finish out of order. Publish only committed references through a manifest generation; expose its completeness and gaps. The user's 28 September refinement adopts ordered chunk delivery: wait for an unfinished earlier slot even if later slots are ready, but advance across an explicit terminal rejection marker as described below. Until EOF, totals can be unknown. A worker restart must resume from committed units, not reimport duplicates.

The current renderer can only display supported representations. APIs may preserve additional attributes/layers while an unwired frontend capability remains unavailable. Backend acceptance of a raster/point cloud is not proof it is displayed.

## 8. Learning alongside ingestion

First deliver reusable validated recipes; this immediately reduces repeated AI work and is **not ML**. Then implement H21's narrow CPU learner for field/operation candidates, not geometry generation or arbitrary document understanding. AI operates as a bounded teacher; a training job is a separate software service, not another chat agent deciding to train itself.

Only permission-eligible examples with source evidence and independently checked labels can train. A model agreeing with itself or passing JSON validation does not create ground truth. Sarvam-derived outputs require the applicable written training permission; if absent, exclude them while independent exact/manual labels remain separately eligible.

Train immutable candidates asynchronously, evaluate on withheld source layouts, shadow against the current route and promote only after predeclared critical-field/abstention/resource gates pass. Keep candidate and active weights separate. Promotion affects only compatible unclaimed chunks; active/completed chunks keep their pinned converter. Roll back future routing on drift. Ingestion must finish successfully even if no model ever qualifies during that upload.

Research such as Magneto supports combining inexpensive candidate generation with LLM reranking, but its domain benchmarks do not qualify cadastral ingestion. Its synthetic training strategy is not adopted under our source rules. [R10]

### Adopted indexed pipeline and incremental learning refinement

User refinement, 28 September: one logical processing queue, indexed result map, AI fallback while a separate worker learns, and an ordered sender that waits for unfinished lower indexes. Implement through the existing job authority and durable DB/object storage, not an additional broker or an all-city RAM map.

- Key every chunk by `(importId, sourceRevision, chunkIndex)`, with a stable zero-based index assigned by the reader. For N chunks the range is `0..N-1`; N remains unknown until EOF. Retries retain the index and change only the fenced attempt. Multi-file imports also retain member/source locators; an index is scheduling order, not a spatial location or property ID.
- One logical work queue carries durable job references, not raw city payloads. Route claimed work to deterministic conversion, qualified ML or AI using job type/capability and bounded concurrency. The training worker consumes durable eligible-example references through the same job infrastructure; it must not compete destructively for unprocessed normalization work. Learning cannot starve ingestion.
- One indexed result authority stores state, immutable payload reference/hash, converter version, attempt and diagnostics. PostgreSQL holds the index; private object storage holds large normalized artifacts. A small bounded memory cache accelerates reads. Both validated AI-route and ML-route results enter this same authority. Keep the original and per-field/feature evidence links.
- State progression: `queued → processing → ready`; recoverable failures route to `awaiting_ai`/retry; unrecoverable units become `quarantined` with a reason; cancellation is explicit. Final enum names must reuse existing statuses where possible. Never represent every state as an empty array slot.
- The first eligible AI-assisted conversion may seed an incremental **candidate** model. Train on source profile/features plus the checked mapping/operation labels and evidence, not just the normalized output. One update does not establish useful accuracy; a chunk of identical-layout records does not provide many independent mapping examples. Restrict candidates by compatible source family, features and target semantics.
- On subsequent chunks the candidate may run in shadow while the existing exact/AI route remains authoritative. Independently check held-out source evidence and useful coverage before promotion. Once qualified, the active model proposes a mapping, deterministic code converts the source, and shared validators check it. Low confidence, unseen layout or failed checks route that chunk to AI while other compatible chunks proceed.
- An AI fallback result supplies a new training example only after applicable permission and independent source/semantic checks. A valid geometry/JSON result alone cannot prove the correct field meaning. Do not train on provider outages, broken parser output or guesses. Deduplicate example IDs so retries do not repeatedly overweight a chunk.
- Batch eligible incremental updates in a separate candidate model; do not mutate the model serving concurrent chunks. Atomic promotion swaps an immutable version for newly claimed work only. Preserve prior accepted results and support rollback. The first candidate may improve during the same import without ever becoming qualified during that import.
- The publisher maintains a durable `nextPublishIndex`. It emits references to consecutively ready results and explicit terminal quarantine/cancellation markers. It waits on an unfinished slot using commit notifications; later ready slots stay on disk. A stuck slot has a lease, finite retry/recovery policy and visible issue status, not an infinite unexplained wait. Never skip an unresolved slot silently or invent a successful chunk.
- Ordered data events are separate from progress/issue notifications: users can see that chunk 2 is awaiting AI while chunks 3–5 are ready. Strict order deliberately creates head-of-line delay. Use a bounded look-ahead window/backpressure so later completion does not exhaust storage while waiting. Future out-of-order viewport previews would be a separate product decision; they are not assumed here.
- Advance the publication watermark atomically with committed manifest/outbox entries; do not advance it merely because bytes were written to a socket. Each subscriber keeps its own resumable SSE cursor, which is distinct from chunk index and the shared publication watermark. Clients deduplicate immutable chunk IDs/revisions. A disconnect does not roll back the import or consume data for another subscriber.

Implementation placement: AI-02 owns stable indexes, durable result slots, ordered ready-prefix publication, terminal markers and bounded look-ahead; AI-03 owns AI fallback/routing; AI-06 owns the eligible example collector, incremental candidates and safe handover. The active AI-01A/AI-01B foundations do not need new scope for this refinement. Incremental learning through small batches is supported by scikit-learn's `partial_fit` estimators, but useful prediction quality remains an empirical question. [R13]

## 9. Is our AI good enough?

**Not established.** Inspected code provides bounded, grounded document proposals; it cannot demonstrate general normalization, unfamiliar binary parsing, correct property linkage or a trained learner. Sarvam's name/context size cannot answer this question. Agent workflow and tools matter alongside model capability. [R11, R12]

Evaluate the actual configured gateway on a small retained official-source set: known structured mapping, unfamiliar readable layout, incomplete/ambiguous evidence, and a genuine unreadable/unsupported case. Expected values must be independently extracted from source evidence. Measure correct field/operation proposals, unsupported guesses, abstention, exact identity preservation, calls, cost and latency. Zero invented critical facts is required on this checked set; do not generalize a tiny check into production accuracy.

Existing NYC geometry/metadata and NWIC data can check conversion mechanics. USGS scanned material can expose OCR gaps. They cannot prove Indian deed-to-building association. A permission-qualified Indian registry-plus-parcel/building example remains needed. Consult [the source index](../api/real-sources.md) and [dataset catalogue](../api/datasets.json) before acquisition.

Prepare the exact public excerpts, scoring and a capped call plan first. Live provider calls require the user's separate authorization under AGENTS.md; do not silently enable a provider or fabricate a passing model result. Offline proposal validation is useful but must be reported separately from model accuracy. A failed model check narrows the supported scope or improves tools/prompting; it does not justify editing the source document.

## 10. Delivery batches and ownership

The lead owns this plan, integration, generated OpenAPI/dataset handoff and shared seam arbitration. Workers use GPT-6 Sol/max, default tier requested (per-turn tier only reported if observed), isolated worktrees from accepted staging, no subagents. Normally two independent first-wave lanes; dispatch later work only after dependencies are integrated. Return one concise completion with commit, commands, checked real inputs and gaps. No exhaustive campaigns or new report collection.

| Batch | Usable result and owned seam | Depends on | Small acceptance check |
| --- | --- | --- | --- |
| AI-01A | Versioned large-original capacity through 7 GiB; coherent receipt/part/storage/finalization budgets and recovery. Own existing upload contracts, large-original service/controller/storage and directly affected SQL/tests. | Current baseline | Existing retained official original resume/hash journey and concrete boundary/recovery controls; distinguish implemented ceiling from unrun 7 GiB runtime. |
| AI-01B | Source-grounded GIS mapping proposals through existing gateway and supported conversion registry; schema validation, abstention, source binding and bounded capability-check runner. Own new adaptive-mapping contract/module, gateway output registration and new API proposal seam. Do not edit AI-01A files or legacy manual semantics. | Current baseline | Existing official sample through deterministic proposal validator plus missing/ambiguous evidence; live provider accuracy remains unqualified until authorized. |
| AI-02 | General streaming GeoJSON/sequence reader, persistent bounded chunk manifest, worker dispatch and progressive draft publication using existing jobs/outbox. Preserve NWIC profile. | AI-01A accepted | One real multi-chunk file gives a committed result before EOF; one invalid feature isolated; restart/retry has no duplicate result. |
| AI-03 | Integrate qualified recipe reuse and AI routing with AI-02; safe recovery policy; drift and issue events. | AI-01B + AI-02 accepted | Known layout skips AI; unfamiliar layout proposes a bounded recipe; unsupported ambiguity remains an issue while siblings continue. |
| AI-04 | Native/scan document partitioning plus evidence-based parcel/building association; choose OCR tool based on a real source failure. | Shared chunk contract accepted | Real document retains locators/headers; explicit source key links; ambiguous relation stays unresolved. Indian association needs suitable real sources. |
| AI-05 | GIS container companions, raster windows and point batches through registered adapters, using retained NYC multimodal originals. | AI-02 accepted | One actual input per added adapter; correct reference metadata and bounded outputs; no renderer work or false display claim. |
| AI-06 | Eligible example collector, CPU candidate learner, held-out evaluation, shadow/pending-only promotion/rollback. | AI-03 + eligible independent labels | Actual model artifact and independent evaluation or honest insufficient-data state; ingestion proceeds either way. |
| AI-07 | Source-backed 1–7 GB runtime qualification, final Swagger/API dataset handoff and lead integration. | Applicable readers and real source | Actual bytes, format, RSS/scratch, time to first accepted result, throughput and resume measured on the real input. No repeated/expanded fake city to claim scale. |

AI-01A is byte-capacity work, not a 7 GiB format-support claim. AI-01B initially produces proposals, not automatic property approval. Those boundaries let two workers produce useful independent changes before general orchestration depends on them.

All later assignments narrow this table into exact paths and pin an accepted base. Final API documentation lists supported input/profile/size, request/error/status schemas, event examples without invented property facts, resume/idempotency, dataset manifests, geography and actual qualification. No frontend refactor or new broker/database is necessary.

## Research references — checked 28 September 2026

- R1 [India Code: Registration Act, section 21](https://www.indiacode.nic.in/bitstream/123456789/19013/1/the_registration_act%2C_1908.pdf): property-description requirements; not a universal coordinate field.
- R2 [DoLR: ULPIN](https://dolr.gov.in/en/ulpin/): parcel-level georeferenced identification.
- R3 [AWS: multipart uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html): independent parts, retries, completion and checksums. Our current conditional object-store protocol still governs compatibility.
- R4 [GDAL virtual files](https://gdal.org/en/stable/user/virtual_file_systems.html): format-dependent compressed/range access.
- R5 [COG in depth](https://cogeo.org/in-depth.html): raster tiles, overviews and HTTP ranges.
- R6 [COPC specification](https://copc.io/) and [PDAL reading/streaming](https://pdal.io/en/stable/tutorial/reading.html): spatial point access and pipeline streamability.
- R7 [Unstructured chunking](https://docs.unstructured.io/api-reference/legacy-api/partition/chunking): structural elements, section/table boundaries.
- R8 [Docling pipeline options](https://docling-project.github.io/docling/reference/pipeline_options/): OCR/layout/table processing and bounded staged queues. Candidate tool, not a dependency decision.
- R9 [WHATWG SSE](https://html.spec.whatwg.org/dev/server-sent-events.html): event IDs and reconnect behavior; application persistence/authorization remains ours.
- R10 [Magneto paper](https://arxiv.org/abs/2412.08194): small/large model schema matching, retrieval/reranking and context/cost limitations.
- R11 [Anthropic: building effective agents](https://www.anthropic.com/engineering/building-effective-agents): controlled workflows and tool design before open-ended autonomy.
- R12 [Anthropic: agent evaluations](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents): outcome-based assessment rather than model confidence alone.
- R13 [scikit-learn: out-of-core and incremental learning](https://scikit-learn.org/stable/computing/scaling_strategies.html): streaming examples, feature extraction and incremental estimators; does not imply qualification after one batch.
