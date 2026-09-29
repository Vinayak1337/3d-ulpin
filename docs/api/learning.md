# Ingestion learning — field mapping and planned document association

**Desktop increment, 29 September:** worker `27a845c` is reviewed and integrated as `6f9dc71`. The trainer now has Windows process-tree limits, exact input/code/settings freezes, useful-positive calibration, device-aware tensors and saved/reloaded inference checks. V5 has 62 scored fields across 11 eligible families. No V5 fit or held-out prediction ran: key/name calibration each still has only Chesterfield as an eligible positive family. Geometry has two positive families and a real non-building polygon control. GNWT's catalogue explicitly lists OGL-NWT, but building-layer applicability relative to separate bulk terms remains unresolved; its evidence is retained but excluded. Halifax/Kitchener evaluation remains unopened.

Lead verified all 12 code hashes, retained source hashes and 62 input proofs against `E:/BhuAayam-data/task-data/ai-06a-learning/desktop-ai06a/completion-v5/completion-receipt.json` (SHA256 `ca33a30f0d2ee1390a6436f2d1a7fe7cf672009ce56a050fc431311b71918011`). Worker checks: nine passed, one optional full-NYC skip; the final supervisor correction passed its focused check. CPU development-only unchanged-base reload matched exactly. CUDA and the complete V5 fitting path remain unexecuted. Earlier originals, runs and takeover backups are preserved. Code acceptance is not model qualification; the next assignment addresses the missing eligible calibration family before fitting.

**Historical trained result, 28 September:** corrected candidate `3a22bb2d92a2858a90e29e99e8a192b03d63701c` is integrated, with an actual saved E5 fine-tune and reproducible inference. It remains experimental and unpromoted. On six DC diagnostic fields, the lexical/type baseline matched6/6; base and tuned E5 matched4/6 and abstained on both positive mappings. This does not justify replacing the existing deterministic conversion/validation path.

The learner scores three existing field/operation targets: `building.sourceKey` / `literal_identifier@1`, `building.name` / `literal_text@1`, and `building.geometry` / `geojson_polygon@1`. It does not read arbitrary documents, normalize raster/point-cloud payloads, establish ownership or modify geometry. Semantic matching, per-row operation eligibility and whole-record conversion remain separate checks.

## Desktop quality plan — 29 September 2026

The user prioritizes the best supported quality and authorizes Astra and local GPU training. The immediate deliverable remains reliable proposals for the three field/operation targets above. This is not a general document model or a production accuracy claim. Training completion, lower loss and GPU use are not acceptance criteria by themselves.

1. **Repair the evidence gap first.** Reuse hash-checked official originals and independently support every label from publisher metadata and actual exported types. Audit family/issuer/schema duplication before splitting; repeated rows and related layers are not independent schema examples. Keep unknown and unsupported labels excluded. Retain difficult negatives such as non-building identifiers, names and polygons. Seek positive key/name/geometry coverage in at least two independent calibration families. This is a minimum for the bounded experiment, not proof of generalization. Broader claims require additional independent sources, including eligible Indian sources for Indian operational claims.
2. **Keep evaluation useful and separate.** Freeze corpus/input hashes, family assignments, label rules, training settings, calibration policy and acceptance criteria before fitting. DC and SF are observed diagnostics. Reserve genuinely unused families for final comparison; Halifax alone lacks a positive building-name field on its polygon layer, so it cannot qualify name recall. Add eligible untouched coverage or explicitly leave that target unqualified. Do not score final evaluation while developing the implementation or selecting settings. Previously inspected schema facts may support curation, but model predictions on final evaluation must remain unseen until the candidate and thresholds are frozen.
3. **Make the existing experiment runnable and reproducible.** Audit and fix the current POSIX-only `resource`/`SIGALRM` handling on Windows and all device placement needed for CUDA, including tokenized inputs, labels, loss weights, scoring and adapter reload. Keep resource limits enforceable on Windows. Use the pinned local E5 checkpoint and locked dependencies. For the first controlled run, retain the planned 64-step configuration rather than assuming more steps improve quality. Use CUDA only when useful, with desktop VRAM headroom; record device, precision, seed, elapsed time, peak memory, dependency versions and artifact hashes. Verify saved-model inference on development/calibration inputs before opening final evaluation. Do not require bitwise CPU/GPU identity; declare a numerical tolerance and investigate changed decisions.
4. **Compare actual decisions.** Evaluate the lexical/type baseline, frozen base encoder and saved/reloaded candidate on the same independently labelled inputs. Report counts by target and source family: correct positives, wrong-target positives, abstentions and false mappings of negatives; derive precision/recall only with their denominators. Separate semantic proposals from row-level wire/operation eligibility. Overall exact accuracy alone can reward abstaining on most fields, so inspect calibration tradeoffs without consulting evaluation. A quality-improvement claim requires a measured positive-mapping gain without increased incorrect mappings on the declared comparison; otherwise retain the stronger baseline and describe the observed tradeoff. Small source samples remain diagnostic, even with perfect scores.
5. **Review before use.** Astra owns the corpus/trainer implementation; the lead reviews leakage, split enforcement, calibration decisions and reproducible saved inference. Fix concrete defects and run focused checks only. The first fit is a controlled experiment, not an obligation to adopt its model. If it fails to improve, use development evidence to define the next bounded experiment and preserve an untouched final evaluation set; do not repeatedly optimize against disclosed holdout results. Any production integration remains a separate reviewed step with deterministic validation and an abstention/review path.

The current learner owner is ordinary task `01a0ede2-c009-7972-ae01-fa4545b54fd9` (AI-06A Learner Full Access), requested Astra/max. Observed turn metadata confirmed that model/effort, approval `never` and `danger-full-access`; actual tier remains unobserved with default configured. The older learner is stopped and must not share its checkout. Local source acquisition and bounded training are already authorized.

## Final training goal — document links to buildings and floors

On 29 September the user added document-source linking to the correct buildings and floors as a final fine-tuning goal after heterogeneous ingestion works. The current three-target field mapper remains an earlier component. [AI-08 in the execution plan](../orchestration/ADAPTIVE_INGESTION_EXECUTION.md#ai-08-final-association-learning--user-addition-29-september) defines the later dependencies, label corpus and evaluation.

The intended flow is: ingest and extract with citations; identify candidate canonical buildings; resolve source-supported floor references within the correct building; propose the relationship with its evidence or abstain for review. Preserve whole-building and multi-floor documents, ambiguous floor conventions, no-match cases and references to data that arrives later. Train only on permitted independently checked relationships, with documents/building identities and source families separated across evaluation splits. Compare to exact-reference rules, measure wrong-building and wrong-floor links separately, and qualify saved inference in shadow before any production decision. Every link must remain traceable to the original document and the selected record revisions. No association fine-tune or floor-link accuracy is claimed yet.

## Open model fit review — desktop, 29 September 2026

The user authorizes choosing, downloading and locally testing a suitable open pretrained model. E5 was already authorized and downloaded; its worker's pending Git write approval was a filesystem boundary, not a model-use permission. Prefer adapting pretrained models and building our own evidence/identity/validation pipeline over pretraining a foundation model from random weights. The current labelled corpus cannot support that scale of pretraining. File readers still decode GIS, raster and point-cloud structures; language models do not replace those readers.

| Requirement | Candidate and verified publisher information | Current decision |
| --- | --- | --- |
| Source-field semantics and candidate retrieval | [Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B), Apache 2.0, multilingual text embeddings, about 1.19 GB weight file | Strong alternative to the retained E5 baseline; assess retrieval coverage on our checked examples before substituting it. Not downloaded in this review. |
| Score document/context against candidate building/floor records | [Qwen3-Reranker-0.6B](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B), Apache 2.0, instruction-conditioned multilingual pair ranking | First new checkpoint downloaded and exercised below. Candidate for later supervised association adaptation; no property-link qualification yet. |
| Scan, table and layout extraction | [PaddleOCR-VL-1.6](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6), Apache 2.0, 0.9B document model, about 1.92 GB weights | Next OCR candidate for actual unreadable scans. Full-page parsing requires its surrounding layout pipeline; plain Transformers covers elements/text spotting. Check target Indian languages and exact citations on real documents. Not downloaded. |
| Smaller multilingual retrieval alternative | [Granite Embedding 311M multilingual R2](https://huggingface.co/ibm-granite/granite-embedding-311m-multilingual-r2), about 623 MB weights; Hindi/Marathi/Telugu included in its enhanced language set | Relevant alternative if encoder cost or Indian-language retrieval is the measured bottleneck. Card lists Apache 2.0 and separately notes Gemma tokenizer terms; retain both notices in any adoption. Not downloaded. |
| General visual document interpretation | [Qwen3.5-2B](https://huggingface.co/Qwen/Qwen3.5-2B), Apache 2.0, vision-language model; about 4.55 GB weights | Optional fallback after a demonstrated extraction/interpretation gap; less VRAM headroom than specialized small models. Not downloaded or qualified. |

Also reviewed [Qwen3-VL-Embedding-2B](https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B) for page-image retrieval and [BGE-M3](https://huggingface.co/BAAI/bge-m3) for dense/sparse retrieval. Neither establishes exact floor identity. [Querit](https://huggingface.co/Querit/Querit) advertises 0.43B active parameters but 4.92B total, so its active count is not a small resident-weight budget; its listed languages omit Hindi. Retained Granite Docling is English-focused and its earlier limited extraction result does not qualify Indian registry OCR. Publisher benchmarks do not identify the best model for our source/link labels.

**Actual local check:** downloaded only Qwen3-Reranker-0.6B at revision `e61197ed45024b0ed8a2d74b80b4d909f1255473`: 1,207,485,009 bytes including tokenizer/config/card, all files hashed and the safetensors weight hash matched publisher LFS metadata. No repository remote code was downloaded/executed. Installed a separate Python 3.11 environment with PyTorch 2.8.0+cu128 and Transformers 4.57.6; the E5/geo environments are unchanged. A single frozen FP16/SDPA inference pass on the existing 25 V4 **training/development** fields (75 candidate pairs; at most 238 tokens, batch 3) took 1.297 seconds after loading, with 1,220,791,808 bytes peak allocated GPU memory and 1,245,708,288 reserved on the RTX 3070. Process RSS at completion was 2,532,204,544 bytes, not a sampled peak. Full script elapsed time including checks/loading was 29.813 seconds. No fit occurred and no new held-out family was scored.

At the predeclared, uncalibrated 0.5 diagnostic threshold with existing type constraints, Qwen matched 21/25 fields: 7/7 positives, zero wrong-target positives, four false mappings on 18 negative fields. The lexical baseline matched 22/25 with the same 7/7 positives and three false mappings. This is a local compatibility/development result, not an improvement or document-association accuracy result. Do not select a new threshold against these results and call it held-out qualification. No production path or active model changed.

Local model, resolved dependencies, frozen inputs/configuration, script and result are under `E:/BhuAayam-model-evaluation/20260929/`. `reranker-download-receipt.json` pins every file; `reranker-smoke-result.json` contains the measured counts. For final AI-08, begin with exact identifier/parent constraints plus candidate retrieval and pair ranking, then fine-tune a small adapter only after eligible correct/incorrect/no-match relationship labels exist. [LoRA](https://huggingface.co/docs/peft/developer_guides/lora) is a suitable adaptation option to measure; this successful inference run does not prove its training memory or final quality. Keep the planned ingestion gate and untouched association evaluation intact.

## Sources and input provenance

The active [corpus](learning-corpus.json) is `usp-field-mapping-corpus-v4`, with `publisher-metadata-profile-v4` input features. Eight official issuer/schema families supply44 scored fields and16 explicitly unknown/excluded fields. Each retained sample has five source records; repeated rows do not become extra schema examples. Original bytes, issuer metadata, permissions, reference information and labels are pinned in the manifest. Originals and model artifacts remain outside Git under `/Users/vinayak/.codex/task-data/ai-06a-learning/`.

| Role | Families | Scored fields / positives |
| --- | --- | ---: |
| Training | New Orleans, NYC, MassGIS structures, Vancouver2015 footprints, Census county boundaries | 25 /7 |
| Threshold calibration | Calgary roof outlines | 7 /1 |
| DC diagnostic comparison | DC2021 building structures; originally reserved in v3, now observed | 6 /2 |
| Earlier diagnostic comparison | San Francisco footprints | 6 /3 |

All sources are foreign research inputs; no Indian operational training qualification follows. Corpus permissions include NOLA public-domain, NYC open-data policy, SF PDDL, MassGIS public-record reuse, Vancouver and Calgary open-government licences, Census public-use data and DC CC BY4.0. Keep issuer attribution and limitations with the source. No provider output, model prediction, private owner record or generated example enters the labels.

V4 derives encoder text from exact JSON pointers or NYC Markdown-table line locators in hash-checked publisher metadata: dataset title, field name, alias, description and declared type. Observed types, null/absence and aggregate value shapes come from the unchanged sample. Missing descriptions remain missing. Reviewer definitions, label reasons, target decisions and freehand source descriptions are excluded from encoder text. The lead re-derived all44 input strings and matched their saved hashes. Raw identifiers, names, coordinates and full rows are not embedded.

Source facts still need careful interpretation. NYC declares a numeric `doitt_id`, but its retained GeoJSON exports strings; the exact-copy operation can use those strings. Null-only NYC names retain their semantic label with zero compatible sample rows. Census county names, codes and polygons are negative building-field examples. MassGIS centroid-derived IDs and Vancouver numeric IDs remain outside the currently qualified stable literal-key operation; exclusion is not a claim that those source fields have no meaning. The OpenDataSoft in-memory shape adapter serves this offline corpus only and does not add a production upload format.

## Actual training and result

The base is MIT-licensed [multilingual-E5-small](https://huggingface.co/intfloat/multilingual-e5-small), revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`, loaded locally with `trust_remote_code=False`. The isolated [learning dependencies](../../services/geo/requirements-learning.txt) remain separate from the production geo image. V4 uses the same frozen configuration as the prior v3 run:64 AdamW steps, seed17, learning rate0.00002, two CPU threads,128-token inputs and only the last BERT layer trainable. No configuration was selected against the observed DC results.

The corrected fit changed1,774,464 parameters and took45.139 seconds, with1,337,131,008 bytes peak process RSS. Saved/reloaded cosine delta was zero. The lead independently loaded the saved adapter and reproduced all six DC decisions exactly. Worker focused checks passed (four passed, one skipped); `--noconftest` isolates these non-service checks from unrelated geo test dependencies.

| Route | DC exact / positive matches | SF exact / positive matches | Training exact / positive matches | Training false maps on negative fields |
| --- | --- | --- | --- | ---: |
| Lexical/type baseline | 6/6;2/2 | 6/6;3/3 | 22/25;7/7 | 3 |
| Base E5 | 4/6;0/2 | 4/6;1/3 | 17/25;2/7 | 3 |
| Fine-tuned E5 | 4/6;0/2 | 4/6;1/3 | 21/25;3/7 | 0 |

The tuned candidate abstains on NOLA `globalid`, NYC `doitt_id` and `name`, and MassGIS geometry in training. Its DC failures are abstentions on GlobalID and geometry. Calgary calibration supplies only one geometry-positive field and no positive source-key/name examples, so it cannot qualify those two targets. The lexical baseline's three incorrect Census mappings also show why generic header rules alone must not activate arbitrary-source normalization. Neither this small diagnostic set nor the training score qualifies automatic conversion. The candidate stays offline; no production queue, model selection or API contract changed.

## Retained artifacts and reproduction

All paths below are relative to `/Users/vinayak/.codex/task-data/ai-06a-learning/`:

| Artifact | SHA-256 |
| --- | --- |
| `learning-corpus-v4-immutable.json` | `67563710df057d89c65a457cb7a3bed77c19b3a1c50aa73da59f5a70e3e67ed5` |
| `input-proof-v4.json` | `1edff34b7bf20d2959f9e24b3113d72a0cd24427692c2d20560020434f3939fb` |
| `fit-freeze-v4.json` | `bec48eb6b1a33717676d70240b474c0894d983e7cf28efd5978d40e3728877e0` |
| `run-08-v4-correction/candidate.safetensors` | `4debdfcb089f4c92f99a2a08a5d86bf1eb9b8d9f44239667f9f22c69aa3e1ab3` |
| `run-08-v4-correction/run.json` | `46597c1f0b4a3bb59d834068d2ff2aa8f63c9835300bec527654df0c7be8800c` |

Replay the saved candidate without fitting again, from the repository root:

```sh
LEARNING_DATA=/Users/vinayak/.codex/task-data/ai-06a-learning
PYTHONPATH=services/geo TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=2 \
  "$LEARNING_DATA/venv/bin/python" scripts/usp/learning/infer.py \
  --corpus "$LEARNING_DATA/learning-corpus-v4-immutable.json" --originals-dir "$LEARNING_DATA" \
  --base-dir "$LEARNING_DATA/base-model" \
  --candidate-dir "$LEARNING_DATA/run-08-v4-correction" --model tuned
```

For an explicitly selected new experiment, `freeze.py` writes an exact `--output-proof` and `--output-freeze`; `train.py` requires both `--input-proof` and `--freeze-file` alongside corpus, originals, base and a new output directory. Run `--preflight-only` first; insufficient coverage exits before a model is loaded. The old `--steps`/`--seed` flags have been replaced by pinned configuration. Preserve every run and failed attempt. New learning qualification needs eligible independent schemas and positive calibration coverage for every enabled target. Historical V2–V4 inference uses its matching immutable corpus, not the changing repository manifest.

## Historical profile correction

V3 added five official families but fed some reviewer-authored target explanations into text labelled as issuer definitions. Its initially reserved DC result therefore cannot establish realistic unseen-input performance. V4 removes that input leakage; DC is now observed and the correction is diagnostic. Preserve `learning-corpus-v3-immutable.json` SHA256 `fa9fad47daa1a4716c9033003c7d59720ad9dccc36498604b257ccade633f1c3`, `fit-freeze-v3.json` SHA256 `2e81b2afa80330bbb8de1e25c8464a1633e37353a30c904be15564d4106611eb`, run07 receipt SHA256 `040208c295c3bc1d00119866d97b8901429fb9c4cbda3b3a70b7a81d2af41f44` and adapter SHA256 `ec1b80c40815f768a27fe504ba11c88f3d7a7fa8aa02e286eed782f9c4be3874` unchanged. The v2 input format likewise used reviewed summaries; its earlier scores remain historical, not source-only v4 evidence.

V2 remains in `learning-corpus-v2-immutable.json` SHA256 `60fb2e7044f084078a7b7f14bcb3e2a152eff11a7c878143d43b885a8e502af0`. Its24-step run06 receipt SHA256 is `123302c119abc83665e40e051bc5a433bf64961381be77798d267167ebb8f069`, and adapter SHA256 is `02ac1f3a87f66d505338918e4219b67f7832123ac9a41dd6c2a3ccc41c28e5db`. The earlier six-field SF lexical/base/tuned scores were6/6,4/6,5/6; this was already a diagnostic family, not a fresh holdout.

## Historical correction

The original `v1` corpus mistakenly excluded NYC `doitt_id` on the claim that its GeoJSON value was numeric. That claim confused the issuer's **declared numeric type** with the export's **JSON string wire type**. The earlier `run-01` through `run-04` originals, model files, and receipts are preserved outside Git and are not rewritten. The recorded `run-04` receipt SHA-256 is `01cc8fd5de71618e28cc55272a92de8e220c3a8fc82208514e8ec3e54a290f0e`; its adapter SHA-256 is `4e20fae70fa4b39acf154796933eee17c7b7076f96c688604ce29f2223eb1a03`. Its 12-field training and 4/7 base versus 5/7 tuned SF result reflect the incorrect label and the older feature/decoder profile. `run-05-corrected` was an intermediate diagnostic before parcel keys were moved to unknown; its receipt SHA-256 is `a0ea71ac79d874fd03398e0fab5297f515e1225300c5f359bc463845dfd5abed` and adapter SHA-256 is `9d47e11ef77a43d56ebacf992b8bf0059a60b6a87b77b325996d0a22636f42e6`. These are historical evidence, not comparable fresh evaluations or production claims.
