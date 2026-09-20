# T090 — source IDs, assigned 3D IDs and map clarity

Implemented a separate persisted application identifier registry for imported buildings and explicit floor records. `3D-<14 base32 characters>` comes from a versioned SHA-256 allocation over the original package fingerprint and canonical building ID; floors use `:<explicit level>`. Database uniqueness and transaction/advisory locks protect allocation retries. Duplicate levels/ambiguous parents fail pre-save validation. Original object IDs, DEMO aliases, raw source bytes, geometry, source revisions and snapshot digests remain intact.

This is a record-identity scheme linked to spatial records, not official government/ECCMA 3D ULPIN issuance or a geospatial encoding. Same-package reimport/reload is stable; identifying the same real building across different packages still requires reviewed reconciliation.

Source 2D ULPIN supports explicit 14-character alphanumeric string fields and existing identifier assertions. Leading zeroes are retained; numeric/malformed fields are not padded or fabricated. Shared parcel searches retain every linked building. The actual Shiv Vihar ZIP has no ULPIN field, and Lake View has only legacy DEMO-2D references. Both show Not supplied for official-format 2D ULPIN. Original references remain in Sources and aliases.

Global header and map search query saved assignments, preserve dataset/building/floor in the target URL and focus the shared map on selection. Local browser verified both directory → floor and Lake View → Shiv Vihar floor. `3D-YWJ1E24MR3W94R:1` resolves to SV-B-029, First Floor. Missing floor geometry is explicitly schedule-only.

UI: three sidebar tabs; compact ID and supplied 2D field; no main-map internal/fictional badges or source-label suffixes; provenance remains in Sources. Section cut/isolate-floor controls removed; unavailable Separate floors hidden. Duplicate floor list and conflict tray removed from the open-inspector view. Import button contrast fixed. Reference anchor reviewed, original scene shapes retained. Appllama connector was unavailable; skill guidance and supplied reference were used, not claimed external Appllama research.

Validation: 15 focused tests pass (both complete source packages, source-field aliases, assignments, aliases/search, ambiguous levels, originals, intake and masks). Both packages produce 81 building and 189 floor assignments. Live local HTTP retry/search test passes. Production build/typecheck pass. Local before/after captures in ../evidence/t090. Hosted HTTP retry/search passed. Both original hosted ZIP downloads remain byte-identical to data-source; active dataset count stays two. The 23-file initial deployment matched GitHub main with zero mismatches. Final floor-disclosure polish is tracked by commit 05b76c2.

## Additional browser evidence

The isolated local source-field test added `ulpin_2d: 00123456789ABC` to a copy of the synthetic parcel file and updated its manifests. The importer first rejected deliberately inconsistent fingerprints, then accepted the self-consistent copy. The UI preserved the supplied string and leading zeroes; search found B01 and zoomed from block context to its building. This is a synthetic format test, not an official ULPIN or newly received real record. It was never saved to local or hosted datasets; neither original ZIP was altered. `source-field-test.png` explicitly shows the test preview.

Final floor panel keeps occupancy behind a collapsed disclosure. Expanding preserves source names and roles, with readable apartment labels rather than legacy unit identifiers. Map geometry remains from the actual imported vectors, including Lake View conflicts; no photograph or replacement box was substituted.

Design read: preserve the existing public-sector officer map, quiet hierarchy, native CSS, variance 3 / motion 2 / density 4. Local full-size screenshots checked against the supplied block-map anchor and the before capture. This is a desktop spatial tool; marketing/mobile-only skill prescriptions are not applicable.

## Final hosted acceptance

Runtime commit `05b76c2` is on branch and main and deployed. Final local and hosted production builds pass. Hosted map.js SHA-256 matches the committed local file. Web, dispatcher and Caddy are active. Native Safari verified directory search for `3D-T9GRMW08XWS50W:1` opening Lake View / B01 / Floor 1, correct floor geometry and selected label, three sidebar tabs, collapsed resident details, and no section/isolate controls. Hosted read-only retry/search tests pass for both datasets. 270 persisted assignments total (81 buildings, 189 explicit floors). Both hosted original ZIPs still exactly match the supplied local originals; no data import/seed script or source rewrite was used.
