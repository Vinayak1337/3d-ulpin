# Offline document extraction trial

This optional host-side runner evaluates one pinned Granite Docling checkpoint on
selected PDF page regions. It does not update the document pipeline or call a
provider during inference. The PNG, DocTags, Markdown, worker logs, and receipts
remain in an immutable output directory outside the repository. All extracted
text is marked model-derived, including text from a PDF with native text.

Create a separate virtual environment using
`services/geo/requirements-document-models.txt`. Place the required files from
`ibm-granite/granite-docling-258M` revision
`982fe3b40f2fa73c365bdb1bcacf6c81b7184bfe` in a local model directory.
The adapter verifies every expected file hash before processing.

The JSON plan has `schemaVersion: "ai-04a-offline-trial-v1"`, `sources`, and
`regions`. Each source needs an `id`, `pageCount`, and `original` with
`localPath`, `bytes`, and `sha256`. Keep issuer, original URL, acquisition date,
and permission information in the source record. Each region needs an `id`,
`sourceId`, one-based `page`, and normalized `[x0, y0, x1, y1]` `bboxNorm`.
The runner accepts at most two originals of 16 MiB each and four regions.

From the repository root:

```sh
PYTHONPATH=services/geo /path/to/venv/bin/python \
  scripts/usp/document-models/run_trial.py \
  --plan /outside-git/trial-plan.json \
  --model-dir /outside-git/base-model \
  --output-dir /outside-git/run-01 \
  --device cpu
```

The device may be `auto`, `cpu`, or `mps`; CPU uses float32 and MPS uses
bfloat16. On Windows a standard-library bootstrap waits for Job Object
attachment before executing each renderer or model worker in that same process.
The job limits its private bytes; the runner observes combined descendant RSS
and stops identity-pinned descendants even where nested Windows jobs do not
inherit them. Rendering is capped at 60 seconds per region, model
inference at 240 seconds per region, and these stages share a 600-second
processing budget. Initial source/model hash and metadata validation occurs
before that budget and is bounded by input sizes, not by a wall-clock timer.
The receipt records
the selected device and dtype, source, model, plan, region, render, artifact,
and resource hashes. Worker errors or resource caps stop the trial. A no-text
result is marked unusable; a failed region stops the remaining selection.
Failed runs remain available for inspection. Compare the output with the
rendered source before deciding whether it is suitable for any later integration.
