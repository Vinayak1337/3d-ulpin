# Fragment rank reload bootstrap code — Task39

## Outcome

The thin reload CLI now adds the same fixed `__file__`-derived script and repository import roots used by the phase entry, before importing its shared stager. This repairs Task38's observed `ModuleNotFoundError: stage_selector_baseline` under the actual `-B -I -S` invocation. The consumed Task38 attempt remains immutable.

Base: `dbddf4951e47b855865d0940850049ee98debf31`  
Code: `13a9e2c90b95ed02cfcad25d870905f7c674598e`

CPython isolated mode excludes the script directory and user site and ignores Python environment settings. The repair reuses the existing fixed-file bootstrap. [CPython 3.11 documentation](https://docs.python.org/3.11/using/cmdline.html#cmdoption-I)

## Focused verification

Two owned sources compiled in memory. One invocation selected only `IsolatedEntryControls`: one test passed, exit0. The old `Controls` body is unchanged and was not rerun.

```text
C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe -B -I -S C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin/scripts/usp/learning/association/test_fragment_rank_reload.py IsolatedEntryControls
```

Both actual child processes ran from the private unrelated directory, with `-B -I -S` and the actual entry path:

- `--help`: exit0; exposed `--assignment`.
- `--assignment <private disabled packet>`: exit1 with `separate_positive_rank_reload_required`; stdout empty, no missing-module error. Only `executable` changed from true to false in the pinned consumed positive-version assignment.

No child bootstrap, import, sys.path, admission or shared-stage doubles were used. The parent receipt environment names the output directory only. Exact argv, cwd, timestamps, exits and hashed stdout/stderr are retained in the private receipts.

One scoped cached whitespace check passed. All 39 protected runtime files match their physical bytes, canonical LF hashes and base Git blobs. Final runtime closure of 40 files matches code Git blobs; its sole changed path is the thin entry. The test is excluded from runtime closure.

## Scope and retained authority

No stage, guard, native import/model read, GPU, PEFT/Torch load, reload, scoring, fit, optimizer or comparison occurred. Expectations and protected evaluation were not read; teacher inputs were not used. No positive packet was authored. The disabled prototype has no execution allowance, positive assignment or final execution head.

All 3 training phases remain accepted, totaling 60 updates/342 contributions. Historical fit source `7a7b6eb5c6fd0ed2f63eb03197e7f5f6999ed270`, accepted outputs and adapter/checkpoint authorities are unchanged. This startup check does not qualify native behavior, development quality, generalization or official property association.

Actual native reload and development comparison remain unrun. Coordinator review and a fresh positive packet pinned to the final execution head are required before that separate work.

## Evidence

Private root: `E:/BhuAayam-data/task-data/ml-distillation/student/fragment-rank-reload-bootstrap-code-v1-e51d6f9cb292490ca4efd6f12289c6df`.

See the sibling JSON for input and receipt hashes, exact commands, 40 runtime source pins and disabled prototype. Private `receipt-index.json` and `finalization.json` record the final evidence hashes, commits and clean status. Requested GPT-6.1 Sol/xhigh/default-standard1x; actual model, effort and tier are unexposed and recorded null. Current supplied permissions are never/danger-full-access.
