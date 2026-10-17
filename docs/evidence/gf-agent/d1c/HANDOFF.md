TASK   D1d — Property tables, second route                 GATE GF-AGENT data prerequisite
WORKS  Inspect immutable inventory/footprint inputs and reproduce deterministic CSVs and a publisher-only freeze.
SEE IT python -B fixtures/usp/D8-messy-india/verify-d1c.py
INPUTS TNHB schemes-yes/no.json: 2 native JSON files, 90 columns each; both have recorded CSV derivatives.
       Pune Municipal Corporation library/office inventories: 2 native XLSX files, 5 columns each.
       Microsoft ms-india-demo-partition.csv.gz: 1 native GeoJSONL original, 3 columns; nested prefix is difficult.
       Development: 3 families / 5 originals, unlabelled. Heldout: 2 families / 2 files / 4 columns / 2 scorable.
       Positive-target columns: 2; building.footprint = 2. No blind publisher, header or value is reported.
GAPS   Incomplete: 1 development family, 1 heldout family and 23 positive columns missing; no GF-AGENT pass.
       Class A: PDF-only/gated/transport-failing inventory and contact-bearing registers; no redaction to qualify.
       Class B: RERA 403/404/application shells. Class C: facilities, not verified building/unit identity or dictionary.
       Class D: >200 MB native partitions skipped; community API 406/500; acquired mirrors remain candidate research.
       Known catalogue KeyError: content and historical D1b fixed seal remain unowned, not repaired or rerun.
       Early external discovery retained excluded bodies/bytes before full privacy screening. Directory stays closed;
       owner-reviewed exact-path disposition is required. No unsafe candidate entered the selected pack or providers.
DESIGN scripts/agent/flatten-json-table.py: read_rows/csv_bytes retain keys, rows, lexical numbers and nested JSON.
       dev/d1c/derivatives.json pins source/prefix locators, version and hashes; no originals are overwritten.
       freeze-a3-truth.py: private pinned bridge, literal citation/unit/canonical-ID checks, additive truth and
       authorised Git receipt replacement. A3 truth/receipt reproduce unchanged; the old empty truth still exists.
       verify-d1c.py checks old metadata, originals/copies/prefixes, derivatives, split and counts, not acceptance.
       Publisher-level hash alternation stays evaluator-only; missing documentation moves that publisher to dev.
       Pune/TNHB licences are not stated/unconfirmed. Microsoft CDLA Permissive 2.0 is explicit; all remain test_only.
       The 128-row prefix is not geographically clipped and not counted as a second original or family.
COMMITS 2a26b558 feat(agent): deterministic JSON-table CSV derivative
        c1df5654 data(d8): authority inventory and building-attribute development families (D1d)
        HEAD     data(d8): frozen property held-out set with publisher truth bridge (D1d)
                 Replaces the empty D1c checkpoint receipt, not its original external truth.
CHECKS  All exit 0: verify-d1c.py; freeze --family-set a3 --check; freeze --family-set d1c --check;
        scripts/api/test_dataset_catalog.py; Ruff on all three changed Python files; git diff --check.
        New code/evidence <=120 columns; native source literals/URLs/table rows remain byte-preserving exceptions.
        Lean good input: TNHB; difficult input: nested native footprint rows with no flattened semantic labels.
        No teacher/provider, training, memory, runtime import, model evaluation, merge/rebase or push.
NEXT    One more development publisher, one more documented heldout publisher and 23 supported positive columns.
        Freeze additive new revisions before any model exposure; never tune or relabel these frozen families.
        Lead: source-safe discovery disposition, native intake qualification and catalogue/retained-ledger seam.
        External task-data/d1c and provisional acquisition directories are evaluator-only and must not be dispatched.
