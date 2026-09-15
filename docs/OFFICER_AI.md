# Local Nous document assistance

The server adapter, evidence grounding, image cropping, persistence and review seam are implemented. **Real inference acceptance remains blocked:** `NOUS_API_KEY` was absent from the task environment and project environment files. No actual Nous inference ran. The ten-real-document evaluation, field accuracy, geometric correction burden, local-language accuracy and live vision/structured-output behavior are not measured.

The [recorded public catalog observation](evidence/nous-catalog-observation.json) contains 404 advertised models and seven routes with zero prompt/completion prices. `stepfun/step-3.7-flash:free` currently advertises text/image input and structured outputs. This is public metadata, not proof of the account's entitlement or quota. Primary references are the [Nous model catalog](https://inference-api.nousresearch.com/v1/models), [official route recommendations](https://portal.nousresearch.com/api/nous/recommended-models), [Nous portal](https://portal.nousresearch.com/) and [official Hermes catalog selection source](https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/models.py).

## Configuration and behavior

Set `NOUS_API_KEY` privately in the local server environment. `NOUS_MODEL` may pin an exact route; it must pass the current authenticated catalog checks. Restart the local web service after environment changes. There is no client-side key, credential file in this change, paid fallback, arbitrary provider URL or provider tool execution.

`GET /api/v1/ai/status` reports missing configuration precisely. With a key, it fetches the authenticated catalog from the fixed HTTPS Nous endpoint, forbids redirects and requires zero numeric prices for every advertised fee plus structured response support. Model capability is advertised metadata; quota stays unknown unless Nous supplies rate-limit headers. A catalog/API failure stops the extraction.

Only explicitly selected, associated document parts and a small current-fact context are sent. Limits are 12 parts, five entities, 40,000 text characters and four selected image regions. Common personal identifiers and labeled personal fields are redacted from text. Image selection requires an explicit crop and confirmation that the crop excludes personal fields; no automatic OCR claim is made. PNG/JPEG originals are checksum-verified, then the private native processor produces a bounded PNG crop with EXIF orientation normalized, at most four megapixels/four MiB. Original and derivative hashes, dimensions, region and bytes are retained. PDF rasterization is currently unsupported; attach an explicit relevant PNG/JPEG derivative or use native PDF text.

The loop makes at most two calls: one proposal and one repair if deterministic validation rejects output. `NOUS_MAX_CALLS` may lower that cap. Output-token default is 3,000 and hard cap 6,000 (`NOUS_MAX_OUTPUT_TOKENS`); per-call timeout defaults to 45 seconds and caps at 60 (`NOUS_TIMEOUT_MS`). JSON schema, source quotations, entity associations, supported properties, numeric values, source units and known reference names are checked locally. Measured geometry candidates may copy explicit selected-source GeoJSON Polygon/MultiPolygon or WKT coordinates only when the quote declares metres and an authorized horizontal frame. Closed finite rings, holes, multipart structure, extent and a 500-point cap are checked; PostGIS checks topology before candidates are shown and again on apply. Altered/inferred outlines and pixel-as-metre geometry fail with a targeted evidence question. Calibration, coordinate conversion and measurements remain native preparation responsibilities; candidates cannot become recorded observations directly.

Text candidates cite exact selected quotes. Image candidates cite the selected source region and are explicitly labeled **unverified image transcription**: a model's transcription is not independent evidence verification. Every candidate remains `ai_extraction` / `unresolved`, with the source entity's world status. Contradictions remain separate claims. Applying selected candidates only appends draft facts. The officer must resolve claims, prepare and pass the existing review before recording. Numeric mm/ft values convert to metres deterministically on apply; values without a supported named vertical reference cannot apply to vertical preparation.

## API seam

`POST /api/v1/import-packages/:id/ai-extractions` accepts:

```json
{
  "expectedRevision": 3,
  "partIds": ["selected-document-part-uuid"],
  "entityIds": ["associated-building-uuid"],
  "requestKey": "new-request-uuid",
  "mode": "live"
}
```

Optional `imageRegions` contains `{partId,region:{x,y,width,height}}` in normalized source-image coordinates and requires `imageContentApproved:true`. The full image is an explicit `{x:0,y:0,width:1,height:1}` selection. Optional `answers:[{question,answer}]` records operator responses for a bounded resumed run; answers are guidance, not measurement evidence. New/changed evidence requires the current preparation revision.

- `GET .../ai-extractions` lists persisted runs; `GET .../ai-extractions/:runId` reopens one.
- `mode:"cached"` performs no provider request and only returns an exact matching revision/evidence/answers cache, clearly labeled. Live mode checks the current catalog before reusing the same route's matching stored result.
- `POST .../ai-extractions/:runId/apply` with `{expectedRevision,candidateIds}` atomically adds selected unresolved facts and records the applied marker. Retries cannot duplicate those facts. Revision and input-fingerprint checks prevent stale output from replacing a newer decision.
- `GET .../ai-extractions/:runId/derivatives/:partId` reopens the exact stored PNG crop locally.

Storage tables `officer_ai_runs` and `officer_ai_derivatives` are additive. They retain source/part/derivative hashes, prompt/schema versions, selected input context, raw structured provider outputs, usage, response IDs, latency, validation failures, run revision and cache provenance. Private input/raw outputs are not returned in the public run response. No models can execute shell, SQL, arbitrary browsing or publication actions. The caller selects additional evidence rather than granting the model general source access.

## Verification and remaining acceptance

Run `pnpm exec tsx --test tests/ai-extraction/grounding.test.ts` and `pnpm exec tsx tests/ai-extraction/integration.ts`. The latter uses local PostgreSQL/storage/native image processing and an in-process **mocked** Nous transport. It creates only an explicitly synthetic UUID namespace and removes its own area, package, source rows and storage objects afterward.

Twenty-two unit checks pass, covering ten synthetic scalar grounding cases, five measured-geometry cases, fee verification, missing credentials, fixed-host authorization, tool prohibition, bounded source-role proposals and identifier-grounded entity proposals. Ten scoped integration checks pass: persisted/idempotent blocked attempts; source-linked candidate provenance; offline cache; role/association suggestion persistence and source-mutation isolation; draft-only atomic apply and stale rejection; one bounded repair; actual native crop/checksum/reopening; native topology validation and draft-only measured-outline application; invalid outside-hole rejection; and current-observation isolation. [The integration evidence](evidence/ai-integration.json) records cleanup and zero actual inference runs. These tests establish implementation behavior, not model accuracy.

Remaining T08 acceptance requires an authorized Nous credential and at least ten permitted real pilot document groups, including local-language text where relevant. Measure useful grounded fields, locator coverage, unsupported guesses, disagreements, missing levels and manual correction burden from actual responses. Image-derived metric geometry and PDF rasterization are not implemented capabilities. Bounded document-role and entity-association proposals are implemented; actual model quality remains unverified. Explicit measured source outlines are supported as grounded geometry candidates; image pixels remain uncalibrated until the separate evidenced native/manual preparation path supplies a measured outline. The coherent Indian pilot document/source permission gate is recorded in [SOURCE_ACCESS.md](../demo-data/real-block/SOURCE_ACCESS.md).

## Source-role and entity proposals

Prompt/schema version 3 also accepts up to 20 optional unresolved suggestions. A role must be `floor_plan`, `section`, `level_schedule`, `survey`, `reference` or `unknown` and cite an exact selected source part quotation (or explicitly selected image crop, labeled unverified). An entity link must name an authorized selected entity and an exact canonical/source identifier from its supplied context that also occurs in the cited source. Similar owner names, proximity and attachment alone cannot establish a match. Unknown parts, entities, roles, invented quotes and excess suggestions fail validation. Original revision, part locator and crop bounds remain on the stored proposal.

These proposals reopen and cache with the same immutable run fingerprint. The preparation panel displays them with source links as unreviewed suggestions. They have no apply endpoint and never alter document roles, source associations, facts or recorded geometry; the operator must use the normal evidence review workflow. Missing credentials still produce zero inference calls.
