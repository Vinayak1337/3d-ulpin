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

MAX_SOURCE_BYTES = 16 * 1024 * 1024
MAX_SOURCE_POINTS = 5_000_000
MAX_BATCH_POINTS = 8192
MAX_ARTIFACT_BYTES = 512 * 1024
RECORD_LENGTHS = {0: 20, 1: 28, 2: 26, 3: 34, 6: 30, 7: 36, 8: 38}
KEY = re.compile(r"^(?:sources|large-originals)/([0-9a-f-]{36})/([0-9a-f]{64})$")
HASH = re.compile(r"^[0-9a-f]{64}$")


def _batch(value: Any) -> dict | None:
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"start", "count"}:
        raise InputError("Select an exact bounded point-index batch.")
    start, count = value["start"], value["count"]
    if (any(isinstance(v, bool) or not isinstance(v, int) for v in (start, count))
            or start < 0 or start >= MAX_SOURCE_POINTS or count < 1 or count > MAX_BATCH_POINTS):
        raise InputError("Point-index batch exceeds the bounded reader profile.")
    return value


def _source_path(body: Any, directory: str, size: int, digest: str) -> Path:
    path = Path(directory) / "source"
    source_hash = hashlib.sha256()
    count = 0
    with path.open("wb") as target:
        for block in body.iter_chunks(chunk_size=1024 * 1024):
            count += len(block)
            if count > size:
                raise InputError("Point source exceeds its retained byte receipt.")
            source_hash.update(block)
            target.write(block)
    if count != size or source_hash.hexdigest() != digest:
        raise InputError("Point source hash or byte count differs from its retained receipt.")
    with path.open("rb") as source:
        prefix = source.read(105)
    if len(prefix) != 105 or prefix[:4] != b"LASF":
        raise InputError("The retained bytes are not a supported readable LAS/LAZ source.")
    named = path.with_suffix(".laz" if prefix[104] & 0x80 else ".las")
    path.rename(named)
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


def _read_native_batch(path: Path, requested: dict | None) -> dict:
    try:
        # lazrs is the processor image's installed LAZ backend; plain LAS needs no backend.
        with laspy.open(path, mode="r", laz_backend=laspy.LazBackend.LazrsParallel) as source:
            header = source.header
            _validate_header(header)
            batch = requested or {"start": 0, "count": min(MAX_BATCH_POINTS, header.point_count)}
            if batch["start"] + batch["count"] > header.point_count:
                raise InputError("Point batch is outside the retained source point count.")
            metadata = _metadata(header, batch)
            source.seek(batch["start"])
            points = source.read_points(batch["count"])
            if len(points) != batch["count"] or points.array.dtype != header.point_format.dtype():
                raise InputError("The selected native point batch could not be decoded exactly.")
            records = points.array.tobytes()
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
        raise InputError("This point reader supports originals of at most 16 MiB.")
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
