TASK   A2 — Mapping teacher review fixes and A1 readability            GATE GF-AGENT
WORKS  Masked profiles yield validated candidate/manual plans; messy development labels verify per field.
SEE IT pnpm exec tsx docs/evidence/gf-agent/a2/run.ts
INPUTS Retained Gurugram LGD CSV + original GMDA sector attribute JSON (A1's sources).
GAPS   No live call, genuine Claude labels or held-out accuracy; API activation belongs to A3.
DESIGN Profiling/masking helpers reuse PapaParse and bounded native readers via read_workbook_cells.py.
       Teacher request/repair/retention helpers use the existing gateway; replay picks the newest valid timestamp.
       Label checks emit per-field pseudo-label metrics; A1's validator/executor use named, unchanged-behaviour helpers.

## Integration

- `column-profile.ts`: `profileColumnFile(path, sheet?, headerRow?)`, `profileColumns(rows, fields, sourceKind)`,
  `profileGisAttributes(rows, names?)`. CSV reuses PapaParse; XLSX/ODS reuse bounded Python native readers,
  without formula evaluation. `ULPIN_PROFILE_PYTHON` selects an existing geo-compatible interpreter.
  Preambles need `--header-row`; repeated literal ODS ranges need manual input.
  Strict UTF-8 and BOM-marked UTF-16 LE/BE are supported; decoding errors use `COLUMN_ENCODING_UNSUPPORTED`.
- Profiler CLI: `pnpm exec tsx scripts/agent/profile-columns.ts <file>` with optional `--sheet` and `--header-row`.
  Prints **only profiles**, never raw rows. Ten observed samples are selected; tiny inputs explicitly report
  `sampleShortfall`, never fabricated padding. Free text is conservatively shape-masked; domain tokens such as
  **Group Housing / Residential Flat** survive without implementing A3's synonyms. Units require header/suffix
  evidence; disagreement leaves none. Null/absent/blank rates stay separate; empty-denominator features are null.
- `proposeMappingWithTeacher(profile, { context, dataPolicy, authorize, ... })` sends only profile-derived
  headers/shapes/masked samples plus vocabulary meanings. Letter-only aliases and word confidence prevent
  generated literal parameters. One schema repair is allowed, never a transport retry. Partial retention keeps
  the first valid target in column order; duplicates become unknown with `TEACHER_DUPLICATE_TARGET`.
- **A3:** supply server-derived public/development eligibility and scope authorization.
  Use `mappingContextFromColumnProfile` for A1's strict inventory validator and **`executeTeacherMappingDryRun`**
  to retain issues on cells, without collapsing null/absent states. Keep existing officer review/commit.
  These modules never write the registry.
- `mappingTeacherGatewayRuntime()` defaults to **replay**; `ULPIN_MAPPING_TEACHER_ADAPTER=sarvam` opts into live.
  Default runtime replay admits Sarvam-origin recordings only; software controls remain isolated.
  Replay reauthorizes/revalidates, selects the most recent valid `recordedAt`, and has zero paid reservations.
  This extends the existing gateway/adapters, not another authority.
- `ingestTeacherLabels(labelsPath, profiles, newOutputPath)` accepts a hash-keyed map of
  `{ profile, dataPolicy, rows?, sourceRef? }`. It validates the exact development method, profile/fingerprint
  and A1 plan, rejects held-outs/restricted data, and creates per-column **pseudo_label** JSONL outside Git.
  Each example carries `dryRun: { cells, needsInput, conflicting }`; `verified:true` requires cells and an issue
  rate at most `MAX_FIELD_ISSUE_RATE = 0.1`, **not truth or review**. Reports count verified/unverified fields
  per label. Without rows verification stays false; A4 must filter and prioritize officer corrections.
  No genuine labels were enrolled.

## One live call — owner only

Key: **`ULPIN_PROVIDER_KEY_SARVAM`**. Configure existing `ULPIN_MODEL_GATEWAY_ENABLED=1` and
`ULPIN_MODEL_GATEWAY_CONFIG` with that secret reference, approved funding/pricing/policy/input versions,
total **and daily money caps**, and daily call cap. The existing PostgreSQL ledger must be available/reconciled.
No credential file, environment file, database or runtime was changed here.

```sh
pnpm exec tsx scripts/agent/mapping-teacher.ts \
  fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv --public-development --live
```

With prerequisites met, this submits **one attempt** (repair disabled), records it, and prints only plan/counts.
No probes, SDK retries or account rotation. Omit `--live` for replay. New exclusive JSONL sessions go to
`E:/BhuAayam-data/runtime/teacher-recordings/`, configurable by `ULPIN_TEACHER_RECORDINGS_DIR`.
They retain hashes, bounded **redacted** raw envelopes (reasoning excluded), parsed plans, validation, tokens,
latency and exact cost. Unknown usage/cost stays null with ledger exposure, never free success.
Recording is required before live dispatch; its failure cannot bypass settlement.

## Qualification

`result.json` comes from the executable check, including the five review regressions and the A1 output comparison.
All 14 Indian administrative-context cells honestly need manual mapping; no parcel/building meaning is invented.
Recorded replay evidence is **software control**, not a live answer. Retained UK XLSX/ODS checks qualify reader
mechanics only. Current Sarvam V1 docs were checked for strict JSON-schema output, low reasoning, nullable cache
usage and no tools. Live PostgreSQL concurrency/restart/provider qualification remains unrun.
