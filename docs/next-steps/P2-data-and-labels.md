# P2 — Site, real sources, and evaluation truth without team labelling

Goal: real Indian sources to build the demo around, and evaluation sets the learned routes can be judged on honestly.

**Updated 10 October:** the owner confirmed there is no team labelling. Truth comes from four places, and each claim names its source and scope:

| Task | Truth source | Why it counts |
| --- | --- | --- |
| Building masks | **RAMP** (DevGlobal): Karnataka, India has 6,288 chips; 6 Bangladesh regions have about 46k | Every chip was labelled by one person and reviewed by a second. CC BY-NC 4.0. |
| Room / plan layout | **Source literals** in CAD (vector) sanctioned plans: room labels with stated dimensions. **CubiCasa5K** test split (foreign, human-labelled) for the plan model | The plan states its own dimensions. CubiCasa is the model's published benchmark. |
| Storeys and floor labels | **Official RERA registry fields** (project/tower pages) and sanction letters | Issued by the authority, independent of the PDF we extract from. |
| Field mapping | **Publisher data dictionaries** (data.gov.in field descriptions, portal schemas) | The publisher states what each column means. |

Teacher or agent outputs (Sarvam) are `pseudo_label` training material only, never evaluation truth.

---

## P2.1 ⭐ Demo storyline and pinned sources

**Gate:** GF-DATA · **Depends:** none · **Owner:** data worker (sprint D2)

```text
Pin the sources for three demo anchors and write docs/evidence/usp/finale/GF-DATA/site-decision.md (≤1 page):

A. Documents and storeys: Haryana RERA 2831 Tower 3 (retained T3 PDFs, project page) inside the Gurugram GMDA
   sectors 59/63A reference area (fixtures/usp/D4/reference-area-gurugram-59-63a/). The G+41/G+42 conflict stays a
   conflict. Note: the Tower 3 plans are scanned images (no text layer, no vector paths).
B. Rooms and units: Bihar Magnolia Residency. The sanctioned layout PDF is CAD vector with room labels and stated
   dimensions (E:/BhuAayam-data/task-data/association-sources-20260929/bihar-magnolia-sanctioned-layout-original.pdf).
   Placement comes only from a stated location (RERA registry address, site plan coordinates). If none exists,
   the building is shown in its local frame with placement "unknown"; never geocode-and-claim.
C. Imagery and AI roofprints: one contiguous Karnataka RAMP area taken from the FROZEN HOLDOUT clusters (P2.3),
   so the demo shows honest, unseen-tile performance. Record the imagery source/licence (CC BY-NC 4.0, Maxar via
   RAMP).

For each layer (boundary/LGD, sectors, roads/water if official, buildings, imagery, plans, RERA documents,
registry pages): source, URL, licence/permission state (unconfirmed is fine for local development; say so),
CRS, vertical reference, stage (acquired | failed(<reason>) | not_available). Reuse retained originals from
docs/api/real-sources.md and docs/api/datasets.json before downloading anything. Update real-sources.md with
one dated line per new acquisition.
```

**Expect back:** site-decision.md, the updated manifests, and the list of layers with their stages.

---

## P2.2 ⭐ Messy Indian files for the agent, with publisher truth

**Gate:** GF-DATA, GF-AGENT · **Depends:** none · **Owner:** data worker (sprint D1)

```text
Collect 8–15 REAL Indian tabular/GIS files that exercise the H28 §Z3 messy cases, grouped into at least 5 layout
FAMILIES (same publisher/schema = one family). Prefer datasets whose publisher documents the fields (data.gov.in
resource field descriptions, portal schema pages, attached data dictionaries): that documentation is the
evaluation truth for the mapping agent.

Cases to find (record which ones each file really contains, with locators): Devanagari or mixed-script headers,
lakh grouping, DD/MM/YYYY, mixed area units (ft²/sq yd/gaj/m²), khasra/plot numbers, floor labels (G, UGF, LGF,
Stilt, Podium, Mezz, B1, Terrace), unit/flat inventories, RERA project lists, property-tax or building-permission
registers, GIS layers with a missing .prj or doubtful CRS. Never edit or fabricate a file to create a case;
record missing cases as gaps.

Write fixtures/usp/D8-messy-india/manifest.json (usp-data-pack/1): per file, its family, URL, issuer, acquisition
date, SHA-256, licence, the cases with locators, and per column the publisher's documented meaning (or
"undocumented"). Split families: about 3 development families and at least 2 HELD-OUT families that the agent
and the learner never see during development. Large bytes stay in E:/BhuAayam-data/datasets/messy-india/.
```

**Expect back:** the manifest with real files, families, the split and documented column meanings, plus the list of cases not found.

---

## P2.3 ⭐ Vision sets from public human-reviewed data

**Gate:** GF-AI (DATA-04/07 replacement) · **Depends:** none · **Owner:** GPU/ML worker (sprint B1)

```text
Buildings (RAMP, https://radiantearth.blob.core.windows.net/mlhub/repositories/ramp/ramp/ , CC BY-NC 4.0):
- Download ramp_karnataka_india (6,288 chip/label pairs, ~1.2 GiB) and the six Bangladesh regions (dhaka,
  sylhet, chittagong, barishal, jashore, coxs_bazar; ~46k pairs, ~8.5 GiB) into E:/BhuAayam-data/datasets/ramp/.
  Keep every original byte; write a manifest with URL, SHA-256, size, region, licence and attribution.
- Read the RAMP README/Documentation.pdf for chip size, resolution and labelling rules (roof outlines, review).
- Karnataka split by GEOGRAPHY, not by chip: cluster chips by their georeferenced centroids (e.g. ~1 km grid
  cells), then assign whole clusters: ~20% HOLDOUT (frozen, hashed, never used for training or tuning), ~15%
  DEV (checkpoint choice, thresholds), rest TRAIN. Bangladesh: TRAIN only. Include empty chips in all splits.
- Note the installed RF-DETR checkpoint's documented training data; if overlap with RAMP can't be ruled out,
  say so in the preregistration.
- Export COCO instance segmentation per split (reuse scripts/usp/learning/prepare_ramp_coco.py where it helps;
  keep it plain).

Plans:
- CubiCasa5K test split (published human labels) is the plan model's benchmark; it is foreign (Finland), so the
  claim says so.
- Indian vector plans (Bihar) give source-literal room dimensions; they check the vector reader (P4.3a), not a
  learned model.
- Indian raster plans have no human labels in this sprint: their candidates are reported as uncalibrated.
- Optional later: ResPlan (South Asian listings, CC BY 4.0) if a plan fine-tune is ever attempted.
```

**Expect back:** the RAMP manifest, the COCO exports, the frozen split with its hash and cluster map, and a short note on resolution/labelling rules. Record the licences as launch-clearance gaps; they don't block development.

---

## P2.4 Storey and level truth from official registries

**Gate:** GF-AI support, GF-T16/T17 · **Depends:** P2.1 · **Owner:** data worker (sprint D2)

```text
For each building whose storeys we extract from documents (Tower 3, Bihar Magnolia, and any RERA project added
in P2.2), record the INDEPENDENT truth from the issuing authority: the RERA registry's structured fields (number
of towers, floors per tower, basements, unit counts) and any sanction letter statement, each with a citation
(URL + retrieval date, or page/region). Keep floor labels as literals. Where sources disagree, record
"conflicting" with both values and both citations; where absent, "unknown". No person invents or "fixes" a
value.

Write data/labels/storeys/manifest.json plus one JSON per building, split by project (holdout ≥ 1/3 of
projects).
```

**Expect back:** storey truth for 10–30 buildings from registry fields, with conflicts kept. This is the scoring truth for P4.4.
