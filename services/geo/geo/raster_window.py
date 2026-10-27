"""Source-bound GeoTIFF previews. Originals are cached, never decoded as a whole array."""
from __future__ import annotations

import base64
import hashlib
import math
import re
from typing import Any

import boto3
from botocore.config import Config
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.io import MemoryFile
from rasterio.windows import Window, bounds, transform
from pyproj import CRS

from . import settings
from .validation import InputError
from .verified_cache import verified_source

MAX_SOURCE_BYTES = 2 * 1024 ** 3
MAX_SOURCE_PIXELS = 2_000_000_000
MAX_WINDOW_SIDE = 256
MAX_WINDOW_RAW_BYTES = 2 * 1024 * 1024
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
KEY = re.compile(r"^(?:sources|large-originals)/([0-9a-f-]{36})/([0-9a-f]{64})$")
HASH = re.compile(r"^[0-9a-f]{64}$")


def _window(value: Any) -> dict | None:
    if value is None:
        return None
    if (not isinstance(value, dict) or not {"x", "y", "width", "height"} <= set(value)
            or set(value) - {"x", "y", "width", "height", "step"}):
        raise InputError("Select an exact bounded pixel window.")
    if any(isinstance(v, bool) or not isinstance(v, int) for v in value.values()):
        raise InputError("Pixel window coordinates must be integers.")
    x, y, width, height = (value[k] for k in ("x", "y", "width", "height"))
    if x < 0 or y < 0 or width < 1 or height < 1 or width > MAX_WINDOW_SIDE or height > MAX_WINDOW_SIDE:
        raise InputError("Pixel window exceeds the 256 by 256 reader limit.")
    if not 1 <= value.get("step", 1) <= 4096:
        raise InputError("Pixel window step must be a whole number from 1 to 4096.")
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
              values: np.ndarray, masks: np.ndarray) -> dict:
    wkt = src.crs.to_wkt() if src.crs else None
    if wkt and len(wkt) > 8192:
        raise InputError("Raster CRS metadata exceeds the bounded reference profile.")
    authority = src.crs.to_authority() if src.crs else None
    vertical = _vertical(src.crs)
    nodata = src.nodatavals[0]
    nodata_kind = ("absent" if nodata is None else "finite" if math.isfinite(float(nodata))
                   else "nan" if math.isnan(float(nodata)) else
                   "positive_infinity" if float(nodata) > 0 else "negative_infinity")
    json_nodata = float(nodata) if nodata_kind == "finite" else None
    return {
        "sourceWidth": src.width, "sourceHeight": src.height, "sourceBands": src.count,
        "sourceTransform": list(src.transform)[:6], "windowTransform": list(clipped)[:6],
        "sourceCrsWkt": wkt, "sourceCrsAuthority": ":".join(authority) if authority else None,
        "verticalReference": vertical, "verticalReferenceStatus": "known" if vertical else "unknown",
        "resolution": list(src.res), "window": selected, "nativeBounds": list(bounds(window, src.transform)),
        "bands": [_band(i + 1, src.dtypes[i], json_nodata, nodata_kind, values[i], masks[i])
                  for i in range(src.count)], "globalPlacement": "not_qualified",
    }


def _artifact(src: Any, width: int, height: int, clipped: Any,
              values: np.ndarray, masks: np.ndarray) -> bytes:
    profile = src.profile.copy()
    profile.update(driver="GTiff", width=width, height=height, count=src.count,
                   transform=clipped, compress="deflate", tiled=False)
    for option in ("blockxsize", "blockysize", "interleave", "photometric"):
        profile.pop(option, None)
    with MemoryFile() as memory:
        with memory.open(**profile) as output:
            output.write(values)
            output.write_mask(masks[0])
        derivative = memory.read()
    if len(derivative) > MAX_OUTPUT_BYTES:
        raise InputError("The selected native window exceeds the 4 MiB artifact budget.")
    return derivative


def _read_native(src: Any, requested: dict | None) -> dict:
    if src.driver != "GTiff":
        raise InputError("Only native GeoTIFF sources are supported by this reader.")
    if (src.width < 1 or src.height < 1 or src.width * src.height > MAX_SOURCE_PIXELS
            or src.count < 1 or src.count > 4):
        raise InputError("Raster dimensions or band count exceed the bounded reader profile.")
    step = math.ceil(max(src.width, src.height) / MAX_WINDOW_SIDE)
    selected = requested or {"x": 0, "y": 0, "width": math.ceil(src.width / step),
                             "height": math.ceil(src.height / step), "step": step}
    x, y, width, height, step = (selected[k] for k in ("x", "y", "width", "height", "step"))
    if x + (width - 1) * step >= src.width or y + (height - 1) * step >= src.height:
        raise InputError("Pixel window is outside the retained raster dimensions.")
    if (len(set(src.dtypes)) != 1
            or np.dtype(src.dtypes[0]).itemsize * width * height * src.count > MAX_WINDOW_RAW_BYTES):
        raise InputError("Raster sample types or selected window exceed the raw-memory budget.")
    if not all(np.dtype(dtype).kind in "uif" for dtype in src.dtypes):
        raise InputError("Raster sample type is unsupported for a native GeoTIFF window.")
    if len(set(src.nodatavals)) != 1:
        raise InputError("Band-specific nodata cannot be preserved by this GeoTIFF derivative.")
    window = Window(x, y, min(width * step, src.width - x), min(height * step, src.height - y))
    shape = (src.count, height, width)
    values = src.read(window=window, out_shape=shape, resampling=Resampling.nearest)
    masks = src.read_masks(window=window, out_shape=shape, resampling=Resampling.nearest)
    if not np.array_equal(masks, np.broadcast_to(masks[0], masks.shape)):
        raise InputError("Band-specific masks cannot be preserved by this GeoTIFF derivative.")
    clipped = transform(window, src.transform) * src.transform.scale(window.width / width, window.height / height)
    derivative = _artifact(src, width, height, clipped, values, masks)
    return {"metadata": _metadata(src, selected, window, clipped, values, masks),
            "artifactBase64": base64.b64encode(derivative).decode("ascii"),
            "artifactSha256": hashlib.sha256(derivative).hexdigest(), "artifactBytes": len(derivative)}


def read_raster_window(data: Any, s3: Any = None) -> dict:
    if not isinstance(data, dict) or set(data) != {"sourceId", "objectKey", "sha256", "bytes", "window"}:
        raise InputError("Raster reader requires exact retained-source pins and a pixel window.")
    source_id, key, digest, size = (data[k] for k in ("sourceId", "objectKey", "sha256", "bytes"))
    match = KEY.fullmatch(key) if isinstance(key, str) else None
    if (not match or match.group(1) != source_id or not isinstance(digest, str)
            or not HASH.fullmatch(digest) or match.group(2) != digest):
        raise InputError("Raster object key must match its retained source ID and SHA-256.")
    if isinstance(size, bool) or not isinstance(size, int) or size < 1 or size > MAX_SOURCE_BYTES:
        raise InputError("This raster reader supports originals of at most 2 GiB.")
    requested = _window(data["window"])
    client = s3 or boto3.client("s3", endpoint_url=settings.S3_ENDPOINT, aws_access_key_id=settings.S3_ACCESS_KEY,
                                aws_secret_access_key=settings.S3_SECRET_KEY, region_name=settings.S3_REGION,
                                config=Config(connect_timeout=5, read_timeout=30, retries={"max_attempts": 2}))
    with verified_source(size, digest, lambda: client.get_object(Bucket=settings.S3_BUCKET, Key=key)["Body"]) as path:
        try:
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_PAM_ENABLED="NO",
                              GDAL_VRT_ENABLE_PYTHON="NO", GDAL_SKIP="VRT WMS WMTS HTTP"):
                with rasterio.open(path, "r") as src:
                    return _read_native(src, requested)
        except InputError:
            raise
        except (rasterio.errors.RasterioError, OSError, ValueError, TypeError):
            raise InputError("The retained bytes are not a supported readable GeoTIFF.") from None
