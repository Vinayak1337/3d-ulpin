"""SB1: the raster-window and point-batch readers take a batch's kept original by its large-original key."""
import base64
import hashlib
import json
from pathlib import Path
import uuid

import pytest

from geo.point_batch import read_point_batch
from geo.raster_window import read_raster_window
from geo.validation import InputError

PACK = Path("E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload")
ROOT = Path(__file__).resolve().parents[3]
RECORDED = {f["file"]: f for f in json.loads((ROOT / "docs/evidence/gf1/au3/result.json").read_text())["files"]}
needs_pack = pytest.mark.skipif(not PACK.exists(), reason="The NYC pack is not on this machine.")


class _Body:
    def __init__(self, data):
        self.data = data

    def iter_chunks(self, chunk_size):
        for at in range(0, len(self.data), chunk_size):
            yield self.data[at:at + chunk_size]

    def close(self):
        pass


class _S3:
    def __init__(self, key, data):
        self.key, self.data = key, data

    def get_object(self, Bucket, Key):
        assert Key == self.key
        return {"Body": _Body(self.data)}


def _kept(name):
    data = (PACK / name).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    assert digest == RECORDED[name]["sha256"]
    source_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"sb1/{name}"))
    key = f"large-originals/{source_id}/{digest}"
    return {"sourceId": source_id, "objectKey": key, "sha256": digest, "bytes": len(data)}, _S3(key, data)


@needs_pack
@pytest.mark.parametrize("name,last", [("nyc-10013-ortho-2018.tif", {"x": 512, "y": 512, "width": 256, "height": 256}),
                                       ("nyc-10013-dem-2017.tif", {"x": 768, "y": 768, "width": 64, "height": 143})])
def test_kept_raster_reads_its_first_and_last_window(name, last):
    pins, s3 = _kept(name)
    first = read_raster_window({**pins, "window": None}, s3=s3)
    recorded = RECORDED[name]["reader"]
    assert first["artifactSha256"] == recorded["artifactSha256"]
    m = first["metadata"]
    assert (m["sourceWidth"], m["sourceHeight"], m["sourceBands"]) == (
        recorded["sourceWidth"], recorded["sourceHeight"], recorded["sourceBands"])
    assert m["sourceCrsAuthority"] == recorded["crs"]
    assert m["verticalReferenceStatus"] == "unknown" and m["verticalReference"] is None
    assert m["window"] == {"x": 0, "y": 0, "width": 256, "height": 256}
    tail = read_raster_window({**pins, "window": last}, s3=s3)
    assert tail["metadata"]["window"] == last


@needs_pack
def test_kept_laz_reads_its_first_and_last_batch():
    name = "nyc-10013-lidar-2017.laz"
    pins, s3 = _kept(name)
    first = read_point_batch({**pins, "batch": None}, s3=s3)
    recorded = RECORDED[name]["reader"]
    assert first["artifactSha256"] == recorded["artifactSha256"]
    m = first["metadata"]
    assert m["sourcePointCount"] == 1726222 and m["horizontalAuthority"] == "EPSG:6347"
    assert m["verticalReference"] == "NAVD88 height" and m["batch"] == {"start": 0, "count": 8192}
    tail = read_point_batch({**pins, "batch": {"start": 1720320, "count": 5902}}, s3=s3)
    assert tail["metadata"]["batch"] == {"start": 1720320, "count": 5902}
    assert len(base64.b64decode(tail["artifactBase64"])) == 5902 * 30


def test_a_key_of_another_prefix_or_source_is_refused():
    digest = "a" * 64
    source_id = str(uuid.uuid4())
    for key in (f"uploads/{source_id}/{digest}", f"large-originals/{uuid.uuid4()}/{digest}"):
        pins = {"sourceId": source_id, "objectKey": key, "sha256": digest, "bytes": 10}
        with pytest.raises(InputError):
            read_raster_window({**pins, "window": None}, s3=None)
        with pytest.raises(InputError):
            read_point_batch({**pins, "batch": None}, s3=None)
