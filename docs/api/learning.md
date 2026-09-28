# AI-06A offline source-field mapping experiment

This is an **experimental, unpromoted** field/operation candidate. It scores only the three existing building mappings: `building.sourceKey` with `literal_identifier@1`, `building.name` with `literal_text@1`, and `building.geometry` with `geojson_polygon@1`. It does not read arbitrary documents, normalize raster or point-cloud payloads, infer ownership, convert geometry, or change ingestion routing. The deterministic registry and validation remain the authority.

## Evidence and eligibility

The checked corpus is [`learning-corpus.json`](learning-corpus.json). It records source URL, issuer, geography, acquisition date, unchanged sample and issuer-metadata byte hashes, permission basis, field definitions, evidence links, label decisions, and source-family split. New originals and the model stay outside Git in `/Users/vinayak/.codex/task-data/ai-06a-learning/`. NOLA and NYC are training families; San Francisco was held out from training, threshold choice, and hyperparameter choice. The acquired NYC sample excludes the retained `DOITT_ID=353927` benchmark feature. All three foreign families are research-only and excluded from Indian production training qualification.

The New Orleans portal calls its source building footprints and declares a public-domain licence. Its sampled `globalid` is text; a 28 September 2026 issuer API count returned 162,486 rows and 162,486 non-null distinct values. NYC's issuer dictionary defines `name` as a building name but cautions that it is not actively maintained; all five newly acquired NYC sample names are null. It also distinguishes building identifiers from tax-lot keys and warns that BINs can be duplicated. San Francisco's issuer dictionary identifies `sf16_bldgid` as a building ID, `p2010_name` as a building name when present, and `shape` as MultiPolygon; two of five sampled names are null. Field definitions support schema labels; absent row values remain absent. Numeric ID fields with no allowed exact string-copy operation and ambiguous alternate identifiers are explicitly `unknown` and excluded from negative training labels. No Sarvam output, teacher agreement, private tenant content, or generated example enters the corpus.

The learner builds field profiles from paths, issuer definitions, declared types, and aggregate value shapes and null rates. It never embeds raw IDs, name values, coordinates, or complete source rows. Its decoder permits only text for the string-copy/text targets and GeoJSON polygon geometry for the geometry target. Checked field/target decisions are deduplicated at the source-layout level; five building rows from one issuer still contribute one schema example per field. Original hashes are checked before training and inference.

## Reproduce the local run

The local run used Python 3.11 and the pinned optional dependencies in [`requirements-learning.txt`](../../services/geo/requirements-learning.txt). The base is the MIT-licensed [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`, loaded locally with `trust_remote_code=False`. Its `model.safetensors` SHA-256 is `1a55775f53449dac10a2bcbc312469fac40b96d53198c407081a831f81c98477`. Full required-file hashes are in the run receipt. Its last BERT encoder layer alone was fine-tuned on CPU with 24 AdamW steps, seed 17, two Torch threads, and a maximum of 128 input tokens. The source and target texts use E5's `query:` and `passage:` prefixes with mean pooling. The threshold for each encoder was selected only on its training-family scores.

From the repository root, with the retained originals and downloaded base model at the paths above:

```sh
LEARNING_RUN=/Users/vinayak/.codex/task-data/ai-06a-learning/run-reproduction
PYTHONPATH=services/geo TOKENIZERS_PARALLELISM=false /Users/vinayak/.codex/task-data/ai-06a-learning/venv/bin/python scripts/usp/learning/train.py --corpus docs/api/learning-corpus.json --originals-dir /Users/vinayak/.codex/task-data/ai-06a-learning --base-dir /Users/vinayak/.codex/task-data/ai-06a-learning/base-model --output-dir "$LEARNING_RUN" --steps 24
PYTHONPATH=services/geo TOKENIZERS_PARALLELISM=false /Users/vinayak/.codex/task-data/ai-06a-learning/venv/bin/python scripts/usp/learning/infer.py --corpus docs/api/learning-corpus.json --originals-dir /Users/vinayak/.codex/task-data/ai-06a-learning --base-dir /Users/vinayak/.codex/task-data/ai-06a-learning/base-model --candidate-dir "$LEARNING_RUN" --model tuned
```

The run directory is immutable to the CLI; choose a fresh output directory for each repeat. The recorded run is `run-04`. Its `run.json` has full per-field decisions, hashes, counts, timing, peak process RSS, and adapter reload comparison. Its SHA-256 is `01cc8fd5de71618e28cc55272a92de8e220c3a8fc82208514e8ec3e54a290f0e`. The saved 7,099,600-byte `candidate.safetensors` SHA-256 is `4e20fae70fa4b39acf154796933eee17c7b7076f96c688604ce29f2223eb1a03`. The fine-tuned layer has 1,774,464 trainable parameters; maximum absolute weight change from the pinned base was `0.000511512`. A fresh base plus saved adapter reproduced the holdout scores exactly in the run (`reloadMaxCosineDelta=0`).

## Measured result

| Route | Held-out exact fields | Correct positive mappings | Positive abstentions | False maps on negative fields |
| --- | ---: | ---: | ---: | ---: |
| Generic lexical/type rule | 7/7 | 3/3 | 0/3 | 0/4 |
| Unchanged E5 | 4/7 | 0/3 | 3/3 | 0/4 |
| Fine-tuned E5 | 5/7 | 1/3 | 2/3 | 0/4 |

There were **12 checked training fields** (4 positive), **7 held-out fields** (3 positive), and **8 explicitly unknown fields** excluded from training/evaluation. The candidate's training exact count rose from 10/12 to 12/12. Its held-out improvement was confined to the geometry mapping; it still abstained on the held-out building ID and name. Peak process RSS was 1,206,943,744 bytes and elapsed run time was 5.713 seconds on the local M3. This narrow result does not beat the inexpensive lexical/type rule or qualify a general learner. The candidate remains offline; no production model, provider route, queue worker, or API contract was changed.
