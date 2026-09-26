#!/usr/bin/env python3
"""Check NEST-01 SQL files against pinned TypeScript literals without importing the app.

This is a source/byte audit, not a SQL parser or migration runner. In particular,
each multi-statement query remains one file and must be sent as one query in the
later runtime wiring. No database, network, or application modules are touched.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "database" / "manifest.json"
QUERY_CALL = re.compile(r"(?<![\w])(?:client\.)?query(?:<[^>\n]+>)?\s*\(\s*([`'\"])")
SCHEMA_SQL = re.compile(
    r"\b(?:CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|EXTENSION|FUNCTION|TRIGGER|VIEW|SCHEMA|ROLE)"
    r"|ALTER\s+TABLE|REVOKE\s+ALL|GRANT\s+(?:EXECUTE|USAGE|SELECT))\b",
    re.IGNORECASE,
)
FUNCTION = re.compile(r"\b(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(")
DOLLAR_TAG = re.compile(r"\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$")


def source_bytes(commit: str, path: str) -> bytes:
    return subprocess.check_output(
        ["git", "show", f"{commit}:{path}"], cwd=ROOT, stderr=subprocess.DEVNULL
    )


def literal_queries(source: str) -> list[tuple[int, str]]:
    """Read raw literal first arguments of query calls without evaluating TypeScript."""
    result: list[tuple[int, str]] = []
    for match in QUERY_CALL.finditer(source):
        quote = match.group(1)
        start = match.end()
        cursor = start
        while cursor < len(source):
            if source[cursor] == "\\":
                # Skip an escaped quote while locating the end; reject below.
                cursor += 2
                continue
            if source[cursor] == quote:
                value = source[start:cursor]
                result.append((source.count("\n", 0, match.start()) + 1, value))
                break
            cursor += 1
        else:
            raise ValueError("Unterminated query literal")
    return result


def sql_statements(sql: str) -> list[str]:
    """Split only at top-level semicolons, retaining original bytes per segment.

    This computes statement hashes for audit. It must never drive execution:
    one source query batch stays one query call in phase 2.
    """
    statements: list[str] = []
    start = cursor = 0
    while cursor < len(sql):
        if sql.startswith("--", cursor):
            newline = sql.find("\n", cursor + 2)
            cursor = len(sql) if newline < 0 else newline + 1
        elif sql.startswith("/*", cursor):
            end = sql.find("*/", cursor + 2)
            if end < 0:
                raise ValueError("Unterminated SQL block comment")
            cursor = end + 2
        elif sql[cursor] in ("'", '"'):
            quote = sql[cursor]
            cursor += 1
            while cursor < len(sql):
                if sql[cursor] == quote:
                    if cursor + 1 < len(sql) and sql[cursor + 1] == quote:
                        cursor += 2
                    else:
                        cursor += 1
                        break
                else:
                    cursor += 1
            else:
                raise ValueError("Unterminated SQL quoted literal")
        elif sql[cursor] == "$" and (tag := DOLLAR_TAG.match(sql, cursor)):
            closing = sql.find(tag.group(), tag.end())
            if closing < 0:
                raise ValueError("Unterminated SQL dollar quote")
            cursor = closing + len(tag.group())
        elif sql[cursor] == ";":
            segment = sql[start : cursor + 1]
            if segment.strip():
                statements.append(segment)
            cursor += 1
            start = cursor
        else:
            cursor += 1
    tail = sql[start:]
    if tail.strip():
        statements.append(tail)
    return statements


def audit() -> None:
    manifest = json.loads(MANIFEST.read_text())
    commit = manifest["sourceCommit"]
    steps = manifest["steps"]
    orders = [step["order"] for step in steps]
    if orders != list(range(len(steps))):
        raise ValueError("Manifest order must be contiguous and match array order")
    if len({step["id"] for step in steps}) != len(steps):
        raise ValueError("Duplicate manifest step ID")
    if len({step["file"] for step in steps}) != len(steps):
        raise ValueError("Duplicate manifest SQL file")

    selected: set[tuple[str, int]] = set()
    source_cache: dict[str, str] = {}
    for step in steps:
        source = step["source"]
        source_path = source["path"]
        if source_path not in source_cache:
            source_cache[source_path] = source_bytes(commit, source_path).decode("utf-8")
        if source["kind"] == "file":
            original = source_cache[source_path].encode("utf-8")
        else:
            prefix = "\n".join(source_cache[source_path].splitlines()[: source["line"] - 1])
            declarations = FUNCTION.findall(prefix)
            if not declarations or declarations[-1] != source["function"]:
                raise ValueError(f"Source function differs at {source_path}:{source['line']}")
            matches = [
                sql for line, sql in literal_queries(source_cache[source_path])
                if line == source["line"]
            ]
            if len(matches) != 1:
                raise ValueError(f"Expected one query literal at {source_path}:{source['line']}")
            if "\\" in matches[0] or "${" in matches[0]:
                raise ValueError(f"Migration SQL needs reviewed JS decoding at {source_path}:{source['line']}")
            original = matches[0].encode("utf-8")
            selected.add((source_path, source["line"]))
        sql_path = ROOT / "database" / step["file"]
        if not sql_path.is_file() or sql_path.read_bytes() != original:
            raise ValueError(f"SQL bytes differ from pinned source: {step['id']}")
        if hashlib.sha256(original).hexdigest() != step["sha256"]:
            raise ValueError(f"SHA-256 differs from pinned source: {step['id']}")
        statements = sql_statements(original.decode("utf-8"))
        hashes = [
            {"ordinal": index, "sha256": hashlib.sha256(statement.encode()).hexdigest()}
            for index, statement in enumerate(statements, start=1)
        ]
        if hashes != step["statements"]:
            raise ValueError(f"Statement hashes differ from pinned source: {step['id']}")
        if source["kind"] != "file" and "$1" in matches[0] and not step["parameters"]:
            raise ValueError(f"Parameter metadata missing: {step['id']}")

    expected_files = {str(ROOT / "database" / step["file"]) for step in steps}
    actual_files = {str(path) for path in (ROOT / "database" / "sql").rglob("*.sql")}
    if expected_files != actual_files:
        raise ValueError("SQL files and manifest entries differ")

    paths = subprocess.check_output(
        ["git", "ls-tree", "-r", "--name-only", commit, "--", "apps/web/lib/server"],
        cwd=ROOT,
        text=True,
    ).splitlines()
    discovered: set[tuple[str, int]] = set()
    for path in paths:
        if not path.endswith(".ts"):
            continue
        sql_source = source_bytes(commit, path).decode("utf-8")
        for line, sql in literal_queries(sql_source):
            if SCHEMA_SQL.search(sql):
                if "\\" in sql or "${" in sql:
                    raise ValueError(f"Schema SQL needs reviewed JS decoding at {path}:{line}")
                discovered.add((path, line))
    missing = sorted(discovered - selected)
    if missing:
        raise ValueError(f"Unextracted schema SQL query literals: {missing}")
    statement_count = sum(len(step["statements"]) for step in steps)
    print(
        f"PASS: {len(steps)} exact SQL files, {statement_count} statement hashes; "
        f"{len(discovered)} schema query literals covered at {commit}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    try:
        audit()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
