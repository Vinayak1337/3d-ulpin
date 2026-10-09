```text
TASK   P1 — Vector plan reader            GATE GF-AI (plan_rooms), GF-T16 prerequisite
WORKS  Read cited literal labels, dimensions and diagnostic metric areas as candidates; scans abstain.
SEE IT powershell -NoProfile -Command "Invoke-Item 'docs/evidence/gf-ai/plans/vector/20261010-p1/bihar/page-02-overlay.png'"
INPUTS Bihar Magnolia original PDF (all pages; scoped floor panels on page 2) + Haryana Tower 3 plan-1 scan.
GAPS   Only one vector floor-plan PDF page exists; merged/open faces and unconfirmed reuse remain unqualified.
```

**Numbers, hashes, runtimes, comparison and check commands:** [result.json](result.json).
This is a working reader checkpoint, **not a three-vector-page gate pass** or
an accuracy claim. Source permissions remain unconfirmed / `test_only`.

## Inspect / reproduce

- [Bihar overlay](bihar/page-02-overlay.png): the literal ground/first/second
  floor-plan panels are on the same PDF sheet; do not call these three pages.
  Green = area agreement within the declared tolerance; red = area mismatch;
  grey = unknown. All regions are candidates, not reviewed rooms.
- [Bihar candidates](bihar/candidates.json), [consistency report](bihar/consistency.json),
  [run receipt](bihar/result.json). Multiple label lines make `label:unknown`
  but the original labels remain in `labelLiterals`.
- [Tower 3 receipt](tower3/result.json): `not_vector`, no invented candidates;
  [thumbnail](tower3/page-01-overlay.png). Bihar's other pages are classified
  and have diagnostic thumbnails too.
- [CLI recipe / contract / limitations](../../../../../../scripts/plans/README.md).
  Use a **new output directory** for reproduction; the CLI refuses overwrites.
- Verify committed artifacts:
  `E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe scripts/plans/verify_vector_evidence.py docs/evidence/gf-ai/plans/vector/20261010-p1/bihar docs/evidence/gf-ai/plans/vector/20261010-p1/tower3`

## Decision / bounded failure recovery

The baseline incorrectly treated a nonrectangular door-leaf bbox as the room's
stated rectangular size, overriding area agreement. One bounded comparison
kept the same polygons and independently fitted scale, comparing **area** to
stated length product and keeping bbox discrepancies as separate diagnostics.
The real ground-bedroom polygon is the single regression next to the reader.
The baseline's small receipt is retained; redundant intermediate JSON/PNG
was removed. No more room-shape tuning or door completion was attempted.

**Next:** lead review the overlay and mismatch/unattached text first. Obtain
additional vector floor-plan sheets if the three-page gate stays mandatory;
otherwise explicitly narrow the qualification to this source sheet/panels.
Backend ingestion should retain these proposals separately from reviewed
values, choose the level through review, and honour the literal source's
`NOT SCALE THE DRAWING` restriction. No API route, GPU, DB or provider was used.
P2 can handle Tower 3's raster path once dispatched.
