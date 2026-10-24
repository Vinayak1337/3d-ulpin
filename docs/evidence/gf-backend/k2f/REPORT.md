TASK   K2f — Complete tessdata and one Tower comparison            GATE GF-AI backend / GF-BACKEND
WORKS  The unchanged OCR runner produces bounded partial Tower candidates with the complete prefix.
SEE IT git show HEAD:docs/evidence/gf-backend/k2f/ocr-comparison.json
INPUTS Retained config/language/OSD assets and K2d crop; difficult Tower page-1 region unchanged.
GAPS   Registry admission deferred; OCR is capped/partial, no reviewed facts or global API-prefix activation.
DESIGN complete-prefix.py copies and verifies retained assets; ocr-comparison.mjs reuses readDemoOcrPaths
       and the existing runner/supervisor with only --tessdata changed. Outputs and logs stay private.
       admission-decision.md records the lead's three unadopted governance options; no gates/readers changed.
COMMITS 7e03aab4 docs(backend): defer model-roofprint registry admission (K2f decision)
        Final checkpoint: docs(ocr): complete tessdata prefix and one Tower 3 comparison
CHECKS Prefix copy/hash check, native TSV header check, one runner comparison, backend typecheck,
       Python/Node syntax and new-code style audits, working/staged diff checks: exit 0.
NEXT   Owner decides API-prefix activation and receipt re-pin separately; lead revisits admission after demo.

## Scope and outcome

Renamed the clean assigned branch and explicitly fast-forwarded staging as instructed. No rebase/push.
The retained install supplied OSD as well as both config directories: no acquisition, catalogue edit or pin edit.
All copied files match their still-unchanged origins, including the previously pinned English/Hindi models.
`prefix.json` retains source paths, sizes, hashes, native package/version and Apache-2.0 licence provenance.

The native check retained TSV privately and verified its `text` header before the single runner comparison.
`ocr-comparison.json` records timings, RSS/Job private peaks, statuses and token-presence booleans only.
The result is partial at the unchanged item cap; no queried token occurs in the retained lines. This is **not**
evidence of absence from the original plan, extraction accuracy, independently verified storeys or Hindi OCR.
Same source/page/region/render, runner/adapter hashes, package versions, model files, native executable and
English data were asserted equal to K2d. Only the prefix changed. No second comparison or crop sweep.

TSV, recognised text, runner receipt and logs remain under the new owned private runtime debug directory.
The final evidence wrapper extracts the safe item-limit flag from the saved result; it does not rerun OCR.
The existing non-secret OCR configuration, native processes, containers and volumes remain untouched.
The new prefix is available for an owner-approved activation; this task did not switch global API configuration.
No registry/area/geometry, chunk-mapping, model-training, agent or Studio code was touched.

The admission decision preserves draft revision zero and the positive-revision recorded-reader invariant.
Demo acceptance remains officer-reviewed source selection, not a qualified registry footprint or measurement.
No complete GF-AI or GF-BACKEND gate pass is claimed. Numeric results and check statuses are in `result.json`.
