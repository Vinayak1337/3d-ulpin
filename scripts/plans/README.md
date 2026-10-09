# P1 — offline vector-plan candidates

Run locally, CPU only, without Docker, an API, a model or a provider:

```bash
python -m venv E:/BhuAayam-data/ml/venv-plans
E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe -m pip install -r scripts/plans/requirements.lock
E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe scripts/plans/read_vector_plan.py E:/BhuAayam-data/task-data/association-sources-20260929/bihar-magnolia-sanctioned-layout-original.pdf --pages 1-6 --region 1:0,0,1950,1650 --region 2:400,1150,1265,1640 --provenance scripts/plans/source-provenance.json --out docs/evidence/gf-ai/plans/vector/my-new-run/bihar
E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe scripts/plans/read_vector_plan.py E:/BhuAayam-data/task-data/association-sources-20260929/haryana-2831-tower3-plan1.pdf --pages 1 --provenance scripts/plans/source-provenance.json --out docs/evidence/gf-ai/plans/vector/my-new-run/tower3
E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe scripts/plans/verify_vector_evidence.py docs/evidence/gf-ai/plans/vector/my-new-run/bihar docs/evidence/gf-ai/plans/vector/my-new-run/tower3
PYTHONPATH=services/geo E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe -m unittest geo.test_vector_plan
```

`--out` must be new/empty. Pages are **PDF pages**, 1-based. `--region` is an
explicit PDF-point selection, not a new boundary: only fully contained faces
and text are admitted. Repeat it for disjoint scopes. Coordinates outside
selected scopes are reported without exporting their text literals. No
original is changed; SHA-256 is checked before/after processing.

## Source reality / scope

The supplied Bihar original has **six PDF pages, only ONE vector floor-plan
sheet**: page 1 = site layout, page 2 = architecture set, pages 3–6 = raster.
Page 2 contains ground, first, second and terrace floor **panels**, not four
pages. The evidence selects the three labelled ground/first/second panels
with one bbox, `[400,1150,1265,1640]`. It cannot qualify three vector PDF pages.
Another original with more floor-plan pages is a lead/owner prerequisite.

The catalogue states `test_only`, permission **unconfirmed**, and no surveyed
CRS. `source-provenance.json` quotes existing `docs/api/datasets.json` provenance
and pins the originals; it is not a new acquisition or licensing assertion.
Overlays/results are local development evidence, not public redistribution
qualification. Bihar's literal **DO NOT SCALE THE DRAWING** note is retained:
metric polygons/areas are diagnostic candidates only, never measurements.

## Method and contract

New module reason: existing `native_pdf.py` returns bounded native text only;
existing spatial-ML polygonisation consumes raster masks, not CAD paths.
There is no existing vector-room helper to reuse. The reader uses the same
Shapely validity/orientation convention, with source-point geometry retained
as a derivative in an explicitly un-georeferenced page-local frame.

- `page.get_drawings()` retains CAD layer names. Architectural allowlist:
  `Wall`, `A- built`, `A- windows`, `A- Columns`. Exclude hatch/text/dimension/
  grid/furniture/elevation layers, invisible/white strokes, curves and tiny
  segments; per-page counts and source layers are recorded. Layerless fallback
  retains dark solid strokes ≥0.3 pt outside native glyph bboxes; unqualified
  on the supplied inputs.
- Straight source lines/quads/rectangles → precision grid + Shapely snap +
  noding + polygonize_full at **0.12 PDF point**. Small/narrow/sliver faces
  are omitted with counts. No artificial door closures, dimension-derived
  rectangles, or crop edges. Unlabelled retained faces stay candidates.
- Entire text-line bbox must fall inside a face. Exact spans/bboxes are kept;
  no nearest-neighbour text assignment. Multiple alphabetic label lines make
  the single `label` **unknown**; all literal labels remain in `labelLiterals`.
  Open kitchen/living/stair/dresser connections therefore remain merged.
- Feet/inches use exact international-foot factors; metric m/cm/mm and shared
  metric pair suffixes are supported. Ambiguous `5'11'` is **not** corrected
  to `5'11"`. Fractions split over multiple displaced text lines are not
  reconstructed. Unknown parsed lengths are null, never zero.
- Scale is from nearby dedicated dimension-layer lines and their perpendicular
  tick/extension intersections, **not** room dimension products or printed
  scale alone. Least-squares consensus needs ≥4 supports, ≥2 per axis,
  ≥80% agreement within 2%; every support/residual is exported. Multiple
  printed panel scales force `no_scale` without a single-scale scope. The
  unscoped architecture sheet contains both 1/8 and 1/4 scales.
- Consistency `ok/mismatch` compares polygon area with the product of two
  stated lengths at a declared 5% tolerance. Bbox length errors are separate
  diagnostics because door leaves/jambs extend nonrectangular faces. A product
  is explicitly **not** a literal stated area; missing/multiple/ambiguous
  dimensions or missing scale yield `unknown`.

`candidates.json` has `pages` keyed by actual PDF page, containing
DomainCandidate-shaped proposals (`task`, `taskVersion`, `sourceParts`,
`inputManifest`, `methodNameAndVersion`, `parameterHash`, `outputRef`,
`confidenceOrError`, `coverage`, `limitations`, `state`). `outputRef` is a
local JSON pointer, **not a registry ID**. Every proposal has `state:candidate`
and `method:deterministic:vector-plan@1`. No confidence is calibrated and no
registry write exists. `output` contains source-point and optional local-metre
polygons, literal text/dimensions, computed area, consistency and page+bbox
citation. `consistency.json`, per-page overlays and `result.json` complete the
run. Non-plan overlays are capped at 640 px diagnostic thumbnails, not
high-resolution copies of the scans. Reported room counts are **closed-face
candidates**, not reviewed rooms.
