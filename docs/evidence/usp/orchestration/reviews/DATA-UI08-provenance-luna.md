# DATA/UI-08 provenance lookup

**Code pin:** `9527e105224c2ae6430fad01c0ac8576928a8471` (Astra UI-08 review result). Read-only lookup; no production edits, database/runtime inspection, or source-row values.

## Existing trustworthy fields and limits

- The current `work-queue` service supplies `dataKind` for case/import variants from recorded `physical_features.body.worldStatus` or `import_packages.body.sourceWorkspace.worldStatus`; the UI drops this field. The saved `spatial_datasets` branch is different: its classification is a compatibility default (`synthetic`/`demonstration`), not evidence about the saved source.
- `areas.ts` derives an area-level `data_kind` from recorded feature `worldStatus` (`real`, `demonstration`, `mixed`, or empty). This is a useful recorded-world-status distinction, not evidence of official issuance or source authority.
- The saved spatial dataset list exposes a classification constrained to `synthetic`; its compatibility normalizer also stamps that value. It does not provide a trustworthy observed-vs-synthetic distinction for these records. Astra's review found all saved entries flowing into a filter labelled “Synthetic sources”.
- Existing provenance contracts can carry stronger basis: a pinned Core Dataset revision has classification, attribution, licence and access; Core Source revisions/assets provide source-family/revision links, method, exact original hash/bytes and access. USP pack provenance can carry source release/resource IDs, acquisition time, original hash/bytes, licence family, permission states, purpose and qualification scope. These contracts are not joined into the affected saved-dataset listing, so their availability for any particular row is unknown here.

## Smallest safe projection

Add a read-time classification plus basis/status to the existing response/view model. Keep case/import `dataKind` visible as the record-derived world-status classification. For saved datasets, distinguish an explicitly source-backed value from the compatibility default; where its basis is absent or unqualified, return and visibly show `Unknown` / `Unverified` with the basis status. Apply that same qualified value to the Synthetic filter; unknown items must not be counted as synthetic. Show the classification and basis/status on saved-dataset, intake and scope surfaces.

“Official source” requires linked, pinned source identity/revision and asset/original integrity, plus recorded authority/attribution and applicable permission/acquisition evidence for the stated purpose. No current field described above independently establishes official status. Do not infer it from a name, URL, `observed`/`real`, or a compatibility classification; do not equate `synthetic` with the fixed “Test fixture” status. Preserve stored rows and source originals; this projection is display/read-time only.

## Scope

This lookup is based on schemas, service code and the pinned Astra review, not production-list contents. It identifies what the current contract can support and where the join/basis is missing; it does not classify any individual saved record or qualify official-source coverage. No tests were run.
