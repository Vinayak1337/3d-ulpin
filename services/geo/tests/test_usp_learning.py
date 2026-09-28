"""Source-backed guards for the offline schema learner."""

import json
import os
from pathlib import Path

import pytest

from geo.usp_learning.corpus import _features, load_examples, wire_compatible_rows, wire_observation


REPO = Path(__file__).resolve().parents[3]


def test_issuer_number_may_be_a_json_string_and_null_is_not_absent():
    sample = json.loads((REPO / "fixtures/real-nyc/original.geojson").read_text())
    features = sample["features"]
    identifier = wire_observation("properties.doitt_id", features)
    assert identifier["nonNullTypes"] == ["string"]
    assert identifier["presentCount"] == 1
    assert wire_compatible_rows("building.sourceKey", "properties.doitt_id", features) == 1
    name = wire_observation("properties.name", features)
    assert name["presentCount"] == 1
    assert name["nullCount"] == 1
    assert name["absentCount"] == 0
    assert wire_compatible_rows("building.name", "properties.name", features) == 0


def test_corpus_rejects_wire_type_claim_contradicting_original(tmp_path):
    originals = os.environ.get("USP_LEARNING_ORIGINALS_DIR")
    if not originals:
        pytest.skip("bounded external issuer originals are not configured")
    corpus = json.loads((REPO / "docs/api/learning-corpus.json").read_text())
    nyc = next(source for source in corpus["sources"] if source["id"] == "nyc-building-footprints")
    identifier = next(field for field in nyc["fields"] if field["path"] == "properties.doitt_id")
    assert identifier["declaredType"] == "number"
    assert identifier["observedWire"]["nonNullTypes"] == ["string"]
    identifier["observedWire"]["nonNullTypes"] = ["number"]
    changed = tmp_path / "corpus.json"
    changed.write_text(json.dumps(corpus))
    with pytest.raises(ValueError, match="observed wire shape contradicts retained original"):
        load_examples(changed, Path(originals))


def test_absent_full_source_name_is_distinct_from_sample_null():
    original = os.environ.get("USP_LEARNING_FULL_NYC_ORIGINAL")
    if not original:
        pytest.skip("retained full NYC original is not configured")
    features = json.loads(Path(original).read_text())["features"]
    name = wire_observation("properties.name", features)
    assert name["presentCount"] == 0
    assert name["nullCount"] == 0
    assert name["absentCount"] == len(features)


def test_acquired_opendatasoft_shape_nonbuilding_labels_and_profile_privacy():
    originals = os.environ.get("USP_LEARNING_ORIGINALS_DIR")
    if not originals:
        pytest.skip("bounded external issuer originals are not configured")
    corpus_path = REPO / "docs/api/learning-corpus.json"
    corpus, examples = load_examples(corpus_path, Path(originals))
    assert corpus["schemaVersion"] == "usp-field-mapping-corpus-v3"
    assert {item["family"] for item in examples if item["split"] == "calibration"}.isdisjoint(
        {item["family"] for item in examples if item["split"] == "evaluation"}
    )
    vancouver = next(source for source in corpus["sources"] if source["id"] == "vancouver-building-footprints-2015")
    original = json.loads((Path(originals) / vancouver["sample"]["file"]).read_text())
    normalized = _features(original, vancouver)
    assert wire_observation("geometry", normalized)["nonNullTypes"] == ["geojson:Polygon"]
    assert wire_observation("properties.object_id", normalized)["nonNullTypes"] == ["number"]
    assert any(item["source"] == "census-tigerweb-counties" and item["path"] == "geometry" and item["target"] is None
               for item in examples)
    dc = next(source for source in corpus["sources"] if source["id"] == "dc-building-footprints-2021")
    dc_original = json.loads((Path(originals) / dc["sample"]["file"]).read_text())
    raw_id = dc_original["features"][0]["properties"]["GLOBALID"]
    profile = next(item["text"] for item in examples
                   if item["source"] == dc["id"] and item["path"] == "properties.GLOBALID")
    assert raw_id not in profile
