"""Generated test-only pixels exercise source layouts, never survey or legal facts."""
import base64
import hashlib
import json
import math
import struct
import time
import uuid
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import rasterio
from rasterio.enums import ColorInterp, Resampling
from rasterio.io import MemoryFile

from geo.raster_window import (
    MAX_DECODE_BYTES, MAX_SAMPLE_BLOCKS, MAX_SAMPLE_SIDE, MAX_WINDOW_RAW_BYTES,
    _overview_range, _range, _read_native, _sample_range, _stretch, read_raster_window,
)
from geo.validation import InputError
from test_surface_readers import _S3, _check_output, private_cache  # noqa: F401


CASES = ([{"dtype": dtype} for dtype in ("uint8", "uint16", "int16", "uint32", "int32", "float32", "float64")]
         + [{"compress": codec} for codec in ("none", "lzw", "deflate", "packbits", "jpeg", "zstd", "webp")]
         + [{"tiled": True, "blockxsize": 16, "blockysize": 16}, {"BIGTIFF": "YES"},
            {"interleave": "band"}, {"compress": "lzw", "predictor": 2},
            {"dtype": "float32", "compress": "deflate", "predictor": 3},
            {"dtype": "float64", "compress": "deflate", "predictor": 3}])


def _fixture(path: Path, count: int = 3, side: int = 32, **options) -> Path:
    profile = {"driver": "GTiff", "width": side, "height": side, "count": count, "dtype": "uint8",
               "transform": rasterio.transform.from_origin(0, side, 1, 1), **options}
    pixels = np.arange(side * side).reshape(side, side) % 200 + 1
    with rasterio.open(path, "w", **profile) as source:
        for index in range(1, count + 1):
            band = pixels * index % 251
            if np.dtype(profile["dtype"]).kind in "if":
                band -= 125
            source.write(band.astype(profile["dtype"]), index)
    return path


def _read(path: Path, window=None, stretch=None) -> dict:
    data = path.read_bytes()
    digest, source_id = hashlib.sha256(data).hexdigest(), str(uuid.uuid4())
    key = f"sources/{source_id}/{digest}"
    result = read_raster_window({"sourceId": source_id, "objectKey": key, "sha256": digest,
                                 "bytes": len(data), "window": window,
                                 **({"displayStretch": stretch} if stretch else {})}, s3=_S3(key, data))
    assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
    artifact = base64.b64decode(result["artifactBase64"])
    assert hashlib.sha256(artifact).hexdigest() == result["artifactSha256"]
    with MemoryFile(artifact) as memory, memory.open() as output:
        assert output.dtypes == ("uint8",) * 4 and output.count == 4
        assert output.colorinterp == (ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha)
        assert output.tags()["measurement"] == output.tags()["height"] == "not_qualified"
        rgba = output.read()
        assert rgba.shape == (4, result["metadata"]["window"]["height"], result["metadata"]["window"]["width"])
    result["rgba"] = rgba
    assert result["metadata"]["display"]["usage"] == "display_only"
    return result


@pytest.mark.parametrize("options", CASES, ids=lambda o: str(o))
def test_source_layout_is_read_and_normalized_for_display(tmp_path, options):
    path = _fixture(tmp_path / "layout.tif", **options)
    with rasterio.open(path) as source:
        # Creation options silently falling back must not count as codec coverage.
        expected = options.get("compress", "none")
        actual = source.compression.name.lower() if source.compression else "none"
        assert actual == expected
        if options.get("tiled"):
            assert source.is_tiled
        if options.get("interleave"):
            assert source.profile["interleave"] == "band"
    if options.get("BIGTIFF"):
        assert path.read_bytes()[2:4] == b"+\0"
    result = _read(path)
    _check_output(path, result)
    assert len(result["metadata"]["bands"]) == 3
    assert result["metadata"]["bands"][0]["dtype"] == options.get("dtype", "uint8")
    assert result["rgba"][3].min() == 255
    if result["metadata"]["display"]["scaling"] == "stored_uint8":
        with rasterio.open(path) as source:
            np.testing.assert_array_equal(result["rgba"][:3], source.read())
    else:
        assert result["rgba"][:3].max() == 255


@pytest.mark.parametrize("count,side,dtype", [(1, 32, "int16"), (2, 32, "uint16"), (5, 32, "uint8"),
                                             (8, 256, "float64"), (64, 32, "uint8")])
def test_all_bands_described_but_only_display_bands_allocated(tmp_path, count, side, dtype):
    path = _fixture(tmp_path / "bands.tif", count=count, side=side, dtype=dtype, interleave="band")
    result = _read(path)
    assert result["metadata"]["sourceBands"] == len(result["metadata"]["bands"]) == count
    assert result["metadata"]["display"]["bands"] == ([1] if count < 3 else [1, 2, 3])
    assert MAX_WINDOW_RAW_BYTES == 2 * 1024 * 1024


@pytest.mark.parametrize("dtype", ["uint8", "float32"])
def test_colour_interpretations_choose_rgb_not_first_three(tmp_path, dtype):
    path = _fixture(tmp_path / "colours.tif", count=5, dtype=dtype)
    with rasterio.open(path, "r+") as source:
        source.colorinterp = (ColorInterp.undefined, ColorInterp.blue, ColorInterp.undefined,
                              ColorInterp.red, ColorInterp.green)
    result = _read(path)
    assert result["metadata"]["display"]["bands"] == [4, 5, 2]
    with rasterio.open(path) as source:
        for channel, index in enumerate([4, 5, 2]):
            pixels = source.read(index)
            limits = result["metadata"]["display"].get("stretch", {}).get("bands", [])
            expected = _stretch(pixels, np.isfinite(pixels), *_range(pixels, np.isfinite(pixels))) if limits else pixels
            np.testing.assert_array_equal(result["rgba"][channel], expected)
    stretch = result["metadata"]["display"].get("stretch")
    if stretch:
        assert [band["index"] for band in stretch["bands"]] == [4, 5, 2]
        later = _read(path, {"x": 0, "y": 0, "width": 16, "height": 32}, stretch)
        np.testing.assert_array_equal(later["rgba"], result["rgba"][:, :, :16])


def test_palette_and_nodata_are_rendered_with_transparency(tmp_path):
    path = _fixture(tmp_path / "palette.tif", count=1, nodata=0)
    with rasterio.open(path, "r+") as source:
        source.write(np.array([[0, 1] * 16] * 32, dtype="uint8"), 1)
        source.write_colormap(1, {0: (0, 0, 0, 0), 1: (12, 34, 56, 255)})
    result = _read(path)
    assert result["metadata"]["display"]["scaling"] == "palette"
    assert result["rgba"][:, 0, :2].tolist() == [[0, 12], [0, 34], [0, 56], [0, 255]]


@pytest.mark.parametrize("nodata", [-99, float("nan")])
def test_nodata_and_nonfinite_samples_in_any_display_band_are_transparent(tmp_path, nodata):
    path = _fixture(tmp_path / "nodata.tif", count=5, dtype="float64", nodata=nodata)
    with rasterio.open(path, "r+") as source:
        pixels = source.read(2)
        pixels[pixels == nodata] = -98
        pixels[0, :3] = [nodata, np.nan, np.inf]
        source.write(pixels, 2)
    result = _read(path)
    assert result["rgba"][3, 0, :4].tolist() == [0, 0, 0, 255]
    assert result["metadata"]["bands"][1]["maskedPixels"] == (2 if np.isnan(nodata) else 1)
    assert result["metadata"]["bands"][1]["nodataKind"] == ("nan" if np.isnan(nodata) else "finite")


def test_matching_internal_overview_is_used(tmp_path):
    path = _fixture(tmp_path / "overview.tif", count=1, side=64)
    with rasterio.open(path, "r+") as source:
        pixels = np.zeros((64, 64), dtype="uint8")
        pixels[::2, ::2] = 252
        source.write(pixels, 1)
        source.build_overviews([2], Resampling.average)
    result = _read(path, {"x": 0, "y": 0, "width": 32, "height": 32, "step": 2})
    assert result["metadata"]["bands"][0]["validMin"] == 63
    assert result["metadata"]["bands"][0]["validMax"] == 63


@pytest.mark.parametrize("kind,code", [("broken", "RASTER_UNREADABLE"), ("complex", "RASTER_SAMPLE_TYPE"),
                                       ("codec", "RASTER_COMPRESSION"),
                                       ("png", "RASTER_FORMAT"), ("step", "RASTER_WINDOW_STEP")])
def test_refusals_have_specific_code_and_plain_sentence(tmp_path, kind, code):
    path = tmp_path / "refused.tif"
    if kind == "broken":
        path.write_bytes(b"not a TIFF")
    elif kind == "png":
        _fixture(path, driver="PNG")
    elif kind == "complex":
        _fixture(path, dtype="complex64")
    elif kind == "step":
        _fixture(path, count=1, width=4096 * 256 + 1, height=1)
    else:
        _fixture(path, compress="none")
        data = bytearray(path.read_bytes())
        directory = struct.unpack_from("<I", data, 4)[0]
        for at in range(directory + 2, directory + 2 + 12 * struct.unpack_from("<H", data, directory)[0], 12):
            if struct.unpack_from("<H", data, at)[0] == 259:
                struct.pack_into("<H", data, at + 8, 65000)
        path.write_bytes(data)
    with pytest.raises(InputError, match=rf"^{code}: [A-Z][^\n]+\.$"):
        _read(path)


def test_receipt_mismatch_is_a_source_integrity_refusal(tmp_path):
    data = _fixture(tmp_path / "receipt.tif").read_bytes()
    digest, source_id = hashlib.sha256(data).hexdigest(), str(uuid.uuid4())
    key = f"sources/{source_id}/{digest}"
    with pytest.raises(InputError, match="^RASTER_SOURCE_INTEGRITY: Source hash or byte count differs"):
        read_raster_window({"sourceId": source_id, "objectKey": key, "sha256": digest,
                            "bytes": len(data), "window": None}, s3=_S3(key, data[:-1]))


@pytest.mark.parametrize("dtype", ["float32", "uint16"])
@pytest.mark.parametrize("count", [1, 3])
@pytest.mark.parametrize("height", [32, 256])
def test_adjacent_windows_share_overview_stretch_even_when_requested_first(tmp_path, monkeypatch, dtype, count, height):
    path = tmp_path / "adjacent.tif"
    row = np.concatenate([np.arange(256) * 4, np.arange(256) * 4 + 512]).astype(dtype)
    pixels = np.tile(row, (height, 1))
    pixels[0, [0, 256]] = -99 if dtype == "float32" else 65535
    with rasterio.open(path, "w", driver="GTiff", width=512, height=height, count=count, dtype=dtype,
                       nodata=float(pixels[0, 0]), transform=rasterio.transform.from_origin(0, height, 1, 1)) as source:
        for index in range(1, count + 1):
            band = np.where(pixels == pixels[0, 0], pixels, pixels * index)
            source.write(band.astype(dtype), index)
    left_window = {"x": 0, "y": 0, "width": 256, "height": height}
    right_window = {**left_window, "x": 256}
    early = _read(path, right_window)
    overview = _read(path)
    stretch = overview["metadata"]["display"]["stretch"]
    assert early["metadata"]["display"]["stretch"] == stretch
    assert stretch["usage"] == "display_only" and stretch["basis"] == "source_sample_percentile_2_98"
    if height == 32:
        with rasterio.open(path) as source:
            for band in stretch["bands"]:
                samples = source.read(band["index"], out_shape=(16, 256))
                mask = source.read_masks(band["index"], out_shape=(16, 256))
                low, high = np.percentile(samples[(mask != 0) & np.isfinite(samples)], [2, 98])
                assert (band["low"], band["high"]) == pytest.approx((low, high))

    def no_recompute(*args):
        pytest.fail("A later window must use its source header, not compute a range.")

    monkeypatch.setattr("geo.raster_window._overview_range", no_recompute)
    left = _read(path, left_window, stretch)
    right = _read(path, right_window, stretch)
    np.testing.assert_array_equal(left["rgba"][:3, 1, 128:], right["rgba"][:3, 1, :128])
    np.testing.assert_array_equal(right["rgba"], early["rgba"])
    assert left["rgba"][3, 0, 0] == right["rgba"][3, 0, 0] == 0
    assert left["metadata"]["bands"][0]["validMax"] == 1020
    assert right["metadata"]["bands"][0]["validMin"] == 512
    assert left["metadata"]["display"] == right["metadata"]["display"] == overview["metadata"]["display"]


@pytest.mark.parametrize("count", [1, 3])
def test_uint8_interpreted_colour_is_byte_exact_in_adjacent_windows(tmp_path, count):
    path = _fixture(tmp_path / "bytes.tif", count=count)
    result = _read(path)
    assert result["metadata"]["display"] == {
        "bands": [1] if count == 1 else [1, 2, 3], "usage": "display_only", "scaling": "stored_uint8"}
    with rasterio.open(path) as source:
        expected = source.read()
    np.testing.assert_array_equal(result["rgba"][:3], np.repeat(expected, 3, axis=0) if count == 1 else expected)
    for x in (0, 16):
        window = _read(path, {"x": x, "y": 0, "width": 16, "height": 32})
        np.testing.assert_array_equal(window["rgba"][:3], result["rgba"][:3, :, x:x + 16])


@pytest.mark.parametrize("limits", [(None, 5), (8, 2), (False, 2), (0, float("inf"))])
def test_invalid_source_stretch_is_refused(tmp_path, limits):
    path = _fixture(tmp_path / "invalid-stretch.tif", dtype="float32")
    stretch = {"usage": "display_only", "basis": "source_overview_percentile_2_98",
               "bands": [{"index": 1, "low": limits[0], "high": limits[1]}]}
    with pytest.raises(InputError, match="^RASTER_STRETCH_INPUT:"):
        _read(path, stretch=stretch)


@pytest.mark.parametrize("side", [10_000, 30_000, 60_000])
@pytest.mark.parametrize("layout", ["stripped", "tiled", "overviews"])
def test_large_source_first_window_is_inside_native_deadline(tmp_path, record_property, side, layout):
    path = tmp_path / "large.tif"
    tiled = layout != "stripped"
    with rasterio.open(path, "w", driver="GTiff", width=side, height=side, count=1, dtype="uint16",
                       tiled=tiled, blockxsize=256 if tiled else side, blockysize=256 if tiled else 1,
                       SPARSE_OK=True, compress="deflate", BIGTIFF="YES",
                       transform=rasterio.transform.from_origin(0, side, 1, 1)) as source:
        for fraction in (0, 0.5, 1):
            x = int((side - 256) * fraction)
            y = int((side - 1) * fraction)
            source.write(np.arange(256, dtype="uint16").reshape(1, 256) + 1, 1,
                         window=rasterio.windows.Window(x, y, 256, 1))
        if layout == "overviews":
            source.build_overviews([math.ceil(side / 256)], Resampling.nearest)
    started = time.perf_counter()
    result = _read(path)
    elapsed = time.perf_counter() - started
    record_property("first_window_seconds", round(elapsed, 4))
    assert elapsed < 30  # Leave headroom inside the 100-second native and 150-second job deadlines.
    assert result["metadata"]["sourceWidth"] == result["metadata"]["sourceHeight"] == side
    basis = "source_overview_percentile_2_98" if layout == "overviews" else "source_sample_percentile_2_98"
    assert result["metadata"]["display"]["stretch"]["basis"] == basis


def test_large_eight_band_float64_source_keeps_window_memory_bound(tmp_path, record_property):
    path = tmp_path / "eight-float64.tif"
    with rasterio.open(path, "w", driver="GTiff", width=60_000, height=60_000, count=8, dtype="float64",
                       tiled=True, blockxsize=256, blockysize=256, interleave="band", SPARSE_OK=True,
                       compress="deflate", BIGTIFF="YES",
                       transform=rasterio.transform.from_origin(0, 60_000, 1, 1)) as source:
        pixels = np.arange(256 * 256, dtype="float64").reshape(256, 256) / 100
        for index in range(1, 9):
            source.write(pixels * index, index, window=rasterio.windows.Window(0, 0, 256, 256))
    started = time.perf_counter()
    result = _read(path)
    elapsed = time.perf_counter() - started
    record_property("first_window_seconds", round(elapsed, 4))
    assert elapsed < 30
    assert len(result["metadata"]["bands"]) == 8
    assert result["metadata"]["display"]["bands"] == [1, 2, 3]
    assert MAX_WINDOW_RAW_BYTES == 2 * 1024 * 1024


@pytest.mark.parametrize("layout", ["stripped", "tiled"])
def test_source_sample_reads_only_bounded_spread_blocks(tmp_path, layout):
    tiled = layout == "tiled"
    path = _fixture(tmp_path / "sample.tif", side=1024, count=1, dtype="float64", tiled=tiled,
                    blockxsize=128 if tiled else 1024, blockysize=128 if tiled else 8)
    with rasterio.open(path) as source:
        calls = []

        class TrackedSource:
            def __getattr__(self, name):
                return getattr(source, name)

            def read(self, indexes, **kwargs):
                calls.append(kwargs)
                return source.read(indexes, **kwargs)

        low, high = _sample_range(TrackedSource(), 1)
        assert low is not None and high >= low
        assert 1 < len(calls) <= MAX_SAMPLE_BLOCKS
        windows = [call["window"] for call in calls]
        assert min(w.row_off for w in windows) == 0
        assert max(w.row_off + w.height for w in windows) == source.height
        assert min(w.col_off for w in windows) == 0
        assert max(w.col_off + w.width for w in windows) == source.width
        assert sum(w.width * w.height * 8 for w in windows) <= MAX_DECODE_BYTES
        assert all(max(call["out_shape"]) <= MAX_SAMPLE_SIDE for call in calls)


def test_internal_overview_stretch_never_samples_the_base_image(tmp_path, monkeypatch):
    path = _fixture(tmp_path / "internal.tif", side=1024, count=1, dtype="float32", tiled=True,
                    blockxsize=128, blockysize=128)
    with rasterio.open(path, "r+") as source:
        source.build_overviews([8], Resampling.average)
    with rasterio.open(path, OVERVIEW_LEVEL=0) as overview:
        values = overview.read(1)
        expected = _range(values, np.isfinite(values))

    def no_base_sample(*args):
        pytest.fail("A small internal overview must not sample base-image blocks.")

    monkeypatch.setattr("geo.raster_window._sample_range", no_base_sample)
    with rasterio.open(path) as source:
        assert _overview_range(source, 1) == pytest.approx(expected)


def test_large_internal_overview_is_itself_sampled_with_bounds(tmp_path, monkeypatch):
    path = _fixture(tmp_path / "coarse-overview.tif", side=1024, count=1, dtype="float32", tiled=True,
                    blockxsize=128, blockysize=128)
    with rasterio.open(path, "r+") as source:
        source.build_overviews([2], Resampling.average)
    sampled = []

    def check_overview(source, index):
        sampled.append((source.width, source.height))
        return _sample_range(source, index)

    monkeypatch.setattr("geo.raster_window._sample_range", check_overview)
    with rasterio.open(path) as source:
        low, high = _overview_range(source, 1)
        assert low is not None and high >= low
    assert sampled == [(512, 512)]


@pytest.mark.parametrize("width,height,count", [(0, 1, 1), (1, 0, 1), (1, 1, 0)])
def test_zero_dimensions_or_bands_stay_refused(width, height, count):
    source = SimpleNamespace(driver="GTiff", width=width, height=height, count=count)
    with pytest.raises(InputError, match=r"^RASTER_DIMENSIONS: [A-Z][^\n]+\.$"):
        _read_native(source, None, None)


@pytest.mark.parametrize("count,block_height", [(1, 1024), (8, 128)])
def test_outside_window_and_oversized_decode_block_stay_refused(tmp_path, count, block_height):
    path = _fixture(tmp_path / "bounds.tif", count=1)
    with pytest.raises(InputError, match=r"^RASTER_WINDOW_OUT_OF_BOUNDS: [A-Z][^\n]+\.$"):
        _read(path, {"x": 32, "y": 0, "width": 1, "height": 1})
    # A compressed single giant strip must not bypass the decode-memory bound via a tiny output shape.
    path = tmp_path / "giant-strip.tif"
    with rasterio.open(path, "w", driver="GTiff", width=10_000, height=10_000, count=count, dtype="float64",
                       blockysize=block_height, interleave="pixel", SPARSE_OK=True, compress="deflate",
                       transform=rasterio.transform.from_origin(0, 10_000, 1, 1)):
        pass
    with pytest.raises(InputError, match=r"^RASTER_MEMORY_LIMIT: [A-Z][^\n]+\.$"):
        _read(path, {"x": 0, "y": 0, "width": 1, "height": 1})


@pytest.mark.parametrize("basis", [[], {}, "window_percentile_2_98", None])
def test_invalid_stretch_basis_keeps_the_input_refusal(tmp_path, basis):
    path = _fixture(tmp_path / "invalid-basis.tif", count=1, dtype="float32")
    stretch = {"usage": "display_only", "basis": basis, "bands": [{"index": 1, "low": 0, "high": 1}]}
    with pytest.raises(InputError, match="^RASTER_STRETCH_INPUT:"):
        _read(path, stretch=stretch)


def test_stretch_uses_percentiles_not_extremes_and_handles_float64_range():
    pixels = np.arange(100, dtype="float64")
    pixels[-1] = 1e300
    valid = np.ones(100, dtype=bool)
    preview = _stretch(pixels, valid, *_range(pixels, valid))
    assert preview[1] == 0 and preview[50] > 100 and preview[-2] == 255
    extremes = np.array([-np.finfo("float64").max, np.finfo("float64").max])
    valid = np.ones(2, dtype=bool)
    assert _stretch(extremes, valid, *_range(extremes, valid)).tolist() == [0, 255]


class _DecodeTracked:
    """Conservative decoded-block accounting, including repeated reads, not compressed file bytes."""

    def __init__(self, source):
        self.source = source
        self.decoded_bytes = 0
        self.calls = []

    def __getattr__(self, name):
        return getattr(self.source, name)

    def read(self, indexes, **kwargs):
        from geo.raster_window import _block_bytes

        window = kwargs["window"]
        bh, bw = self.source.block_shapes[indexes[0] - 1]
        rows = math.ceil((window.row_off + window.height) / bh) - math.floor(window.row_off / bh)
        columns = math.ceil((window.col_off + window.width) / bw) - math.floor(window.col_off / bw)
        decoded = rows * columns * _block_bytes(self.source, indexes[0])
        if self.source.profile["interleave"] != "pixel":
            decoded *= len(indexes)
        assert decoded <= MAX_DECODE_BYTES
        self.decoded_bytes += decoded
        self.calls.append(indexes)
        return self.source.read(indexes, **kwargs)


def test_792_band_contiguous_cube_batches_display_reads(tmp_path, record_property):
    path = tmp_path / "cube.tif"
    with rasterio.open(path, "w", driver="GTiff", width=640, height=360, count=792, dtype="float64",
                       interleave="pixel", blockysize=1, compress="lzw",
                       transform=rasterio.transform.from_origin(0, 360, 1, 1)) as source:
        row = np.arange(792 * 640, dtype="float64").reshape(792, 1, 640) / 32
        for y in range(360):
            source.write(row + y, window=rasterio.windows.Window(0, y, 640, 1))
    with rasterio.Env(GDAL_CACHEMAX=MAX_DECODE_BYTES), rasterio.open(path) as source:
        tracked = _DecodeTracked(source)
        started = time.perf_counter()
        result = _read_native(tracked, None, None)
        elapsed = time.perf_counter() - started
        record_property("first_window_seconds", round(elapsed, 4))
        record_property("decoded_block_bytes_upper_bound", tracked.decoded_bytes)
        assert elapsed < 30
        assert all(indexes == [1, 2, 3] for indexes in tracked.calls)
        assert result["metadata"]["sourceBands"] == 792
        assert [band["index"] for band in result["metadata"]["bands"]] == [1, 2, 3]
        assert result["metadata"]["display"]["bandMetadata"] == "display_bands_only"
        assert "overview" not in result["metadata"]["display"]
        assert len(json.dumps(result["metadata"]).encode()) < 32 * 1024
        with MemoryFile(base64.b64decode(result["artifactBase64"])) as memory, memory.open() as output:
            assert output.read(4).min() == 255


def test_30_gigapixel_two_bit_first_window_is_sampled_but_later_pixels_are_exact(tmp_path, record_property):
    path = tmp_path / "two-bit.tif"
    with rasterio.open(path, "w", driver="GTiff", width=228_531, height=131_847, count=1, dtype="uint8",
                       nbits=2, tiled=True, blockxsize=128, blockysize=128, compress="lzw", SPARSE_OK=True,
                       transform=rasterio.transform.from_origin(0, 131_847, 1, 1)) as source:
        pixels = np.ones((128, 128), dtype="uint8")
        pixels[0, :4] = [0, 1, 2, 3]
        source.write(pixels, 1, window=rasterio.windows.Window(0, 0, 128, 128))
    with rasterio.Env(GDAL_CACHEMAX=MAX_DECODE_BYTES), rasterio.open(path) as source:
        tracked = _DecodeTracked(source)
        started = time.perf_counter()
        result = _read_native(tracked, None, None)
        elapsed = time.perf_counter() - started
        record_property("first_window_seconds", round(elapsed, 4))
        record_property("decoded_block_bytes_upper_bound", tracked.decoded_bytes)
        assert elapsed < 30
        assert len(tracked.calls) <= 2 * MAX_SAMPLE_BLOCKS
        assert tracked.decoded_bytes <= 2 * MAX_SAMPLE_BLOCKS * 128 ** 2
        display = result["metadata"]["display"]
        assert display["overview"] == {"sampling": "spread_blocks", "usage": "display_only"}
        # Force the collapsed sample case independent of the sparse source's zero blocks.
        stretch = {"usage": "display_only", "basis": "source_sample_percentile_2_98",
                   "bands": [{"index": 1, "low": 0, "high": 3}]}
        with MemoryFile(base64.b64decode(result["artifactBase64"])) as memory, memory.open() as output:
            alpha = output.read(4)
            assert 0 < np.count_nonzero(alpha) <= 64 and np.any(alpha == 0)
        later = _read_native(tracked, {"x": 0, "y": 0, "width": 128, "height": 128, "step": 1}, stretch)
        assert "overview" not in later["metadata"]["display"]
        with MemoryFile(base64.b64decode(later["artifactBase64"])) as memory, memory.open() as output:
            assert output.read(1)[0, :4].tolist() == [0, 85, 170, 255]
            assert output.read(4).min() == 255


@pytest.mark.parametrize("dtype,nbits,expected", [("uint8", 2, (0, 3)), ("uint8", 4, (0, 15)),
                                                    ("uint16", 16, (0, 65535)),
                                                    ("int16", 16, (-32768, 32767))])
def test_collapsed_integer_percentiles_use_stated_sample_range(tmp_path, dtype, nbits, expected):
    path = _fixture(tmp_path / "constant.tif", count=1, dtype=dtype, nbits=nbits)
    with rasterio.open(path, "r+") as source:
        pixels = np.ones((32, 32), dtype=dtype)
        pixels[0, :2] = expected
        source.write(pixels, 1)
    result = _read(path)
    band = result["metadata"]["display"]["stretch"]["bands"][0]
    assert (band["low"], band["high"]) == expected
    assert result["rgba"][0, 0, :2].tolist() == [0, 255]


def test_partitioned_contiguous_reads_keep_nearest_sample_centres(tmp_path):
    from geo.raster_window import _read_pixels

    path = _fixture(tmp_path / "strips.tif", count=32, side=512, dtype="float64", blockysize=8)
    with rasterio.open(path) as source:
        tracked = _DecodeTracked(source)
        window = rasterio.windows.Window(3, 5, 501, 503)
        actual, masks = _read_pixels(tracked, [1, 2, 3], window, 213, 217)
        expected = source.read([1, 2, 3], window=window, out_shape=(3, 217, 213))
        np.testing.assert_array_equal(actual, expected)
        assert masks.min() == 255
        assert len(tracked.calls) > 1


def test_multiband_internal_overview_keeps_its_exact_preview(tmp_path):
    path = _fixture(tmp_path / "rgb-overview.tif", side=512, dtype="float32", count=3,
                    tiled=True, blockxsize=128, blockysize=128)
    with rasterio.open(path, "r+") as source:
        source.build_overviews([2, 4], Resampling.average)
    result = _read(path)
    display = result["metadata"]["display"]
    assert "overview" not in display
    assert display["stretch"]["basis"] == "source_overview_percentile_2_98"
    with rasterio.open(path, OVERVIEW_LEVEL=1) as source:
        for index, band in enumerate(display["stretch"]["bands"], 1):
            values = source.read(index)
            assert (band["low"], band["high"]) == pytest.approx(_range(values, np.isfinite(values)))


def test_metadata_budget_still_refuses_oversized_descriptions(tmp_path, monkeypatch):
    path = _fixture(tmp_path / "metadata.tif")
    monkeypatch.setattr("geo.raster_window.MAX_METADATA_BYTES", 500)
    with pytest.raises(InputError, match=r"^RASTER_METADATA_LIMIT: [A-Z][^\n]+\.$"):
        _read(path)
