# FND D0 local verification — 23 September 2026

This records generated evidence from the former FND worktree. Its implementation
is already in `staging` as commit `97146d6`. The local receipt names `5f1a0e7`;
those commits have the same parent and stable patch ID
`c816ef956efcdb4b5e61ec759ce543c99e998f83`. The difference is the
`[skip ci]` suffix on the staging commit message.

## Isolated local result

[`isolated-local-receipt.json`](isolated-local-receipt.json) reports **PASS**
against disposable local services and a synthetic D0 pack. It verified 44
restored table hashes and 497 retained original object hashes. All 15 recorded
commands exited 0, including two migration applications, D0 import plan and
apply, the D0 live check, the Studio browser test, and cleanup of the owned
Compose project. This did not test the linked private environment.

[`d0-live-receipt.json`](d0-live-receipt.json) reports the `golden-v1` D0 pack
**passed**: exact locators `line 3`, `line 5`, `CSV row 2`, and `CSV row 4`
produced a complete 1,301-byte packet. A cross-building selection returned
`invalid_vertical_membership`.

The saved browser report recorded one expected test, one pass, zero unexpected,
skipped, or flaky results. The test selected exact evidence in Studio, compiled
PACK0, and reopened its saved receipt. These captures show the selected source
line and the reopened packet:

- [Exact source evidence](d0-exact-evidence.png)
- [Reopened scoped packet](d0-packet-reloaded.png)

`SHA256SUMS` records the byte hashes of the four copied receipts and captures.
The original generated output remains in the local recovery bundle.

## Hosted boundary

The earlier FND hosted checks [35830812877](https://github.com/Vinayak1337/3d-ulpin/actions/runs/35830812877)
and [35831399185](https://github.com/Vinayak1337/3d-ulpin/actions/runs/35831399185)
passed for the retained baseline, as detailed in the
[FND hosted receipt](../HOSTED_RECEIPT_2026-09-23.md). Three later hosted D0
attempts failed during import/apply:

| Run | Observed failure |
| --- | --- |
| [35835737030](https://github.com/Vinayak1337/3d-ulpin/actions/runs/35835737030) | Detailed geometry profile rejected a non-simple outline |
| [35836725703](https://github.com/Vinayak1337/3d-ulpin/actions/runs/35836725703) | Building `B-A` build timed out |
| [35837296364](https://github.com/Vinayak1337/3d-ulpin/actions/runs/35837296364) | Import geometry contained unsupported fields |

The final local result followed those attempts. There is no recorded hosted D0
pass for that final patch. Real D1 source qualification and public deployment
are separate gates.
