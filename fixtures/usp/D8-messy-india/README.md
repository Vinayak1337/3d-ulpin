# D8 — source-native Indian tables and GIS (D1, 10 October 2026 IST)

`manifest.json` is the development-teacher-safe view: **8 originals, 5 layout families, 3 development families and 2 held-out families**. `heldout.json` is **evaluator-only**; do not open it in a teacher context, include it in a teacher prompt, or use it for calibration. Its exact bytes are frozen by the hash in `manifest.json`. Held-out originals and their publisher schema documents remain outside Git.

## Development inputs

- `mi-d01`: retained LGD district CSV, unchanged. The small copy in `dev/lgd-districts.csv` preserves leading-zero identifier strings and missing local names. The OGD resource describes district codes, but an expanded per-column dictionary was not located: those meanings are explicitly `undocumented`, not worker-authored truth.
- `mi-d02`: three Bihar RERA **original HTML building tables** (Magnolia, 3D Apartment, A M Pinnacle). The independent publisher filing manual, page 11 §17, documents seven fields and explicitly states square-foot units for apartment, balcony and terrace areas. Land area in the registry is labelled square metres. Floor expressions remain literals; the manual does not authorize expanding `B`, `S`, or `G` into a reviewed level schedule.
- `mi-d03`: two genuine pages of Bihar's registered-project table, with publisher-labelled columns, mixed-script **address values**, missing addresses and plot/survey text. They do **not** have Devanagari headers. Pages 3 and 4 are unchanged, system-trusted responses to public, read-only pagination; no registration/application was submitted. Pages 1/2 remain external and unselected because their rows include closed storey projects.

Five development files are HTML, not CSV/XLSX. They are counted as real tabular originals, **not** as qualified CSV-import inputs. Whole HTML remains external because it includes unrelated public contact/bank sections. Give T1 only the selected non-personal table profiles and publisher definitions. No reformatted CSV, invented row or modified source is counted.

## Blind holdout inventory

| Family | Original file count | Case names |
| --- | ---: | --- |
| `mi-h01` | 1 | `GIS_attributes`, `declared_projected_crs` |
| `mi-h02` | 1 | `GIS_attributes`, `declared_projected_crs` |

These are distinct publisher schemas, frozen at family level. The evaluator must scope its oracle to what the publisher actually documents: aliases/types are not an expanded unit or legal dictionary. Missing meanings require abstention; a teacher's interpretation cannot fill the oracle.

## Limits and gaps

See `manifest.json → missingCapabilities` for the complete case gaps. Not found: Devanagari/legacy-font headers or digits, lakh-grouped numerical cells, record dates in `DD/MM/YYYY`, gaj/sq-yd/acre/hectare area fields, the specified UGF/LGF/Stilt/Podium/Mezz/B1 literals, tax/permission tabular registers, real injection examples and naturally missing/wrong CRS. Mixed-script addresses are not mixed-script headers; an explicit projected GIS response is not a doubtful-CRS example.

Permission is `unconfirmed` for local development; no public launch, redistribution or ML-training clearance is asserted. This is `usp-data-pack/1` **style**, not the strict existing DTO (which permits D0–D7 only). D8/column metadata and HTML ingestion require downstream work outside D1's owned paths. No runtime GF-DATA/GF-AGENT gate has passed.
