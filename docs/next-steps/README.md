# Next steps — build prompts for 3D ULPIN

This folder turns the [deep dive](../../PROJECT_DEEP_DIVE_ACTION_PLAN.md) and the [ML review](../../ML_REVIEW_RECOMMENDATIONS.md) into **copy-paste prompts**, one per module or task. Give one prompt to one agent (Codex, Claude or another) in its own branch or worktree. Each prompt says what to build, what to reuse, which standards apply and **what I expect back**.

Every prompt assumes the agent first reads **[00-STANDARDS.md](00-STANDARDS.md)**. That file is the shared contract: data rules, the normalised schema, the candidate/review rules, ML rules, the lean verification policy and the report format. Prompts don't repeat it.

> **Current plan (10 October 2026):** [SPRINT-SELECTION.md](SPRINT-SELECTION.md) sets out the selection sprint, which ends 22 October; selection is around 24 October.
> - Claude leads all lanes and delegates to `gpt-6.1-sol` workers through the pi codex-pool.
> - Priority one is the model that accepts heterogeneous data automatically: the agent, with a development teacher chosen by provider limit (Opus 5.5 on Claude, `gpt-6.1-sol` on the codex pool; [WORKERS.md §8](WORKERS.md#8-teacher-and-learner-work-the-model-follows-the-provider)), Sarvam as runtime teacher, and a background learner. Building extraction, plan reading and document extraction run in parallel.
> - Parked, only if that approach fails: [FALLBACK-LEARNER.md](FALLBACK-LEARNER.md).
> - Live state: [docs/STATUS.md](../STATUS.md).

## How I would build this from the problem statement

SIH26011 asks for one result: **unique 3D identities for what sits on, above and below a land parcel, built from fragmented survey and document inputs, with AI/ML for extraction, floor segmentation, vertical delineation and topology validation.** From first principles that breaks into seven layers. Each layer has a clear owner and a clear output:

```
 1 INTAKE        originals in, hashed, profiled, never changed
 2 READERS       format -> source-native features + citations (deterministic)
 3 NORMALISE     source-native -> canonical building record (deterministic + mapping agent)
 4 DOMAIN AI     imagery -> roofprints, plans -> rooms, documents -> storeys (learned, proposes only)
 5 REVIEW        officer accepts/rejects candidates -> immutable registry revision
 6 GEOMETRY      reviewed footprints + levels -> prisms, topology checks, quantities (deterministic)
 7 OUTPUTS       P3 identity, CityJSON + sidecar, findings, property card + QR, 3D scene
```

Rules that follow from this:

- **ML only proposes.** Deterministic code reads, converts, measures and writes. An officer review stands between every proposal and the registry.
- **One canonical building record** (`normalized-building/1`, defined in P1) is the contract between the backend and the Three.js scene. Every reader and every model feeds it; the scene draws only from it.
- **Learned models are used where the input is pixels, free language or an unfamiliar layout:** imagery, raster plans, scanned documents, and the meaning of columns in files we haven't seen (the agent and learner). Deterministic code does everything else.
- **One real Indian building, end to end, before breadth.** Every new format or feature has to extend that journey.

## What already exists (reuse, don't rebuild)

The repository already has most of layers 1–2, much of 5, parts of 4 and 6, and a large frontend. **The gap is not missing code; it's that nothing has been joined into one journey on real Indian data, and no release gate has started.**

| Layer | Exists | Main gap |
| --- | --- | --- |
| Intake / readers | `packages/server/src/modules/usp/ingestion/*`, `services/geo/geo/native_*.py`; since 4 Oct: Tower 3 source-claim review, large-sheet region previews, document proposals and immutable decisions, saved-evidence reopening | Readers stop at metadata/citations; few emit scene geometry |
| Normalise | `adaptive-mapping*.ts`, `chunk-mapping*.ts`, `streamed-mapping.ts`, `model-gateway/*` (Sarvam/replay/control adapters) | Mapping vocabulary has only 3 targets and GeoJSON EPSG:4326 only (P1.0, P3.4); no learner (P3.5); no canonical record |
| Domain AI | `spatial/spatial-ml*.ts` (incl. source-only batches + candidate reviews), `services/geo/geo/spatial_ml.py`, `services/geo/ml-models.json` (CubiCasa5K, RF-DETR) | Measured on foreign data only (floor IoU 0.60; RAMP-KA buildings IoU 0.45 / recall 0.49 on 24 chips); RAMP gives 6,288 Indian + ~46k Bangladesh reviewed chips (P2.3) |
| Review / registry | `modules/registry/*`, `usp/commands.ts`, `usp/project-identity.ts` (P3 authority fix 5 Oct) | Relationship/declaration proposals not end to end; no actual P3 input yet |
| Geometry | `services/geo/geo/geometry.py`, `usp/geometry.ts`, SQL `60-usp`, floor contour profile v2 | No qualification producer; CityJSON export has empty vertices |
| Outputs | `usp/exchange.ts`, `usp/packet0.ts`, `property-cards/generate|read` routes, Studio card/QR (browser-only) | Card not wired to a unit/revision journey; QR resolver; identity not wired to Studio |
| Scene / Studio | `apps/studio`, `packages/scene` | 2 live / 31 local routes; runs on NYC/Swiss/historical local data |

## Order of work

Run the phases in order; prompts inside a phase can run in parallel where the **Depends** line allows. The ⭐ prompts are the critical path, so do them first and don't add breadth until they pass.

| Phase | File | Purpose | Gate |
| --- | --- | --- | --- |
| P0 | [P0-reset.md](P0-reset.md) | Stop drift, clean instructions, stable runtime | — |
| P1 | [P1-canonical-model.md](P1-canonical-model.md) | Field vocabulary, the normalised building record and scene projection | GF0 contract |
| P2 | [P2-data-and-labels.md](P2-data-and-labels.md) | Demo sources; truth from public human-reviewed data and official literals (no team labels) | GF0 data, GF-AI prerequisite |
| P3 | [P3-ingestion.md](P3-ingestion.md) | Heterogeneous sources → canonical record: agent + background learner | GF0 backend, GF-AGENT, GF-SUFFICIENCY |
| P4 | [P4-domain-ai.md](P4-domain-ai.md) | Building masks, plan segmentation, storey extraction | GF-AI |
| P5 | [P5-geometry-and-identity.md](P5-geometry-and-identity.md) | Levels, prisms, topology, P3 IDs, CityJSON | GF1, GF2 |
| P6 | [P6-govern.md](P6-govern.md) | Carpet area, deviation, readiness, underground | GF3 |
| P7 | [P7-card-and-qr.md](P7-card-and-qr.md) | Scoped property card and QR | GF4 |
| P8 | [P8-studio-integration.md](P8-studio-integration.md) | Studio on the live API | all gates' UI side |
| P9 | [P9-rehearsal-and-claims.md](P9-rehearsal-and-claims.md) | One recorded journey, honest claims, PPT | GF5 |
| P10 | [P10-after-finale.md](P10-after-finale.md) | Schema learner, association ranker, scale | full_product |

Critical path (selection sprint):
1. **P0.1–P0.3**.
2. In parallel:
   - **P1.0 → P3.4 → P3.5**, the heterogeneous-data model;
   - **P2.3 → P4.0–P4.2**, buildings;
   - **P4.3**, plans;
   - **P4.4**, documents.
3. **P1.1–P1.2 → P3.1 → P8.1 → P8.2/P8.4**.
4. **P5.1–P5.5 → P7 → P9.1**.

Dates and owners are in [SPRINT-SELECTION.md](SPRINT-SELECTION.md).

## What I expect from every agent (summary)

1. **A working, visible result:** something a person can see in the Studio, or one `curl` command that shows it. Not a document.
2. **Real inputs:** one representative real input and one naturally difficult real input. No invented data.
3. **A five-line report** in the format of [00-STANDARDS §9](00-STANDARDS.md#9-report-format), plus a results JSON when numbers are involved.
4. **Small diffs** that reuse existing modules. A new module needs a one-sentence reason for why an existing one can't serve.
5. **Honesty:** unknown stays unknown, failures are reported as failures, and claims are scoped to what ran.
6. **No test sprawl:** contract checks, invariant checks and one end-to-end journey (see [00-STANDARDS §8](00-STANDARDS.md#8-verification-policy-lean)). The implementing agent may add unit tests where they help, but nobody reviews coverage.
