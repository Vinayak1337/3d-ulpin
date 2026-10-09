# P10 — After the finale (full_product)

These start only after P9.1 passes, or when the owner explicitly moves them earlier. Each one fixes how the earlier attempts went wrong.

---

## P10.1 Schema learner done right (FP-LEARN)

**Moved forward on 10 October:** the owner wants the learner in the selection demo. Its first version is now [P3.5](P3-ingestion.md): Claude as development teacher, Sarvam as runtime teacher, and a Stage A online student. What remains here after the finale is to widen it across many real imports and run shadow-mode promotion.

**Gate:** FP-LEARN-TEST · **Depends:** P3.5 in use for a while (reviewed mappings accumulate)

```text
Follow H21 §C literally before anything bigger:
1. Dataset = reviewed MappingExamples from real imports (officer-accepted mapping-agent proposals and manual
   mappings), deduplicated by layout, split by source family; Sarvam-derived outputs excluded unless written
   permission exists.
2. Baseline = deterministic exact-family reuse. Model 1 = scikit-learn HashingVectorizer + SGDClassifier(log_loss)
   pairwise field->target with partial_fit; features from names, neighbours, types, value shapes.
3. Evaluate on held-out families: precision on auto-committed fields must be 1.0 (threshold set on a calibration
   family, never the holdout), report coverage gain over exact reuse.
4. Only if a measured gap remains, try a small local encoder or cross-encoder (sentence-transformers) or the
   V7 Qwen3-Reranker result as a ranker, with the same evaluation.
5. Shadow mode first; auto-promotion stays off by default.
```

**Expect back:** coverage gain over exact reuse at precision 1.0 on held-out families, or an honest "no gain".

---

## P10.2 Learned document ↔ building/floor linker

**Gate:** R-FP-LEARN / AI-08 · **Depends:** P4.6 baseline measured; ≥200 reviewed candidate pairs from ≥5 projects

```text
Restart the association lane only with: (a) the P4.6 rule baseline measured, (b) at least ~200 reviewed pairs
including hard negatives (adjacent floors, same name/different building, obsolete revisions, no-match), (c)
splits by project. Model: a cross-encoder/reranker (sentence-transformers or a pretrained reranker) over
(document span, candidate record summary), fine-tuned with standard tooling; compare with zero-shot strong
models first. Report wrong-building and wrong-floor accepts separately; the gate is "no critical wrong accept"
plus useful coverage over rules. Reuse the retained ML-DISTILL history as lessons, not as a codebase.
To get more training pairs, a strong teacher may pre-label candidate pairs over real documents, following the
P4.7 recipe (permission check, teacher passes dev first, deterministic citation check, ≥10% human spot-check,
pseudo_label lineage). Reviewed officer decisions remain the preferred labels.
```

**Expect back:** a measured improvement over the rule baseline, or a documented decision to keep rules.

---

## P10.3 Scale, public portal, assistance

**Gate:** FP-SCALE, FP-PUBLIC, FP-ASSIST, FP-DEPLOY

```text
Pick these up from release-plan.json in order of owner priority. Each one gets its own short prompt written at
that time, in this folder's format, and must keep the canonical record and the review rules unchanged.
```
