"""Bounded validation of bundled, generated core schemas. No remote schema input."""
from __future__ import annotations
import copy
import json
import math
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote
from jsonschema import Draft202012Validator


class CoreContractError(ValueError):
    def __init__(self, code: str, message: str, path=()):
        super().__init__(message)
        self.code = code
        self.path = tuple(path)


def fail(code, message):
    raise CoreContractError(code, message)


def assert_core_json(value):
    pending = [(value, 0, False)]
    active = set()
    nodes = 0
    while pending:
        item, depth, leave = pending.pop()
        if leave:
            active.remove(id(item))
            continue
        nodes += 1
        if nodes > 1_000_000 or depth > 64:
            fail("JSON_LIMIT", "Core input exceeds the node/depth profile")
        if item is None or type(item) is bool:
            continue
        if type(item) is str:
            if len(item.encode("utf-16-le", errors="surrogatepass")) // 2 > 1_048_576:
                fail("JSON_LIMIT", "Core string exceeds the input profile")
            continue
        if type(item) in (int, float):
            try:
                finite = math.isfinite(item)
            except OverflowError:
                finite = False
            if not finite:
                fail("NON_FINITE", "Core numbers must be finite")
            continue
        if type(item) not in (dict, list):
            fail("NON_JSON", "Core input must contain plain JSON data only")
        if id(item) in active:
            fail("JSON_CYCLE", "Circular input is not JSON")
        if len(item) + nodes > 1_000_000:
            fail("JSON_LIMIT", "Core collection exceeds the node profile")
        active.add(id(item))
        pending.append((item, depth, True))
        if type(item) is dict:
            for key, child in item.items():
                if type(key) is not str:
                    fail("NON_JSON", "Core object keys must be strings")
                if key in ("__proto__", "prototype", "constructor"):
                    fail("UNSAFE_KEY", "Reserved object keys are not permitted")
                pending.append((child, depth + 1, False))
        else:
            pending.extend((child, depth + 1, False) for child in item)


@lru_cache(maxsize=16)
def bundled_schema(name):
    # This finite allowlist grows through the same reviewed core export task.
    if name not in ("identity-graph", "identity-command", "number-value", "source-catalog", "frame-catalog", "point-transform", "geometry-catalog", "measure-request", "snapshot-input", "snapshot-manifest", "publication-candidate"):
        fail("SCHEMA_PROFILE", "Unsupported bundled core schema")
    schema = json.loads((Path(__file__).parent / "contracts" / (name + ".schema.json")).read_text(encoding="utf-8"))
    pending = [schema]
    while pending:
        item = pending.pop()
        if isinstance(item, dict):
            for key, child in item.items():
                if key in ("$ref", "$dynamicRef") and (not isinstance(child, str) or not child.startswith("#")):
                    fail("SCHEMA_REFERENCE", "External schema references are forbidden")
                pending.append(child)
        elif isinstance(item, list):
            pending.extend(item)
    Draft202012Validator.check_schema(schema)
    return schema, Draft202012Validator(schema)


def parse_core(name, value):
    assert_core_json(value)
    _, validator = bundled_schema(name)
    error = next(validator.iter_errors(value), None)
    if error is not None:
        raise CoreContractError("INVALID_CONTRACT", "Value does not satisfy the qualified core contract", error.path)
    return copy.deepcopy(value)


def ref_key(ref):
    return ref["namespace"] + ":" + quote(ref["id"], safe="-_.!~*'()")


def version_key(link):
    return ref_key(link["ref"]), link["revision"]


def index_records(records, kind):
    result = {}
    for record in records:
        key = ref_key(record["ref"])
        if key in result:
            fail("DUPLICATE_RECORD", "Duplicate " + kind + " reference")
        result[key] = record
    return result


def require_revision(records, link, kind):
    record = records.get(ref_key(link["ref"]))
    if record is None:
        fail("MISSING_REFERENCE", "Missing " + kind + " reference")
    if record["revision"] != link["revision"]:
        fail("STALE_REFERENCE", "Stale " + kind + " reference")
    return record


def structural_key(value):
    if isinstance(value, dict):
        return tuple((key, structural_key(value[key])) for key in sorted(value))
    if isinstance(value, list):
        return tuple(structural_key(child) for child in value)
    return value
