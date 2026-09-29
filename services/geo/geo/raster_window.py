"""Source-bound GeoTIFF windows. The original is spooled, never decoded as a whole array."""
from __future__ import annotations

import base64
import hashlib
import math
import re
import tempfile

import boto3
from botocore.config import Config
import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.windows import Window, bounds, transform
from pyproj import CRS

from . import settings
from .validation import InputError

MAX_SOURCE_BYTES = 16 * 1024 * 1024
MAX_SOURCE_PIXELS = 100_000_000
MAX_WINDOW_SIDE = 256
MAX_WINDOW_RAW_BYTES = 2 * 1024 * 1024
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
KEY = re.compile(r"^sources/([0-9a-f-]{36})/([0-9a-f]{64})$")
HASH = re.compile(r"^[0-9a-f]{64}$")


def _window(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"x", "y", "width", "height"}:
        raise InputError("Select an exact bounded pixel window.")
    if any(isinstance(v, bool) or not isinstance(v, int) for v in value.values()):
        raise InputError("Pixel window coordinates must be integers.")
    x, y, width, height = (value[k] for k in ("x", "y", "width", "height"))
    if x < 0 or y < 0 or width < 1 or height < 1 or width > MAX_WINDOW_SIDE or height > MAX_WINDOW_SIDE:
        raise InputError("Pixel window exceeds the 256 by 256 reader limit.")
    return value


def _vertical(crs):
    if crs is None:
        return None
    try:
        parsed = CRS.from_wkt(crs.to_wkt())
        vertical = parsed if parsed.is_vertical else next((part for part in parsed.sub_crs_list if part.is_vertical), None)
        return vertical.name[:500] if vertical is not None else None
    except Exception:
        return None


def read_raster_window(data, s3=None):
    if not isinstance(data, dict) or set(data) != {"sourceId", "objectKey", "sha256", "bytes", "window"}:
        raise InputError("Raster reader requires exact retained-source pins and a pixel window.")
    source_id, key, digest, size = (data[k] for k in ("sourceId", "objectKey", "sha256", "bytes"))
    match = KEY.fullmatch(key) if isinstance(key, str) else None
    if not match or match.group(1) != source_id or not isinstance(digest, str) or not HASH.fullmatch(digest) or match.group(2) != digest:
        raise InputError("Raster object key must match its retained source ID and SHA-256.")
    if isinstance(size, bool) or not isinstance(size, int) or size < 1 or size > MAX_SOURCE_BYTES:
        raise InputError("This raster reader supports originals of at most 16 MiB.")
    requested = _window(data["window"])
    client = s3 or boto3.client("s3", endpoint_url=settings.S3_ENDPOINT, aws_access_key_id=settings.S3_ACCESS_KEY,
                                aws_secret_access_key=settings.S3_SECRET_KEY, region_name=settings.S3_REGION,
                                config=Config(connect_timeout=5, read_timeout=30, retries={"max_attempts": 2}))
    obj = client.get_object(Bucket=settings.S3_BUCKET, Key=key)
    body = obj["Body"]
    source_hash = hashlib.sha256()
    count = 0
    try:
        with tempfile.TemporaryDirectory(prefix="raster-window-") as directory:
            path = f"{directory}/source.tif"
            with open(path, "wb") as target:
                for block in body.iter_chunks(chunk_size=1024 * 1024):
                    count += len(block)
                    if count > size:
                        raise InputError("Raster source exceeds its retained byte receipt.")
                    source_hash.update(block)
                    target.write(block)
            if count != size or source_hash.hexdigest() != digest:
                raise InputError("Raster source hash or byte count differs from its retained receipt.")
            try:
                with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_PAM_ENABLED="NO",
                                  GDAL_VRT_ENABLE_PYTHON="NO", GDAL_SKIP="VRT WMS WMTS HTTP"):
                    with rasterio.open(path, "r") as src:
                        if src.driver != "GTiff":
                            raise InputError("Only native GeoTIFF sources are supported by this reader.")
                        if src.width < 1 or src.height < 1 or src.width * src.height > MAX_SOURCE_PIXELS or src.count < 1 or src.count > 4:
                            raise InputError("Raster dimensions or band count exceed the bounded reader profile.")
                        x, y = (requested["x"], requested["y"]) if requested else (0, 0)
                        width = requested["width"] if requested else min(MAX_WINDOW_SIDE, src.width)
                        height = requested["height"] if requested else min(MAX_WINDOW_SIDE, src.height)
                        if x + width > src.width or y + height > src.height:
                            raise InputError("Pixel window is outside the retained raster dimensions.")
                        if len(set(src.dtypes)) != 1 or np.dtype(src.dtypes[0]).itemsize * width * height * src.count > MAX_WINDOW_RAW_BYTES:
                            raise InputError("Raster sample types or selected window exceed the raw-memory budget.")
                        if not all(np.dtype(dtype).kind in "uif" for dtype in src.dtypes):
                            raise InputError("Raster sample type is unsupported for a native GeoTIFF window.")
                        if len(set(src.nodatavals)) != 1:
                            raise InputError("Band-specific nodata cannot be preserved by this GeoTIFF derivative.")
                        window = Window(x, y, width, height)
                        values = src.read(window=window)
                        masks = src.read_masks(window=window)
                        if not np.array_equal(masks, np.broadcast_to(masks[0], masks.shape)):
                            raise InputError("Band-specific masks cannot be preserved by this GeoTIFF derivative.")
                        profile = src.profile.copy()
                        profile.update(driver="GTiff", width=width, height=height, count=src.count,
                                       transform=transform(window, src.transform), compress="deflate", tiled=False)
                        for option in ("blockxsize", "blockysize", "interleave", "photometric"):
                            profile.pop(option, None)
                        with MemoryFile() as memory:
                            with memory.open(**profile) as output:
                                output.write(values)
                                output.write_mask(masks[0])
                            derivative = memory.read()
                        if len(derivative) > MAX_OUTPUT_BYTES:
                            raise InputError("The selected native window exceeds the 4 MiB artifact budget.")
                        affine = src.transform
                        clipped = transform(window, affine)
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
                        result = {
                            "sourceWidth": src.width, "sourceHeight": src.height, "sourceBands": src.count,
                            "sourceTransform": list(affine)[:6], "windowTransform": list(clipped)[:6],
                            "sourceCrsWkt": wkt, "sourceCrsAuthority": ":".join(authority) if authority else None,
                            "verticalReference": vertical, "verticalReferenceStatus": "known" if vertical else "unknown",
                            "resolution": list(src.res), "window": {"x": x, "y": y, "width": width, "height": height},
                            "nativeBounds": list(bounds(window, affine)),
                            "bands": [{"index": i + 1, "dtype": src.dtypes[i], "nodata": json_nodata,
                                       "nodataKind": nodata_kind,
                                       "maskedPixels": int(np.count_nonzero(masks[i] == 0)),
                                       "validPixels": int(np.count_nonzero(masks[i] != 0))} for i in range(src.count)],
                            "globalPlacement": "not_qualified",
                        }
                        return {"metadata": result, "artifactBase64": base64.b64encode(derivative).decode("ascii"),
                                "artifactSha256": hashlib.sha256(derivative).hexdigest(), "artifactBytes": len(derivative)}
            except InputError:
                raise
            except (rasterio.errors.RasterioError, OSError, ValueError, TypeError):
                raise InputError("The retained bytes are not a supported readable GeoTIFF.") from None
    finally:
        body.close()
