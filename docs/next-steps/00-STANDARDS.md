# 00 — Standards every prompt follows

Read this once before any prompt in this folder. Where it disagrees with an older handoff, **this file and the release plan win** for work started from these prompts. AGENTS.md data, safety and permission rules still apply.

---

## 1. Scope discipline

- Every task names **one release-gate test** it moves (`release-plan.json` → `tests`), or says it's P0 hygiene.
- Build the **smallest end-to-end result** first, then widen. No new format, adapter, export variant or audit unless a prompt asks for it.
- Reuse existing modules (see the README table). Adding a new module, store, queue or authority needs a one-sentence reason in the report.
- One writer per shared seam. Shared seams are allowed: the agent that owns a prompt owns the seams that prompt names.

## 2. Data rules (short form of AGENTS.md)

- **Originals are immutable.** Store bytes once with SHA-256, issuer, URL, acquisition date, licence/permission state, geography, CRS and vertical reference. Every derivative points back to its original and a locator (page/region/row/cell/entity/feature id).
- **States are distinct and fixed:** `unknown | absent | null | withheld | conflicting | estimated | candidate | source_supported | reviewed`. Never collapse them. Never turn unknown into 0.
- **No invented records, geometry, heights, controls, IDs or labels.** Public research data is fine for development if it's labelled `test_only` with its origin. Indian operational claims need Indian sources.
- **Permission states:** `confirmed | unconfirmed | restricted`. `unconfirmed` is allowed for local development and must be shown in claims; it is not a blocker.
- **Official parcel ULPIN ≠ application IDs.** A building can span parcels; a unit can span floors; a floor is not a unit.

## 3. Units, frames and geometry

- Store source coordinates and source CRS unchanged. Each **area** has a declared local frame: origin (lon, lat, ellipsoidal height), axes east/north/up, metres. The scene receives local metres only (`packages/scene/src/types.ts`: "the scene never reprojects").
- Heights carry a **vertical reference**: `ellipsoidal | orthometric:<datum> | building_relative | local:<benchmark>`. Convert only through a named, recorded operation.
- Indian CRS mistakes (wrong UTM zone, Everest/Kalianpur labelled WGS84, swapped lat/lon, missing `.prj`) produce `crs_unverified`. **Never guess a zone or datum from coordinate ranges.**
- Indian literals are kept as literals: khasra `123/4`, Devanagari digits, `10'6"`, lakh grouping, gaj/bigha/marla. Regional units need a sourced conversion, otherwise `needs_input`. A floor label (`G`, `UGF`, `Stilt`, `B1`, `Mezz`, `Terrace`) never becomes an integer level without a reviewed level schedule.
- Polygons: outer ring counter-clockwise, holes clockwise, closed, valid (`ST_IsValid`). Prisms: `lowerM < upperM`; `null` heights are drawn flat, never extruded to a guess.

## 4. The canonical building record

`normalized-building/1` (built in P1.1) is the **single contract** between the backend and the Three.js scene. It maps 1:1 onto `FootprintInput`, `StoreyInput`, `LevelInput`, `SpaceInput`, `BaseFeatureInput` and the overlays in `packages/scene/src/types.ts`.

- Every value is `{ value, state, unit?, citations[], method, revisionId }`.
- `method` is one of: `source_literal | deterministic:<op>@<ver> | model:<id>@<sha> | reviewer:<id>`.
- The scene and the Studio read **only** this record (through the API projection) plus tiles. No screen computes or invents a value.

## 5. Candidates and review

- Every proposal from a model, agent or heuristic is a **DomainCandidate** (H27 §B): `task, taskVersion, sourceParts, inputManifest, methodNameAndVersion, modelHash?, parameterHash, outputRef, confidenceOrError, coverage, limitations, state (candidate|abstained|unsupported|failed|reviewed)`.
- **No candidate writes the registry.** An officer accepts, rejects (with a reason) or asks for a source through the existing review commands. Accepting creates a new immutable revision with lineage candidate → reviewer → revision.
- A model never allocates an identifier, changes source coordinates, sets a legal right or declares an illegality.

## 6. Contracts and APIs

- Wire types live in `packages/contracts` (one source). The NestJS controller validates against them, `docs/api/openapi.json` is regenerated, and `packages/api-client` is regenerated from it. No hand-copied types in the Studio.
- Endpoint naming: plural nouns, `GET` reads have no side effects, writes are idempotent with an `Idempotency-Key`, stale writes return `409` with the current revision.
- Errors: `{ code, message, details?, retryable }`; codes are stable `UPPER_SNAKE`.
- Long work runs as jobs: `POST` returns `202` with a job id; progress goes over the existing SSE stream; results are fetched by id.
- Access: everything private by default; the local operator subject is required; source bytes are only reachable through the authorised original route.

## 7. ML rules

- **Evaluation set before training.** It is split by geography, project or source family, and the holdout is frozen and hashed **before** any model sees it (`preregistration.json`).
  - Truth comes from people who labelled it independently of us (publisher labels with review, such as RAMP), from official literals (registry fields, stated plan dimensions), or from publisher data dictionaries.
  - There is no team labelling (owner, 10 October).
  - Teacher or agent outputs are never truth.
- **Baseline first:** the existing model as installed, or rules/regex, or a strong pretrained model without fine-tuning. Fine-tune only on a measured gap, with enough labels (hundreds of images, or 300+ text examples across 5+ families).
- **Per-class metrics, never a single pooled score.** Report the denominators. State the abstention rate.
- **Model card JSON** for every model used: source URL, revision, licence, weight SHA-256, preprocessing profile, training data (or "undocumented"), evaluation results, known failure modes.
- Use standard tooling (torchvision/RF-DETR/CubiCasa scripts, Hugging Face TRL/PEFT, sentence-transformers, scikit-learn). Don't build custom training frameworks.
- Hardware: one GPU owner (RTX 3070, 8 GB; plan for ≤6 GiB). Offline weights (`HF_HUB_OFFLINE=1`), safetensors/ONNX only. One plain results JSON per run (git SHA, data hash, model hash, metrics). Experiments run in a plain environment (P4.0). The heavy containment check runs once before integration, not per experiment.
- **Teachers (owner decision, 10 October):**
  - Claude (Opus 5.5, the lead) is the development teacher.
  - Sarvam is the runtime teacher.
  - Our learners may train on their verified outputs, because these learners don't compete with any provider. This supersedes the old H21 permission rule for this use.
- **Distillation (teacher → student) is allowed for language and layout tasks, and only when it's real distillation:**
  - the teacher runs over **many real, unlabelled inputs**; it doesn't hand-write examples;
  - every output passes deterministic checks (schema, no literals, executor dry-run, each quote exists at its locator, units converted by code);
  - agreement with the independent truth source (publisher dictionary, registry field) is measured on development data and reported;
  - the teacher never sees the held-out families or projects;
  - outputs are recorded as `pseudo_label` (`method: model:<teacher>@<version>`), never as truth;
  - officer corrections outrank teacher labels;
  - private or restricted documents never go to an external provider.

  Pixel tasks (roofprints, room masks) use human-reviewed labels (RAMP, CubiCasa) and pretrained vision models, not LLM teachers.

## 8. Verification policy (lean)

The agent may write whatever unit tests help it build. **Reviewers check only these:**

1. **Contract check:** API responses for the changed routes validate against the published schema. One test file per route group.
2. **Invariant checks** (only where the change touches them):
   - the source hash is unchanged after processing;
   - a candidate can't reach the registry without review;
   - a stale revision is rejected;
   - a cross-site/unauthorised read is denied;
   - unknown never becomes 0;
   - a model output with literals (EPSG code, coordinates, invented IDs) is rejected.
3. **Golden journey:** the single end-to-end script `scripts/golden-journey` (built in P9.1) still passes after the change. Until it exists, run one real input through the UI or API by hand and record it.
4. **One difficult real input** per feature: an incomplete, conflicting or messy source. Show the honest state it produces.
5. **Regression test only for a bug actually found.**

There are no coverage targets, test matrices or per-format campaigns, and no re-proving hashes of unchanged files.

## 9. Report format

Every agent ends with this, and the same text goes at the top of the relevant ledger entry:

```
TASK   <prompt id> — <title>            GATE <test id>
WORKS  <what a person can now do, one line>
SEE IT <Studio URL or one curl command>
INPUTS <real inputs used: good one + difficult one>
GAPS   <what is still missing or unqualified, one line>
```

Numbers go in `docs/evidence/<gate>/<task>/result.json`. Don't put hashes in prose, and don't write reports longer than a page.

## 10. Git and process

- One branch per prompt (`task/<prompt-id>-<slug>`), from the current integration head. Keep diffs small; split anything over about 800 changed lines.
- Commit messages say what changed and why. Never commit secrets, `.env`, large originals or weights.
- Don't push to `main`, deploy or call live paid providers without the owner's go-ahead. Sarvam test calls are approved for the agent tasks that name them, with one configured key and no rotation across accounts.
- If something fails twice for the same reason, stop and apply the AGENTS.md failure-recovery workflow. Don't retry unchanged.
- **Workers** (SPRINT-SELECTION §3):
  - they work only in their own worktree and on their own branch, and touch only the paths their task file names;
  - they never change or delete originals, `.env` or Docker volumes, and never push;
  - they stop at their time box with a resumable checkpoint and report in the §9 format, with commits and exit codes;
  - the lead reviews every return before integrating it.

## 11. Code quality (owner direction, 10 October)

The repository has no formatter or linter configured, and older files differ in style. These rules keep new code readable without mass-reformatting old files.

- **New files** follow the readable style of `packages/server/src/modules/model-gateway/gateway.ts` and `apps/api/src`: spaces around operators and after commas, one statement per line, lines of 120 characters or fewer.
- **Edits in an existing file** match that file's style. Don't reformat lines you aren't changing.
- **Small units.** Functions do one thing and stay under about 40 lines. Split a long function by responsibility into named helpers (for example one helper per value kind) rather than one large closure. Avoid chained ternaries and several statements on one line.
- **Names say what things are.** No single-letter names outside short lambdas. Types and exported functions get a one-line comment only where the *why* isn't obvious.
- **Reuse before writing.** Search for an existing helper, reader, schema or script first. No duplicate helpers, no parallel modules, no copy-pasted blocks.
- **Nothing left behind:** no dead code, commented-out code, debug prints, unused exports or stray files. Evidence files are compact JSON (no pretty-printing of large arrays; round coordinates sensibly); large outputs stay under `E:/BhuAayam-data/`.
- **Python:** PEP 8, type hints on functions, `pathlib`, a `main()` behind `if __name__ == "__main__":`, no module-level side effects, lines of 120 characters or fewer.
- **Tests** sit next to the code, following the existing pattern. Test names describe behaviour. Test the contract and the invariants, not implementation details.
- **Self-review before reporting.** Read your own `git diff staging...HEAD` as a reviewer would and fix what you would flag. The report's `DESIGN` line names the main files and functions and how they fit together.

**The lead's review** of every return reads the full diff file by file, not just the report. It checks:
1. correctness of the key logic;
2. owned paths only;
3. these style rules (including `awk 'length>120'` on new files);
4. duplication of existing code;
5. evidence size;
6. that the worker's key check passes when re-run.

Requested changes go back to the same worker session, with the exact changes listed.
