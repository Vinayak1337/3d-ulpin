# STUDENT-11 — constrained selector preparation

CPU preparation is complete for coordinator review. Code: `ebc8554d3e30d6ab0072c140af1fe97c79f7db53`, based on `448d6ea04f7ff9dfe00a6f05c3a80390503c73fc`. The [machine receipt](selector-constraints-preparation.json) contains all six code hashes, 21 future runtime source pins, input/model/tokenizer bindings and host artifact hashes.

## Change

The existing single generation call now accepts an optional, default-off `prefix_allowed_tokens_fn` controller. It uses the installed Transformers interface and a shared byte trie read from the pinned tokenizer JSON. Source-dependent integer intervals constrain fragment ordinals and exclusive lexical span ends without enumerating all spans or output combinations. No package was installed.

The controller forces compact JSON/key order, schema limits, source ranges, literal/unit coverage and length, compatible state/value combinations, distinct citation triples, at least two conflict citations, an initial `no_canonical_targets` abstention and empty canonical links. These are **controller-enforced properties, not learned accuracy**. The unchanged whole-response projector still checks semantics. Role/value/state/unit correctness, identifier/unit boundaries, duplicate quoted text at different positions, conflict truth and native attribute matching remain outside the controller.

The byte grammar handles multi-digit integers, vocabulary tokens crossing JSON boundaries, partial UTF-8 and JSON escapes. EOS is legal only after a complete response. Raw output is saved before final decode-equivalence checking; a response cut off at the token cap is preserved without closing or repair. Added tokenizer tokens other than EOS are excluded. One shared vocabulary trie is reused across examples, and the most recent allowed-prefix result is cached.

## Verification

Six focused CPU controls passed, exit 0, in 1.775 seconds (wrapper: 1.989 seconds). They cover one unchanged training source view, one unchanged IFC4 development view, the original absent-fragment defect, range/citation/state boundaries, Unicode/EOS transport, explicit execution/freeze gates, historical raw rejection and protected source bytes. Technical fixtures are not operational records or new learning labels. No expectations entered these controls.

The first run had one failure: CPython deferred rejection of incomplete UTF-8 `ED A0`, although it cannot complete to a Unicode scalar. Explicit second-byte restrictions fixed that defect; impossible UTF-16 low-surrogate escape prefixes are also excluded. The retained failure receipt and focused rerun are linked in the machine receipt.

```powershell
& 'C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe' -B -I -S 'C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin/scripts/usp/learning/association/test_selector_constraints.py'
```

The complete owned delta was inspected. All six Python files compiled with `compile(read_bytes(), path, "exec")` under `-B -I -S`, exit 0; no pycache or native model/tokenizer imports. Working and staged code whitespace checks passed. Existing projection, schema, prompt, core adapter, containment and resource implementation bytes remain unchanged.

| CPU observation | Result |
| --- | ---: |
| Vocabulary construction | 0.513 s |
| Trie | 333,010 nodes; 4,329,130 logical array bytes |
| Complete technical fixture | 76 vocabulary tokens; 77 mask calls |
| Fixture total / largest mask | 0.01972 s / 0.00150 s |
| Broad decision-code prefix | 146,991 allowed tokens; 326,415 visits; 1.051 s |
| CPU process peak working set | 107,331,584 bytes |

These are one small CPU observation, not a generation performance campaign. Fixture segmentation uses actual vocabulary bytes, **not native BPE encoding**. Actual fast-tokenizer decoding, Transformers callback integration and GPU latency remain unverified until a separately authorized contained run.

Representative controls preserve legal `[0,10,18]` under citation `[0,0,19]`; reject absent fragment 4, empty/reversed/out-of-range spans and values outside their own citations; exclude early EOS; and retain an incomplete UTF-8 prefix at the cap. A grammar-legal wrong semantic role still fails the unchanged projector. The retained historical IFC4 response still fails `selector_fragment_range` with zero accepted claims.

## Pins and future execution

Policy SHA-256: `ec73957cd919f8635ef3bb7a7353ec331965dbe59dcd0f1f1463dd1be49f1744`.

Tokenizer JSON: `c0382117ea329cdf097041132f6d735924b697924d6f6fc3945713e96ce87539`; tokenizer config: `5b5d4f65d0acd3b2d56a35b56d374a36cbc1c8fa5cf3b3febbbfabf22f359583`.

The retained model remains Qwen/Qwen2.5-0.5B-Instruct at `7ae557604adf67be50417f59c2c2f167def9a775`, weights `fdf756fa7fcbe7404d5c60e26bff1a0c8b8aa1f72ced49e7dd0210fe288fb7fe`, with accepted adapter `93890e8ba23dd0c363cdcb36ed7e6f6b8f0a2ab2e3a3fe6e675ce91dfd277c70`. These are retained bindings; no weights were loaded by PREP.

A future run requires coordinator inspection and a separate assignment with task `STUDENT-11-CONSTRAINED-RELOAD`, version `association-selector-constrained-execution/1`, action `reload`, and freeze `association-selector-constrained-freeze/1`. It must bind exact `selector_constraints.metadata()`, the accepted final clean HEAD, all 21 runtime source hashes, unchanged prompt/schema/development inputs and the accepted saved adapter. Historical adapter assignments/freezes reject a constraints field. PREP is refused before runtime inspection or stage creation.

Preserve original greedy settings, 768-token cap, Job/egress/guard/output/cleanup acceptance and resource limits. The later contained run must verify native vocabulary/decoder agreement and exact final text equivalence. Keep unconstrained and constrained raw strings and quality/resource measurements separate. Report controller-enforced fields explicitly; they cannot establish semantic improvement. No automatic fit, inference retry, held-out evaluation or promotion follows this preparation.

## Scope and handoff

The historical result remains **2/2 JSON/schema-valid, 0/2 usable, 7 emitted claims, 0 accepted claims and 0/6 correct expected claims; precision is undefined**. That comparison was not repeated. No model stage, model/native-tokenizer load, GPU work, source acquisition, teacher feedback, provider call, dependency change or held-out evaluation occurred.

Supplied permissions are `never` / `danger-full-access`. Requested Astra/xhigh/default-standard settings are recorded; actual per-turn model, reasoning and service tier were not exposed. The primary staging checkout was observed read-only at `409d26414b5f7544fc4db41d1b14c95d43604957`; no integration occurred here.

Host logs are retained at `E:/BhuAayam-data/task-data/ml-distillation/student/selector-constraints-preparation-host-20261003-448d6ea0`. No live owned process or GPU allocation remains. Return the code/evidence commits to coordinator `01a0fbd1-c2aa-75c0-8a52-4c4f662f3759`, then stop at this preparation boundary.
