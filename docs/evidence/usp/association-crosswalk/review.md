# DATA-LINK-03R retained-source crosswalk review

The retained land file partly explains Bihar's Khata discrepancy, but it does not resolve the drawing's Jamabandi number or identify a numbered villa. Haryana's additional sheet supports explicit planned floor scopes while adding a visible floor-count conflict. The exact current approved revision remains unresolved. All canonical matches stay `not_assessed`; no registry record or training label was created.

## Bihar

The approved-layout PDF (`f8a55dc251facb1d0442e9a306db218356082f5d34a2c5071e9b0db64abb60b3`) is byte-identical to the earlier reviewed plan. Its p. 1 right title block still says `VILLA TYPE 5, UNIT NO. - ____`, `V5-01`, `08.06.21`, Khesra 1659, Khata 35 and Jamabandi 333. It does not select one of the numbered layout positions or establish a new approval revision. The earlier independent p. 2/V5-02 type-level review remains applicable.

The project HTML (`bc3b4f8a4644505681526f6c39b0145285e60590c90354e9fd2fd88b7d5edc1e`) still lists part of plot 1659, Khata 40, Jamabandi 330. Its Building Details row gives a project-level `Magnolia Residency / 3 / Duplex / 12` entry, without a per-villa number/type mapping. The displayed approval date is `1899-12-30`; this is recorded as displayed and is not accepted as a usable drawing approval date. Its cause was not established.

The land/location PDF (`1fed768fa33b3fa249bbfe84805903f8d1e16a06d839afcbd0ca6d86b0108b6a`) adds useful context:

| PDF page and visible region | Source observation | Supported conclusion |
| --- | --- | --- |
| p. 18, upright mutation-table row | Jamabandi 330; grouped Khata 40, 35, 212 and Khesra 1641, 1659, 1660 | Both Khata 35 and 40 occur within this retained land record. Their difference alone does not establish different property. Grouped columns do not establish a one-to-one mapping. |
| p. 20, printed rent receipt header and identifier row | Jamabandi 330, Khata 212/35/40, Khesra 1641/1659/1660, date 26-08-2021 | Corroborates the grouped identifiers and 330 at source level. It does not correct the drawing's 333 or select a villa. |
| pp. 15 and 19, receipt headers; p. 21, Nature of Information required | Visible references to 330, including an information request | Context only. The dense handwritten annotations were not transcribed as an authoritative correction. |
| p. 22, corrected-orientation Jamabandi copy header and plot table | Jamabandi 330 and November 16, 2019 are readable; three plot rows are visible | Faint/clipped row-level Khata mappings remain untranscribed. No exact row assignment is inferred. |

This is a **partial reconciliation** of the Khata context. The Jamabandi 333 versus 330 conflict remains. A versioned issuer/project-approved villa/type/site-position schedule and an issuing-source identifier correction or explicit crosswalk are still needed.

## Haryana

The project HTML (`ab2eecce106b47aeea784fb34bd1853f0501c0c70ad582ad0976ff6e8b773ea8`) links the exact retained site-plan and Tower-3 Plan-2 URLs in project 2831. It also lists Plan-1 and Section Elevation, with document-list dates 29-08-2024. The layout/building approval fields display 29-04-2024. Those dates do not identify the current approved revision of each retained sheet.

| PDF hash, page and visible region | Verified observation | Consequence |
| --- | --- | --- |
| Site plan `26c2d3101bfe676c8ac66f129439e066b603a555b3c55a35ba509befb707fad9`, p. 1 central tower graphic and lower tables | The T-3 graphic says `G+41`; both `UNIT DETAIL` and `TOWER AREA DETAIL` list Tower 3 as `G+42`. The bottom-right title block says `SITE PLAN / PLAN & AREA CALCULATION`, `S-001`, `JAN-2024`. | A conflict exists within the same retained sheet. No approved or built floor count is selected. |
| Plan-2 `2aadce88509b437bfa8ff104e7f7d51f62e05bc8fc904e26e41a43e8263b1bd1`, p. 1 main captions and bottom-right title | `TOWER-03 / PLAN & AREA CALCULATION`, `T3-2`, `JAN-2024`; Typical Floor-01 names 3rd–12th, 14th–16th, 18th–20th, 22nd–25th, 27th & 29th, 31st–34th, 36th–37th and 39th–41st. Typical Floor-02 prints `13rd, 21st, 30th & 38th FLOOR`. | Supports two distinct native planned floor scopes. Preserve the printed lists, gaps and spelling; do not infer omitted floors or canonical floor/unit identities. |
| Same Plan-2, p. 1 upper-right sanction region | A sanction stamp and signatures are visible; the memo number/date are not readable. | The stamp does not establish the exact current approved sheet revision or paired set. |

The portal grouping, matching project/architect blocks and T3 sheet family support adding T3-2 to the native **planned Tower-3 drawing-set context** established in the [earlier independent review](../association-sources/independent-review.md). They do not prove that T3-1, T3-2 and T3-4 constitute the current approved revision. A readable approval memo and issuer-approved sheet index/revision register are still needed, followed by a versioned canonical building/floor crosswalk and registry comparison.

## Evidence and execution

[observations.json](observations.json) holds seven findings with exact source hashes, pages/regions and private derivative references. All six originals matched the immutable [manifest](manifest.json) byte counts and SHA-256 pins. Retained native text was used where available; scanned content was checked visually. HTML fields/document links were read with a standard-library parser. No whole chat history, download, OCR/model run, source edit, API, Docker or registry query was used.

Private derivatives and their dimensions, byte counts and hashes are indexed at `E:/BhuAayam-data/task-data/association-crosswalk-20260930/review-recovery/image-index.json`. Fifteen new views total **2,079,410 bytes**; the largest is **352,865 bytes**, below 350 KiB. Aggregate checks rejected larger proposed image sets before they were viewed; smaller JPEG derivatives then passed the 2 MiB bound. An overview was used only to locate land-record regions, not to read their facts. Originals and prior renders remain preserved. No 413 occurred in this recovery.

Validation: source-hash assertion command exited 0; derivative-size assertions exited 0 after the bounded adjustment; JSON/source-pin/image-index validation and staged whitespace check exited 0. Supplied permissions are `never` / `danger-full-access`. GPT-6.1 Sol/high and default/standard speed were requested; actual turn model, effort and tier were unexposed. No owned process remains running.

These separate Bihar/Haryana observations concern submitted planned drawings and retained land-document text, not ownership, issued rights, as-built geometry, ML labels or a GF/release pass. Source-specific reuse, redistribution and training permission remains unconfirmed in the retained manifest.
