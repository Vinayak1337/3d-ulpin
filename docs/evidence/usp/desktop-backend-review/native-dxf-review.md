# DXF-01-R — independent native drawing review

**One P2 correction required.** Candidate code `bbdf5cd4e9f8ea8a038d0604e39231001d19831c`, handoff `e165b344122937573c826c018aad1f1d4ba0294d`, base `78a9d0c293dccf6e18a9f7c3f5e2a9442efd1b0b`. [Assignment](../../../orchestration/PARALLEL_20261001B.md) at dispatch `f687cd29d17925f5893d7d1cddcfe31d30300177`. Candidate checkout `C:/Users/kvina/.codex/worktrees/desktop-dxf/3d-ulpin` was inspected read-only. Report branch `task/desktop-dxf-native-audit` starts at preserved reviewer checkpoint `9123956b96f3d480ee15003d5a3d0d943b8ada30` in `C:/Users/kvina/.codex/worktrees/backend-review/3d-ulpin`. Supplied never/danger-full-access; GPT-6.1 Sol/xhigh/default-standard requested, actual per-turn model/effort/tier unexposed.

## Finding

### [P2] Unrecognized declared codepages are labeled as source-selected decoding

`services/geo/geo/native_dxf.py:248–249,400` uses `dxf_stream_info().encoding`, then labels pre-R2007 decoding `declared_codepage` whenever `$DWGCODEPAGE` exists. Pinned ezdxf's `tools/codepage.py:83–87` silently returns **cp1252** for an unrecognized value. Thus an unsupported declaration becomes an available result claiming that the selected encoding came from the source. Text/layer labels may be decoded incorrectly while the provenance masks the fallback, violating this reader's separation of declarations and parser defaults.

One supervised targeted control inserts only an unrecognized `$DWGCODEPAGE=ANSI_9999` header declaration **in memory** into the unchanged upstream R12 sample. No drawing/entity/coordinate/name value or retained source file was edited. Exact private copies of the candidate reader and its pinned physical memory guard return:

```json
{"status":"available","encoding":{"name":"cp1252","basis":"declared_codepage"}}
```

The result preserves `headerVariables.$DWGCODEPAGE[0].rawValue="ANSI_9999"`, proving that cp1252 is a parser fallback rather than the declaration. Recorded command: `E:/BhuAayam-data/task-data/desktop-dxf-native/env/Scripts/python.exe -B E:/BhuAayam-data/task-data/desktop-dxf-review/codepage-control.py`, **exit 0**. Full result/control/log are retained in that fresh private review directory. Control input SHA `cbca9feb9732cf232c65305aef32af8fb0dfcbb3a444e5e508529ac9b72680c4`; original SHA remains `b476d3e53fe24c1db3c701d20b2bebd774f7bd7966b12d81891505b9b29e4d21`. This is a malformed-header regression control, not a new operational source, qualification sample or learning label.

**Requested correction:** validate the original pre-R2007 codepage before selecting its decoder. Reject unrecognized declarations with a bounded unsupported/unavailable response, or explicitly represent assumed/unavailable decoding without claiming source-selected text. Preserve the original declaration/locators and current behavior for genuinely absent codepages and R2007+ UTF-8. Fix ownership stays with the DXF implementation owner; add only the focused regression for this fallback.

## Reconciliation and other review conclusions

- The primary saved verification SHA **`2b9ef3298ffb29e26e47c49ddb8102ffd8680134ac33403e4310cbb6990b8d5c`** matches its private final copy. Exact five-file implementation/two-file handoff scope, six physical/Git code pins, four saved command logs and both extraction receipts/artifacts match. Existing `native_pdf.py` physical CRLF versus Git LF is disclosed and verified equivalent; neither was rewritten.
- Two unchanged `test_only` ezdxf v1.4.3 development sources and the MIT notice match acquisition/manifest hashes and original blob IDs in retained upstream tree `df5ef277fcc674d77580143212ec63dd981cc2b3`. Geography/CRS/vertical reference remain unknown. No official Indian CAD or source rediscovery was performed.
- The five lane wheel hashes/versions match the lock, installed metadata and **1,678 installed wheel files**. Installation rewrite exclusions are wheel `RECORD` files and `.data` destinations, listed in private reconciliation. No dependency installation or shared requirements change occurred.
- Saved drawing tag lexemes and one-based value/code locators match original lines. Declared sample remains 83 LINE/ARC/TEXT entities; R12 remains four projected records including its block TEXT. R12 units and INSERT scales/rotation stay absent. Unsupported/opaque records and INSERT non-expansion remain explicit. No repaired/default handles, layouts, transformed coordinates or external-reference fetch were established.
- Code review confirms the reused OS memory guard precedes parser import/stdin, one child has a 45-second parent timeout with kill/reap, bounded input/record/entity/point/tag/output limits, sanitized temporary config/cache, and no parser fallback in the parent. The native-library thread setting is **environment configuration, not an OS-enforced thread ceiling**; actual OS thread count was not measured. Saved Windows checks do not qualify Linux or memory/scale performance.
- CLI original SHA/recheck, fresh output outside Git, exclusive fixed filenames and owned partial-output cleanup retain the intended local publication boundary. API access, canonical jobs, official geometry and release qualification remain deferred. No additional actionable finding was established in these reviewed paths.

## Evidence and return

Reused the saved **five focused tests** and **two final extractions**; no campaign or extraction rerun. Fresh work is evidence reconciliation and the single codepage control. Two private reconciliation helper setup errors (encoding alias and wheel-directory/hash-list assumptions) were corrected; initial logs remain retained. They are not candidate defects.

Private review receipt **`E:/BhuAayam-data/task-data/desktop-dxf-review/verification.json`**, **9,727 bytes**, SHA **`2f280456465096ce2b4b57bce6e075eab9b18274fcf7867030496a8fb32942f6`**. Detailed reconciliation **14,241 bytes**, SHA **`b64bfc558dfc2321828d98370e2fa2b7243193c7cdfb543904d1b1f6d9d01ba3`**. Both pin exact artifacts, sources/dependencies/code and reproduction evidence.

Only this report is committed. Reviewer checkpoint and three accepted EOL status entries (`area.py`, `native_pdf.py`, `native_archive.py`) retain their exact physical hashes with empty content/index diffs. Original sources, candidate checkout and prior receipts remain unchanged. The owned parser child was reaped, scratch cleaned and exact code copies/evidence retained. No services, Docker/socket recovery, API/DB, GPU/model/provider, frontend or generated-file work occurred. Return the P2 to the existing implementation owner, send the authorized lead callback, then stop; candidate remains pending correction/closure and goal stays paused reference.
