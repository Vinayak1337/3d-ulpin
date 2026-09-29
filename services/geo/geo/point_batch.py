"""Hash-verified, source-bound LAZ/COPC point-index batches in native LAS 1.4 format 6."""
from __future__ import annotations

import base64
import hashlib
import re
import tempfile

import boto3
from botocore.config import Config
import laspy

from . import settings
from .validation import InputError

MAX_SOURCE_BYTES = 16 * 1024 * 1024
MAX_SOURCE_POINTS = 5_000_000
MAX_BATCH_POINTS = 8192
MAX_ARTIFACT_BYTES = 512 * 1024
KEY = re.compile(r"^sources/([0-9a-f-]{36})/([0-9a-f]{64})$")
HASH = re.compile(r"^[0-9a-f]{64}$")


def _batch(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"start", "count"}:
        raise InputError("Select an exact bounded point-index batch.")
    start, count = value["start"], value["count"]
    if any(isinstance(v, bool) or not isinstance(v, int) for v in (start, count)) or start < 0 or start >= MAX_SOURCE_POINTS or count < 1 or count > MAX_BATCH_POINTS:
        raise InputError("Point-index batch exceeds the bounded reader profile.")
    return value


def read_point_batch(data, s3=None):
    if not isinstance(data, dict) or set(data) != {"sourceId", "objectKey", "sha256", "bytes", "batch"}:
        raise InputError("Point reader requires exact retained-source pins and a point-index batch.")
    source_id, key, digest, size = (data[k] for k in ("sourceId", "objectKey", "sha256", "bytes"))
    match = KEY.fullmatch(key) if isinstance(key, str) else None
    if not match or match.group(1) != source_id or not isinstance(digest, str) or not HASH.fullmatch(digest) or match.group(2) != digest:
        raise InputError("Point object key must match its retained source ID and SHA-256.")
    if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= MAX_SOURCE_BYTES:
        raise InputError("This point reader supports originals of at most 16 MiB.")
    requested = _batch(data["batch"])
    client = s3 or boto3.client("s3", endpoint_url=settings.S3_ENDPOINT, aws_access_key_id=settings.S3_ACCESS_KEY,
                                aws_secret_access_key=settings.S3_SECRET_KEY, region_name=settings.S3_REGION,
                                config=Config(connect_timeout=5, read_timeout=30, retries={"max_attempts": 2}))
    obj = client.get_object(Bucket=settings.S3_BUCKET, Key=key)
    body = obj["Body"]
    source_hash = hashlib.sha256()
    count = 0
    try:
        with tempfile.TemporaryDirectory(prefix="point-batch-") as directory:
            path = f"{directory}/source.laz"
            with open(path, "wb") as target:
                for block in body.iter_chunks(chunk_size=1024 * 1024):
                    count += len(block)
                    if count > size:
                        raise InputError("Point source exceeds its retained byte receipt.")
                    source_hash.update(block)
                    target.write(block)
            if count != size or source_hash.hexdigest() != digest:
                raise InputError("Point source hash or byte count differs from its retained receipt.")
            try:
                with laspy.open(path, mode="r") as source:
                    header = source.header
                    fmt = header.point_format
                    if str(header.version) != "1.4" or not header.are_points_compressed or fmt.id != 6 or fmt.size != 30 or list(fmt.extra_dimensions):
                        raise InputError("Only standard LAS 1.4 point format 6 without extra dimensions is supported losslessly.")
                    if not 1 <= header.point_count <= MAX_SOURCE_POINTS:
                        raise InputError("Point count exceeds the bounded reader profile.")
                    start, selected = ((requested["start"], requested["count"]) if requested else
                                       (0, min(MAX_BATCH_POINTS, header.point_count)))
                    if start + selected > header.point_count:
                        raise InputError("Point batch is outside the retained source point count.")
                    crs = header.parse_crs()
                    wkt = crs.to_wkt() if crs else None
                    if wkt and len(wkt) > 8192:
                        raise InputError("Point CRS metadata exceeds the bounded reference profile.")
                    parts = crs.sub_crs_list if crs and crs.is_compound else [crs] if crs else []
                    horizontal = next((part for part in parts if part.is_projected or part.is_geographic), None)
                    vertical = next((part for part in parts if part.is_vertical), None)
                    authority = horizontal.to_authority() if horizontal else None
                    layout = fmt.dtype()
                    fields = [{"name": name, "offset": field[1], "dtype": field[0].str,
                               "bytes": field[0].itemsize} for name, field in layout.fields.items()]
                    if layout.itemsize != 30 or any(field["offset"] + field["bytes"] > 30 for field in fields):
                        raise InputError("The native point record layout is unsupported.")
                    source.seek(start)
                    points = source.read_points(selected)
                    if len(points) != selected or points.array.dtype != layout:
                        raise InputError("The selected native point batch could not be decoded exactly.")
                    records = points.array.tobytes()
                    if len(records) != selected * 30 or len(records) > MAX_ARTIFACT_BYTES:
                        raise InputError("The native point artifact exceeds the bounded byte budget.")
                    metadata = {
                        "lasVersion": "1.4", "pointFormatId": 6, "recordLength": 30,
                        "recordEncoding": "las-1.4-point-format-6-le",
                        "dimensions": list(fmt.dimension_names),
                        "sourcePointCount": header.point_count,
                        "scale": header.scales.tolist(), "offset": header.offsets.tolist(),
                        "sourceBounds": [*header.mins.tolist(), *header.maxs.tolist()],
                        "crsWkt": wkt, "horizontalAuthority": ":".join(authority) if authority else None,
                        "verticalReference": vertical.name[:500] if vertical else None,
                        "verticalReferenceStatus": "known" if vertical else "unknown",
                        "gpsTimeType": "standard" if int(header.global_encoding.gps_time_type) == 1 else "week_time",
                        "batch": {"start": start, "count": selected}, "recordFields": fields,
                        "globalPlacement": "not_qualified",
                    }
                    return {"metadata": metadata, "artifactBase64": base64.b64encode(records).decode("ascii"),
                            "artifactSha256": hashlib.sha256(records).hexdigest(), "artifactBytes": len(records)}
            except InputError:
                raise
            except (OSError, ValueError, TypeError, laspy.errors.LaspyException):
                raise InputError("The retained bytes are not a supported readable LAZ/COPC source.") from None
    finally:
        body.close()
