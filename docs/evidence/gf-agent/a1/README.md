TASK   A1 — Canonical vocabulary, MappingPlan v2 and executor            GATE GF-CONTRACT, GF-AGENT
WORKS  Validate/execute source-linked tabular and GIS candidates without model literals; v1 mapping stays intact.
SEE IT pnpm exec tsx docs/evidence/gf-agent/a1/run.ts
INPUTS LGD Gurugram CSV + unchanged GMDA sector attributes (EPSG:32643); NYC original for positive compatibility tests.
GAPS   Gaj definition unverified; Indian context remains unknown; broader API metadata test has a count mismatch.

## Consumer seam (A2/A3/A4/K1)

- Import vocabulary, `MappingPlanV2Schema` and operation/layout/value types from `@ulpin/contracts`; `@ulpin/contracts/usp` also reexports the v2 plan schema/type. V1 schemas/receipts remain unchanged.
- `fields[]` covers **every** source column, including `unknown`. Operations are strict objects: `{kind:'copy'}`, `{kind:'unit_convert',sourceUnit:'ft2'}`, `{kind:'enum_lookup',tableId:'…@1'}`, `{kind:'parse_literal',literalKind:'date_dmy'}`, `{kind:'link_parent_key',parentField:<inventory column>}`. No literal value/factor/CRS/ID payloads.
- Call `layoutFingerprint(fields)` → `validateMappingPlanV2(plan, context)` → `executeMappingPlanV2(plan, rows, context)`. Reader-owned context supplies exact columns, types, declared units, source reference, optional parents and source CRS. The hash is SHA-256 of ordered JSON `[normalised header,type]` pairs: NFC, trimmed/collapsed whitespace, lowercase. Reuse still requires exact inventory/unit validation.
- Citations use **zero-based logical data-row/feature indices**, excluding CSV headers. `literal` retains source cells beside parsed values. Unknown, absent, null, needs_input and conflicting stay distinct. Reviewer-authored plans still produce **candidates**, never reviewed facts. Unprofiled row columns are retained as needs_input.
- Parent-reference targets make the requested link operation usable without repurposing official identifiers; exactly one supplied parent must match. Unmapped enum categories abstain. Geometry retains source coordinates/CRS, not scene-ready geometry.
- `validateAdaptiveMapping` and the pure `normalizeMappedChunk` seam accept v2; `legacyPlanToV2` adapts v1. Converter pins include the new dependencies. **Persisted v2 approval/API/dispatch wiring remains A3 work**; no new authority, routes, tables or model calls.

## Evidence / limits

Hand-authored `lgd.plan.json` / `gmda.plan.json` and their output files retain every cell/locator. `result.json` records counts, unchanged hashes and literal rejection. Both Indian sources are administrative context: **all 14 cells correctly remain unknown**. Sector names are not plot/unit identifiers; undeclared GMDA `Area:0` is not parcel area. Both inherit `test_only` / permission `unconfirmed`. No held-out accuracy or whole-gate pass is claimed.

Searched fixture and task-data CSV/XLSX/GIS files. The difficult original is `E:/BhuAayam-data/task-data/ulpin-data-09/gmda-sectors-59-63a.json`, pinned by the retained Gurugram manifest. Original coordinates/bytes were not modified or committed. Positive building/geometry compatibility uses unchanged `fixtures/real-nyc/original.geojson`, foreign software-only evidence.

13 A1/adaptive tests, the manual literal-boundary test and both typechecks pass. Initial broad test invocation needed API decorator configuration; corrected invocation exposed **288 actual operations versus 235 expected** in the manual API ledger. No routes changed; that broader test remains failed.

NIST SP 811 Appendix B.8 supplies exact foot/yard factors. Government discovery did not verify gaj (Jamabandi returned no definition; Punjab TLS failed; measure pages were unavailable). No vendor factor or access bypass was used. **Gaj/marla/bigha/kanal/cent/guntha remain needs_input** pending an inspected applicable official definition.
