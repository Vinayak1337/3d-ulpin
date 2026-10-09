TASK   A2 — Column profiler and governed mapping teacher            GATE GF-AGENT
WORKS  Masked profiles become validated candidate/manual plans through control, replay or the one-key gateway.
SEE IT pnpm exec tsx docs/evidence/gf-agent/a2/run.ts
INPUTS Retained Gurugram LGD CSV + original GMDA sector attribute JSON (A1's sources).
GAPS   No live call, genuine Claude labels or held-out accuracy; API activation belongs to A3.

## Integration

- `column-profile.ts`: `profileColumnFile(path, sheet?, headerRow?)`, `profileColumns(rows, fields, sourceKind)`, `profileGisAttributes(rows, names?)`. CSV reuses PapaParse; XLSX/ODS reuse bounded Python native readers, without formula evaluation. `ULPIN_PROFILE_PYTHON` selects an existing geo-compatible interpreter. Preambles need `--header-row`; repeated literal ODS ranges need manual input.
- CLI: `pnpm exec tsx scripts/agent/profile-columns.ts <file> [--sheet <name>] [--header-row <one-based-row>]`. Prints **only profiles**, never raw rows. Ten observed samples are selected; tiny inputs explicitly report `sampleShortfall`, never fabricated padding. Free text is conservatively shape-masked; domain tokens such as **Group Housing / Residential Flat** survive without implementing A3's synonyms. Units require header/suffix evidence; disagreement leaves none. Null/absent/blank rates stay separate; empty-denominator features are null.
- `proposeMappingWithTeacher(profile, {context, dataPolicy, authorize, ...})` sends only profile-derived headers/shapes/masked samples plus vocabulary meanings. Letter-only aliases and word confidence prevent generated literal parameters. One schema repair is allowed, never a transport retry; invalid remaining fields require manual input.
- **A3:** supply server-derived public/development eligibility and scope authorization. Use `mappingContextFromColumnProfile` for A1's strict inventory validator and **`executeTeacherMappingDryRun`** to retain issues on cells, without collapsing null/absent states. Keep existing officer review/commit. These modules never write the registry.
- `mappingTeacherGatewayRuntime()` defaults to **replay**; `ULPIN_MAPPING_TEACHER_ADAPTER=sarvam` opts into live. Default runtime replay admits Sarvam-origin recordings only; test-control recordings are explicitly identified and isolated. Replay reauthorizes and revalidates, with zero paid reservations. This extends the existing gateway/adapters, not another authority.
- `ingestTeacherLabels(labelsPath, Map<profileHash, {profile, dataPolicy, rows?, sourceRef?}>, newOutputPath)` validates the exact development method, profile/fingerprint and A1 plan, rejects held-outs/restricted data, and creates per-column **pseudo_label** JSONL outside Git. `verified:true` means schema + local dry-run, **not truth or review**. Without rows it stays false; A4 must filter unverified examples and prioritize officer corrections. No genuine labels were enrolled.

## One live call — owner only

Key: **`ULPIN_PROVIDER_KEY_SARVAM`**. Configure existing `ULPIN_MODEL_GATEWAY_ENABLED=1` and `ULPIN_MODEL_GATEWAY_CONFIG` with that secret reference, approved funding/pricing/policy/input versions, total **and daily money caps**, and daily call cap. The existing PostgreSQL ledger must be available/reconciled. No credential file, environment file, database or runtime was changed here.

```sh
pnpm exec tsx scripts/agent/mapping-teacher.ts fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv --public-development --live
```

With prerequisites met, this submits **one attempt** (repair disabled), records it, and prints only plan/counts. No probes, SDK retries or account rotation. Omit `--live` for replay. New exclusive JSONL sessions go to `E:/BhuAayam-data/runtime/teacher-recordings/`, configurable by `ULPIN_TEACHER_RECORDINGS_DIR`. They retain hashes, bounded **redacted** raw envelopes (reasoning excluded), parsed plans, validation, tokens, latency and exact cost. Unknown usage/cost stays null with ledger exposure, never free success. Recording is required before live dispatch; its failure cannot bypass settlement.

## Qualification

`result.json` comes from the executable check. All 14 Indian administrative-context cells honestly need manual mapping; no parcel/building meaning is invented. Recorded replay evidence is **software control**, not a live answer. Supplemental retained UK XLSX/ODS checks qualify reader mechanics only. Current Sarvam V1 docs were checked for strict JSON-schema output, low reasoning, nullable cache usage and no tools. Live PostgreSQL concurrency/restart/provider qualification remains unrun.
