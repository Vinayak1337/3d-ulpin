"""Generated test-only pixels exercise source layouts, never survey or legal facts."""
import base64
import hashlib
import struct
import uuid
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.enums import ColorInterp, Resampling
from rasterio.io import MemoryFile

from geo.raster_window import MAX_WINDOW_RAW_BYTES, _stretch, read_raster_window
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


def _read(path: Path, window=None) -> dict:
    data = path.read_bytes()
    digest, source_id = hashlib.sha256(data).hexdigest(), str(uuid.uuid4())
    key = f"sources/{source_id}/{digest}"
    result = read_raster_window({"sourceId": source_id, "objectKey": key, "sha256": digest,
                                 "bytes": len(data), "window": window}, s3=_S3(key, data))
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
    assert result["rgba"][:3].max() == 255 and result["rgba"][3].min() == 255


@pytest.mark.parametrize("count,side,dtype", [(1, 32, "int16"), (2, 32, "uint16"), (5, 32, "uint8"),
                                             (8, 256, "float64"), (64, 32, "uint8")])
def test_all_bands_described_but_only_display_bands_allocated(tmp_path, count, side, dtype):
    path = _fixture(tmp_path / "bands.tif", count=count, side=side, dtype=dtype, interleave="band")
    result = _read(path)
    assert result["metadata"]["sourceBands"] == len(result["metadata"]["bands"]) == count
    assert result["metadata"]["display"]["bands"] == ([1] if count < 3 else [1, 2, 3])
    assert MAX_WINDOW_RAW_BYTES == 2 * 1024 * 1024


def test_colour_interpretations_choose_rgb_not_first_three(tmp_path):
    path = _fixture(tmp_path / "colours.tif", count=5)
    with rasterio.open(path, "r+") as source:
        source.colorinterp = (ColorInterp.undefined, ColorInterp.blue, ColorInterp.undefined,
                              ColorInterp.red, ColorInterp.green)
    result = _read(path)
    assert result["metadata"]["display"]["bands"] == [4, 5, 2]
    with rasterio.open(path) as source:
        for channel, index in enumerate([4, 5, 2]):
            pixels = source.read(index)
            np.testing.assert_array_equal(result["rgba"][channel], _stretch(pixels, pixels != 0))


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
                                       ("codec", "RASTER_COMPRESSION"), ("metadata", "RASTER_METADATA_LIMIT"),
                                       ("png", "RASTER_FORMAT"), ("step", "RASTER_WINDOW_STEP")])
def test_refusals_have_specific_code_and_plain_sentence(tmp_path, kind, code):
    path = tmp_path / "refused.tif"
    if kind == "broken":
        path.write_bytes(b"not a TIFF")
    elif kind == "png":
        _fixture(path, driver="PNG")
    elif kind == "complex":
        _fixture(path, dtype="complex64")
    elif kind == "metadata":
        _fixture(path, count=256)
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


def test_stretch_uses_percentiles_not_extremes_and_handles_float64_range():
    pixels = np.arange(100, dtype="float64")
    pixels[-1] = 1e300
    preview = _stretch(pixels, np.ones(100, dtype=bool))
    assert preview[1] == 0 and preview[50] > 100 and preview[-2] == 255
    extremes = np.array([-np.finfo("float64").max, np.finfo("float64").max])
    assert _stretch(extremes, np.ones(2, dtype=bool)).tolist() == [0, 255]
