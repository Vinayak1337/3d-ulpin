"""Source-backed V7 guards against split drift and answer/raw-value input leakage."""

import copy
import importlib.util
import json
import os
from pathlib import Path

import pytest

from geo.usp_learning.corpus import input_proof, load_examples, publisher_field_profile, sha256_file


REPO = Path(__file__).resolve().parents[3]


def retained_corpus(version=None):
    originals = os.environ.get("USP_LEARNING_ORIGINALS_DIR")
    if not originals:
        pytest.skip("retained issuer originals not configured")
    root = Path(originals)
    path = (root / f"desktop-ai06a/completion-{version}/learning-corpus-{version}-immutable.json"
            if version else REPO / "docs/api/learning-corpus.json")
    corpus, examples = load_examples(path, root)
    return root, path, corpus, examples


def test_v7_preserves_v6_sources_splits_and_exact_inputs():
    root, path, corpus, examples = retained_corpus(version="v7")
    spec = importlib.util.spec_from_file_location("training_curation", REPO / "scripts/usp/learning/prepare_training_corpus.py")
    curation = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(curation)
    previous_path = root / "desktop-ai06a/completion-v6/learning-corpus-v6-immutable.json"
    previous_proof_path = previous_path.with_name("input-proof-v6.json")
    assert sha256_file(previous_path) == curation.V6_SHA256
    assert sha256_file(previous_proof_path) == curation.V6_PROOF_SHA256
    previous, previous_examples = load_examples(previous_path, root)
    prior_proof = json.loads(previous_proof_path.read_text(encoding="utf-8"))
    assert input_proof(previous_path, previous_examples) == prior_proof
    proof = input_proof(path, examples)
    curation.preserve_v6(previous, corpus, prior_proof, proof)
    frozen = root / "desktop-ai06a/completion-v7"
    frozen_path = frozen / "learning-corpus-v7-immutable.json"
    # Git may convert the checked manifest's line endings; private frozen bytes stay exact.
    assert corpus == json.loads(frozen_path.read_text(encoding="utf-8"))
    assert input_proof(frozen_path, examples) == json.loads((frozen / "input-proof-v7.json").read_text(encoding="utf-8"))
    added = corpus["sources"][len(previous["sources"]):]
    assert added == curation.training_additions(root)
    assert len(added) == 4 and all(source["split"] == "train" for source in added)
    corrupted = copy.deepcopy(corpus)
    corrupted["sources"][0]["split"] = "calibration"
    with pytest.raises(ValueError, match="V6 source objects"):
        curation.preserve_v6(previous, corrupted, prior_proof, proof)
    corrupted = copy.deepcopy(corpus)
    corrupted["sources"][-1]["split"] = "evaluation"
    with pytest.raises(ValueError, match="independent training families"):
        curation.preserve_v6(previous, corrupted, prior_proof, proof)


def test_new_profiles_keep_raw_values_review_labels_and_unsupported_fields_out(tmp_path):
    root, _, corpus, examples = retained_corpus()
    new_ids = {"cambridge-municipal-buildings", "oregon-state-government-buildings",
               "tweed-council-buildings", "usgs-wbd-subwatersheds"}
    additions = [source for source in corpus["sources"] if source["id"] in new_ids]
    for source in additions:
        features = json.loads((root / source["sample"]["file"]).read_text(encoding="utf-8"))["features"]
        metadata = (root / source["metadata"]["file"]).read_text(encoding="utf-8")
        for field in source["fields"]:
            text = publisher_field_profile(source, field, features, metadata)
            changed = {**field, "definition": "reviewer answer must stay out", "target": "building.sourceKey"}
            assert publisher_field_profile(source, changed, features, metadata) == text
            # Inspect meaningful retained strings without false matches on short codes.
            for feature in features:
                for value in feature["properties"].values():
                    if isinstance(value, str) and len(value) >= 8:
                        assert value not in text
        scored_paths = {item["path"] for item in examples if item["source"] == source["id"]}
        assert scored_paths.isdisjoint(field["path"] for field in source["excludedFields"])
    cambridge = next(source for source in additions if source["id"] == "cambridge-municipal-buildings")
    edit_date = next(field for field in cambridge["excludedFields"] if field["path"] == "properties.EditDate")
    assert edit_date["observedWire"]["nullCount"] == 5 and edit_date["observedWire"]["absentCount"] == 0
    new_examples = [item for item in examples if item["source"] in new_ids]
    assert sum(item["target"] == "building.name" for item in new_examples) == 3
    assert not any(item["target"] == "building.sourceKey" for item in new_examples)
    assert any(item["source"] == "usgs-wbd-subwatersheds" and item["path"] == "geometry"
               and item["observedWire"]["nonNullTypes"] == ["geojson:Polygon"] and item["target"] is None
               for item in new_examples)
    cambridge["permission"]["trainingEligible"] = False
    changed_path = tmp_path / "ineligible.json"
    changed_path.write_text(json.dumps(corpus), encoding="utf-8")
    with pytest.raises(ValueError, match="source not eligible"):
        load_examples(changed_path, root)
