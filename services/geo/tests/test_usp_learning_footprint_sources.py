"""Real-source V8 regressions: preserved inputs, label isolation and typed locators."""

import copy
import importlib.util
import json
import os
from pathlib import Path

import pytest

from geo.usp_learning.corpus import input_proof, load_examples, publisher_field_profile, wire_observation

REPO = Path(__file__).resolve().parents[3]


def retained():
    if not os.environ.get("USP_LEARNING_ORIGINALS_DIR"):
        pytest.skip("retained issuer originals not configured")
    root = Path(os.environ["USP_LEARNING_ORIGINALS_DIR"])
    candidate = Path(os.environ.get("USP_LEARNING_CANDIDATE_DIR", root / "desktop-ai06a/completion-v8"))
    path = candidate / "learning-corpus-v8-immutable.json"
    corpus, examples = load_examples(path, root)
    return root, path, corpus, examples


def test_v8_preserves_all_v7_sources_splits_and_exact_inputs():
    root, path, corpus, examples = retained()
    previous = root / "desktop-ai06a/completion-v7/learning-corpus-v7-immutable.json"
    prior, old_examples = load_examples(previous, root)
    old_proof = json.loads(previous.with_name("input-proof-v7.json").read_text(encoding="utf-8"))
    proof = json.loads(path.with_name("input-proof-v8.json").read_text(encoding="utf-8"))
    assert input_proof(previous, old_examples) == old_proof
    assert input_proof(path, examples) == proof
    assert corpus["sources"][:16] == prior["sources"]
    assert proof["fields"][:88] == old_proof["fields"]
    assert json.loads((REPO / "docs/api/learning-corpus.json").read_text(encoding="utf-8")) == corpus
    assert len(examples) == 92 and len(corpus["sources"]) == 18
    new = examples[88:]
    assert len(new) == 4 and all(item["split"] == "train" for item in new)
    assert sum(item["target"] == "building.sourceKey" for item in new) == 1
    spec = importlib.util.spec_from_file_location("curation", REPO / "scripts/usp/learning/prepare_training_corpus.py")
    curation = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(curation)
    curation.preserve_v7(prior, corpus, old_proof, proof)
    changed = copy.deepcopy(corpus)
    changed["sources"][0]["fields"][0]["target"] = None
    with pytest.raises(ValueError, match="V7 source objects"):
        curation.preserve_v7(prior, changed, old_proof, proof)
    changed = copy.deepcopy(corpus)
    changed["sources"][-1]["split"] = "evaluation"
    with pytest.raises(ValueError, match="independent training families"):
        curation.preserve_v7(prior, changed, old_proof, proof)


def test_native_profiles_exclude_review_prose_raw_ids_and_unknown_fields():
    root, _, corpus, examples = retained()
    for source in corpus["sources"][-2:]:
        features = json.loads((root / source["sample"]["file"]).read_text(encoding="utf-8"))["features"]
        metadata = (root / source["metadata"]["file"]).read_text(encoding="utf-8")
        for field in source["fields"]:
            profile = publisher_field_profile(source, field, features, metadata)
            changed = {**field, "definition": "reviewer answer must stay out", "target": "building.name"}
            assert publisher_field_profile(source, changed, features, metadata) == profile
            assert "publisher description none recorded" in profile
            for feature in features:
                assert feature["id"] not in profile
                assert feature["properties"].get("identificatie", feature["properties"].get("cleabs")) not in profile
        scored = {item["path"] for item in examples if item["source"] == source["id"]}
        assert scored.isdisjoint(field["path"] for field in source["excludedFields"])
    bag, ign = corpus["sources"][-2:]
    key = next(field for field in bag["excludedFields"] if field["path"] == "properties.identificatie")
    assert key["decision"] == "unknown" and key["observedWire"]["nonNullTypes"] == ["string"]
    nulls = next(field for field in ign["excludedFields"] if field["path"] == "properties.identifiants_sources")
    assert nulls["observedWire"]["nullCount"] == 2 and nulls["observedWire"]["absentCount"] == 0
    assert nulls["observedWire"]["nonNullTypes"] == ["string"]


def test_wrong_schema_locators_and_numeric_key_labels_fail(tmp_path):
    root, _, corpus, _ = retained()
    bag, ign = corpus["sources"][-2:]
    bag_features = json.loads((root / bag["sample"]["file"]).read_text(encoding="utf-8"))["features"]
    bag_metadata = (root / bag["metadata"]["file"]).read_text(encoding="utf-8")
    field = copy.deepcopy(bag["fields"][0])
    field["inputEvidence"] = {"sourceField": "identificatie", "fieldPointer": "/properties/identificatie"}
    with pytest.raises(ValueError, match="geometry role"):
        publisher_field_profile(bag, field, bag_features, bag_metadata)
    features = json.loads((root / ign["sample"]["file"]).read_text(encoding="utf-8"))["features"]
    metadata = (root / ign["metadata"]["file"]).read_text(encoding="utf-8")
    field = copy.deepcopy(ign["fields"][0])
    field["inputEvidence"]["sourceField"] = "geometrie"
    with pytest.raises(ValueError, match="observed property path"):
        publisher_field_profile(ign, field, features, metadata)
    # Alter a label/configuration only; the retained numeric values stay untouched.
    changed = copy.deepcopy(corpus)
    source = changed["sources"][-1]
    source["excludedFields"] = [field for field in source["excludedFields"] if field["path"] != "properties.nombre_de_logements"]
    field = source["fields"][0]
    field.update(path="properties.nombre_de_logements", declaredType="xsd:int",
                 inputEvidence={"sourceField": "nombre_de_logements"},
                 observedWire=wire_observation("properties.nombre_de_logements", features))
    changed_path = tmp_path / "invalid-numeric-key-label.json"
    changed_path.write_text(json.dumps(changed), encoding="utf-8")
    with pytest.raises(ValueError, match="literal text target cannot coerce"):
        load_examples(changed_path, root)
