# AI-06E — saved V8 calibration diagnosis

30 September 2026. **The failed candidate has a cross-target score-ordering problem and a training-control regression.** Correct positive target rankings do not establish reliable rejection of non-building polygons. The null global threshold is the intended policy outcome; accepting everything below a different cutoff would not repair this result.

This is arithmetic on eight pinned, existing train/calibration artifacts only. No model/package import, model load, inference, fit, new threshold selection, calibrator, download, service, NET harness edit, corpus/label/config change or promotion occurred. Evaluation and diagnostic-family inputs/outputs were not opened. The two cutoff replays below use previously recorded V7 values; neither becomes a tuned operating point.

## Evidence and comparability

Primary read-only head: `3a13c62bc18eeb9561776b0f44e41aeb8350ee81`. Owned `56f9` worktree remains on `task/desktop-qwen-lora-v8`, preserving executable `59f81d9` and handoff `edade4a`. Supplied permissions are `never` / `danger-full-access`. Astra/high/standard was requested; actual model/effort/tier are not independently exposed.

The [standard-library summarizer](../../../scripts/usp/learning/diagnose_v8_saved.py) reads only the two saved development-input files, freezes, score matrices and result files. It joins by `(source,path)`, verifies identical labels, family/split, type masks, publisher text and all three prompts for **65 matching fields** (40 train, 25 calibration), and reproduces both historical baseline decision counts. The four additional V8 training fields have no base scores; they are never included in a claimed paired improvement.

The targets, retained base revision, FP16/SDPA, no-cache behavior and untruncated prompt/tokenizer path are shared. Base inference used batch three; tuned scoring used single pairs with FP32 adapters and deterministic execution. This is a comparison of recorded base versus final V8 outputs, not a same-execution numeric ablation. It cannot separate the effects of LoRA, the V8 training increment and individual optimization choices. All prompts were below both historical token caps. Saved tuned probabilities agree with sigmoid of the saved margins to maximum absolute residual **7.04e-8**, consistent with the original float32 two-token softmax. There is no observed score-column, label-join or margin-sign defect.

## What the null threshold means

The existing policy requires zero incorrect calibration accepts and at least one positive from every target. The negative Census county polygon scores **0.999322772** for building geometry. Both calibration keys and both names score lower. Any global cutoff low enough to retain key/name coverage therefore accepts the county polygon; rejecting it loses every key/name positive. This inequality alone explains the null result without searching another threshold.

| Calibration target | Positive fields | Tuned positive range | Highest eligible negative-pair score | Negative pair |
| --- | ---: | ---: | ---: | --- |
| Source key | 2 | 0.996995687–0.999052703 | 0.952574134 | Calgary `bldg_code` |
| Building name | 2 | 0.978051722–0.985718131 | 0.253861010 | Calgary `bldg_code_desc` |
| Building geometry | 3 | 0.999764025–0.999935985 | 0.999322772 | Census county geometry |

Within **each** target, the saved calibration positives all exceed its eligible negative candidates. Across targets, they do not. This is an observed small-sample separation, not justification for fitting three cutoffs: there are only two key positives, two name positives and one eligible negative polygon. No per-target calibrator or thresholds were fitted. A global positive temperature or other strictly increasing global transform preserves the obstructing order and cannot fix it.

All seven calibration positives have the correct top allowed target in both base and tuned outputs. All 14 tuned training positives also have the correct top allowed target. Seven training and three calibration geometry positives have **only one allowed target**, so their “correct ranking” is largely a type-mask property. Counties and subwatersheds also pass that same Polygon/MultiPolygon mask; the mask cannot establish building semantics.

## Paired changes at already recorded cutoffs

`P/N` below means correctly accepted positives / incorrectly accepted negative fields. No positive is assigned the wrong target in these replays.

| Saved cutoff replay | Base train, 40 fields / 11 positives | Tuned same 40 | Base calibration, 25 / 7 | Tuned same 25 |
| --- | ---: | ---: | ---: | ---: |
| Historical fixed 0.5 | 11 / 5 | 9 / 1 | 7 / 4 | 7 / 2 |
| Historical **base-selected** 0.9736446738243103 | 5 / 0 | 9 / 1 | 5 / 0 | 7 / 1 |

At fixed 0.5, the tuned full 44-field training set accepts 11/14 positives and one negative: keys 2/3, names 2/4, geometry 7/7. Its four new fields contribute two accepted geometry positives, one abstained key and one correctly rejected negative. On the 40 matching fields, base → tuned name coverage falls **4/4 → 2/4**; key coverage stays 2/2 and geometry 5/5. Calibration coverage at this fixed cutoff stays keys 2/2, names 2/2, geometry 3/3, while errors decrease 4 → 2.

Those are useful mixed development observations, **not acceptance at the tuned policy**. That policy remains null and abstains on all positives. In particular, the larger NOLA/NYC key scores do not satisfy the required accepted-key recovery.

### Source-family accounting at fixed 0.5

| Split / family | Fields / positives | Base P/N | Tuned P/N |
| --- | ---: | ---: | ---: |
| Train — NOLA | 5 / 2 | 2 / 2 | 2 / 0 |
| Train — NYC | 6 / 3 | 3 / 0 | 3 / 0 |
| Train — MassGIS | 6 / 1 | 1 / 1 | 1 / 0 |
| Train — Vancouver | 2 / 1 | 1 / 0 | 1 / 0 |
| Train — Cambridge municipal points | 3 / 1 | 1 / 1 | 0 / 0 |
| Train — Oregon government points | 8 / 1 | 1 / 1 | 0 / 0 |
| Train — Tweed | 4 / 2 | 2 / 0 | 2 / 0 |
| Train — USGS WBD | 6 / 0 | 0 / 0 | 0 / 1 |
| Train — BAG, new | 1 / 1 | unscored | 1 / 0 |
| Train — IGN, new | 3 / 2 | unscored | 1 / 0 |
| Calibration — Census counties | 6 / 0 | 0 / 1 | 0 / 1 |
| Calibration — Calgary | 7 / 1 | 1 / 3 | 1 / 1 |
| Calibration — Chesterfield | 7 / 3 | 3 / 0 | 3 / 0 |
| Calibration — GNWT | 5 / 3 | 3 / 0 | 3 / 0 |

## Confirmed failures, data limits and causal hypotheses

**Confirmed semantic-control regression:** the training USGS subwatershed geometry rises **0.403566897 → 0.997409046** as building geometry. The calibration Census polygon rises **0.831143081 → 0.999322772**. Thus the problem is not only transfer to an unseen calibration family: the model also fails a negative polygon it was trained against. Both profiles retain meaningful publisher titles: `12-digit HU (Subwatershed)` and `Counties`; neither title was replaced with “building.” Their target query explicitly requires building footprint geometry. The current record supports these negative labels; this analysis finds no reason to relabel them. It does not re-audit original issuer evidence.

**Confirmed positive suppression:** Cambridge's building-name score falls **0.771843493 → 0.156104907** and Oregon's **0.907312274 → 0.433981478**. Their top target remains name, but fixed-0.5 acceptance is lost. IGN's new `cleabs` key score is **0.051845472**; no base comparison exists. Its publisher profile supplies `batiment`, `cleabs`, `xsd:string`, observed strings and no recorded description. Language/abbreviation/semantic sufficiency are plausible difficulties, not proven causes. Do not insert reviewer explanations or convert unknown BAG keys into labels to improve the score.

**Confirmed objective composition, not a normalization bug:** the frozen pair plan gives every family total unweighted coefficient 0.1, with the documented partial-window normalization. Its positive multiplier is eight. There are 44 geometry-target pairs, seven positive and 37 negative, but **only one negative has eligible polygon wire shape**: USGS. The other 36 geometry negatives have other input shapes. Therefore raw “118 negative pairs versus 14 positives” is not 118 independent, difficult no-match controls.

The seven compatible geometry-positive pairs have total positive-weighted coefficient **0.697777778**; the one compatible negative polygon has coefficient **0.005555556**: **125.6:1**. BAG's sole positive geometry alone has coefficient 0.266666667, **48 times** the USGS polygon coefficient. Equal-family averaging and positive weighting were implemented as specified; they do not balance semantic negative polygons against building polygons. These are loss coefficients, **not measured realized gradient magnitudes**. Saturated positives can have very small gradients; the saved outputs cannot prove which updates caused the regression.

**Hypotheses to keep separate:** shared-adapter optimization may emphasize easy geometry/type patterns under this weighting; the single semantic negative polygon family may be insufficient; three epochs/the fixed step schedule may underfit the negative control or interfere with name features. The saved run does not distinguish these explanations or prove a model-capacity/implementation defect. No evidence here supports repairing a label, moving Census into training, reading evaluation, or claiming a per-target calibration guarantee.

## One smallest next experiment — recommendation only

**One controlled repeat from the unchanged retained base, changing only BCE positive weight from 8 to 1.** Keep the V8 corpus/splits/publisher prompts, all three candidates, equal-family coefficients and partial-window normalization, seed 17, q/v rank 8, alpha 32, dropout zero, AdamW, clipping, three epochs, 51 updates and final-adapter-only policy unchanged. Reuse the recorded V8 weight-8 candidate and base outputs as comparators; no new model or data is needed. Do not initialize from the failed adapter. This is an ablation of one specific objective choice, not a sweep or an implemented trainer option.

Why this first: both non-building polygons became more confident and two supported names lost acceptance, while geometry positives saturated. Removing the eightfold positive multiplier directly tests one plausible source of the imbalance with fewer changed variables than another model, prompt, hard-negative corpus or three calibrators. It reduces the compatible-geometry coefficient ratio from 125.6:1 to 15.7:1, **not** to balance; the single negative family remains a serious limitation. At an ideal unconstrained BCE optimum, a uniform positive multiplier amounts to a monotone odds adjustment, so weight 1 is **not a mathematical cure for ordering**. Any change would arise through finite-data/shared-adapter optimization. Improvement is a hypothesis and may fail.

After the lead's NET-01 enforcement decision and a separate experiment assignment: freeze the one change before any gradient, use the same measured hardware/process bounds, save train/calibration matrices before the unchanged single global selector, verify one saved-adapter reload sample, and retain the original development criterion (accepted recovery of an old key, zero incorrect accepts, at least 5/7 calibration positives, each target covered). Report USGS/Census scores and Cambridge/Oregon/IGN coverage explicitly. Stop after that one outcome; do not pick epochs, thresholds or another weight from the calibration result. **Evaluation and diagnostic families remain closed even on a development pass.** No such experiment was implemented or run here.

This uses the [accepted pointwise/abstention research](learner-technique-reuse.md): no-match supervision must remain, and monotone temperature scaling cannot fix ordering. The [accepted Jev/open-alternative research](prediction-model-fit.md) identifies Von as a future small typed comparator with explicit no-match, but its public calibration is not ours. A new model/runtime and changed decision interface would confound this narrower objective question. No Von acquisition/pass is recommended as an additional parallel learner experiment in this handoff.

## Reproduction, hashes and limitations

Ran with standard-library isolation from the owned worktree:

```powershell
& 'C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe' -I -S `
  scripts/usp/learning/diagnose_v8_saved.py `
  --root 'E:/BhuAayam-data/task-data/ai-06a-learning/desktop-ai06a' `
  --output 'E:/BhuAayam-data/task-data/ai-06a-learning/desktop-ai06a/v8-calibration-diagnosis-02.json'
```

Exit 0. The output contains exact per-field paired scores, per-family/target counts, eligible-pair extrema, objective coefficients and all eight input hashes. Checks cover pins, unique row joins/counts, closed-split exclusion, prompt/label/type-mask equality, finite scores, reproduction of both saved base-cutoff totals, native-margin equivalence and family mass. The script asserts that torch/transformers/peft/geo were not imported; `-I -S` excludes site-package initialization. It reads no corpus, originals, adapter or model files. Review found no threshold search or network/model execution path. No extra test suite or runtime campaign was needed for this report-only calculation.

| Artifact | SHA-256 |
| --- | --- |
| Final summarizer | `841ec03a18cfd9d4906abfd598d3e4dd47c9366e7f65db0f652e1774138b4446` |
| `v8-calibration-diagnosis-02.json` | `3f20995591718ee7dd58b42ce66632f9ecfa8534702b16b71ae8ca8f9b662a2b` |
| Earlier arithmetic draft `v8-calibration-diagnosis-01.json`, preserved | `fd7e0fabbdd00968e4696c3dfff973a087d45361f1536a321e0288021c132b5d` |
| Tuned input freeze | `1075a64cc50da8c84cd09818d6aba9822aa2afe7a34846b1a45d898763799005` |
| Tuned score matrix | `db8af9d3e922a212cc2015c2b812091c86fa8a0dd600a9f05236aa50e8943e74` |
| Tuned result | `dfb3f0a7f586e6949eb3d6a571e487103f316076d988530c41f51e987a140564` |
| Base score matrix | `4ba474ab5574b3956a414b8e0e961c975496bed8f6b2d5627ae65e6a5490039d` |
| Base run | `e0b40f2ad75206c64ce5c09653e79c4ef79f14d7340a8ca8e9bfc5d34226f541` |

The first arithmetic draft was retained; the final revision additionally verifies both historical cutoff totals and margin/probability agreement. It is not another model run. All original inputs/artifacts and prior executable commits remain unchanged. NET-01 corrections/review are a separate owner's work; this report grants no network-silence, model integration, private-document, official operational or release qualification. Reused calibration families are development evidence, not independent final evaluation.
