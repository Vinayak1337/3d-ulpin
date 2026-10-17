# AU2 - ingestion gaps between a judge's unknown file and a property card (stages B and C)

Read-only audit of `staging` at `84fb2837` (ZJ1 merged). Gap list: [gaps.json](gaps.json) (27 entries, file:line
evidence). Nothing here was run; "unconfirmed" marks what needs a runtime. RG1, LA4 and LA5 are listed, not duplicated.

## Top ten, in the order I would fix them for the demo
1. **G01** The Studio drop keeps no file outside GeoJSON, CSV, XLSX, GPKG, ZIP; a small PDF/TIFF/LAZ/IFC/KML has
   no door at all (`/uploads` starts at 16 MiB + 1). The judges' file fails before the product sees it.
2. **G02** A probed item with no batch reader rests "undecided" with no words; give it `not_understood` and its
   signature, so "any file" at least ends in a sentence.
3. **G03** The confirmation run never heartbeats; after 180 s its lease lapses, `conflict()` (409) is read as a
   refusal and every listed building is stopped. 21 Niagara packages at ~10 s each would cross it (estimate).
4. **G05** Confirm-to-card has never run on an empty rehearsal runtime (REH2-REH5 stop before the press). One run,
   NYC then Niagara, after G03 and RG1, also measures G08 (commit cost).
5. **G04** After recording, no building beyond the 100 chosen can get a card from the Studio: a confirmation needs
   an uncommitted package and ready targets; the register's issue action is for coded units only.
6. **G07** Proposal outlines have no spatial index: each window read parses every package body (1.5 s fixed at
   41,809; 4 reads per view). Recommended fix below; no schema step.
7. **G06** Window and context reads take only the newest 30 packages of an area; past ~60,000 features older
   proposals vanish from the map with no words.
8. **G18** The area map cannot reach its batch confirmation; a proposal's "Open register" shows an empty register.
9. **G17** Upload caps are lifetime counts (128 v1 receipts and 512 MiB reserved ever, 8 v2 ever): rehearsals on
   the demo runtime spend the day's allowance. Fix (B2) or start fresh (owner).
10. **G10** A PDF in a batch is not read; the building "Add files" for PDFs is a local draft route
    (`routes.ts:109-118`), not the live API. Demo items 2 and 4 cannot start from a drop.

## Each file kind today (does a drop reach a reviewed candidate on staging?)
| Kind | Where it stops | Proof |
|---|---|---|
| GeoJSON <= 16 MiB | to card: layout answer, review, one confirmation, 100 cards | harness (LQ1b, E1); REH2 |
| GeoJSON 16-128 MiB | 21 REVIEWED packages, drawn by window; confirmation not run | rehearsal runtime (REH3, REH5) |
| GeoJSON > 128 MiB | rests `not_understood` (`intake-draft.ts:127-133`) | code only |
| ZIP of GeoJSON layers | each layer <= 16 MiB its own item (ZJ1); larger not kept (G12) | REH4 (words), unit |
| Shapefile ZIP | bounded direct import (16 MiB, 2,000); batch item says so | CB1 harness; Studio unconfirmed |
| GeoPackage | as shapefile; intake recipe not built (SH1) | code, CB1 |
| KML/KMZ | `needs_answer` with words; no area import | code only |
| CSV/XLSX | table page maps rows; execution refuses records; 2,000 rows | A3c; `service.ts:278-280` |
| PDF | not retained by the drop; the Studio never calls the document route | code; Tower 3 card via API (r3) |
| Raster/GeoTIFF, LAZ | not retained by the drop; readers by separate request only | AU3 runtime-01 (one read each) |
| IFC | not retained by the drop; reader is metadata only | code (`ifc-processor.ts:27`) |
| Images (JPEG/PNG) | no reader | code only |

## Officer path, candidate to card
1. Layout question (or memory proposal) -> one press: wired (LQ1b, ST1 for large files).
2. Package review: automatic in the run's `prepare` phase: wired (ZB1 words on refusal).
3. One confirmation (packages <= 100, cards <= 100): wired on the batch page (`run/Confirm.tsx`).
4. Commit, record at revision 1, snapshot, packet, card, verify: automatic; **fails at scale** (G03), unmeasured (G08).
5. Open record: wired, but the register 422s in a large area (RG1, in progress).
6. Card for a building not chosen at the press: **not wired** anywhere (G04).
7. From the map back to the confirmation: **not wired** (G18).
Link step 4 of the design (rows and pages onto the record) is not built (G09, G10, G21).

## Large area after LA1, LA2, REH5
- Register (RG1), camera (LA4), window line (LA5): in progress; not repeated in tasks here.
- Confirming 41,809 proposals: the contract allows it (21 packages <= 100), every building gets a record at commit,
  cards only for 100. Cost: each package commit runs ~9 statements per feature under one global advisory lock
  (`areas.ts:1643`, loop `:1688`), and the whole commit phase runs in one job attempt with no heartbeat (G03).
  LQ1b saw 12.0 s from press to first card for one 1,661-feature package; 21 packages is an estimate of 3-4 min.
- After commit the buildings move to `physical_features` with geometry, read through the GiST index, so the map
  gets faster; the 30-package cut (G06) also stops mattering for recorded features.

## Proposal outline index: options (G07)
A draft row is inserted with its body only (`areas.ts:1003`); geometry arrives at commit (`:1701`). The window
reads build every proposal's outline from `import_packages.body` per request (`area-display-window.ts:24-29`).
- **A. Store the outline at draft (recommended).** Write `geographic_geometry` (not `geometry`) on the revision-0
  row in the same insert, and on a package correction. `proposed` then joins `physical_features` with
  `ST_Intersects` on `physical_geographic_gist`. No schema step (column and index exist, `area.sql:35,38`). Every
  reader I found filters `revision>0` (snapshots, area reads, officer, review context), so recorded behaviour
  holds; the invariant "no geometry until recorded" becomes "no *recorded* geometry until recorded", a lead
  decision. Old drafts keep the package path until redrafted. Step 0: EXPLAIN ANALYZE on the rehearsal to split
  the 1.5 s between the proposal rule's body read and the geometry parse; if the rule dominates, A alone is not
  enough and the rule's choice must be stored at review too.
- **B. Expression index on the package extent.** `gist(ST_GeomFromGeoJSON(body->'geographicExtent'))` on
  `import_packages` prunes packages, not features (still ~2,000 parsed per hit). Schema step (one index), small gain.
- **C. A new outline table** keyed by feature and package, GiST. Schema step (additive table), clean separation,
  most code.
- **D. None.** Keep 1.5 s per read; the view fills in 8-10 s; grows with packages.

## The rest, by stage
**A (spine):** G17 lifetime caps (S); G22 scheduler waves and reservations (M, after G14).

**B (meaning and links), no merged code for any of these:**
- G09 table rows to facts on a building: AU4-B1..B4 unmerged; `usp_holding_keys` has no writer (L, schema step).
- G21 waiting keys and late arrivals; closing pass (M, schema step, part of AU4).
- G10 PDF page lane in a batch (L); G23 page images and photos (M).
- G13 table reader as a stream past 2,000 rows and 16 MiB (L).
- G11 shapefile/GPKG intake recipe (SH1) and KML area import (L); G12 large ZIP members (M).
- G24 layout approval carried to the next file of the same layout (S).

**C (surface and models), no merged code:** G14 raster pyramid, roof chips, LAS/LAZ height grid (AU3 SURFACE-*,
L); G15 IFC structure scan (M); G16 large ceilings to 1 GB and 500,000 features (M); XL "register in place" not
built (not listed: no demo need found).

**Demo and owner:** G05 rehearsal run; G18 map-to-batch link; G19 Sarvam keys not loaded, no live call yet;
G20 a cleaned runtime (area delete is local-only; a second copy of a file is refused runtime-wide).

## Method
Read `INGESTION-ARCHITECTURE.md`, `SPRINT-SELECTION.md`, `STATUS.md` (top), REH3-REH5 and LA2/LQ1b/LR3 results;
then the code paths named in gaps.json. Searches for writers, routes and callers were done with grep in this
checkout; claims resting on a grep say so in the entry's notes.
