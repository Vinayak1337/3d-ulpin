from __future__ import annotations

import hashlib
import logging
import uuid

import boto3
from botocore.config import Config
from celery import Celery
from celery.exceptions import SoftTimeLimitExceeded

from . import settings
from .geometry import build_model
from .inspection import MAX_BYTES, PROFILES, inspect_bytes
from .store import JobStore
from .validation import InputError, text

logger = logging.getLogger(__name__)
celery_app = Celery("ulpin_geo", broker=settings.REDIS_URL, backend=settings.REDIS_URL)
celery_app.conf.update(task_serializer="json", result_serializer="json", accept_content=["json"], task_acks_late=True, task_reject_on_worker_lost=True, worker_prefetch_multiplier=1, broker_connection_retry_on_startup=True, task_soft_time_limit=110, task_time_limit=120, broker_transport_options={"visibility_timeout": 180}, result_expires=86400)


def inspect_object(data: dict, s3=None) -> dict:
    text(data.get("sourceId"), "sourceId")
    profile = data.get("profile")
    if profile not in PROFILES:
        raise InputError("Unsupported source profile.")
    key = text(data.get("objectKey"), "objectKey")
    digest = data.get("sha256")
    expected = data.get("bytes")
    if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise InputError("sha256 must be a lowercase, 64-character SHA-256 fingerprint.")
    if isinstance(expected, bool) or not isinstance(expected, int) or not 1 <= expected <= MAX_BYTES:
        raise InputError("Expected source size must be between 1 byte and 16 MiB.")
    if s3 is None:
        s3 = boto3.client("s3", endpoint_url=settings.S3_ENDPOINT, aws_access_key_id=settings.S3_ACCESS_KEY, aws_secret_access_key=settings.S3_SECRET_KEY, region_name=settings.S3_REGION, config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=5, read_timeout=30, retries={"max_attempts": 2}))
    obj = s3.get_object(Bucket=settings.S3_BUCKET, Key=key)
    body = obj["Body"]
    try:
        raw = body.read(MAX_BYTES + 1)
    finally:
        body.close()
    if len(raw) != expected:
        raise InputError("Stored source size does not match the finalized upload. Re-upload the original file.")
    if hashlib.sha256(raw).hexdigest() != digest:
        raise InputError("Stored source checksum does not match the finalized upload. Re-upload the original file.")
    return inspect_bytes(profile, raw)


def run_job(identity: str, store=None) -> dict:
    store = store or JobStore()
    record = store.read(identity)
    if record is None:
        raise InputError("Processing job does not exist.")
    if record["status"] in ("succeeded", "failed"):
        return {"jobId": identity, "status": record["status"]}
    owner = str(uuid.uuid4())
    if not store.claim(identity, owner):
        # Another delivery owns the bounded lease. Celery retries after its expiry,
        # allowing recovery from a worker killed before releasing the lease.
        return {"jobId": identity, "status": "busy"}
    try:
        record = store.read(identity)
        if record["status"] in ("succeeded", "failed"):
            return {"jobId": identity, "status": record["status"]}
        store.update(identity, status="running")
        result = inspect_object(record["input"]) if record["operation"] == "inspect" else build_model(record["input"])
        store.update(identity, status="succeeded", result=result)
        return {"jobId": identity, "status": "succeeded"}
    except InputError as error:
        store.update(identity, status="failed", error=str(error))
        return {"jobId": identity, "status": "failed"}
    except SoftTimeLimitExceeded:
        store.update(identity, status="failed", error="Processing exceeded the 110-second limit. Simplify the input and retry.")
        return {"jobId": identity, "status": "failed"}
    except Exception as error:
        logger.exception("Processing job %s failed (%s)", identity, type(error).__name__)
        store.update(identity, status="failed", error=f"Processing service failed ({type(error).__name__}). Check service health and retry with a new job ID.")
        return {"jobId": identity, "status": "failed"}
    finally:
        store.release(identity, owner)


@celery_app.task(bind=True, name="ulpin.process_job", max_retries=5)
def process_job(self, identity: str) -> dict:
    result = run_job(identity)
    if result["status"] == "busy":
        raise self.retry(countdown=185)
    return result
