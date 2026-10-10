TASK   D1c — Property-table acquisition checkpoint            GATE GF-AGENT data prerequisite
WORKS  Inspect two unlabelled official property-scheme JSON originals in one development family.
SEE IT python -B fixtures/usp/D8-messy-india/verify-d1c.py
INPUTS TNHB published scheme register (good); public unpublished scheme register (difficult, status unqualified).
GAPS   Targets unmet; new heldout: 0 families, 0 files, 0 columns, 0 scorable columns, 0 positive targets.

`manifest.json` pins the originals, byte-identical copies, permission state and shared ordered-key fingerprint.
The existing freeze script adds `--family-set a3|d1c` and a read-only `--check` mode. A3 uses an exact-byte
external manifest snapshot; its original truth and frozen Git receipt reproduce unchanged. Windows checkout
CRLF is disclosed, not applied to source originals. D1c freezes an explicitly **empty, blocked** selection.
A nonempty D1c set is refused before writing until its real publisher-dictionary adapter is implemented.

The read-only D1c verifier checks amendment preservation, new original/copy/layout integrity, catalogue pins
and blocked counts. This is acquisition integrity, not acceptance of the requested thresholds or a runtime gate.
The native JSON files are **not CSV/XLSX coverage**. No development labels, provider calls, training or imports.

Checks: D1c verifier, A3 freeze check, D1c freeze create/check, catalogue regression and `git diff --check`: 0.
Catalogue preview/check: 1 (`KeyError: content`, existing D8 DTO mismatch). Historical fixed-count D1b
verifier: 1 (fixed previous-seal assumption). No unowned script was edited to suppress these failures.

NEXT: obtain three more development families and three privacy-safe heldout families with publisher dictionaries,
then implement their deterministic truth bridge and freeze at least 25 supported positive columns before exposure.
The lead must adapt the catalogue builder/retained ledger and decide native JSON intake versus native CSV/XLSX.
External `E:/BhuAayam-data/task-data/d1c/` preserves acquisition code/receipts for continuation; do not rerun into
existing immutable filenames. All blind support/discovery remains evaluator-only; never dispatch that directory.
