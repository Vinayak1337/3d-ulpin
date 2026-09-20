# T090 — source IDs, assigned 3D IDs and map clarity

Implemented a separate persisted application identifier registry for imported buildings and explicit floor records. `3D-<14 base32 characters>` comes from a versioned SHA-256 allocation over the original package fingerprint and canonical building ID; floors use `:<explicit level>`. Database uniqueness and transaction/advisory locks protect allocation retries. Duplicate levels/ambiguous parents fail pre-save validation. Original object IDs, DEMO aliases, raw source bytes, geometry, source revisions and snapshot digests remain intact.

This is a record-identity scheme linked to spatial records, not official government/ECCMA 3D ULPIN issuance or a geospatial encoding. Same-package reimport/reload is stable; identifying the same real building across different packages still requires reviewed reconciliation.

Source 2D ULPIN supports explicit 14-character alphanumeric string fields and existing identifier assertions. Leading zeroes are retained; numeric/malformed fields are not padded or fabricated. Shared parcel searches retain every linked building. The actual Shiv Vihar ZIP has no ULPIN field, and Lake View has only legacy DEMO-2D references. Both show Not supplied for official-format 2D ULPIN. Original references remain in Sources and aliases.

Global header and map search query saved assignments, preserve dataset/building/floor in the target URL and focus the shared map on selection. Local browser verified both directory → floor and Lake View → Shiv Vihar floor. `3D-YWJ1E24MR3W94R:1` resolves to SV-B-029, First Floor. Missing floor geometry is explicitly schedule-only.

UI: three sidebar tabs; compact ID and supplied 2D field; no main-map internal/fictional badges or source-label suffixes; provenance remains in Sources. Section cut/isolate-floor controls removed; unavailable Separate floors hidden. Duplicate floor list and conflict tray removed from the open-inspector view. Import button contrast fixed. Reference anchor reviewed, original scene shapes retained. Appllama connector was unavailable; skill guidance and supplied reference were used, not claimed external Appllama research.

Validation: 15 focused tests pass (both complete source packages, source-field aliases, assignments, aliases/search, ambiguous levels, originals, intake and masks). Both packages produce 81 building and 189 floor assignments. Live local HTTP retry/search test passes. Production build/typecheck pass. Local before/after captures in ../evidence/t090. Hosted deployment verification pending in this commit.
