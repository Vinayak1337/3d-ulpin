"""Project two bounded development cases from retained IFC results; no extraction."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "services/geo"))
from geo.usp_learning.association.validation import validate_input, validate_output

FAMILY = "buildingsmart-certification-simple-scene"
SCHEMA = "scripts/usp/learning/association/schema-v1.json"
FAMILY_FREEZE = "docs/evidence/usp/ml-distillation/family-freeze.json"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False)
        stream.write("\n")


def prepare(destination):
    destination.mkdir(parents=True, exist_ok=False)
    contract_bytes = (REPO / SCHEMA).read_bytes()
    freeze_bytes = (REPO / FAMILY_FREEZE).read_bytes()
    contract, freeze = json.loads(contract_bytes), json.loads(freeze_bytes)
    assert sha(contract_bytes.replace(b"\r\n", b"\n")) == freeze["schemaSha256"]
    manifest_path = REPO / "docs/evidence/usp/native-ifc/manifest.json"
    manifest = json.loads(manifest_path.read_bytes())
    development_sources = {s["sourceSha256"]: s for s in freeze["sources"]
                           if s["familyId"] == FAMILY and s["split"] == "development"}
    artifact_pins = {a["path"].replace("\\", "/"): a["sha256"] for a in manifest["artifacts"]}
    examples, expectations, lineage = [], [], []
    for name, selections in (
        ("ifc4", (("IfcProject", "Name", "project"), ("IfcBuilding", "Name", "building"),
                  ("IfcBuildingStorey", "Name", "floor"), ("IfcBuilding", "GlobalId", "source_identifier"))),
        ("ifc2x3", (("IfcBuilding", "Elevation", "level"), ("IfcBuilding", "ElevationOfRefHeight", "level"))),
    ):
        output_path = Path("E:/BhuAayam-data/task-data/desktop-ifc-native/outputs/final") / (name + ".json")
        output_bytes = output_path.read_bytes()
        assert sha(output_bytes) == artifact_pins[output_path.as_posix()]
        document = json.loads(output_bytes)
        source = development_sources[document["source"]["sha256"]]
        source_bytes = Path(source["originalPath"]).read_bytes()
        assert sha(source_bytes) == source["sourceSha256"]
        fragments, claims = [], []
        for index, (entity_type, attribute, role) in enumerate(selections, 1):
            records = [(i, record) for i, record in enumerate(document["records"]) if record["entityType"] == entity_type]
            assert len(records) == 1, "seed retrieval expects one source-native entity of this type"
            record_index, record = records[0]
            value = record["attributes"][attribute]
            locator = dict(value["locator"])
            if value["state"] != "absent":
                assert source_bytes[locator["byteStart"]:locator["byteEnd"]].decode("latin-1") == value["rawLiteral"]
            else:
                assert value["reason"] == "not_in_schema_entity" and value["rawLiteral"] is None
            literal = value["value"] if value["state"] == "supplied" else None
            assert literal is None or isinstance(literal, str), "numeric normalization is deferred"
            text = f"{entity_type}.{attribute} = {value['rawLiteral']}" if value["state"] != "absent" else f"{entity_type}.{attribute} is absent (not_in_schema_entity)"
            locator.update(readerOutputSha256=sha(output_bytes), readerPointer=f"/records/{record_index}/attributes/{attribute}",
                           nativeAttribute={"entityType": entity_type, "attribute": attribute, "state": value["state"], "literal": literal})
            key = f"{name}-{index}"
            fragments.append({"key": key, "familyId": FAMILY, "sourceSha256": source["sourceSha256"],
                              "method": "native_metadata", "locator": locator, "text": text})
            claims.append({"role": role, "state": "declared" if value["state"] == "supplied" else value["state"],
                           "literal": literal, "unit": None, "citations": [{"key": key, "quote": literal or text}]})
        if name == "ifc2x3":
            assert document["georeference"]["state"] == "missing_or_unqualified"
            fragments.append({"key": "ifc2x3-georeference", "familyId": FAMILY, "sourceSha256": source["sourceSha256"],
                "method": "native_metadata", "locator": {"readerOutputSha256": sha(output_bytes), "readerPointer": "/georeference"},
                "text": "georeference.state = missing_or_unqualified; globalTransformApplied = false; inspectionFrame = source_local"})
        example = {"version": "evidence-association-input/1", "exampleId": name + "-source-native-v1", "familyId": FAMILY, "evidence": fragments}
        expected = {"version": "evidence-association-output/1", "claims": claims, "conflicts": [],
                    "abstentions": [{"code": "no_canonical_targets", "citations": []}], "canonicalLinks": []}
        validate_input(example, contract, freeze, ("development",))
        validate_output(expected, example, contract, freeze, ("development",))
        examples.append(example)
        expectations.append({"exampleId": example["exampleId"], "expected": expected,
                             "origin": "deterministic unchanged native attributes and original spans; frozen before model output"})
        relations = [r for r in document["records"] if r["entityType"] == "IfcRelAggregates"
                     and r["attributes"]["RelatingObject"]["value"]["entityType"] == "IfcBuilding"]
        lineage.append({"exampleId": example["exampleId"], "source": source, "sourceBytes": len(source_bytes),
                        "readerPath": str(output_path), "readerSha256": sha(output_bytes),
                        "nativeBuildingStoreyRelations": relations, "license": "CC-BY-4.0",
                        "attribution": "buildingSMART International Ltd., Certification-datasets 80d976a9b193a26a8e928c3e79bff67af1de68a8",
                        "geography": "test_only source geography unknown; no transform or canonical identity"})
    (destination / "schema-v1.json").write_bytes(contract_bytes)
    (destination / "family-freeze.json").write_bytes(freeze_bytes)
    write(destination / "development.json", {"version": "association-development/1", "examples": examples})
    write(destination / "expectations.json", {"version": "association-expectations/1", "examples": expectations})
    write(destination / "lineage.json", {"manifestSha256": sha(manifest_path.read_bytes()), "sources": lineage,
          "exampleCount": len(examples), "familyCount": 1, "expectedClaims": sum(len(e["expected"]["claims"]) for e in expectations),
          "evaluationContentRead": False, "oldMappingDataRead": False, "teacherOutputsUsed": False})
    print(json.dumps({"prepared": str(destination), "examples": len(examples), "expectedClaims": 6, "families": 1}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    prepare(parser.parse_args().destination)
