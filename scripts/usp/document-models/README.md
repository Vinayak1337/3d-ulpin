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
  --output-dir /outside-git/run-01
```

The receipt records source, model, plan, region, render, artifact and resource
hashes. The process stops after the first failed region; failed runs remain
available for inspection. Compare the output with the rendered source before
deciding whether it is suitable for any later integration.
