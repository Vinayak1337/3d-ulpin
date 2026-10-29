"""SB1: the raster-window and point-batch readers take a batch's kept original by its large-original key."""
import base64
import hashlib
import json
import math
from pathlib import Path
import time
import uuid

import numpy as np
import pytest
import rasterio
from rasterio.enums import Resampling
from rasterio.io import MemoryFile
from rasterio.windows import Window

from geo import settings

from geo.point_batch import _source_path, read_point_batch
from geo.raster_window import _band, read_raster_window
from geo.validation import InputError

PACK = Path("E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload")
ROOT = Path(__file__).resolve().parents[3]
RECORDED = {f["file"]: f for f in json.loads((ROOT / "docs/evidence/gf1/au3/result.json").read_text())["files"]}
needs_pack = pytest.mark.skipif(not PACK.exists(), reason="The NYC pack is not on this machine.")


@pytest.fixture(autouse=True)
def private_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "VERIFIED_CACHE_DIR", str(tmp_path / "verified"))


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
    m = first["metadata"]
    assert (m["sourceWidth"], m["sourceHeight"], m["sourceBands"]) == (
        recorded["sourceWidth"], recorded["sourceHeight"], recorded["sourceBands"])
    assert m["sourceCrsAuthority"] == recorded["crs"]
    assert m["verticalReferenceStatus"] == "unknown" and m["verticalReference"] is None
    step = math.ceil(max(m["sourceWidth"], m["sourceHeight"]) / 256)
    assert m["window"] == {"x": 0, "y": 0, "width": math.ceil(m["sourceWidth"] / step),
                           "height": math.ceil(m["sourceHeight"] / step), "step": step}
    with rasterio.open(PACK / name) as source:
        assert m["nativeBounds"] == pytest.approx(list(source.bounds))
    tail = read_raster_window({**pins, "window": last}, s3=s3)
    assert tail["metadata"]["window"] == {**last, "step": 1}
    original_crop = read_raster_window({**pins, "window": {"x": 0, "y": 0, "width": 256, "height": 256}}, s3=s3)
    _check_output(PACK / name, original_crop)
    artifact = base64.b64decode(original_crop["artifactBase64"])
    assert original_crop["artifactSha256"] == hashlib.sha256(artifact).hexdigest()
    assert hashlib.sha256((PACK / name).read_bytes()).hexdigest() == pins["sha256"]


@needs_pack
def test_kept_laz_reads_its_first_and_last_batch():
    name = "nyc-10013-lidar-2017.laz"
    pins, s3 = _kept(name)
    first = read_point_batch({**pins, "batch": None}, s3=s3)
    recorded = RECORDED[name]["reader"]
    m = first["metadata"]
    assert m["sourcePointCount"] == 1726222 and m["horizontalAuthority"] == "EPSG:6347"
    step = math.ceil(m["sourcePointCount"] / 32_768)
    assert m["verticalReference"] == "NAVD88 height" and m["batch"] == {
        "start": 0, "count": math.ceil(m["sourcePointCount"] / step), "step": step}
    tail = read_point_batch({**pins, "batch": {"start": 1720320, "count": 5902}}, s3=s3)
    assert tail["metadata"]["batch"] == {"start": 1720320, "count": 5902, "step": 1}
    assert len(base64.b64decode(tail["artifactBase64"])) == 5902 * 30
    original_batch = read_point_batch({**pins, "batch": {"start": 0, "count": 8192}}, s3=s3)
    assert original_batch["artifactSha256"] == recorded["artifactSha256"]


PRACTICE = json.loads((ROOT / "docs/evidence/step-2/s2-2/manifest.json").read_text())
RASTERS = [f for f in PRACTICE["files"] if f["format"] in {"COG GeoTIFF", "DEM GeoTIFF"}]


class _FileBody:
    def __init__(self, path):
        self.source = path.open("rb")

    def iter_chunks(self, chunk_size):
        while block := self.source.read(chunk_size):
            yield block

    def close(self):
        self.source.close()


class _FileS3:
    def __init__(self, path, key):
        self.path, self.key, self.downloads = path, key, 0

    def get_object(self, Bucket, Key):
        assert Key == self.key
        self.downloads += 1
        return {"Body": _FileBody(self.path)}


def _practice(file):
    path = Path(PRACTICE["root"]) / file["path"]
    if not path.is_file():
        pytest.skip(f"Practice raster is absent: {path.name}")
    source_id = str(uuid.uuid5(uuid.NAMESPACE_URL, file["path"]))
    key = f"large-originals/{source_id}/{file['sha256']}"
    pins = {"sourceId": source_id, "objectKey": key, "sha256": file["sha256"], "bytes": file["bytes"]}
    return path, pins, _FileS3(path, key)


def _check_output(path, result):
    metadata = result["metadata"]
    selected = metadata["window"]
    x, y, width, height, step = (selected[k] for k in ("x", "y", "width", "height", "step"))
    with rasterio.open(path) as source, MemoryFile(base64.b64decode(result["artifactBase64"])) as memory:
        window = Window(x, y, min(width * step, source.width - x), min(height * step, source.height - y))
        shape = (source.count, height, width)
        expected = source.read(window=window, out_shape=shape, resampling=Resampling.nearest)
        masks = source.read_masks(window=window, out_shape=shape, resampling=Resampling.nearest)
        with memory.open() as output:
            preview = output.read()
            assert output.count == 4 and output.dtypes == ("uint8",) * 4
            assert output.colorinterp[-1].name == "alpha" and output.nodata is None
            assert output.tags()["usage"] == "display_only"
            chosen = metadata["display"]["bands"]
            alpha = np.full((height, width), 255, dtype="uint8")
            for target, index in enumerate(chosen):
                values, mask = expected[index - 1], masks[index - 1]
                valid = (mask != 0) & np.isfinite(values)
                alpha = np.minimum(alpha, np.where(valid, mask, 0))
                channel = np.zeros((height, width), dtype="uint8")
                if valid.any():
                    low, high = np.percentile(values[valid].astype("float64"), [2, 98])
                    channel[valid] = (np.rint(np.clip((values[valid].astype("float64") - low)
                                                     / (high - low), 0, 1) * 255) if high > low else 128)
                for out in ([0, 1, 2] if len(chosen) == 1 else [target]):
                    np.testing.assert_array_equal(preview[out], channel)
            np.testing.assert_array_equal(preview[3], alpha)
            assert list(output.transform)[:6] == pytest.approx(metadata["windowTransform"])
        affine = source.window_transform(window) * source.transform.scale(window.width / width, window.height / height)
        assert metadata["windowTransform"] == pytest.approx(list(affine)[:6])
        for i, band in enumerate(metadata["bands"]):
            valid = expected[i][masks[i] != 0]
            assert band["validMin"] == (float(valid.min()) if valid.size else None)
            assert band["validMax"] == (float(valid.max()) if valid.size else None)


@pytest.mark.parametrize("file", RASTERS, ids=lambda f: Path(f["path"]).name)
def test_practice_overview_covers_whole_extent_and_cache_downloads_once(file):
    path, pins, s3 = _practice(file)
    result = read_raster_window({**pins, "window": None}, s3=s3)
    metadata = result["metadata"]
    expected = (242, 110, 256) if "Raichur" in path.name else (43, 252, 252)
    assert tuple(metadata["window"][k] for k in ("step", "width", "height")) == expected
    with rasterio.open(path) as source:
        assert metadata["nativeBounds"] == pytest.approx(list(source.bounds))
    _check_output(path, result)
    started = time.perf_counter()
    window = {"x": 1024, "y": 1024, "width": 128, "height": 128, "step": 32}
    stepped = read_raster_window({**pins, "window": window}, s3=s3)
    assert time.perf_counter() - started < 10
    assert s3.downloads == 1
    _check_output(path, stepped)


@pytest.mark.parametrize("masked", [False, True])
@pytest.mark.parametrize("step", [1, 4])
def test_clipped_step_stops_at_last_source_sample_and_empty_range_is_null(tmp_path, masked, step):
    # Technical pixels only, not survey data: exercise both clipped axes and nodata.
    path = tmp_path / "control.tif"
    values = np.full((1, 7, 10), -99, dtype="int16") if masked else np.arange(70, dtype="int16").reshape(1, 7, 10)
    with rasterio.open(path, "w", driver="GTiff", width=10, height=7, count=1, dtype="int16",
                       nodata=-99, transform=rasterio.transform.from_origin(0, 7, 1, 1)) as source:
        source.write(values)
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    source_id = str(uuid.uuid4())
    key = f"sources/{source_id}/{digest}"
    pins = {"sourceId": source_id, "objectKey": key, "sha256": digest, "bytes": len(data)}
    window = {"x": 9 - step, "y": 6 - step, "width": 2, "height": 2, "step": step}
    result = read_raster_window({**pins, "window": window}, s3=_S3(key, data))
    assert result["metadata"]["window"] == window
    assert result["metadata"]["sourceCrsWkt"] is None
    assert result["metadata"]["bands"][0]["validPixels"] == (0 if masked else 4)
    _check_output(path, result)
    for extra in ({"width": 3}, {"height": 3}):
        with pytest.raises(InputError, match="Pixel window is outside the retained raster dimensions"):
            read_raster_window({**pins, "window": {**window, **extra}}, s3=_S3(key, data))


def test_point_cache_on_another_disk_has_plain_words(tmp_path, monkeypatch):
    # Only the LAS prefix is needed to exercise naming, not native point decoding.
    data = b"LASF" + bytes(101)

    def wrong_disk(self, target):
        raise OSError("Cross-device link")

    monkeypatch.setattr(Path, "hardlink_to", wrong_disk)
    with pytest.raises(InputError, match="cache folder must be on the same disk as the processor temporary folder"):
        _source_path(_Body(data), str(tmp_path), len(data), hashlib.sha256(data).hexdigest())


def test_unmasked_nonfinite_samples_do_not_claim_a_finite_range():
    values = np.array([1, np.inf], dtype="float32")
    band = _band(1, "float32", None, "absent", values, np.array([255, 255], dtype="uint8"))
    assert band["validPixels"] == 2
    assert "validMin" not in band and "validMax" not in band


@pytest.mark.parametrize("step", [0, 1.5, True, 4097])
def test_invalid_window_step_is_refused_before_download(step):
    digest = "a" * 64
    source_id = str(uuid.uuid4())
    pins = {"sourceId": source_id, "objectKey": f"sources/{source_id}/{digest}", "sha256": digest, "bytes": 1}
    code = "RASTER_WINDOW_INPUT" if isinstance(step, (float, bool)) else "RASTER_WINDOW_STEP"
    with pytest.raises(InputError, match=f"^{code}:"):
        read_raster_window({**pins, "window": {"x": 0, "y": 0, "width": 1, "height": 1, "step": step}})


def test_a_key_of_another_prefix_or_source_is_refused():
    digest = "a" * 64
    source_id = str(uuid.uuid4())
    for key in (f"uploads/{source_id}/{digest}", f"large-originals/{uuid.uuid4()}/{digest}"):
        pins = {"sourceId": source_id, "objectKey": key, "sha256": digest, "bytes": 10}
        with pytest.raises(InputError, match="^RASTER_SOURCE_INPUT:"):
            read_raster_window({**pins, "window": None}, s3=None)
        with pytest.raises(InputError):
            read_point_batch({**pins, "batch": None}, s3=None)
