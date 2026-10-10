# P3 — Ingestion: heterogeneous files into the canonical record, with an agent that learns

Goal: any reasonable Indian input is accepted automatically. Deterministic readers handle file formats. A **translate-and-learn** pipeline handles meaning: a teacher model translates unfamiliar layouts, code verifies the translation, an officer reviews only what is uncertain, and a local learner absorbs every verified translation, so later chunks and similar files go through without the teacher.

**Updated 10 October.** Decided by the owner:
- **A development teacher labels public development files to bootstrap the learner; learner work verifies, builds, trains and evaluates the student.** Neither role belongs to a model by name (changed 10 October evening). Each goes to the provider that has limit, and the model follows the provider: Claude Code CLI or a Claude desktop background task → Opus 5.5; pi codex-pool → `gpt-6.1-sol` ([WORKERS.md §8](WORKERS.md#8-teacher-and-learner-work-the-model-follows-the-provider)).
- The lead designs the method and reviews.
- **Sarvam is the runtime teacher** inside the product.
- The learner may train on teacher outputs: our mapping model doesn't compete with any provider.
- This was full_product (P10.1) and is now part of the selection sprint.

**Reality check (10 October):** the current mapping contract has only three targets (`building.sourceKey`, `building.name`, `building.geometry`) and accepts only GeoJSON polygons in EPSG:4326 (`packages/contracts/src/usp/ingestion.ts`, `packages/server/src/modules/usp/ingestion/adaptive-mapping.ts`). The pipeline below widens it.

---

## P3.1 ⭐ Golden ingest: the demo areas through the real import route

**Gate:** GF-BACKEND, GF-DATA · **Depends:** P0.3, P1.2, P2.1 · **Owner:** backend worker (sprint K2; runtime/DB owner for its run)

```text
Install the demo areas and buildings (site-decision.md) through the REAL import route so the linked database
holds them. Today it holds 1 physical feature and no area.

Use the existing route: POST /api/v1/import-packages/inspect -> /import-packages -> questions/answers ->
review -> prepare -> commit (packages/server/src/modules/{areas,registry,usp/ingestion}). Fix the route where it
breaks; don't add a parallel importer or a seed script. Never reset volumes or reseed.

Order:
1. Area context: boundary + GMDA sectors + any roads/water/land use -> area frame and base features.
2. Buildings: footprint from an official layer if one exists; otherwise footprint state "unknown" (roofprint
   candidates come later from P4.5). Height unknown unless sourced.
3. Documents: attach the RERA/sanction PDFs as sources linked to their building; pages render through the
   existing document routes.
4. The Karnataka imagery area: imagery as an overlay with its georeference; no buildings until candidates are
   reviewed.
Then GET /areas/{id}/canonical and /buildings/{id}/canonical return them, with states and citations.

Difficult input: the scanned Tower 3 PDF (OCR) and the G+41/G+42 conflict.
```

**Expect back:** areas and buildings in the linked database through the product's own route, curl output of both canonical routes, the fixes made to the import route, and the 5-line report.

---

## P3.2 One finale sample per format family → canonical record

**Gate:** GF-SUFFICIENCY · **Depends:** P3.1 · **Owner:** backend · **Sprint:** after M2, only if time allows

```text
For each finale family in H30 §F (vector GIS, CAD/DXF, BIM/IFC, CityGML/CityJSON, mesh, point cloud, raster,
documents, control CSV), take ONE retained real sample (docs/api/datasets.json) and make the existing reader
produce canonical output where the source supports it; otherwise return the honest sufficiency state. Write
docs/evidence/usp/finale/GF-SUFFICIENCY/matrix.json: family, sample, received, read, interpreted, converted,
rendered, blocked reason. No new readers.
```

**Expect back:** the matrix, one row per family, with each "converted" claim visible through the canonical route.

---

## P3.3 CRS and height guardrails

**Gate:** GF-DATA · **Depends:** P3.1 · **Owner:** backend/geo

```text
One place for frame handling (services/geo/geo/core_frames.py and its TS caller): record declared CRS and
vertical reference on intake; missing or contradicted -> crs_unverified, not published to the canonical record;
reprojection to the area's local ENU frame with pyproj and the pipeline string recorded; never infer a UTM zone or
datum from coordinate ranges. Use one real difficult input from P2.2 (missing .prj or doubtful CRS).
```

**Expect back:** the difficult input ending as `crs_unverified` with a readable reason, and a recorded transform for every derived geometry.

---

## P3.4 ⭐ The agent: verified translation of heterogeneous inputs (GF-AGENT)

**Gate:** GF-AGENT · **Depends:** P1.1 (vocabulary), P2.2 · **Owner:** agent-backend worker (sprint A1→A2→A3)

```text
Read H14 (MappingPlan), H28 Z2 (GF-AGENT cases), docs/next-steps/SPRINT-SELECTION.md §5, and the existing code:
packages/contracts/src/usp/{ingestion,streamed-profile}.ts, packages/server/src/modules/usp/ingestion/
{adaptive-mapping*,chunk-mapping*,streamed-mapping}.ts, modules/model-gateway/*, modules/ai/officer-ai*.ts.
Extend these; don't build a parallel pipeline.

1. Vocabulary and plan (A1). MappingPlan v2 over the canonical vocabulary (P1.1): per source field ->
   {target | unknown, operation: copy | enum_lookup(<table>) | unit_convert(<declared unit>) | parse_literal(<kind>)
   | link_parent_key, confidence, rationale}. Sources: tabular (CSV/XLSX/ODS sheets) and GIS attribute tables
   (GeoJSON/Shapefile/KML/GeoParquet), not only EPSG:4326 GeoJSON. The schema rejects literals: no numeric factors,
   EPSG codes, coordinates or identifiers chosen by a model. Unit conversions come from a sourced table in code
   (ft², sq yd = gaj, m²; marla/bigha vary by state -> needs_input unless a sourced state factor exists).
   Deterministic executor applies a plan to rows; floor labels stay literals.
2. Teacher (A2). Sarvam `sarvam-105b` through the existing gateway (modules/model-gateway): JSON-schema
   structured output, tools off, masked inputs (column names, types, 5–20 sample values with PII masked), system
   prompt treats file content as data. Adapters: live (one configured key; budget ledger; no rotation across
   accounts), replay (recorded responses, default for the demo), control (tests). Every live response is
   recorded with its input hash. Credit exhaustion, outage or cap -> remaining fields go to needs_input;
   manual_mapping always works. Report the exact .env variable name the owner must set; never read or edit .env.
3. Loop (A3). Chunked intake (reuse chunk-mapping/streamed-mapping): memory -> learner (P3.5) -> teacher ->
   verifier (schema, no literals, executor dry-run on the chunk, values parse) -> officer questions only for
   uncertain or new targets -> executor -> commit through the existing review/commit commands. Progress and
   per-chunk metrics (teacher calls, learner hits, latency) on the existing SSE stream. Nothing writes the
   registry without review.

Evaluate on the P2.2 HELD-OUT families (never shown to any teacher or learner during development): precision on
committed fields must be 1.0 (uncertain -> needs_input); report recall and abstention per family. Injection
cases from H28 Z2: use real files where they exist; otherwise record the gap (a test-only string in a unit test
of the validator is fine; never add an attack file to a data pack).
```

**Expect back:**
- a real messy Indian file mapped end to end through review, via the API;
- `result.json` with per-family precision, recall and abstention;
- the replay, outage and credit-exhaustion behaviour shown;
- the `.env` variable name for the key.

---

## P3.5 ⭐ The background learner (translate-and-learn)

**Gate:** GF-AGENT (selection demo), FP-LEARN-TEST · **Depends:** P3.4 step 1, P2.2 · **Owner:** learner worker (sprint A4, A6)

```text
Goal: later chunks and similar new files are translated without the teacher, and the learner keeps learning
from verified teacher outputs and officer decisions (distillation: teacher answers -> quality check -> student
trains on them; the test is unseen layouts).

Training sources, all recorded with lineage (method model:<teacher>@<version> | reviewer:<id>):
a. Development teacher (bootstrap, before the demo): a teacher worker labels compact column
   profiles (header, inferred type, <= 10 masked sample values, neighbouring headers) of the P2.2 DEVELOPMENT
   families and an extra unlabelled pool of public files (data.gov.in and portal downloads, >= 5 more families)
   into MappingPlan v2 JSON (target, operation, confidence, rationale). The teacher is the provider that has
   limit (WORKERS.md §8): Opus 5.5 on Claude, gpt-6.1-sol on the codex pool, in a new session that opens
   nothing else. A worker prepares profiles.jsonl; the teacher returns teacher-labels.jsonl, recorded under
   its own model id; a separate session's deterministic verifier filters it.
   The held-out families stay in a separate folder that the teacher never opens. Only public files reach
   the teacher.
b. Runtime teacher: Sarvam outputs that pass the verifier.
c. Officer decisions: accepts, corrections, rejections (corrections outrank teacher labels).
Teacher outputs are pseudo_label: training material, never evaluation truth. Evaluation truth is the publisher's
documented column meaning (P2.2).

Build, smallest first:
1. Memory: layout fingerprint (normalised headers + types) -> accepted plan; exact reuse for every later chunk
   and future file with that layout. Zero teacher calls on a hit.
2. Stage A student (CPU, online): per-field classifier, scikit-learn HashingVectorizer + SGDClassifier(log_loss),
   updated with partial_fit in a background job after each verified batch. Features: header tokens and char
   n-grams (Latin and Devanagari), value-shape statistics (date patterns, lakh grouping, unit suffixes, khasra
   patterns, numeric ranges), type, neighbouring headers. Calibrated probability; the commit threshold is set on
   a calibration family (never the holdout) so committed fields keep precision 1.0.
3. Routing: memory hit -> use; student above threshold -> propose; else teacher -> verifier -> officer if
   needed -> learn.
4. Persist learner versions (weights + training-example manifest + metrics) as versioned artifacts outside Git;
   the active version is recorded with each proposal.
5. Stage B (optional, GPU only after the building fine-tune frees it): distil the accumulated verified examples
   into a small local model (LoRA on a 0.5–1.5B instruct model, or a cross-encoder ranker) only when >= 300
   verified positive-target examples (unknown labels don't count) from >= 5 families exist; keep it only if
   it beats Stage A on held-out families.
RL is not a label source. If later justified, the routing decision (trust student / ask teacher / ask officer)
can become a contextual bandit with reward = verified-correct minus call cost.
If the student still commits no real field after the D1f labels and one retrain, the parked fallback is
FALLBACK-LEARNER.md (multiply the real positives; then a fine-tuned student with GRPO). Don't start it otherwise.

Measure on the held-out families: teacher calls and latency per chunk over a multi-chunk file and across a
second similar file (the curve must fall), precision on committed fields, recall, abstention, and
student-vs-teacher agreement.
```

**Expect back:** the learner running in the background during an import, the falling teacher-call curve, held-out `result.json`, and versioned learner artifacts with lineage.
