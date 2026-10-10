"""Check type hints, physical function size and readable lines on P2 Python sources."""
from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path
from typing import Any


SOURCES = ["services/geo/geo/raster_plan.py", "services/geo/geo/test_raster_plan.py"] + [
    f"scripts/plans/{name}.py" for name in (
        "acquire_cubicasa_test", "raster_common", "read_raster_plan", "raster_ocr", "raster_replay",
        "cubicasa_labels", "evaluate_cubicasa_test", "publish_raster_sources", "publish_raster_continuation",
        "verify_raster_evidence", "audit_raster_sources",
    )
]


def missing_hints(function: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    parameters = [*function.args.posonlyargs, *function.args.args, *function.args.kwonlyargs]
    parameters += [argument for argument in (function.args.vararg, function.args.kwarg) if argument is not None]
    missing = [argument.arg for argument in parameters if argument.arg != "self" and argument.annotation is None]
    return missing + (["return"] if function.returns is None else [])


def audit(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    functions = [node for node in ast.walk(ast.parse(text))
                 if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
    typed = [{"function": node.name, "missing": missing_hints(node)} for node in functions if missing_hints(node)]
    sizes = {node.name: (node.end_lineno or node.lineno) - node.lineno + 1 for node in functions}
    long_lines = [number for number, line in enumerate(text.splitlines(), 1) if len(line) > 120]
    oversized = {name: size for name, size in sizes.items() if size > 40}
    return {"path": path.as_posix(), "functions": len(functions), "maximumFunctionLines": max(sizes.values()),
            "missingHints": typed, "over40Lines": oversized, "over120CharacterLines": long_lines,
            "passed": not (typed or oversized or long_lines)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", type=Path)
    args = parser.parse_args()
    result = [audit(path) for path in args.paths or map(Path, SOURCES)]
    print(json.dumps({"sources": result, "passed": all(row["passed"] for row in result)}))
    return 0 if all(row["passed"] for row in result) else 1


if __name__ == "__main__":
    raise SystemExit(main())
