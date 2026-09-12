# Synthetic demonstration inputs

Every file here is generated teaching data, not surveyed measurements, official identities or ownership evidence. Load actual files through the application's upload/inspection workflow. Neither dataset contains a precomputed model or findings to substitute for processing.

Each dataset has a manifest with its local frame, file profiles, `initial` flag, calibration reference coordinates, and independently derived test expectations. Initial loading excludes `levels-r2.csv`; applying that revision must be an explicit operator action after upload and inspection.

| Case | Initial behavior | After applying r2 and rebuilding |
| --- | --- | --- |
| C-001 | Seven spaces; U01 area 32 m² and volume 96 m³. U03's unverified lower hint 2.8 m produces 102.4 m³ volume and 6.4 m³ overlap with U01. U04's lower 3.0 m is also unverified. Basement volume is 240 m³. | U03 lower becomes supported 3.0 m and overlap becomes zero. U04 binds new support with unchanged geometry. Boundary contacts remain informational. |
| C-002 | Five spaces with different IDs: an L-shaped footprint of 48 m², a 12 m² triangle, circulation and basement. Upper studio lower hint 2.2 m overlaps the lower studio ending at 2.5 m by 14.4 m³. | Corrected lower 2.5 m produces zero positive overlap. |

Both cases include spatial JSON, initial/revised level CSVs, control CSV, PNG and PDF. The plan shows ground-floor outlines at a fixed pixel scale; two labelled control points establish scale, rotation and translation. PDF pages use the same 1400 × 900 dimensions as the PNG at scale 1. Plans require manual calibration and tracing; source inspection does not extract geometry.

Regenerate files using `services/geo/.venv/bin/python fixtures/generate.py` after installing the geometry development requirements. The generator uses Pillow and ReportLab. Synthetic notices are printed on the plans and included in JSON and manifests.
