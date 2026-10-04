"""Admit retained native facts against pinned reader records and original bytes.

Only the existing pure byte index is used; IfcOpenShell is never initialized.
Candidate facts are deterministic projections, not predictions or new labels.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
import re

from ...native_ifc import DEFAULT_LIMITS, lexical_index
from .selectors import canonical, canonical_sha
from .validation import NATIVE_ROLES, require, strict_json, validate_input, validate_output

VERSION = "association-native-candidates/1"
POLICY = {
    "version": VERSION,
    "authority": "frozen family/manifest/lineage; pinned retained reader and unchanged original bytes",
    "admission": "exact record pointer, entity/STEP ID, attribute/index, source byte spans and raw literal",
    "values": "supported exact-citable strings; explicit parser null and not_in_schema_entity absent stay distinct",
    "roles": dict((entity + "." + attribute, role) for (entity, attribute), role in NATIVE_ROLES.items()),
    "additionalRoles": {"GlobalId": "source_identifier", "Elevation": "level", "ElevationOfRefHeight": "level"},
    "unsupported": ["numeric normalization", "decoded value not exactly citable", "unmapped roles",
                    "missing native metadata", "georeference", "explicit input conflicts"],
    "qualification": "candidate construction is deterministic; no learned selection or operational truth claim",
}
POLICY_SHA = canonical_sha(POLICY)


def read_pinned(path, digest, maximum):
    path = Path(path)
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= maximum,
            "candidate_reference_type_or_bound")
    with path.open("rb") as stream:
        raw = stream.read(maximum + 1)
    require(len(raw) <= maximum and hashlib.sha256(raw).hexdigest() == digest, "candidate_reference_hash_drift")
    return raw


@dataclass(frozen=True)
class Reader:
    example_id: str
    source_json: str
    reader_sha256: str
    reader_bytes: bytes
    original: bytes


@dataclass(frozen=True)
class Authority:
    readers: tuple[Reader, ...]
    provenance_json: str


def load_authority(assignment, family):
    """References come only from a separately hash-checked assignment, never input locators."""
    manifest_ref, lineage_ref = assignment["nativeManifest"], assignment["lineage"]
    manifest = strict_json(read_pinned(manifest_ref["path"], manifest_ref["physicalSha256"], 1024**2))
    lineage = strict_json(read_pinned(lineage_ref["path"], lineage_ref["physicalSha256"], 1024**2))
    require(lineage["manifestSha256"] == manifest_ref["physicalSha256"], "candidate_manifest_lineage_drift")
    # Reuse only the byte index in the unchanged existing reader module.
    lexical_path = Path(__file__).resolve().parents[2] / "native_ifc.py"
    lexical_sha = hashlib.sha256(lexical_path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
    require(any(p["path"] == "services/geo/geo/native_ifc.py" and p["gitBlobBytesSha256"] == lexical_sha
                for p in manifest["codePins"]), "candidate_byte_index_code_drift")
    sources = {s["sourceSha256"]: s for s in assignment["sources"]}
    require(len(sources) == len(assignment["sources"]) <= 2 and len(assignment["readers"]) <= 2,
            "candidate_authority_scope")
    trusted = []
    for reference in assignment["readers"]:
        rows = [r for r in lineage["sources"] if r["exampleId"] == reference["exampleId"]]
        require(len(rows) == 1, "candidate_lineage_identity")
        row = rows[0]
        source = sources.get(row["source"]["sourceSha256"])
        require(source is not None and canonical(source) == canonical(row["source"]), "candidate_lineage_source_drift")
        require(any(s == source for s in family["sources"])
                and source["split"] == "development"
                and any(f == {"familyId": source["familyId"], "split": "development"} for f in family["families"]),
                "candidate_frozen_family_refused")
        require(Path(reference["path"]) == Path(row["readerPath"])
                and reference["physicalSha256"] == row["readerSha256"], "candidate_lineage_reader_drift")
        originals = [s for s in manifest["sources"] if s["sha256"] == source["sourceSha256"]]
        require(len(originals) == 1, "candidate_manifest_source_missing")
        original_meta = originals[0]
        require(Path(original_meta["path"]) == Path(source["originalPath"])
                and original_meta["repositoryPath"] == source["sourceId"]
                and original_meta["issuer"] == source["issuer"] and original_meta["url"] == source["originalUrl"],
                "candidate_manifest_source_identity")
        runs = [r["receipt"] for r in manifest["runs"] if Path(r["receipt"]["output"]) == Path(reference["path"])]
        require(len(runs) == 1 and runs[0]["sha256"] == reference["physicalSha256"]
                and runs[0]["sourceSha256"] == source["sourceSha256"] and runs[0]["status"] == "available",
                "candidate_manifest_reader_missing")
        original = read_pinned(source["originalPath"], source["sourceSha256"], DEFAULT_LIMITS.input_bytes)
        reader_bytes = read_pinned(reference["path"], reference["physicalSha256"], DEFAULT_LIMITS.output_bytes)
        reader = strict_json(reader_bytes)
        require(len(original) == original_meta["bytes"] == row["sourceBytes"] == reader["source"]["bytes"]
                and len(reader_bytes) == runs[0]["bytes"] and reader["source"]["sha256"] == source["sourceSha256"]
                and reader["schemaVersion"] == "ulpin-native-ifc/1" and reader["status"] == "available"
                and reader["scope"] == "source_native_metadata" and reader["parser"] == {"name": "IfcOpenShell", "version": "0.8.5"}
                and len(reader["records"]) <= DEFAULT_LIMITS.records, "candidate_reader_source_drift")
        trusted.append(Reader(reference["exampleId"], canonical(source), reference["physicalSha256"], reader_bytes, original))
    require(len({r.example_id for r in trusted}) == len(trusted), "candidate_duplicate_reader")
    return Authority(tuple(trusted), canonical({"manifestSha256": manifest_ref["physicalSha256"],
        "lineageSha256": lineage_ref["physicalSha256"], "lexicalIndexCodeCanonicalLfSha256": lexical_sha,
        "policySha256": POLICY_SHA}))


def legacy_output(claims=()):
    return {"version": "evidence-association-output/1", "claims": list(claims), "conflicts": [],
            "abstentions": [{"code": "no_canonical_targets", "citations": []}], "canonicalLinks": []}


def construct(example, authority, contract, family):
    """No expectations; inspect only attributes actually referenced by the input."""
    validate_input(example, contract, family, ("development",))
    groups = {}
    for fragment in example["evidence"]:
        if group := fragment["locator"].get("conflictGroup"):
            groups.setdefault(group, set()).add(fragment["key"])
    require(all(len(keys) < 2 for keys in groups.values()), "candidate_explicit_conflict_unsupported")
    matches = [r for r in authority.readers if r.example_id == example["exampleId"]]
    require(len(matches) == 1, "candidate_reader_identity")
    trusted = matches[0]
    source, reader = strict_json(trusted.source_json), strict_json(trusted.reader_bytes)
    require(hashlib.sha256(trusted.original).hexdigest() == source["sourceSha256"]
            and hashlib.sha256(trusted.reader_bytes).hexdigest() == trusted.reader_sha256,
            "candidate_authority_snapshot_drift")
    index = lexical_index(trusted.original, DEFAULT_LIMITS)
    candidates, unsupported = [], []
    for fragment in example["evidence"]:
        loc = fragment["locator"]
        require(fragment["familyId"] == source["familyId"] and fragment["sourceSha256"] == source["sourceSha256"],
                "candidate_input_source_drift")
        if fragment["method"] != "native_metadata":
            unsupported.append({"key": fragment["key"], "reason": "non_native_method"})
            continue
        require(loc.get("readerOutputSha256") == trusted.reader_sha256, "candidate_stale_reader")
        pointer = loc.get("readerPointer", "")
        if pointer == "/georeference":
            require(type(reader.get("georeference")) is dict and "nativeAttribute" not in loc,
                    "candidate_georeference_metadata_drift")
            unsupported.append({"key": fragment["key"], "reason": "georeference_not_property_candidate"})
            continue
        match = re.fullmatch(r"/records/(0|[1-9][0-9]*)/attributes/([A-Za-z][A-Za-z0-9]*)", pointer)
        require(match is not None and int(match[1]) < len(reader["records"]), "candidate_reader_pointer")
        record, attribute = reader["records"][int(match[1])], match[2]
        require(attribute in record["attributes"], "candidate_reader_attribute_missing")
        value = record["attributes"][attribute]
        ident, entity = record["stepId"], record["entityType"]
        require(type(ident) is int and ident in index and index[ident]["type"].upper() == entity.upper(),
                "candidate_record_identity")
        record_loc = {"stepId": ident, "entityType": entity, "attribute": None, "attributeIndex": None,
                      "byteStart": index[ident]["span"][0], "byteEnd": index[ident]["span"][1]}
        require(record["locator"] == record_loc, "candidate_record_span_drift")
        supplied_loc = {k: v for k, v in loc.items() if k not in ("nativeAttribute", "readerPointer", "readerOutputSha256", "conflictGroup")}
        require(supplied_loc == value["locator"] and loc.get("stepId") == ident and loc.get("attribute") == attribute,
                "candidate_attribute_locator_drift")
        native = loc.get("nativeAttribute")
        if native is None:
            unsupported.append({"key": fragment["key"], "reason": "missing_native_metadata"})
            continue
        require(type(native) is dict and set(native) == {"entityType", "attribute", "state", "literal"}
                and native["entityType"] == entity and native["attribute"] == attribute and native["state"] == value["state"],
                "candidate_native_metadata_drift")
        if value["state"] == "absent":
            require(value.get("reason") == "not_in_schema_entity" and value["rawLiteral"] is None and value["value"] is None
                    and value["locator"] == {"stepId": ident, "attribute": attribute}, "candidate_absent_not_supported")
            text = f"{entity}.{attribute} is absent (not_in_schema_entity)"
        else:
            position = value["locator"].get("attributeIndex")
            require(type(position) is int and 0 <= position < len(index[ident]["attributes"]), "candidate_attribute_index")
            first, end = index[ident]["attributes"][position]
            expected_loc = {"stepId": ident, "entityType": entity, "attribute": attribute,
                            "attributeIndex": position, "byteStart": first, "byteEnd": end}
            require(value["locator"] == expected_loc and 0 <= first < end <= len(trusted.original)
                    and trusted.original[first:end].decode("latin-1") == value["rawLiteral"], "candidate_attribute_bytes_drift")
            if value["state"] == "null":
                require(index[ident]["markers"][position] == b"$" and value["value"] is None, "candidate_null_not_supported")
            text = f"{entity}.{attribute} = {value['rawLiteral']}"
        require(fragment["text"] == text, "candidate_evidence_text_drift")
        role = NATIVE_ROLES.get((entity, attribute), POLICY["additionalRoles"].get(attribute))
        reason = None
        if role is None:
            reason = "unmapped_native_role"
        elif value["state"] not in ("supplied", "null", "absent"):
            reason = "unsupported_parser_state"
        elif value["state"] == "supplied" and type(value["value"]) is not str:
            reason = "numeric_or_structured_literal_unsupported"
        else:
            require(native["literal"] == value["value"], "candidate_native_literal_drift")
            if value["state"] == "supplied" and (not value["value"] or len(value["value"]) > 1024
                    or value["value"] not in value["rawLiteral"]):
                reason = "decoded_literal_not_exactly_citable"
        if reason:
            unsupported.append({"key": fragment["key"], "reason": reason})
            continue
        quote = value["value"] if value["state"] == "supplied" else text
        claim = {"role": role, "state": "declared" if value["state"] == "supplied" else value["state"],
                 "literal": value["value"], "unit": None, "citations": [{"key": fragment["key"], "quote": quote}]}
        validate_output(legacy_output([claim]), example, contract, family, ("development",))
        candidates.append({"id": "c" + str(len(candidates)), "claim": claim, "provenance": {
            "inputCanonicalJsonSha256": canonical_sha(example),
            "familyId": fragment["familyId"], "sourceSha256": fragment["sourceSha256"], "method": fragment["method"],
            "locator": loc, "readerSha256": trusted.reader_sha256, "readerPointer": pointer,
            "recordLocator": record_loc, "parserAttribute": value}})
    return {"version": VERSION, "inputCanonicalJsonSha256": canonical_sha(example), "policySha256": POLICY_SHA,
            "authority": strict_json(authority.provenance_json), "candidates": candidates, "unsupported": unsupported}
