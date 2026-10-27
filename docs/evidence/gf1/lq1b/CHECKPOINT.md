# LQ1b checkpoint

The build and tests are whole; the complete browser gate is not. GF1/GF5 remain partial.

- Baseline 402 Studio tests; final 415/63 files, typecheck and diff check pass.
- AQ1 became available at walk time. Second authorized staging merge is `33e793d0`.
- The browser itself answered the NYC building question, authored/approved once, followed the package, selected 100, typed the acknowledgement and confirmed. Stored result: 1,661 recorded, 100 cards, no stopped buildings. Reload and second-window following passed. The last chosen row was prioritized before its card; it was the only first-observed carded ID.
- Parks reached a linked package but remains `READY_FOR_REVIEW` without a review fingerprint. There is no published refusal reason. Confirmation must not proceed without the review. Do not supply missing facts from inspection SQL or a hand-issued review request.
- The area page reports accepted buildings but its screenshot is blank; drawing is not qualified.
- Shared transport, last-leave close, uncertain retries, exact 429 words and bounded reads pass pure tests. The actual live offline/reconnect proof did not finish: the disconnected banner did not appear. Offline alone and one materially different owned-proxy request teardown comparison both hit this signature. Do not repeat either unchanged.

## Resume prerequisites
1. Review `result.json`, `runtime-qualified.json` and `attempts.json`; full raw receipts/logs are referenced outside Git. The final receipt's name does **not** mean its gate passed.
2. Separately authorize server work to expose the zero-building package's review/refusal outcome. `intake-run-worker.ts:64-77` catches review refusals and `intake-targets.ts:105-115` holds targets, but a package with no target cannot carry those words through this path. Its package summary only exposes review metadata (`intake-targets.ts:191-208`). Do not assert a refusal code that was not returned.
3. Diagnose the owned Vite proxy's actual downstream response/socket termination. The attempted cut destroys upstream request objects after headers; that did not establish a browser stream disconnection. Inspect response/socket close events and cancellation ordering before **one new bounded comparison**. One open request in the final stable document does not qualify earlier navigation maxima of two or across-reconnect behavior.
4. Qualify area drawing and, if needed, open one actual card PDF and its verification page. No area/scene changes are owned here.
5. Rerun only the unqualified journey after prerequisites, on new nonce-owned infrastructure. The harness was split into small helpers after the final live attempt without another live rerun; its behavioral observations are from the preserved receipts, not a post-refactor claim.

Remembered-layout live work remains unavailable across differing columns. Change has a named controlled browser check with exact prefill/revision and pure tests, not live memory evidence.
