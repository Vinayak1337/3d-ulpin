TASK   AU4 — Tables and documents accompanying a building batch       GATE GF1 / GF2
WORKS  Code-read audit only: eight traced steps; no product capability changed.
SEE IT Read `docs/evidence/gf1/au4/chain.json`; run `node docs/evidence/gf1/au4/check.mjs`.
INPUTS Code, design, E1 handoff and catalogue/README metadata; no original-data or HTTP run.
GAPS   No batch row-to-building authority, stage4, native-part packet path or late attachment run.
DESIGN Existing intake, jobs, registry and packet authorities are separate; extend them, do not replace them.

## Eight-item matrix

Paths below use the aliases in `chain.json.paths`; each numbered item has the full conditions and citations.
Request = explicit person/API request, not an automatic Studio batch step. “Not connected” is not “no reader”.

| # | Step | Table status | Document status | Primary code evidence |
|---|---|---|---|---|
| 1 | Studio drop | request | not connected | studio/features/intake/AddFilesDialog.tsx:251-256 |
| 2 | Retain/probe | request | request | ingestion/intake-service.ts:81-89,117-137 |
| 3 | Rows/review | registry refused | not connected | ingestion/service.ts:261-264 |
| 4 | Building tie | not built | request, proposal only | ingestion/mapping-executor.ts:165-183 |
| 5 | Parts/claims | not connected | request | ingestion/documents.ts:91-149 |
| 6 | Registry/card | not connected | request, conditional | usp/packets/plan-authority.ts:195-274 |
| 7 | E1/readiness | not connected | not connected | ingestion/intake-run-worker.ts:275-305 |
| 8 | Late arrival | not connected | not connected | ingestion/intake-run-worker.ts:293-305 |

Document tie additionally uses ingestion/document-association-targets.ts:49-79 and
source-fusion-associations-projection.ts:190-246 under the same ingestion alias.
Document registry amendment is registry/registry-document-evidence.ts:610-637,800-848;
PDF region packet is usp/packets/pdf-authority.ts:47-62. Neither is a generic native-part card path.

**CSV drop:** “Import as a table” asks for a case, retains it, automatically requests raw/mapping jobs,
then shows draft rows with no building/registry/map admission (chain1,3; TablePage.tsx:35).
**XLSX drop:** Same table flow, but the person supplies exact sheet and header rows;
probe sheet metadata is not cell reading or a building link (chain1-3).
**PDF drop:** NewFiles says “Not imported”; a separate document API retains/queues extraction,
but neither the drop nor E1 associates its parts with batch buildings (chain1,5,7).

## Quoted design/code discrepancies

Architecture path: `docs/next-steps/INGESTION-ARCHITECTURE.md`.
- :239 says “a single exact key match is attached”. Run carrySteps has no stage4, and the plan selects
  one map-feature pointer (ingestion/intake-run-worker.ts:203-217,275-305).
- :222 says “No new code: linking runs **after** the record exists”. Table execute explicitly refuses
  TABULAR_REGISTRY_UNQUALIFIED (ingestion/service.ts:261-264). Post-record timing does not create a row authority.
- :222 says “a table-row citation, which the plan already accepts”. Plan accepts `CSV row N`, but the
  native reference reader emits `CSV logical row N` (usp/packets/plan-authority.ts:243-252;
  geo/native_schedule.py:31-33). Mapped tabular slots are neither reference parts nor recorded bindings.
- :160 says “the page's own text with coordinates”. Native extraction stores page text segments with
  character spans, not region boxes; OCR needs another explicit selection (ingestion/document-native.ts:62-106;
  ingestion/document-worker.ts:51-59; ingestion/documents.ts:133-149).
- :169 requires “The lookup is symmetric”. No waiting-key index/write is present in this audited path;
  new intake items do not rerun carded targets (ingestion/intake-ledger.ts:32-47;
  ingestion/intake-run-worker.ts:293-305). This is a missing connection, not proof no future implementation exists.

## Qualification

No runtime gate passed. FX2 refresh refused unexpected events.ts index bytes; audit stayed on the branch baseline.
Optional HTTP rehearsal not attempted: no permitted NYC table/PDF pair with a verified shared literal was established.
Catalogue has development tables (for example datasets.json:5322-5351); this is not a claim there are no tables.
No original, provider, GPU, credential, container, runtime/task-data or restricted evaluation path was opened.
