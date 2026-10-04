# P2 — Site, real sources and team-labelled holdouts

Goal: one real Indian area and building to build everything around, and small human-labelled evaluation sets so the ML gate can actually pass. **P2.3 depends on an owner decision:** team members label the holdouts, and the labels are recorded honestly as team-labelled (deep dive §6, item 1).

---

## P2.1 ⭐ Choose the demo site and pin its sources

**Gate:** GF-DATA · **Depends:** P0.1 · **Owner:** data

```text
Pick one Indian area (0.5–2 km²) and one building in it to carry the whole demo. Default proposal: Gurugram GMDA
sectors 59/63A (fixtures/usp/D4/reference-area-gurugram-59-63a/) with the Haryana RERA project 2831 Tower 3
documents (docs/evidence/usp/association-crosswalk/, haryana-approval-evidence/). Fall back to Bihar Magnolia
Residency if Tower 3's location can't be supported from a source.

Read docs/api/real-sources.md, docs/api/datasets.json, H28 §3–5/Z4, H30 §B, and the D4/D5 manifests.

Deliver docs/evidence/usp/finale/GF-DATA/site-decision.md (at most 1 page):
- the area polygon and its source; the building and the document(s) that state its location;
- per layer (boundary/LGD, sectors, roads, water, land use, buildings, DEM, imagery, plans, RERA documents):
  source, URL, licence/permission state (unconfirmed is fine for local development; say so), CRS, vertical
  reference, stage (acquired | failed(<reason>) | not_available);
- known conflicts kept as conflicts (G+41/G+42) and known gaps.
Acquire missing layers only from data.gov.in or the issuing authority; public research layers allowed as
test_only with origin recorded. Update real-sources.md with one dated line.
```

**Expect back:** the site decision, updated manifests, and a list of layers with stages. This is a decision document, not a survey of every possible source.

---

## P2.2 ⭐ Indian messy-data fixtures from real sources

**Gate:** GF-DATA, GF-AGENT · **Depends:** P2.1 · **Owner:** data

```text
Collect a small set of REAL Indian source files that exercise the messy cases in H28 §Z3, for the ingestion
and mapping-agent work. Never edit or fabricate a file to create a case; if a case can't be found, record it
as a gap.

Target 8–15 files across: CSV/XLSX with Devanagari headers, lakh grouping, DD/MM/YYYY, mixed area units
(ft²/sq yd/gaj/m²), khasra numbers, floor labels (G, UGF, LGF, Stilt, Podium, Mezz, B1, Terrace); GIS layers
with missing .prj or doubtful CRS; RERA/sanction PDFs (native text and scanned).
Sources: data.gov.in, state RERA portals, municipal/development-authority portals.

Write fixtures/usp/D8-messy-india/manifest.json (usp-data-pack/1) listing each file, the cases it really
contains (with locators), and the expected handling per 00-STANDARDS §3. Large bytes stay outside Git.
```

**Expect back:** a manifest with real files and real cases, each with a locator, plus the list of cases not found.

---

## P2.3 ⭐ Team-labelled holdouts for GF-AI

**Gate:** GF-AI (DATA-04/07 replacement) · **Depends:** P2.1 and the owner's decision · **Owner:** data + 2 team members

```text
Create the small, honest evaluation sets the learned routes need. People label; agents prepare and check.

Imagery (building masks):
- 40–60 tiles of 512×512 px at ≤0.5 m/px from at least 2 Indian cities, including the demo area, from
  permitted imagery (record source and terms; OpenAerialMap Indian scenes, Bhuvan/NRSC products where their
  terms allow, or a permitted drone set). Include 5+ tiles with no buildings and 5+ dense informal areas.
- Label building ROOFPRINTS as polygons (outline what is seen from above, including chajjas and balconies);
  this is not a ground footprint (H27 Z1).
Plans (room segmentation):
- 20–30 Indian floor-plan pages (RERA/sanction sheets, mixed quality) rasterised at a recorded DPI.
- Label room polygons with classes mapped to CubiCasa5K's room classes, plus "unit boundary" where readable.
  Record the scale (from a dimension or scale bar) per page when present.

Process:
- Tool: CVAT or Label Studio (self-hosted, open source). Export COCO + GeoJSON (imagery in pixel and map
  coordinates).
- Labelling guide at most 1 page with 6 example images, written before labelling.
- Labeller A draws everything; labeller B reviews and corrects every item; disagreements go to a short log.
- Split by city/project: about 2/3 dev (may be used to fine-tune), 1/3 holdout (never used for tuning).
- Check RF-DETR/CubiCasa training-data overlap where knowable; HOTOSM/OAM scenes used by RF-DETR's card are
  excluded from the holdout.
- Record each label as review.kind:"human", independence:"team", with labeller IDs (no personal data in Git).

Write data/labels/<set>/manifest.json with item IDs, source hashes, split and label file hashes. Keep the
large files outside Git.
```

**Expect back:** two labelled sets with manifests, the labelling guide, the split, and a disagreement log. Expect about 1–2 person-days of labelling, which is the most valuable time anyone spends on this project.

---

## P2.4 Storey and level truth for documents

**Gate:** GF-AI support, GF-T16/T17 · **Depends:** P2.1 · **Owner:** data + 1 team member

```text
For every building whose storey structure is stated in documents you hold (Haryana, Bihar, and any added in
P2.2), a person records the truth: storey list as literal labels (e.g. B2, B1, Stilt, G, 1…41, Terrace), any
stated floor-to-floor heights, and the citation (page/region). Where sources disagree, record "conflicting"
with both values and both citations; where absent, "unknown".

Write data/labels/storeys/manifest.json plus one JSON per building. Split by project (holdout ≥ 1/3).
```

**Expect back:** storey truth for 10–30 buildings, with conflicts kept. This is the oracle for P4.4 and P5.1.
