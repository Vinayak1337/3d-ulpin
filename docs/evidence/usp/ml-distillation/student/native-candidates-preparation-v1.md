# STUDENT-12 — native candidate preparation

**CPU source-to-candidate-to-selection preparation is complete for review.** Code commit `a2b663cbb6bd9a236341725ab65e2a70833ff7a1`, based on `fa8676e68a79ccfdba263da37b853d173daeeb76`. The [machine receipt](native-candidates-preparation-v1.json) contains commands, all seven owned code/schema pins, 23 protected reference pins, source/reader bindings and the private artifact manifest.

## Working flow

The producer verifies frozen family, source manifest and lineage bindings, unchanged original/reader hashes, reader source identity/size, exact JSON pointer, entity type and STEP ID. It reuses the existing pure Python byte index to check record bounds, schema attribute index, exclusive original-byte spans and raw literals. It does not initialize IfcOpenShell or decode a new native result.

Candidates come only from attributes referenced by the current supplied evidence. Roles reuse `NATIVE_ROLES` and the existing GlobalId/elevation rules. Each candidate retains its exact legacy claim/citation plus input, family, source, method, record, reader, attribute and locator provenance. The original input and candidate set become immutable canonical JSON snapshots.

The student-facing representation permits only a full `candidateSetSha256` and distinct local `cN` IDs. The hash binds the complete current input, admitted candidates, provenance and representation. IDs alone cannot be carried between contexts. Empty and subset selections remain valid; selected IDs copy stored facts without rewriting roles, states, literals, units or citations. Unknown, duplicate, foreign-context or malformed selections reject the whole response. Expansion uses unchanged `validate_output`; invalid fallback receives no partial credit.

| Unchanged input | Candidate construction | CPU selection check |
| --- | --- | --- |
| IFC4 source view | Four supported, exact-citable native facts | One-candidate subset and empty selection accepted |
| Incomplete IFC2x3 view | Separate absent and explicit-null elevation candidates | Individual subset, empty selection and both-state control accepted |

The IFC2x3 georeference fragment is explicitly unsupported as a property candidate. Absent retains parser `not_in_schema_entity`, null raw/value and **no attribute byte span**. Explicit null retains its actual `$` bytes. Parent record locators remain separate from attribute locators.

These are deterministic candidate construction and technical selection controls. They are **not learned selection accuracy, expected answers, or new learning labels**. The producer never reads `expectations.json`. No model was run and the previous 0/2 usable, 0/6 correct model result remains unchanged.

## Verification

Five focused tests passed on the first run: exit 0, unittest 0.674 seconds, tool wall time 0.903 seconds. Coverage: original reader/source facts and immutable snapshots; absent/null/georeference behavior; stale reader, mismatched pointer, changed original and explicit conflict refusal; whole-response identity/unknown/duplicate/field-rewrite rejection; candidate grammar plus the existing selector default.

The transport control uses the existing 333,010-node pinned vocabulary trie and shared Controller with single-byte vocabulary IDs. Empty/subset grammars reach complete EOS; unknown/duplicate IDs and early EOS are unavailable. This is CPU byte transport, not native BPE encoding or model inference. Historical selector schema/prompt/policy and projection remain unchanged. The generation hook defaults to `None`, and there is still one `generate` call.

All six changed/new Python sources compiled without execution or pycache under `-B -I -S`. The complete owned delta was inspected, and working/staged whitespace checks passed. All 23 protected references match their assigned canonical-LF pins; the selector schema absent from this learner checkout was checked in its read-only coordinator location. No protected file was edited.

```powershell
& 'C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe' -B -I -S 'C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin/scripts/usp/learning/association/test_native_candidates.py'
& 'C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe' -B -I -S 'C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin/scripts/usp/learning/association/prepare_native_candidates.py' --assignment 'C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/student-12.native-candidates-preparation.assignment.json' --assignment-sha256 1a2da59403f8737a9b3573777712e94a04094e65e8d686071b6e3499b41e2657
```

The CLI ran once from the clean code commit, exit 0, and prepared its artifacts in 0.088 seconds (tool wall time 0.237 seconds). No native model/tokenizer/parser library was imported by the checks or CLI. CPU peak memory was not measured; no model/resource qualification is claimed.

## Artifacts and pins

One new directory contains contexts, model inputs, candidate route/schema/prompt, technical projections and command receipts:

`E:/BhuAayam-data/task-data/ml-distillation/student/native-candidates-preparation-9e147bf705c5413388f86ab0f785eadc`

- Construction policy: `07540ff3bbe14d9eeb9796ddde0d2b246e7d98595063c8aa516b755958d5badd`
- Selection policy: `9bbff02c55134a8fc772155cf197b7ae21b5deaf26dc01dfb75ade42e35f26ce`
- Prompt: `97354126da61e713fb381c9de46e6966de82ec2424a50feaf93b538d43a6780c`
- Schema canonical LF: `016b415ed96de321c43174023238f8de5582df37dc428731234b6f02a3280574`
- Candidate route artifact: `ac177a8e15fa8bb41226b9a151e0f69ac6c6dcc253063b89c738163b10a60267`
- IFC4 set: `ededc3e493b107fb4d016456d36a86a4d06acb3d689e0c9e14dce2e7928d3d41`
- IFC2x3 set: `64859a859f9096890862e7aaf1aef86ddf281c00c237b41481dd51e3917515e2`

## Limits and next boundary

Numeric/structured normalization, unmapped roles, decoded literals that cannot be cited exactly, and missing native metadata remain unsupported. Explicit multi-fragment conflict groups refuse this route; it neither infers natural conflicts nor resolves them silently. Canonical identity, geometry, transforms, ownership, operational accuracy and generalization are unqualified. The retained buildingSMART CC-BY-4.0 certification samples remain foreign `test_only` inputs.

The optional candidate context/projector/grammar hooks reuse the existing generation loop and byte transport. **No candidate model or adapter has been selected, and current stager/worker CLI admission is not enabled for candidate execution.** A later inspected assignment must choose that route and pin the admitted context artifacts, input, schema, prompt, policy and executable bytes through the existing stager/CLI. Native candidate-tokenizer/model integration remains unverified. Historical adapters are not automatically reused or refitted.

Supplied permissions: `never` / `danger-full-access`. Requested worker settings: Astra/xhigh/default-standard; actual model/effort/tier are unexposed. Primary staging was read-only and observed at handoff as `ffe16d0e54e52e904dc1adef1982602fcd69b08e`. No acquisition, teacher feedback, expectations, held-out content, model stage, fitting, inference, native parser initialization, shared application change or dependency/host change occurred. No owned live process, GPU allocation, service or listener remains.

Return code/evidence commits to coordinator `01a0fbd1-c2aa-75c0-8a52-4c4f662f3759`, then stop at this preparation boundary.
