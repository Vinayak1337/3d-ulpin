from __future__ import annotations

import hmac
from typing import Annotated, Any, Literal, Optional
import uuid

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from redis import Redis

from . import settings
from .store import JobConflict, JobStore, public_job
from .tasks import celery_app, process_job

app = FastAPI(title="Private ULPIN geometry processor", docs_url=None, redoc_url=None, openapi_url=None)


def authorize(authorization: Annotated[Optional[str], Header()] = None) -> None:
    if not settings.GEO_SERVICE_TOKEN:
        raise HTTPException(status_code=503, detail="Processing service authentication is not configured.")
    expected = f"Bearer {settings.GEO_SERVICE_TOKEN}"
    if authorization is None or not hmac.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Valid service bearer token required.")


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    jobId: uuid.UUID
    operation: Literal["inspect", "build", "spatial-inference"]
    input: dict[str, Any] = Field(min_length=1)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/internal/ready", dependencies=[Depends(authorize)])
def readiness() -> dict:
    redis_ready = worker_ready = False
    client = Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=1, retry_on_timeout=False)
    try:
        redis_ready = bool(client.ping())
    except Exception:
        pass
    finally:
        client.close()
    if redis_ready:
        try:
            with celery_app.connection_for_read(connect_timeout=1, transport_options={"socket_connect_timeout": 1, "socket_timeout": 1, "max_retries": 0}) as connection:
                replies = celery_app.control.inspect(timeout=1.0, limit=1, connection=connection).ping()
                worker_ready = bool(replies and any(isinstance(reply, dict) and reply.get("ok") == "pong" for reply in replies.values()))
        except Exception:
            pass
    return {"ok": redis_ready and worker_ready, "redis": redis_ready, "worker": worker_ready}


@app.post("/internal/jobs", dependencies=[Depends(authorize)])
def submit_job(request: JobRequest) -> dict:
    store = JobStore()
    try:
        entry, _ = store.create(str(request.jobId), request.operation, request.input)
    except JobConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from None
    except ValueError:
        raise HTTPException(status_code=422, detail="Job input must contain JSON-safe finite values.") from None
    if entry["status"] == "queued" and not entry.get("dispatched"):
        try:
            process_job.apply_async(args=[entry["jobId"]], task_id=entry["jobId"])
            entry = store.update(entry["jobId"], dispatched=True)
        except Exception:
            # Keep queued and undispatched: an idempotent resubmission can safely
            # recover a temporary broker outage without losing the logical job.
            raise HTTPException(status_code=503, detail="Worker queue unavailable; safely retry the same job ID and input.") from None
    return public_job(entry, include_result=False)


@app.get("/internal/jobs/{job_id}", dependencies=[Depends(authorize)])
def read_job(job_id: uuid.UUID) -> dict:
    entry = JobStore().read(str(job_id))
    if entry is None:
        raise HTTPException(status_code=404, detail="Processing job not found.")
    return public_job(entry)


@app.get("/internal/spatial-ml/status", dependencies=[Depends(authorize)])
def spatial_ml_status() -> dict:
    from .spatial_ml import spatial_ml_readiness
    return spatial_ml_readiness()


@app.post('/internal/registry/{operation}', dependencies=[Depends(authorize)])
def registry_operation(operation: str, data: dict[str, Any]) -> dict:
    from .registry import check_registry, query_registry
    from .validation import InputError
    if operation not in ('check', 'query'):
        raise HTTPException(status_code=404, detail='Unknown registry operation.')
    try:
        return (check_registry if operation == 'check' else query_registry)(data)
    except (InputError, KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from None


@app.post('/internal/area/{operation}', dependencies=[Depends(authorize)])
def area_operation(operation: str, data: dict[str, Any]) -> dict:
    from .area import check_area, extract_document, normalize_area
    from .gis_inspection import inspect_gis
    from .image_derivative import crop_image
    from .officer import resolve_profile_request
    from .validation import InputError
    operations = {'inspect-gis': inspect_gis, 'normalize': normalize_area, 'check': check_area, 'extract': extract_document, 'crop': crop_image, 'profile': resolve_profile_request}
    if operation not in operations:
        raise HTTPException(status_code=404, detail='Unknown area operation.')
    try:
        return operations[operation](data)
    except (InputError, KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
