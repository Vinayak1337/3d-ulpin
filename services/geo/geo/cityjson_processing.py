"""Private retained-object wrapper around the accepted bounded native reader."""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time

from .native_cityjson import MAX_INPUT_BYTES, MAX_OUTPUT_BYTES
from .validation import InputError

KEY = re.compile(r"^sources/([0-9a-f-]{36})/([0-9a-f]{64})$")
WORKER = """
import json,sys
from geo.native_cityjson import read_cityjson,encode_cityjson_result,CityJSONError,MAX_INPUT_BYTES
try:
    result=read_cityjson(sys.stdin.buffer.read(MAX_INPUT_BYTES+1))
    sys.stdout.buffer.write(encode_cityjson_result(result))
except CityJSONError as error:
    sys.stdout.buffer.write(json.dumps({'error':error.as_dict()}).encode())
    sys.exit(2)
"""


def reader_sha():
    directory = Path(__file__).parent
    return hashlib.sha256(b"".join((directory / name).read_bytes() for name in
                                  ("native_cityjson.py", "cityjson_processing.py"))).hexdigest()


def process_cityjson(data, s3=None):
    if not isinstance(data, dict) or set(data) != {"sourceId", "objectKey", "sha256", "bytes", "readerSha256", "selection"}:
        raise InputError("CITYJSON_SOURCE_PINS")
    source_id, key, digest, size = (data[k] for k in ("sourceId", "objectKey", "sha256", "bytes"))
    match = KEY.fullmatch(key) if isinstance(key, str) else None
    if not match or match.group(1) != source_id or match.group(2) != digest:
        raise InputError("CITYJSON_SOURCE_PINS")
    if type(size) is not int or not 1 <= size <= MAX_INPUT_BYTES:
        raise InputError("CITYJSON_INPUT_LIMIT")
    if data["readerSha256"] != reader_sha() or data["selection"] != "complete_bounded_source":
        raise InputError("CITYJSON_READER_MISMATCH")
    if s3 is None:
        import boto3
        from botocore.config import Config
        from . import settings
        s3 = boto3.client("s3", endpoint_url=settings.S3_ENDPOINT, aws_access_key_id=settings.S3_ACCESS_KEY,
                          aws_secret_access_key=settings.S3_SECRET_KEY, region_name=settings.S3_REGION,
                          config=Config(connect_timeout=5, read_timeout=10, retries={"max_attempts": 0}))
    from . import settings
    obj = s3.get_object(Bucket=settings.S3_BUCKET, Key=key)
    body = obj["Body"]
    start = time.monotonic()
    raw = bytearray()
    try:
        if obj.get("ContentLength") != size:
            raise InputError("CITYJSON_SOURCE_INTEGRITY")
        for block in body.iter_chunks(chunk_size=64 * 1024):
            if len(raw) + len(block) > size or time.monotonic() - start > 30:
                raise InputError("CITYJSON_SOURCE_INTEGRITY")
            raw.extend(block)
        if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
            raise InputError("CITYJSON_SOURCE_INTEGRITY")
    finally:
        body.close()
    try:
        child = subprocess.run([sys.executable, "-m", "geo.cityjson_processing", "--worker"], input=bytes(raw),
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20)
    except subprocess.TimeoutExpired:
        raise InputError("CITYJSON_TIME_LIMIT") from None
    if len(child.stdout) > MAX_OUTPUT_BYTES:
        raise InputError("CITYJSON_OUTPUT_LIMIT")
    if child.returncode == 2:
        error = json.loads(child.stdout)["error"]
        category = {"malformed": "MALFORMED", "unsupported": "UNSUPPORTED", "limit": "LIMIT"}[error["status"]]
        # Source-derived pointers/messages stay in the private source; failure
        # status is a bounded code, not arbitrary native exception text.
        raise InputError("CITYJSON_" + category)
    if child.returncode != 0:
        raise InputError("CITYJSON_PROCESSOR_FAILED")
    result = json.loads(child.stdout)
    if result["sourceSha256"] != digest or result["sourceBytes"] != size:
        raise InputError("CITYJSON_SOURCE_INTEGRITY")
    geometries = [g for item in result["objects"] for g in item["geometries"]]
    summary = {key: result[key] for key in ("schemaVersion", "status", "sourceSha256", "sourceBytes", "objectCount",
               "vertexCount", "boundaryIndexCount", "decodedBounds", "transformState", "coordinateMode")}
    summary.update(supportedGeometryCount=sum(g["status"] == "supported" for g in geometries),
                   unsupportedGeometryCount=sum(g["status"] == "unsupported" for g in geometries),
                   referenceSystemState=result["frame"]["referenceSystemState"], structuralReadingOnly=True,
                   globalPlacement="not_qualified", watertightSolid="not_qualified",
                   interiorFloors="not_established_by_reader", rights="not_assessed")
    return {"summary": summary, "artifactBase64": base64.b64encode(child.stdout).decode("ascii"),
            "artifactSha256": hashlib.sha256(child.stdout).hexdigest(), "artifactBytes": len(child.stdout),
            "readerSha256": reader_sha()}


def make_cityjson_router(authorize):
    from fastapi import APIRouter, Depends, HTTPException
    router = APIRouter()

    @router.post("/internal/cityjson/native", dependencies=[Depends(authorize)])
    def native(data: dict) -> dict:
        try:
            return process_cityjson(data)
        except InputError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    return router


if __name__ == "__main__" and sys.argv[1:] == ["--worker"]:
    exec(WORKER)  # Fixed module-owned code only, never caller-supplied code.
