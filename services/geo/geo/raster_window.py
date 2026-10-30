"""Source-bound GeoTIFF previews. Originals are cached, never decoded as a whole array."""
from __future__ import annotations

import base64
import hashlib
import json
import math
import re
from typing import Any, NoReturn

import boto3
from botocore.config import Config
import numpy as np
import rasterio
from rasterio.enums import ColorInterp, Resampling
from rasterio.io import MemoryFile
from rasterio.windows import Window, bounds, transform
from pyproj import CRS

from . import settings
from .validation import InputError
from .verified_cache import verified_source

MAX_SOURCE_BYTES = 2 * 1024 ** 3
MAX_WINDOW_SIDE = 256
MAX_SAMPLE_BLOCKS = 16
MAX_SAMPLE_SIDE = 64
MAX_DESCRIBED_BANDS = 64
MAX_FIRST_PREVIEW_BLOCKS = 4096
MAX_DECODE_BYTES = 32 * 1024 * 1024
STRETCH_BASES = ("source_overview_percentile_2_98", "source_sample_percentile_2_98")
MAX_WINDOW_RAW_BYTES = 2 * 1024 * 1024
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
MAX_METADATA_BYTES = 32 * 1024
SAMPLE_TYPES = {"uint8", "uint16", "int16", "uint32", "int32", "float32", "float64"}
KEY = re.compile(r"^(?:sources|large-originals)/([0-9a-f-]{36})/([0-9a-f]{64})$")
HASH = re.compile(r"^[0-9a-f]{64}$")


def _refuse(code: str, sentence: str) -> NoReturn:
    raise InputError(f"{code}: {sentence}")


def _window(value: Any) -> dict | None:
    if value is None:
        return None
    if (not isinstance(value, dict) or not {"x", "y", "width", "height"} <= set(value)
            or set(value) - {"x", "y", "width", "height", "step"}):
        _refuse("RASTER_WINDOW_INPUT", "Select an exact bounded pixel window.")
    if any(isinstance(v, bool) or not isinstance(v, int) for v in value.values()):
        _refuse("RASTER_WINDOW_INPUT", "Pixel window coordinates must be integers.")
    x, y, width, height = (value[k] for k in ("x", "y", "width", "height"))
    if x < 0 or y < 0 or width < 1 or height < 1 or width > MAX_WINDOW_SIDE or height > MAX_WINDOW_SIDE:
        _refuse("RASTER_WINDOW_LIMIT", "Pixel window exceeds the 256 by 256 reader limit.")
    if not 1 <= value.get("step", 1) <= 4096:
        _refuse("RASTER_WINDOW_STEP", "Pixel window step must be a whole number from 1 to 4096.")
    return {**value, "step": value.get("step", 1)}


def _vertical(crs: Any) -> str | None:
    if crs is None:
        return None
    try:
        parsed = CRS.from_wkt(crs.to_wkt())
        vertical = parsed if parsed.is_vertical else next((part for part in parsed.sub_crs_list if part.is_vertical), None)
        return vertical.name[:500] if vertical is not None else None
    except Exception:
        return None


def _band(index: int, dtype: str, nodata: float | None, nodata_kind: str,
          values: np.ndarray, mask: np.ndarray) -> dict:
    valid = values[mask != 0]
    band = {"index": index, "dtype": dtype, "nodata": nodata, "nodataKind": nodata_kind,
            "maskedPixels": int(np.count_nonzero(mask == 0)), "validPixels": int(valid.size)}
    # A non-finite unmasked value has no finite JSON range; do not invent a narrower one.
    if np.isfinite(valid).all():
        band.update(validMin=float(valid.min()) if valid.size else None,
                    validMax=float(valid.max()) if valid.size else None)
    return band


def _metadata(src: Any, selected: dict, window: Window, clipped: Any,
              bands: list[dict], display: dict) -> dict:
    wkt = src.crs.to_wkt() if src.crs else None
    if wkt and len(wkt) > 8192:
        _refuse("RASTER_CRS_LIMIT", "Raster CRS metadata exceeds the bounded reference profile.")
    authority = src.crs.to_authority() if src.crs else None
    vertical = _vertical(src.crs)
    return {
        "sourceWidth": src.width, "sourceHeight": src.height, "sourceBands": src.count,
        "sourceTransform": list(src.transform)[:6], "windowTransform": list(clipped)[:6],
        "sourceCrsWkt": wkt, "sourceCrsAuthority": ":".join(authority) if authority else None,
        "verticalReference": vertical, "verticalReferenceStatus": "known" if vertical else "unknown",
        "resolution": list(src.res), "window": selected, "nativeBounds": list(bounds(window, src.transform)),
        "bands": bands, "globalPlacement": "not_qualified",
        "display": display,
    }


def _artifact(src: Any, width: int, height: int, clipped: Any, rgba: np.ndarray) -> bytes:
    # Never copy source sample/height tags into stretched display bytes.
    with MemoryFile() as memory:
        with memory.open(driver="GTiff", width=width, height=height, count=4, dtype="uint8",
                         crs=src.crs, transform=clipped, compress="deflate", tiled=False,
                         interleave="pixel", photometric="RGB", alpha="YES") as output:
            output.write(rgba)
            output.colorinterp = (ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha)
            output.update_tags(usage="display_only", measurement="not_qualified", height="not_qualified")
        derivative = memory.read()
    if len(derivative) > MAX_OUTPUT_BYTES:
        _refuse("RASTER_ARTIFACT_LIMIT", "The display window exceeds the 4 MiB artifact budget.")
    return derivative


def _range(values: np.ndarray, valid: np.ndarray) -> tuple[float | None, float | None]:
    samples = values[valid].astype("float64")
    if not samples.size:
        return None, None
    scale = max(1.0, float(np.abs(samples).max()))
    if scale <= np.finfo("float64").max / 4:
        scale = 1.0
    low, high = np.percentile(samples / scale, [2, 98]) * scale
    return float(low), float(high)


def _stretch(values: np.ndarray, valid: np.ndarray, low: float | None, high: float | None) -> np.ndarray:
    out = np.zeros(values.shape, dtype="uint8")
    if valid.any():
        if low is not None and high is not None and high > low:
            scale = max(abs(low), abs(high))
            if scale <= np.finfo("float64").max / 4:
                scale = 1.0
            samples = values[valid].astype("float64") / scale
            # Clip before subtraction to avoid overflow from values outside the overview range.
            samples = (np.clip(samples, low / scale, high / scale) - low / scale) / (high / scale - low / scale)
            out[valid] = np.rint(samples * 255).astype("uint8")
        else:
            out[valid] = 128
    return out


def _block_bytes(src: Any, index: int) -> int:
    height, width = src.block_shapes[index - 1]
    size = np.dtype(src.dtypes[index - 1]).itemsize
    if src.profile.get("interleave") == "pixel":
        size = sum(np.dtype(dtype).itemsize for dtype in src.dtypes)
    return height * width * size


def _decode_bytes(src: Any, indexes: list[int]) -> int:
    sizes = [_block_bytes(src, i) for i in indexes]
    size = max(sizes) if src.profile.get("interleave") == "pixel" else sum(sizes)
    if size > MAX_DECODE_BYTES:
        _refuse("RASTER_MEMORY_LIMIT", "A source block exceeds the bounded decode-memory budget.")
    return size


def _sample_windows(src: Any, indexes: list[int]) -> list[Window]:
    limit = min(MAX_SAMPLE_BLOCKS, MAX_DECODE_BYTES // _decode_bytes(src, indexes))
    block_height, block_width = src.block_shapes[indexes[0] - 1]
    rows, columns = math.ceil(src.height / block_height), math.ceil(src.width / block_width)
    nx = min(columns, max(1, math.isqrt(limit)))
    ny = min(rows, limit // nx)
    return [Window(int(col) * block_width, int(row) * block_height,
                   min(block_width, src.width - int(col) * block_width),
                   min(block_height, src.height - int(row) * block_height))
            for row in np.linspace(0, rows - 1, ny, dtype=int)
            for col in np.linspace(0, columns - 1, nx, dtype=int)]


def _read_pixels(src: Any, indexes: list[int], window: Window,
                 width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    block_bytes = _decode_bytes(src, indexes)
    bh, bw = src.block_shapes[indexes[0] - 1]
    columns = math.ceil((window.col_off + window.width) / bw) - math.floor(window.col_off / bw)
    rows = math.ceil((window.row_off + window.height) / bh) - math.floor(window.row_off / bh)
    if columns * rows * block_bytes <= MAX_DECODE_BYTES:
        shape = (len(indexes), height, width)
        return (src.read(indexes=indexes, window=window, out_shape=shape, resampling=Resampling.nearest),
                src.read_masks(indexes=indexes, window=window, out_shape=shape, resampling=Resampling.nearest))
    # Partition the output grid, preserving the original nearest-neighbour sample centres.
    if width == height == 1:
        pixel = Window(math.floor(window.col_off + window.width / 2),
                       math.floor(window.row_off + window.height / 2), 1, 1)
        return _read_pixels(src, indexes, pixel, 1, 1)
    axis = 1 if height > 1 and (rows >= columns or width == 1) else 2
    length = height if axis == 1 else width
    cut = length // 2
    fraction = cut / length
    if axis == 1:
        first = Window(window.col_off, window.row_off, window.width, window.height * fraction)
        second = Window(window.col_off, window.row_off + first.height, window.width, window.height - first.height)
        a = _read_pixels(src, indexes, first, width, cut)
        b = _read_pixels(src, indexes, second, width, height - cut)
    else:
        first = Window(window.col_off, window.row_off, window.width * fraction, window.height)
        second = Window(window.col_off + first.width, window.row_off, window.width - first.width, window.height)
        a = _read_pixels(src, indexes, first, cut, height)
        b = _read_pixels(src, indexes, second, width - cut, height)
    return np.concatenate((a[0], b[0]), axis=axis), np.concatenate((a[1], b[1]), axis=axis)


def _sample_ranges(src: Any, indexes: list[int]) -> list[tuple[float | None, float | None]]:
    samples: list[list[np.ndarray]] = [[] for _ in indexes]
    for window in _sample_windows(src, indexes):
        values, masks = _read_pixels(src, indexes, window,
                                     min(int(window.width), MAX_SAMPLE_SIDE), min(int(window.height), MAX_SAMPLE_SIDE))
        for n in range(len(indexes)):
            valid = (masks[n] != 0) & np.isfinite(values[n])
            samples[n].append(values[n][valid])
    joined = [np.concatenate(parts) for parts in samples]
    return [_range(values, np.ones(values.shape, dtype=bool)) for values in joined]


def _sample_range(src: Any, index: int) -> tuple[float | None, float | None]:
    return _sample_ranges(src, [index])[0]


def _overview_range(src: Any, index: int) -> tuple[float | None, float | None]:
    overviews = src.overviews(index)
    if overviews:
        # Explicitly open the coarsest internal level; GDAL must not fall back to decoding the base image.
        with rasterio.open(src.name, OVERVIEW_LEVEL=len(overviews) - 1) as overview:
            return _bounded_range(overview, index)
    return _bounded_range(src, index)


def _bounded_range(src: Any, index: int) -> tuple[float | None, float | None]:
    if src.width * src.height > MAX_WINDOW_SIDE ** 2:
        return _sample_range(src, index)
    step = math.ceil(max(src.width, src.height) / MAX_WINDOW_SIDE)
    shape = (math.ceil(src.height / step), math.ceil(src.width / step))
    values, mask = _read_pixels(src, [index], Window(0, 0, src.width, src.height), shape[1], shape[0])
    return _range(values[0], (mask[0] != 0) & np.isfinite(values[0]))


def _overview_ranges(src: Any, indexes: list[int]) -> list[tuple[float | None, float | None]]:
    if len(indexes) == 1:
        return [_overview_range(src, indexes[0])]
    overviews = src.overviews(indexes[0])
    if overviews and all(src.overviews(i) == overviews for i in indexes):
        with rasterio.open(src.name, OVERVIEW_LEVEL=len(overviews) - 1) as overview:
            return _overview_ranges(overview, indexes)
    if src.width * src.height > MAX_WINDOW_SIDE ** 2:
        return _sample_ranges(src, indexes)
    step = math.ceil(max(src.width, src.height) / MAX_WINDOW_SIDE)
    values, masks = _read_pixels(src, indexes, Window(0, 0, src.width, src.height),
                                 math.ceil(src.width / step), math.ceil(src.height / step))
    return [_range(v, (m != 0) & np.isfinite(v)) for v, m in zip(values, masks)]


def _sampled_preview(src: Any, indexes: list[int], width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    values = np.zeros((len(indexes), height, width), dtype=src.dtypes[indexes[0] - 1])
    masks = np.zeros(values.shape, dtype="uint8")
    for window in _sample_windows(src, indexes):
        x = int(window.col_off * width / src.width)
        y = int(window.row_off * height / src.height)
        right = min(width, max(x + 1, math.ceil((window.col_off + window.width) * width / src.width)))
        bottom = min(height, max(y + 1, math.ceil((window.row_off + window.height) * height / src.height)))
        block, mask = _read_pixels(src, indexes, window, right - x, bottom - y)
        values[:, y:bottom, x:right] = block
        masks[:, y:bottom, x:right] = mask
    return values, masks


def _integer_range(src: Any, index: int, low: float | None,
                   high: float | None) -> tuple[float | None, float | None]:
    dtype = np.dtype(src.dtypes[index - 1])
    if low is not None and low == high and dtype.kind in "iu":
        info = np.iinfo(dtype)
        nbits = int(src.tags(index, ns="IMAGE_STRUCTURE").get("NBITS", dtype.itemsize * 8))
        if dtype.kind == "u" and 0 < nbits <= dtype.itemsize * 8:
            return 0.0, float(2 ** nbits - 1)
        return float(info.min), float(info.max)
    return low, high


def _display_stretch(value: Any) -> dict | None:
    if value is None:
        return None
    if (not isinstance(value, dict) or set(value) != {"usage", "basis", "bands"}
            or value["usage"] != "display_only" or value["basis"] not in STRETCH_BASES
            or not isinstance(value["bands"], list) or not 1 <= len(value["bands"]) <= 3):
        _refuse("RASTER_STRETCH_INPUT", "Use the source's display-only overview or sample stretch.")
    seen = set()
    for band in value["bands"]:
        if (not isinstance(band, dict) or set(band) != {"index", "low", "high"}
                or type(band["index"]) is not int or band["index"] < 1 or band["index"] in seen):
            _refuse("RASTER_STRETCH_INPUT", "Display stretch bands must be unique source band indices.")
        seen.add(band["index"])
        low, high = band["low"], band["high"]
        if low is None and high is None:
            continue
        if (any(type(v) not in (int, float) or not math.isfinite(v) for v in (low, high)) or high < low):
            _refuse("RASTER_STRETCH_INPUT", "Display stretch limits must be finite ordered source values or null.")
    return value


def _source_band(src: Any, index: int, values: np.ndarray, mask: np.ndarray) -> dict:
    nodata = src.nodatavals[index - 1]
    if nodata is None:
        kind = "absent"
    elif math.isfinite(float(nodata)):
        kind = "finite"
    elif math.isnan(float(nodata)):
        kind = "nan"
    else:
        kind = "positive_infinity" if float(nodata) > 0 else "negative_infinity"
    band = _band(index, src.dtypes[index - 1], float(nodata) if kind == "finite" else None, kind, values, mask)
    band["colorInterpretation"] = src.colorinterp[index - 1].name
    return band


def _display_bands(src: Any) -> tuple[list[int], list[int], bool]:
    colours = list(src.colorinterp)
    rgb = (ColorInterp.red, ColorInterp.green, ColorInterp.blue)
    if all(c in colours for c in rgb):
        chosen = [colours.index(c) + 1 for c in rgb]
    else:
        chosen = [1, 2, 3] if src.count >= 3 else [1]
    palette = colours[0] == ColorInterp.palette
    if palette:
        chosen = [1]
    stretched = [i for i in chosen if not palette and not (
        src.dtypes[i - 1] == "uint8" and colours[i - 1] in (*rgb, ColorInterp.gray)
        and "NBITS" not in src.tags(i, ns="IMAGE_STRUCTURE"))]
    return chosen, stretched, palette


def _validate_samples(src: Any, width: int, height: int) -> None:
    for index, dtype in enumerate(src.dtypes, 1):
        if dtype not in SAMPLE_TYPES:
            _refuse("RASTER_SAMPLE_TYPE", "This raster sample type cannot be drawn as a numeric preview.")
        if np.dtype(dtype).itemsize * width * height > MAX_WINDOW_RAW_BYTES:
            _refuse("RASTER_MEMORY_LIMIT", "The selected band exceeds the raw-memory budget.")
        if _block_bytes(src, index) > MAX_DECODE_BYTES:
            _refuse("RASTER_MEMORY_LIMIT", "A source block exceeds the bounded decode-memory budget.")


def _preview(src: Any, window: Window, width: int, height: int,
             stretch: dict | None, sampled: bool = False) -> tuple[np.ndarray, list[dict], dict]:
    chosen, stretched, palette = _display_bands(src)
    _validate_samples(src, width, height)
    if stretch is not None and [b["index"] for b in stretch["bands"]] != stretched:
        _refuse("RASTER_STRETCH_INPUT", "Display stretch must describe exactly the source's numeric display bands.")
    ranges = []
    basis = stretch["basis"] if stretch else (
        "source_overview_percentile_2_98" if stretched and all(src.overviews(i) for i in stretched)
        else "source_sample_percentile_2_98")
    rgba = np.zeros((4, height, width), dtype="uint8")
    rgba[3] = 255
    bands, metadata_bytes = [], 0
    # Full per-band window statistics cannot fit the result budget for hyperspectral cubes.
    described = list(range(1, src.count + 1)) if src.count <= MAX_DESCRIBED_BANDS else chosen
    values_all, masks_all = (_sampled_preview(src, chosen, width, height) if sampled
                             else _read_pixels(src, chosen, window, width, height))
    computed = dict(zip(stretched, _overview_ranges(src, stretched))) if stretched and not stretch else {}
    for index in described:
        if index in chosen:
            values, mask = values_all[chosen.index(index)], masks_all[chosen.index(index)]
        else:
            other, other_mask = (_sampled_preview(src, [index], width, height) if sampled
                                 else _read_pixels(src, [index], window, width, height))
            values, mask = other[0], other_mask[0]
        band = _source_band(src, index, values, mask)
        metadata_bytes += len(json.dumps(band))
        if metadata_bytes > MAX_METADATA_BYTES:
            _refuse("RASTER_METADATA_LIMIT", "All band descriptions do not fit the bounded result budget.")
        bands.append(band)
        if index in chosen:
            valid = (mask != 0) & np.isfinite(values)
            rgba[3] = np.minimum(rgba[3], np.where(valid, mask, 0).astype("uint8"))
            if palette:
                _palette(src, values, rgba)
            else:
                if index in stretched:
                    limits = next((b for b in stretch["bands"] if b["index"] == index), None) if stretch else None
                    low, high = (limits["low"], limits["high"]) if limits else _integer_range(
                        src, index, *computed[index])
                    ranges.append({"index": index, "low": low, "high": high})
                    channel = _stretch(values, valid, low, high)
                else:
                    channel = values
                for target in ([0, 1, 2] if len(chosen) == 1 else [chosen.index(index)]):
                    rgba[target] = channel
    display = _display_metadata(src, chosen, palette, ranges, basis, sampled)
    return rgba, bands, display


def _display_metadata(src: Any, chosen: list[int], palette: bool, ranges: list[dict],
                      basis: str, sampled: bool) -> dict:
    scaling = "stored_uint8"
    if palette:
        scaling = "palette"
    elif ranges:
        scaling = "source_percentile_2_98"
    display = {"bands": chosen, "usage": "display_only", "scaling": scaling}
    if src.count > MAX_DESCRIBED_BANDS:
        display["bandMetadata"] = "display_bands_only"
    if sampled:
        display["overview"] = {"sampling": "spread_blocks", "usage": "display_only"}
    if ranges:
        # Keep the request's band order, including interpreted RGB that is not stored in band order.
        display["stretch"] = {"usage": "display_only", "basis": basis,
                              "bands": sorted(ranges, key=lambda b: chosen.index(b["index"]))}
    return display


def _palette(src: Any, values: np.ndarray, rgba: np.ndarray) -> None:
    if src.dtypes[0] not in {"uint8", "uint16"}:
        _refuse("RASTER_PALETTE", "The raster palette needs unsigned 8-bit or 16-bit sample indices.")
    try:
        colours = src.colormap(1)
    except ValueError:
        _refuse("RASTER_PALETTE", "The raster palette is missing or unreadable.")
    if not colours or max(colours) > 65535:
        _refuse("RASTER_PALETTE", "The raster palette exceeds the supported 16-bit colour table.")
    lookup = np.zeros((max(colours) + 1, 4), dtype="uint8")
    for value, colour in colours.items():
        lookup[value] = colour
    if any(int(value) not in colours for value in np.unique(values)):
        _refuse("RASTER_PALETTE", "A raster sample has no colour in its palette.")
    mapped = lookup[values]
    rgba[:3] = mapped[:, :, :3].transpose(2, 0, 1)
    rgba[3] = np.minimum(rgba[3], mapped[:, :, 3])


def _read_native(src: Any, requested: dict | None, stretch: dict | None) -> dict:
    if src.driver != "GTiff":
        _refuse("RASTER_FORMAT", "Only native GeoTIFF sources are supported by this reader.")
    if src.width < 1 or src.height < 1 or src.count < 1:
        _refuse("RASTER_DIMENSIONS", "Raster dimensions and band count must be positive.")
    step = math.ceil(max(src.width, src.height) / MAX_WINDOW_SIDE)
    if requested is None and step > 4096:
        _refuse("RASTER_WINDOW_STEP", "The overview needs a sampling step above the reader's 4096 limit.")
    selected = requested or {"x": 0, "y": 0, "width": math.ceil(src.width / step),
                             "height": math.ceil(src.height / step), "step": step}
    x, y, width, height, step = (selected[k] for k in ("x", "y", "width", "height", "step"))
    if x + (width - 1) * step >= src.width or y + (height - 1) * step >= src.height:
        _refuse("RASTER_WINDOW_OUT_OF_BOUNDS", "Pixel window is outside the retained raster dimensions.")
    window = Window(x, y, min(width * step, src.width - x), min(height * step, src.height - y))
    block_height, block_width = src.block_shapes[0]
    block_count = math.ceil(src.width / block_width) * math.ceil(src.height / block_height)
    # Only the unsolicited whole-extent preview may leave unread pixels transparent.
    sampled = requested is None and not src.overviews(1) and block_count > MAX_FIRST_PREVIEW_BLOCKS
    rgba, bands, display = _preview(src, window, width, height, stretch, sampled)
    clipped = transform(window, src.transform) * src.transform.scale(window.width / width, window.height / height)
    metadata = _metadata(src, selected, window, clipped, bands, display)
    if len(json.dumps(metadata).encode("utf-8")) > MAX_METADATA_BYTES:
        _refuse("RASTER_METADATA_LIMIT", "Raster metadata does not fit the bounded result budget.")
    derivative = _artifact(src, width, height, clipped, rgba)
    return {"metadata": metadata,
            "artifactBase64": base64.b64encode(derivative).decode("ascii"),
            "artifactSha256": hashlib.sha256(derivative).hexdigest(), "artifactBytes": len(derivative)}


def read_raster_window(data: Any, s3: Any = None) -> dict:
    if (not isinstance(data, dict) or set(data) - {"displayStretch"} != {
            "sourceId", "objectKey", "sha256", "bytes", "window"}):
        _refuse("RASTER_SOURCE_INPUT", "Raster reader requires exact retained-source pins and a pixel window.")
    source_id, key, digest, size = (data[k] for k in ("sourceId", "objectKey", "sha256", "bytes"))
    match = KEY.fullmatch(key) if isinstance(key, str) else None
    if (not match or match.group(1) != source_id or not isinstance(digest, str)
            or not HASH.fullmatch(digest) or match.group(2) != digest):
        _refuse("RASTER_SOURCE_INPUT", "Raster object key must match its retained source ID and SHA-256.")
    if isinstance(size, bool) or not isinstance(size, int) or size < 1 or size > MAX_SOURCE_BYTES:
        _refuse("RASTER_SOURCE_LIMIT", "This raster reader supports originals of at most 2 GiB.")
    requested = _window(data["window"])
    stretch = _display_stretch(data.get("displayStretch"))
    client = s3 or boto3.client("s3", endpoint_url=settings.S3_ENDPOINT, aws_access_key_id=settings.S3_ACCESS_KEY,
                                aws_secret_access_key=settings.S3_SECRET_KEY, region_name=settings.S3_REGION,
                                config=Config(connect_timeout=5, read_timeout=30, retries={"max_attempts": 2}))
    try:
        with verified_source(size, digest, lambda: client.get_object(
                Bucket=settings.S3_BUCKET, Key=key)["Body"]) as path:
            with rasterio.Env(GDAL_CACHEMAX=MAX_DECODE_BYTES,
                              GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_PAM_ENABLED="NO",
                              GDAL_VRT_ENABLE_PYTHON="NO", GDAL_SKIP="VRT WMS WMTS HTTP"):
                with rasterio.open(path, "r") as src:
                    return _read_native(src, requested, stretch)
    except InputError as error:
        if str(error).startswith("RASTER_"):
            raise
        code = "RASTER_SOURCE_INTEGRITY" if "receipt" in str(error) else "RASTER_CACHE"
        _refuse(code, str(error))
    except (rasterio.errors.RasterioError, OSError, ValueError, TypeError) as error:
        message = str(error).lower()
        if "predictor" in message:
            _refuse("RASTER_PREDICTOR", "This raster predictor cannot be decoded by the installed reader.")
        if "sampleformat" in message or "datatype" in message or "values per sample" in message:
            _refuse("RASTER_SAMPLE_TYPE", "This raster sample type cannot be decoded by the installed reader.")
        if any(word in message for word in ("codec", "compression", "compressor")):
            _refuse("RASTER_COMPRESSION", "This raster compression cannot be decoded by the installed reader.")
        _refuse("RASTER_UNREADABLE", "The retained GeoTIFF header or pixel data is damaged or unreadable.")
