"""Fail-closed validation of the coordinator's leaf contract and cited literals."""
from __future__ import annotations

import json
import re


class InvalidEvidence(ValueError):
    pass


def require(value, code):
    if not value:
        raise InvalidEvidence(code)


def strict_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate_json_key")
            result[key] = value
        return result
    def invalid_constant(_):
        raise InvalidEvidence("nonfinite_json")
    return json.loads(raw, object_pairs_hook=unique, parse_constant=invalid_constant)


def schema_check(value, spec, contract, path="$"):
    """Small validator for the exact leaf schema's used JSON Schema keywords."""
    if "$ref" in spec:
        require(spec["$ref"].startswith("#/$defs/"), "external_schema_ref")
        return schema_check(value, contract["$defs"][spec["$ref"].split("/")[-1]], contract, path)
    types = spec.get("type", [])
    types = [types] if isinstance(types, str) else types
    kinds = {"object": dict, "array": list, "string": str, "null": type(None)}
    if types:
        require(any(type(value) is kinds[kind] for kind in types), path + ":type")
    if "const" in spec:
        require(value == spec["const"], path + ":const")
    if "enum" in spec:
        require(value in spec["enum"], path + ":enum")
    if isinstance(value, str):
        require(len(value) >= spec.get("minLength", 0) and len(value) <= spec.get("maxLength", len(value)), path + ":length")
        if "pattern" in spec:
            require(re.search(spec["pattern"], value) is not None, path + ":pattern")
    if isinstance(value, list):
        require(len(value) >= spec.get("minItems", 0) and len(value) <= spec.get("maxItems", len(value)), path + ":items")
        for index, item in enumerate(value):
            schema_check(item, spec.get("items", {}), contract, f"{path}[{index}]")
    if isinstance(value, dict):
        require(set(spec.get("required", [])) <= value.keys(), path + ":required")
        if spec.get("additionalProperties") is False:
            require(value.keys() <= spec.get("properties", {}).keys(), path + ":extra_property")
        for key, child in spec.get("properties", {}).items():
            if key in value:
                schema_check(value[key], child, contract, path + "." + key)
    for child in spec.get("allOf", []):
        if "if" in child:
            try:
                schema_check(value, child["if"], contract, path)
            except InvalidEvidence:
                continue
            schema_check(value, child["then"], contract, path)
        else:
            schema_check(value, child, contract, path)


def validate_input(example, contract, freeze, allowed_splits=("train", "development")):
    schema_check(example, contract["$defs"]["input"], contract)
    family = example["familyId"]
    families = {row["familyId"]: row["split"] for row in freeze["families"]}
    require(families.get(family) in allowed_splits, "source_family_split_refused")
    sources = {row["sourceSha256"] for row in freeze["sources"]
               if row["familyId"] == family and row["split"] == families[family]}
    keys = set()
    for fragment in example["evidence"]:
        require(fragment["key"] not in keys, "duplicate_evidence_key")
        keys.add(fragment["key"])
        require(fragment["familyId"] == family and fragment["sourceSha256"] in sources, "source_family_mismatch")
        require(len(json.dumps(fragment["locator"], ensure_ascii=False)) <= 16384, "locator_too_large")
    return {fragment["key"]: fragment for fragment in example["evidence"]}


def checked_citations(citations, evidence):
    found = []
    for citation in citations:
        fragment = evidence.get(citation["key"])
        require(fragment is not None, "unknown_citation_key")
        require(citation["quote"] in fragment["text"], "quote_not_exact")
        found.append(fragment)
    require(len({(item["key"], item["quote"]) for item in citations}) == len(citations), "duplicate_citation")
    return found


NATIVE_ROLES = {("IfcProject", "Name"): "project", ("IfcBuilding", "Name"): "building",
                ("IfcBuilding", "ObjectType"): "building_type", ("IfcBuildingStorey", "Name"): "floor"}
STATE_WORDS = {"unknown": ("unknown", "undetermined", "not known"), "absent": ("absent", "not supplied", "missing", "not_in_schema_entity"),
               "null": ("null",), "withheld": ("withheld", "redacted")}


def validate_output(output, example, contract, freeze, allowed_splits=("train", "development")):
    evidence = validate_input(example, contract, freeze, allowed_splits)
    schema_check(output, contract["$defs"]["output"], contract)
    for decision in output["conflicts"] + output["abstentions"]:
        checked_citations(decision["citations"], evidence)
    conflict_keys = set()
    for decision in output["conflicts"]:
        keys = {c["key"] for c in decision["citations"]}
        require(len({(c["key"], c["quote"]) for c in decision["citations"]}) >= 2, "conflict_needs_distinct_evidence")
        conflict_keys.update(keys)
    for claim in output["claims"]:
        fragments = checked_citations(claim["citations"], evidence)
        require(fragments, "claim_requires_source_support")
        quotes = [item["quote"] for item in claim["citations"]]
        native = [f["locator"].get("nativeAttribute") for f in fragments if f["method"] == "native_metadata"]
        native = [item for item in native if item is not None]
        if claim["literal"] is not None:
            literal = claim["literal"]
            require(bool(literal), "empty_literal")
            require(any(literal in quote for quote in quotes), "literal_not_cited")
            if claim["role"] == "source_identifier":
                pattern = r"(?<![\w$.-])" + re.escape(literal) + r"(?![\w$.-])"
                require(any(re.search(pattern, quote) for quote in quotes), "identifier_not_exact")
        if claim["state"] in ("absent", "null", "withheld", "unknown"):
            require(claim["literal"] is None and claim["unit"] is None, "nondeclared_value_must_be_null")
        if native:
            supported = False
            for item in native:
                role = NATIVE_ROLES.get((item["entityType"], item["attribute"]))
                if item["attribute"] == "GlobalId":
                    role = "source_identifier"
                elif item["attribute"] in ("Elevation", "ElevationOfRefHeight"):
                    role = "level"
                state = "declared" if item["state"] == "supplied" else item["state"]
                supported |= (role == claim["role"] and state == claim["state"]
                              and item["literal"] == claim["literal"] and claim["unit"] is None)
            require(supported, "native_attribute_role_state_or_literal_mismatch")
        elif claim["state"] in ("absent", "null", "withheld"):
            require(any(word in quote.lower() for quote in quotes for word in STATE_WORDS[claim["state"]]), "state_not_cited")
        if claim["state"] == "conflicting":
            require({c["key"] for c in claim["citations"]} <= conflict_keys, "conflict_silently_resolved")
        if claim["unit"] is not None:
            pattern = r"(?<!\w)" + re.escape(claim["unit"]) + r"(?!\w)"
            require(any(re.search(pattern, quote) for quote in quotes), "unit_not_cited")
    # Explicit input conflict groups are carried from reviewed source annotations,
    # never inferred from the student's preferred value.
    groups = {}
    for fragment in evidence.values():
        if group := fragment["locator"].get("conflictGroup"):
            groups.setdefault(group, set()).add(fragment["key"])
    for keys in groups.values():
        require(len(keys) < 2 or keys <= conflict_keys, "input_conflict_omitted")
    return output


def project_raw(raw, example, contract, freeze, allowed_splits=("train", "development")):
    """Keep raw output separate; invalid output becomes an explicit abstention."""
    validate_input(example, contract, freeze, allowed_splits)
    try:
        require(isinstance(raw, str) and len(raw.encode("utf-8")) <= 65536, "student_output_too_large")
        output = strict_json(raw)
        validate_output(output, example, contract, freeze, allowed_splits)
        return {"modelOutputValid": True, "errors": [], "acceptedProjection": output, "repairApplied": False}
    except (InvalidEvidence, json.JSONDecodeError, RecursionError) as error:
        return {"modelOutputValid": False, "errors": [str(error)], "repairApplied": False,
                "acceptedProjection": {"version": "evidence-association-output/1", "claims": [], "conflicts": [],
                    "abstentions": [{"code": "invalid_student_output", "citations": []},
                                    {"code": "no_canonical_targets", "citations": []}], "canonicalLinks": []}}
