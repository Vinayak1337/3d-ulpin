# DATA-LINK-01: retained drawing relationship source pack

This is a bounded, unreviewed source preparation record. It reuses three unchanged official portal PDFs from D5. The files were copied byte for byte to `E:/BhuAayam-data/task-data/association-sources-20260929`; no new source bytes were downloaded. [The manifest](manifest.json) records issuer URLs, first acquisition times, hashes, geography, reference limitations and permission status. [The observations](observations.json) cite page and visual region for each native building/floor statement.

The Haryana Tower-3 plan and section support a building-level, multiple-floor *drawing* relationship. The Bihar Villa Type 5 architecture sheet supports a type-level multilevel drawing relationship but its unit number is blank; it cannot identify a particular villa. These are candidate source observations, not reviewed labels, canonical matches or recorded property facts. No registry snapshot was inspected, so no-match and outside-loaded-record states remain unassessed. Plans are not as-built or rights evidence.

Source-specific reuse, redistribution and ML training permission remain unconfirmed in D5 and DATA-05. This pack is ineligible for AI-08 training pending permission and independent relationship review. It also lacks a verified document-to-canonical-building/floor pair. The lead should retain the current source-index/catalogue statuses and add only this evidence pointer after review.

## Local checks

- `Get-FileHash` on the three retained PDFs and their private copies: all six checks matched the D5 SHA-256 values.
- Poppler renders from the earlier DATA-05 private inspection were viewed for Bihar pages 1–2 and the Haryana Tower-3 plan and section. The cited labels and blank Bihar unit number were visually present. OCR or extracted text was not treated as the oracle.
- JSON parsing, source ID/hash cross-check and each citation's required page/region/text fields are checked before commit; see the completion callback for exact command and exit.

The private checksum receipt lives beside the PDFs. Neither the PDFs nor their renders are committed.
