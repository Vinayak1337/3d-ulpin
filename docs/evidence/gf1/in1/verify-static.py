"""Check only IN1's authored ledger, mirrored enums and new-file line widths; no runtime."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]


def check_ledger() -> int:
    from scripts.db.verify_extraction import sql_statements

    manifest = json.loads((ROOT / "database/manifest.json").read_text(encoding="utf-8"))
    step = next(entry for entry in manifest["steps"] if entry["id"] == "ingestion.intake.schema")
    raw = (ROOT / "database" / step["file"]).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == step["sha256"]
    statements = sql_statements(raw.decode("utf-8"))
    hashes = [{"ordinal": index, "sha256": hashlib.sha256(statement.encode()).hexdigest()}
              for index, statement in enumerate(statements, 1)]
    assert hashes == step["statements"]
    assert len(re.findall(r"CREATE TABLE IF NOT EXISTS", raw.decode("utf-8"))) == 4
    return len(statements)


def check_enums() -> None:
    contract = (ROOT / "packages/contracts/src/usp/intake.ts").read_text(encoding="utf-8")
    sql = (ROOT / "database/sql/95-ingestion/intake-ledger.sql").read_text(encoding="utf-8")
    enums = {"Family": "family", "SizeClass": "size_class", "State": "state",
             "Placement": "placement", "CrsState": "crs_state"}
    for name, column in enums.items():
        ts_match = re.search(rf"Intake{name}Schema = z.enum\(\[([\s\S]*?)\]\)", contract)
        sql_match = re.search(rf"CHECK\({column} IN \(([^)]*)\)\)", sql)
        assert ts_match and sql_match, name
        assert re.findall(r"'([^']+)'", ts_match[1]) == re.findall(r"'([^']+)'", sql_match[1]), name


def check_style() -> None:
    committed = subprocess.check_output(
        ["git", "diff", "--name-only", "--diff-filter=A", "staging...HEAD"], cwd=ROOT, text=True
    ).splitlines()
    untracked = subprocess.check_output(
        ["git", "ls-files", "--others", "--exclude-standard"], cwd=ROOT, text=True
    ).splitlines()
    for name in set(committed + untracked):
        if Path(name).suffix not in {".ts", ".sql", ".py"}:
            continue
        for number, line in enumerate((ROOT / name).read_text(encoding="utf-8").splitlines(), 1):
            assert len(line) <= 120, f"{name}:{number}:{len(line)}"


def main() -> None:
    sys.path.insert(0, str(ROOT))
    statements = check_ledger()
    check_enums()
    check_style()
    print(f"IN1-STATIC: 4 tables, {statements} statement hashes, 5 mirrored enums; new source lines <=120")


if __name__ == "__main__":
    main()
