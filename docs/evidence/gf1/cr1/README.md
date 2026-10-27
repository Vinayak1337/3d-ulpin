TASK   CR1 — GeoJSON declarations are read in their own system       GATE GF1
WORKS  A real EPSG:2958 GeoJSON imports, is reviewed, and records 155 physical parcels.
SEE IT `node docs/evidence/gf1/cr1/run-runtime.mjs <new-receipt.json>`
INPUTS Niagara condominium parcels; three MultiPolygons and incomplete/repeated alternate identifiers.
GAPS   Foreign test_only; manual profile/streaming and full-suite qualification remain open.

## Seen over HTTP

The harness builds this worktree's geo image, checks its source hashes, and starts nonce-owned tmpfs PostGIS.
Real Nest import-package and area controllers handle multipart import → review → commit → area read-back.
The CB1-style object store is a private in-memory HTTP S3 stand-in, not production storage qualification.
`runtime.json` records four successful requests and validates their published-source wire schemas.

All **155 physical parcel records** have revision 1, in the area's stored EPSG:32617 frame and metre origin.
The area stores source EPSG:2958, the declaration warning, and the normalized geographic extent.
The original bytes/hash are unchanged. MultiPolygon source keys **79, 88, 153** each remain two-part multipart
geometries in both normalized frames; **zero features set aside**. `parcel` and `OBJECTID` are harness choices.
There are **zero issued building/unit registry records**: the product's exterior recording filter selects buildings.
A parcel gets no property card, as this task specifies; no card issuance or cadastral-rights claim is made.

## Proof and boundaries

- `step0.json`: baseline refusals, undeclared-coordinate diagnosis, TypeScript/Studio seams and runtime commands.
- `c6-addendum.json`: degree-only profile units and streaming evidence gaps from the second audit.
- `unchanged-output.json`: whole NYC output (1,661 accepted features) and undeclared control equal pinned staging.
  C5 keeps the existing CRS84 warning; new declarations get C3. Inspection uses C3 even for CRS84, so its manual
  profile's old exact evidence enum also needs the next task. Direct import with the selected ID bypasses that profile.
- `place-and-heads.json`: CRS area of use contains the stored extent, independently of our transform. That test
  alone is weaker than a dataset envelope. The dataset's static web page is a shell; DA5's retained public publisher
  item states a geographic envelope that also contains ours. Two large originals get declaration-only answers from
  their first 64 KiB; no feature subset was framed, imported, normalized or written.
- `attempts.json`: three harness setup/count/query faults, their diagnoses and corrections; originals untouched.
- `result.json`: exact commands/counts and gaps. Focused tests **77 → 120 passing**; native regressions **22 pass**.
  The partial broader suite has the same **12 failures** before/after (**483 → 522 pass, 54 skip**); optional
  dependencies also prevent full collection. This is not a full-suite pass. Backend/API/diff checks pass.

DESIGN `area._geojson_crs` shares exact named-form validation and `_crs` resolution with inspection.
       The GeoJSON branch uses the existing strict always-xy transform and retains source geometry/bytes.
       Only the undeclared out-of-range diagnostic changes; native readers and TypeScript/Studio stay untouched.
NEXT Review these commits; extend C6's manual profile/contracts and streaming declaration propagation separately.
