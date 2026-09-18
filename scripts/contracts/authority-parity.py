"""Check the same bounded JSON corpus against a generated, bundled schema only."""
from __future__ import annotations
import json
import math
from pathlib import Path
from jsonschema import Draft202012Validator


def reject_constant(value):
    raise ValueError("Non-finite JSON constant")


def json_safe(value):
    if isinstance(value, float) and not math.isfinite(value):
        return False
    if isinstance(value, dict):
        return all(isinstance(k, str) and json_safe(v) for k, v in value.items())
    if isinstance(value, list):
        return all(json_safe(v) for v in value)
    return value is None or isinstance(value, (str, int, float, bool))


def strict_loads(raw):
    value = json.loads(raw, parse_constant=reject_constant)
    if not json_safe(value):
        raise ValueError("Non-finite or unsupported JSON value")
    return value


def run():
    root = Path(__file__).resolve().parents[2] / "fixtures/contracts"
    schema = strict_loads((root / "authority.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    # Only generated local schemas are allowed. No arbitrary remote references.
    def references(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key == "$ref" and not item.startswith("#"):
                    raise ValueError("External schema references are forbidden")
                references(item)
        elif isinstance(value, list):
            for item in value:
                references(item)
    references(schema)
    validator = Draft202012Validator(schema)
    corpus = strict_loads((root / "authority.cases.json").read_text(encoding="utf-8"))["cases"]
    for case in corpus:
        actual = json_safe(case["value"]) and validator.is_valid(case["value"])
        if actual != case["valid"]:
            raise AssertionError("Cross-language structural mismatch: " + case["id"])
    for raw in ['{"value": NaN}', '{"value": Infinity}', '{"value": -Infinity}', '{"value": 1e400}']:
        try:
            strict_loads(raw)
        except ValueError:
            continue
        raise AssertionError("Non-finite raw JSON was accepted")
    print(json.dumps({"kind":"structural-authority-experiment","runtime":"Python jsonschema","cases":len(corpus),"result":"PASS","nonFiniteWireCases":4}))


if __name__ == "__main__":
    run()
