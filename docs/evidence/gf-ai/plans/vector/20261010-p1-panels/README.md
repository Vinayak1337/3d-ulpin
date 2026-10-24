```text
TASK   P1 continued — Three-panel wall-mask room reader     GATE GF-AI (plan_rooms), GF-T16 prerequisite
WORKS  Inspect 17 literal named rooms/spaces in panel-local metres, with an exhaustive name audit and honest scan abstention.
SEE IT powershell -NoProfile -Command "Invoke-Item 'docs/evidence/gf-ai/plans/vector/20261010-p1-panels/bihar/page-02-overlay.png'"
INPUTS Bihar Magnolia page 2 ground/first/second panels; Haryana Tower 3 plan-1 scanned page 1.
GAPS   SHAFT/LAWN unattached; malformed balcony dimension and master-bedroom area mismatch retained; all geometry remains candidate.
```

**Numbers, denominators, scale fits, hashes, runtimes and checks:** [result.json](result.json).
The lead replaced “three pages” with the three floor panels on page 2. No
further PDFs, labels, weights, GPU, runtime/DB writes or providers were used.

- [Overlay](bihar/page-02-overlay.png) shows panel ids, room names and local
  origins. Green = area agrees within the declared tolerance; red = mismatch;
  grey = no comparable literal; magenta = explicitly unattached name.
- [Room candidates](bihar/candidates.json), [consistency report](bihar/consistency.json),
  [Bihar receipt](bihar/result.json), [Tower 3 receipt](tower3/result.json).
- **Every one of the 19 room/space-name literals is accounted for**: 17 attached
  exactly once, SHAFT and LAWN explicitly unattached. There is one unlabelled
  retained interior candidate; it is not assigned a type. No merged region
  remains on this selection. Furniture, treads and diagonal hatch strokes do
  not define room faces.
- Wall-mask minus building outline: bounded source-aligned wall-end/junction
  closures are all recorded as candidate bridges. Maximum opening **1.85 m**;
  minimum face **1 m2**. Source-derived slivers and exterior setbacks have
  explicit omission counts. No room was resized to match a dimension literal.
- **Do not hide the denominator:** 9/10 attached numerically comparable rooms
  agree; including the unattached parseable SHAFT yields **9/11 = 81.8%**.
  Including the malformed balcony literal too yields **9/12 = 75%**, so the
  all-literal variant of the 80% target is **not** claimed. `5'11'` remains
  ambiguous/null, not changed to an inch value.
- Master bedroom's literal `(12'6" X 15'10")` has length product 18.387 m2;
  the wall-derived region is 15.939 m2, difference **-2.448 m2 (-13.3%)**.
  The source also depicts an irregular lower extension. This is a reviewer
  finding, not evaluation truth or justification to enlarge the room.
- Each panel has its own dimension fit and `SCALE 1/8" = 1'` cross-check:
  all agree within the declared 2%. Origins are candidate building-outline
  lower-left bboxes; axes page-right/page-up, **not surveyed/georeferenced**.

All JSON is compact. PDF coordinates use 0.01 pt; metric coordinates and bbox
length diagnostics use 1 mm. Each file pins immutable full precision under
`E:/BhuAayam-data/task-data/p1-vector-plan/20261010-p1-panels/` by SHA-256.
`derivativeWriterSha256` distinguishes a display-rounding fix from the frozen
computation's code hash; private bytes were not overwritten. The earlier
31k-line baseline candidates file was also replaced by a compact SHA-pinned
derivative, without discarding its full-precision evidence.

**Lean verification:**
`E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe scripts/plans/verify_vector_evidence.py docs/evidence/gf-ai/plans/vector/20261010-p1-panels/bihar docs/evidence/gf-ai/plans/vector/20261010-p1-panels/tower3`

[CLI recipe and method](../../../../../../scripts/plans/README.md). Re-run into
**new** output directories; no overwrites. The real-input contract check covers
source literals/bboxes, one-to-one name accounting, bridged source references,
valid/closed/oriented polygons, panel-frame transforms, full-precision hashes,
rounded derivatives, scan abstention and no registry writes. The regression
file retains the real door-bbox case and the degenerate source-line bbox bug.

**Next:** lead review the overlay/bridge hypotheses, all-literal denominator,
master-bedroom mismatch, malformed balcony and displaced SHAFT. Ingest only as
candidates with officer-chosen levels; a printed title is not a reviewed level
schedule. Preserve the literal `NOT SCALE THE DRAWING`, unconfirmed permission
and `test_only` limits. P2 can handle the scan when dispatched.
