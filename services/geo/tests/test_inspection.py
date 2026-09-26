import hashlib
import io
import json

import pytest

from geo.inspection import inspect_bytes
from geo.tasks import inspect_object
from geo.validation import InputError
from conftest import FIXTURES


def test_real_nyc_files_have_parseable_original_bytes():
    folder = FIXTURES / "real-nyc"
    spatial = inspect_bytes("parcel-local-json-v1", (folder / "spatial.json").read_bytes())
    levels = inspect_bytes("levels-csv-v1", (folder / "levels-r1.csv").read_bytes())
    assert spatial["status"] in ("ready", "needs_input")
    assert levels["status"] in ("ready", "needs_input")
    assert len([f for f in spatial["features"] if f["kind"] == "unit"]) == 1
    assert levels["levels"][0]["alias"] == "NYC-ENV353927"


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
    source = json.loads((FIXTURES / "real-nyc/spatial.json").read_text())
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
    raw = (FIXTURES / "real-nyc/levels-r1.csv").read_bytes()
    data = {"sourceId": "source-id", "profile": "levels-csv-v1", "objectKey": "private/source-original", "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
    client = FakeS3(raw)
    assert inspect_object(data, client)["status"] == "ready"
    assert client.calls[0]["Key"] == "private/source-original"
    with pytest.raises(InputError, match="checksum"):
        inspect_object({**data, "sha256": "0" * 64}, client)
    with pytest.raises(InputError, match="size"):
        inspect_object({**data, "bytes": len(raw) + 1}, client)
