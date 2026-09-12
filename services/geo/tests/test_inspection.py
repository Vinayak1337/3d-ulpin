import hashlib
import io
import json

import pytest

from geo.inspection import inspect_bytes
from geo.tasks import inspect_object
from geo.validation import InputError
from conftest import FIXTURES


@pytest.mark.parametrize("dataset", ["c001", "c002"])
def test_every_advertised_file_has_real_parseable_bytes(dataset):
    manifest = json.loads((FIXTURES / dataset / "manifest.json").read_text())
    for source in manifest["files"]:
        result = inspect_bytes(source["profile"], (FIXTURES / dataset / source["name"]).read_bytes())
        assert result["status"] in ("ready", "needs_input"), result
        if source["name"] == "spatial.json":
            assert result["frame"] == manifest["frame"]
            assert len([f for f in result["features"] if f["kind"] in ("unit", "common", "basement")]) == manifest["expected"]["unitCount"]
        if source["name"].startswith("plan"):
            assert result["status"] == "needs_input"
            assert result["image"]["width"] == 1400
            assert result["image"]["height"] == 900


def test_incomplete_levels_preserve_null_and_exact_locator():
    result = inspect_bytes("levels-csv-v1", (FIXTURES / "c001/levels-r1.csv").read_bytes())
    assert result["status"] == "needs_input"
    upper_west = next(row for row in result["levels"] if row["alias"] == "U03")
    assert upper_west["lower"] is None
    assert upper_west["upper"] == 6
    assert upper_west["locator"] == "csv row 4"
    assert len(result["issues"]) == 2


@pytest.mark.parametrize("row", ["A,NaN,3,m,BM,test", "A,Infinity,3,m,BM,test", "A,nope,3,m,BM,test", "A,0,3,ft,BM,test", "A,4,3,m,BM,test", "A,0,3,m,,test", "A,0,3,m,BM,", "A,0,3,m,BM,test,unexpected"])
def test_bad_level_values_are_not_silently_coerced(row):
    result = inspect_bytes("levels-csv-v1", ("alias,lower,upper,unit,benchmark,method\n" + row + "\n").encode())
    assert result["status"] == "failed"
    assert result["issues"][0]["severity"] == "error"


def test_csv_duplicate_alias_and_mixed_reference_fail():
    header = "alias,lower,upper,unit,benchmark,method\n"
    for body in ("A,0,3,m,BM,test\nA,3,6,m,BM,test\n", "A,0,3,m,BM,test\nB,3,6,m,OTHER,test\n"):
        assert inspect_bytes("levels-csv-v1", (header + body).encode())["status"] == "failed"


@pytest.mark.parametrize("mutation", ["nonfinite", "crossing", "holes", "frame", "feature_reference", "duplicate_alias"])
def test_invalid_spatial_profiles(mutation):
    source = json.loads((FIXTURES / "c001/spatial.json").read_text())
    if mutation == "nonfinite":
        source["features"][0]["footprint"][0][0] = float("nan")
    elif mutation == "crossing":
        source["features"][0]["footprint"] = [[0, 0], [2, 2], [0, 2], [2, 0]]
    elif mutation == "holes":
        source["features"][0]["footprint"] = [[[0, 0], [2, 0], [2, 2], [0, 2]], [[1, 1], [1.5, 1], [1.5, 1.5]]]
    elif mutation == "frame":
        source["frame"]["horizontalUnit"] = "ft"
    elif mutation == "feature_reference":
        source["features"][0]["frame"] = {**source["frame"], "id": "OTHER"}
    else:
        source["features"][1]["alias"] = source["features"][0]["alias"]
    assert inspect_bytes("parcel-local-json-v1", json.dumps(source).encode())["status"] == "failed"


def test_controls_and_invalid_plan_bytes():
    single = b"id,x,y,unit,benchmark\nA,0,0,m,BM\n"
    assert inspect_bytes("control-csv-v1", single)["status"] == "needs_input"
    for profile in ("plan-png-v1", "plan-pdf-v1"):
        assert inspect_bytes(profile, b"not a valid image or PDF")["status"] == "failed"


class FakeS3:
    def __init__(self, raw):
        self.raw = raw
        self.calls = []

    def get_object(self, **kwargs):
        self.calls.append(kwargs)
        return {"Body": io.BytesIO(self.raw)}


def test_inspector_reads_original_and_verifies_hash_and_size():
    raw = (FIXTURES / "c001/levels-r2.csv").read_bytes()
    data = {"sourceId": "source-id", "profile": "levels-csv-v1", "objectKey": "private/source-original", "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
    client = FakeS3(raw)
    assert inspect_object(data, client)["status"] == "ready"
    assert client.calls[0]["Key"] == "private/source-original"
    with pytest.raises(InputError, match="checksum"):
        inspect_object({**data, "sha256": "0" * 64}, client)
    with pytest.raises(InputError, match="size"):
        inspect_object({**data, "bytes": len(raw) + 1}, client)
