"""Demonstrate the distance-independent guard using existing synthetic test fixtures."""
from __future__ import annotations

import ast
import copy
import json
import sys
from pathlib import Path


def selected_fixture(node: ast.AST, names: set[str]) -> bool:
    if isinstance(node, ast.FunctionDef):
        return node.name in names
    if isinstance(node, ast.Assign):
        return any(isinstance(target, ast.Name) and target.id in names for target in node.targets)
    return False


def fixtures(root: Path) -> dict:
    namespace = {"copy": copy}
    selections = {"test_area.py": {"REFERENCE", "ring", "polygon"}, "test_officer.py": {"EVIDENCE", "feature"}}
    for filename, names in selections.items():
        path = root / "services" / "geo" / "tests" / filename
        parsed = ast.parse(path.read_text(encoding="utf-8"))
        selected = [node for node in parsed.body if selected_fixture(node, names)]
        exec(compile(ast.Module(body=selected, type_ignores=[]), str(path), "exec"), namespace)
    return namespace


def main() -> None:
    root = Path(__file__).resolve().parents[4]
    sys.path.insert(0, str(root / "services" / "geo"))

    from geo import area
    from geo.validation import InputError

    # Load only existing fixture definitions, not unrelated HTTP/PDF test dependencies.
    fixture = fixtures(root)
    occupation = fixture["feature"]("O", "observed_ground_occupation")
    public = fixture["feature"]("R", "public_road_land", fixture["polygon"](20, 20), "road")
    data = {"reference": fixture["REFERENCE"], "features": [occupation, public]}
    baseline = area.check_area(data)
    assert [item["code"] for item in baseline["findings"]] == ["PARCEL_ASSOCIATION_REQUIRED"]

    budget = area.MAX_PAIRS
    try:
        # One pair exhausts this diagnostic budget only if counted before intersection.
        area.MAX_PAIRS = 0
        try:
            area.check_area(data)
        except InputError as error:
            refusal = str(error)
        else:
            raise AssertionError("Expected the separated public feature to consume the officer pair budget.")
    finally:
        area.MAX_PAIRS = budget

    expected = "Officer check exceeds the bounded candidate-pair limit; split the area."
    assert refusal == expected
    print(json.dumps({
        "task": "LP1", "qualification": "existing synthetic fixtures; diagnostic budget override, not NYC",
        "productionPairBudget": budget, "diagnosticPairBudget": 0,
        "occupationBounds": [0, 0, 10, 10], "publicBounds": [20, 20, 30, 30],
        "intersectingPairs": 0, "baselineFindingCodes": [item["code"] for item in baseline["findings"]],
        "diagnosticRefusal": refusal, "sourceFilesModified": False,
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
