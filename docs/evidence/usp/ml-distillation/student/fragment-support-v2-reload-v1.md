# STUDENT-23 — reload staging blocked

The single authorized stage command exited **1**, before creating a stage directory or copying runtime/model bytes. Execution HEAD stayed `f25bc4a0f473b9e3fc9d8f13087f971c98e5b310`. **No native reload or host comparison ran; host expectations remain unread.**

## Exact blocker

`stage_fragment_adapter.py:83` reads `fragment.BATCH_SHA` while constructing the reload input map. The v2 leaf `fragment_support_v2.py` omitted that immutable v1 development-batch constant from its exports, producing:

```text
AttributeError: module 'geo.usp_learning.association.fragment_support_v2' has no attribute 'BATCH_SHA'
```

The failure follows existing saved-fit host admission and reload binding, and precedes complete development admission, freeze generation, `root.mkdir`, copying and native execution. The accepted v2 fit remains intact. No actual reload profile, freeze, output or metric exists.

## Return

The STUDENT-23 protocol explicitly prohibits executable changes and retries after a blocker. No correction or retry was made. A separately assigned CPU correction should expose the unchanged batch pin and cover the successful shared reload staging path up to its side-effect boundary; a new reviewed execution freeze is needed before any subsequent native attempt.

Only this evidence pair changes the repository. The [JSON report](fragment-support-v2-reload-v1.json) retains exact argv/cwd/start/end/exit, full failure log, assignment/protocol pins and all 33 physical/canonical/Git source pins. Private receipts: `E:\BhuAayam-data\task-data\ml-distillation\student\fragment-support-v2-reload-v1-host-891fdbbc60824e279068f1bbfd1261fd`. Owned stage process 19780 exited and is absent; no native Job/AppContainer, service or tool session remains. Original data, baseline/v1 results and accepted v2 fit are preserved. No development criterion, model quality or release claim follows.
