"""Hash-verified LAS/LAZ point-index batches preserving the source's native records."""
from __future__ import annotations

import base64
import hashlib
from pathlib import Path
import re
import tempfile
from typing import Any

import boto3
from botocore.config import Config
import laspy

from . import settings
from .validation import InputError

MAX_SOURCE_BYTES = 1024 ** 3
MAX_SOURCE_POINTS = 500_000_000
MAX_BATCH_POINTS = 32_768
MAX_ARTIFACT_BYTES = 2 * 1024 * 1024
RECORD_LENGTHS = {0: 20, 1: 28, 2: 26, 3: 34, 6: 30, 7: 36, 8: 38}
KEY = re.compile(r"^(?:sources|large-originals)/([0-9a-f-]{36})/([0-9a-f]{64})$")
HASH = re.compile(r"^[0-9a-f]{64}$")


def _batch(value: Any) -> dict | None:
    if value is None:
        return None
    if (not isinstance(value, dict) or not {"start", "count"} <= set(value)
            or set(value) - {"start", "count", "step"}):
        raise InputError("Select an exact bounded point-index batch.")
    start, count, step = value["start"], value["count"], value.get("step", 1)
    if (any(isinstance(v, bool) or not isinstance(v, int) for v in (start, count, step))
            or start < 0 or start >= MAX_SOURCE_POINTS or count < 1 or count > MAX_BATCH_POINTS
            or not 1 <= step <= 65_536):
        raise InputError("Point-index batch exceeds the bounded reader profile.")
    return {**value, "step": step}


def _source_path(body: Any, directory: str, size: int, digest: str) -> Path:
    from .verified_cache import verified_source

    with verified_source(size, digest, lambda: body) as path:
        with path.open("rb") as source:
            prefix = source.read(105)
        if len(prefix) != 105 or prefix[:4] != b"LASF":
            raise InputError("The retained bytes are not a supported readable LAS/LAZ source.")
        named = Path(directory) / ("source.laz" if prefix[104] & 0x80 else "source.las")
        try:
            named.hardlink_to(path)
        except OSError:
            raise InputError("The verified-original cache folder must be on the same disk "
                             "as the processor temporary folder.") from None
        return named


def _validate_header(header: laspy.LasHeader) -> None:
    fmt = header.point_format
    if (str(header.version) not in {"1.2", "1.3", "1.4"} or fmt.id not in RECORD_LENGTHS
            or (fmt.id >= 6 and str(header.version) != "1.4")):
        raise InputError("Only LAS 1.2, 1.3 or 1.4 point formats 0-3 or 6-8 are read; "
                         "waveform formats 4/5/9/10 are not read.")
    if fmt.size != RECORD_LENGTHS[fmt.id] or list(fmt.extra_dimensions):
        raise InputError("Only standard LAS point records without extra dimensions are supported losslessly.")
    if not 1 <= header.point_count <= MAX_SOURCE_POINTS:
        raise InputError("Point count exceeds the bounded reader profile.")


def _crs_metadata(header: laspy.LasHeader) -> dict:
    # parse_crs uses only the source's WKT or GeoTIFF VLRs, never a coordinate-range guess.
    crs = header.parse_crs()
    wkt = crs.to_wkt() if crs else None
    if wkt and len(wkt) > 8192:
        raise InputError("Point CRS metadata exceeds the bounded reference profile.")
    parts = []
    if crs:
        parts = crs.sub_crs_list if crs.is_compound else [crs]
    horizontal = next((part for part in parts if part.is_projected or part.is_geographic), None)
    vertical = next((part for part in parts if part.is_vertical), None)
    authority = horizontal.to_authority() if horizontal else None
    return {"crsWkt": wkt, "horizontalAuthority": ":".join(authority) if authority else None,
            "verticalReference": vertical.name[:500] if vertical else None,
            "verticalReferenceStatus": "known" if vertical else "unknown"}


def _metadata(header: laspy.LasHeader, batch: dict) -> dict:
    fmt = header.point_format
    dimensions = list(fmt.dimension_names)
    fields = [{"name": name, "offset": field[1], "dtype": field[0].str, "bytes": field[0].itemsize}
              for name, field in fmt.dtype().fields.items()]
    gps_time_type = None
    if "gps_time" in dimensions:
        gps_time_type = "standard" if int(header.global_encoding.gps_time_type) == 1 else "week_time"
    return {"lasVersion": str(header.version), "pointFormatId": fmt.id, "recordLength": fmt.size,
            "recordEncoding": f"las-{header.version}-point-format-{fmt.id}-le",
            "dimensions": dimensions, "sourcePointCount": header.point_count,
            "scale": header.scales.tolist(), "offset": header.offsets.tolist(),
            "sourceBounds": [*header.mins.tolist(), *header.maxs.tolist()], **_crs_metadata(header),
            "gpsTimeType": gps_time_type, "batch": batch, "recordFields": fields,
            "globalPlacement": "not_qualified"}


def _native_records(source: Any, batch: dict) -> bytes:
    start, count, step = (batch[k] for k in ("start", "count", "step"))
    end = start + (count - 1) * step + 1
    records = bytearray()
    # The installed lazrs seeks incorrectly across COPC variable-size chunks; stream the prefix instead.
    copc = any(vlr.user_id == "copc" and vlr.record_id == 1 for vlr in source.header.vlrs)
    offset = 0 if copc else start
    source.seek(offset)
    for points in source.chunk_iterator(min(end - offset, 1_048_576)):
        if points.array.dtype != source.header.point_format.dtype():
            raise InputError("The selected native point batch could not be decoded exactly.")
        stop = min(len(points), end - offset)
        first = max(start - offset, (start - offset) % step)
        records.extend(points.array[first:stop:step].tobytes())
        offset += stop
        del points
        if offset == end:
            break
    if offset != end or len(records) != count * source.header.point_format.size:
        raise InputError("The selected native point batch could not be decoded exactly.")
    return bytes(records)


def _read_native_batch(path: Path, requested: dict | None) -> dict:
    try:
        # Sequential lazrs avoids the parallel decoder's allocation of COPC's variable-chunk sentinel.
        with laspy.open(path, mode="r", laz_backend=laspy.LazBackend.Lazrs) as source:
            header = source.header
            _validate_header(header)
            step = (header.point_count + MAX_BATCH_POINTS - 1) // MAX_BATCH_POINTS
            batch = requested or {"start": 0, "count": (header.point_count + step - 1) // step, "step": step}
            if batch["start"] + (batch["count"] - 1) * batch["step"] >= header.point_count:
                raise InputError("Point batch is outside the retained source point count.")
            metadata = _metadata(header, batch)
            records = _native_records(source, batch)
            if len(records) != batch["count"] * header.point_format.size or len(records) > MAX_ARTIFACT_BYTES:
                raise InputError("The native point artifact exceeds the bounded byte budget.")
            return {"metadata": metadata, "artifactBase64": base64.b64encode(records).decode("ascii"),
                    "artifactSha256": hashlib.sha256(records).hexdigest(), "artifactBytes": len(records)}
    except InputError:
        raise
    except (OSError, ValueError, TypeError, laspy.errors.LaspyException):
        raise InputError("The retained bytes are not a supported readable LAS/LAZ source.") from None


def read_point_batch(data: Any, s3: Any = None) -> dict:
    if not isinstance(data, dict) or set(data) != {"sourceId", "objectKey", "sha256", "bytes", "batch"}:
        raise InputError("Point reader requires exact retained-source pins and a point-index batch.")
    source_id, key, digest, size = (data[k] for k in ("sourceId", "objectKey", "sha256", "bytes"))
    match = KEY.fullmatch(key) if isinstance(key, str) else None
    if (not match or match.group(1) != source_id or not isinstance(digest, str)
            or not HASH.fullmatch(digest) or match.group(2) != digest):
        raise InputError("Point object key must match its retained source ID and SHA-256.")
    if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= MAX_SOURCE_BYTES:
        raise InputError("This point reader supports originals of at most 1 GiB.")
    requested = _batch(data["batch"])
    client = s3 or boto3.client("s3", endpoint_url=settings.S3_ENDPOINT, aws_access_key_id=settings.S3_ACCESS_KEY,
                                aws_secret_access_key=settings.S3_SECRET_KEY, region_name=settings.S3_REGION,
                                config=Config(connect_timeout=5, read_timeout=30, retries={"max_attempts": 2}))
    body = client.get_object(Bucket=settings.S3_BUCKET, Key=key)["Body"]
    try:
        with tempfile.TemporaryDirectory(prefix="point-batch-") as directory:
            return _read_native_batch(_source_path(body, directory, size, digest), requested)
    finally:
        body.close()
