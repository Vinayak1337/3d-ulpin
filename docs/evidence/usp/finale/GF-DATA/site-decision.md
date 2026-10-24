# Demo source decision — D2, 10 October 2026 IST

**A — Haryana RERA 2831, Tower 3.** Use the retained planned drawing set inside the **Gurugram sectors 59/63A reference area**, not a claimed tower coordinate or parcel. **G+41 / G+42 remains `conflicting`** (S-001 graphic versus tables). T3 plans/section are scanned images, without text or vector paths; current approved revision and as-built status remain unknown.

**B — Bihar Magnolia Residency.** Use the retained **CAD-vector sanctioned layout** for literal room/dimension work. The registry states **“Deva Nagar, Singhaul”**, Begusarai; this supports an address, not coordinates. Display the drawing in its local frame with geographic placement **`unknown`**. Do not geocode-and-claim; no keyed villa/unit placement is established.

**C — Karnataka RAMP imagery area (K2c):** choose frozen cluster **`6933:7322:1640`**, using only B1's
split/chip-count metadata: the first qualifying mixed-density cluster in sorted order, with 22 retained chips,
9 publisher-empty and 13 nonempty; the densest chip has 24 publisher features. This gives dense rows and empty
context without looking at truth polygons or model performance. The preregistered approximately 1 km grid is
EPSG:6933; each original chip keeps its declared EPSG:4326 TIFF affine. Imagery and candidate generation are
**display-only `test_only`**, not a new holdout score, training signal or reopened evaluation slot. No RAMP
truth polygon is installed as a building. CC BY-NC 4.0, publisher attribution and Maxar upstream conditions stay
with every chip. Operational/legal clearance, measured terrain and surveyed ground footprints remain unknown.
API installation and exact source pins are recorded in `docs/evidence/gf-backend/k2c/`; this decision alone
is not an installation or accuracy claim.

| Anchor / layer | Source and URL | Permission | CRS / vertical reference | Stage |
| --- | --- | --- | --- | --- |
| A administrative label (not boundary polygon) | LGD [district resource](https://www.data.gov.in/resource/local-government-directory-lgd-districts), retained CSV | unconfirmed; historical GODL notice, resource applicability not independently pinned | not spatial / not applicable | acquired |
| A sector context | GMDA [layer 18](https://onemapdepts.gmda.gov.in/server/rest/services/Toilet2/MapServer/18), retained exact query in D4 manifest | unconfirmed | EPSG:32643 query output / unknown | acquired |
| A road context | GMDA [layer 7](https://onemapdepts.gmda.gov.in/server/rest/services/Toilet2/MapServer/7), retained D4 query | unconfirmed | EPSG:32643 query output / unknown | acquired |
| A parks | GMDA [layer 8](https://onemapdepts.gmda.gov.in/server/rest/services/Toilet2/MapServer/8), retained empty query | unconfirmed | EPSG:32643 / unknown | acquired (0 returned features; completeness unknown) |
| A registry/address | [Haryana RERA 2831](https://haryanarera.gov.in/view_project/project_preview_open/2831), retained HTML | unconfirmed | no coordinates / not applicable | acquired |
| A plans, section, site plan | Haryana RERA attachments: [T3 plan](https://haryanarera.gov.in/project/view_uploaded_Document_open/781dca7f03NDg2NTc=), [section](https://haryanarera.gov.in/project/view_uploaded_Document_open/c313c18c7bNDg2NjA=); exact S-001 URL/pins in storey truth | unconfirmed | drawing-local / building-relative labels, no verified datum | acquired |
| B registry/address | [Bihar registry](https://rera.bihar.gov.in/Filanprint.aspx?id=RERAP2311201700019-3), retained HTML | unconfirmed | geographic placement unknown / not applicable | acquired |
| B sanctioned plan | [Bihar sanctioned layout](https://rera.bihar.gov.in/All_Document/RERAP2311201700019RERAP2311201700019-3SanctionedLayoutPlan.pdf), retained original | unconfirmed | drawing-local / building-relative stated levels, no global datum | acquired |
| C imagery / roofprint truth | [RAMP release root](https://radiantearth.blob.core.windows.net/mlhub/repositories/ramp/ramp/) | CC BY-NC 4.0; operational clearance unconfirmed | exact TIFF CRS/affine and vertical applicability pending B1 | not_available (B1 selection pending) |
| A/B/C boundary polygon, water, terrain, observed buildings | No matched, qualified source selected in this task | unconfirmed | unknown / unknown | not_available |

All `unconfirmed` sources are owner-approved **local development only**; access is not redistribution permission. Reuse lineage: `fixtures/usp/D4/reference-area-gurugram-59-63a/manifest.json`, D5 manifest, `association-sources-20260929/`, and `association-crosswalk-20260930/`. Acquisition is not API installation, a reviewed registry fact, or a runtime gate pass.
