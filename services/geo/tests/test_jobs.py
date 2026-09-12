from copy import deepcopy
from contextlib import nullcontext
from types import SimpleNamespace
import uuid

import fakeredis
from fastapi.testclient import TestClient
import pytest

from geo import api, settings
from geo.store import JobConflict, JobStore, public_job
from geo.tasks import run_job


@pytest.fixture
def store():
    return JobStore(fakeredis.FakeRedis(decode_responses=True))


def test_logical_duplicate_is_idempotent_and_changed_payload_conflicts(store, draft):
    identity = str(uuid.uuid4())
    first, created = store.create(identity, "build", draft)
    assert created
    second, created = store.create(identity, "build", deepcopy(draft))
    assert not created
    assert second == first
    with pytest.raises(JobConflict):
        store.create(identity, "build", {**draft, "inputFingerprint": "changed"})


def test_worker_transitions_compute_preserve_terminal_and_hide_private_input(store, draft):
    identity = str(uuid.uuid4())
    store.create(identity, "build", draft)
    assert run_job(identity, store)["status"] == "succeeded"
    record = store.read(identity)
    assert record["result"]["inputFingerprint"] == draft["inputFingerprint"]
    assert sum(f["overlap"]["volume"] for f in record["result"]["findings"] if f["code"] == "OVERLAP") == pytest.approx(6.4)
    assert set(public_job(record)) == {"jobId", "status", "result"}
    run_job(identity, store)
    assert store.read(identity) == record


def test_failed_input_is_terminal_and_retry_uses_new_identity(store, draft):
    identity = str(uuid.uuid4())
    invalid = deepcopy(draft)
    invalid["units"][0]["lower"] = None
    store.create(identity, "build", invalid)
    assert run_job(identity, store)["status"] == "failed"
    assert "finite number" in store.read(identity)["error"]
    assert run_job(identity, store)["status"] == "failed"
    retry = str(uuid.uuid4())
    store.create(retry, "build", draft)
    assert run_job(retry, store)["status"] == "succeeded"


def test_duplicate_worker_lease_and_stale_owner_cannot_release_new_owner(store, draft):
    identity = str(uuid.uuid4())
    store.create(identity, "build", draft)
    assert store.claim(identity, "worker-a")
    assert run_job(identity, store)["status"] == "busy"
    store.release(identity, "worker-b")
    assert not store.claim(identity, "worker-b")
    store.release(identity, "worker-a")
    assert run_job(identity, store)["status"] == "succeeded"


def test_private_api_auth_enqueue_duplicate_and_payload_conflict(monkeypatch, store, draft):
    monkeypatch.setattr(settings, "GEO_SERVICE_TOKEN", "test-private-service-token")
    monkeypatch.setattr(api, "JobStore", lambda: store)
    calls = []
    monkeypatch.setattr(api.process_job, "apply_async", lambda **kw: calls.append(kw))
    client = TestClient(api.app)
    headers = {"Authorization": "Bearer test-private-service-token"}
    identity = str(uuid.uuid4())
    payload = {"jobId": identity, "operation": "build", "input": draft}
    assert client.get("/health").json() == {"ok": True}
    assert client.post("/internal/jobs", json=payload).status_code == 401
    assert client.post("/internal/jobs", json=payload, headers=headers).json() == {"jobId": identity, "status": "queued"}
    assert client.post("/internal/jobs", json=payload, headers=headers).status_code == 200
    assert len(calls) == 1
    assert calls[0]["args"] == [identity]
    altered = deepcopy(payload)
    altered["input"]["inputFingerprint"] = "different"
    assert client.post("/internal/jobs", json=altered, headers=headers).status_code == 409
    run_job(identity, store)
    result = client.get(f"/internal/jobs/{identity}", headers=headers)
    assert result.json()["status"] == "succeeded"
    assert "input" not in result.json()
    assert client.get(f"/internal/jobs/{uuid.uuid4()}", headers=headers).status_code == 404


def test_enqueue_failure_preserves_same_id_for_safe_recovery(monkeypatch, store, draft):
    monkeypatch.setattr(settings, "GEO_SERVICE_TOKEN", "test-private-service-token")
    monkeypatch.setattr(api, "JobStore", lambda: store)

    def broken(**kwargs):
        raise ConnectionError("temporary failure")

    monkeypatch.setattr(api.process_job, "apply_async", broken)
    client = TestClient(api.app)
    headers = {"Authorization": "Bearer test-private-service-token"}
    payload = {"jobId": str(uuid.uuid4()), "operation": "build", "input": draft}
    assert client.post("/internal/jobs", json=payload, headers=headers).status_code == 503
    assert not store.read(payload["jobId"])["dispatched"]
    monkeypatch.setattr(api.process_job, "apply_async", lambda **kwargs: None)
    assert client.post("/internal/jobs", json=payload, headers=headers).status_code == 200
    assert store.read(payload["jobId"])["dispatched"]


@pytest.mark.parametrize("reply,expected", [({"worker-1": {"ok": "pong"}}, True), (None, False), (RuntimeError("private broker details"), False)])
def test_readiness_requires_actual_worker_reply_and_hides_failures(monkeypatch, reply, expected):
    monkeypatch.setattr(settings, "GEO_SERVICE_TOKEN", "test-private-service-token")
    monkeypatch.setattr(api.Redis, "from_url", lambda *args, **kwargs: SimpleNamespace(ping=lambda: True, close=lambda: None))
    monkeypatch.setattr(api.celery_app, "connection_for_read", lambda **kwargs: nullcontext(object()))

    def ping():
        if isinstance(reply, Exception):
            raise reply
        return reply

    def inspect(**kwargs):
        assert kwargs["timeout"] == 1.0
        assert kwargs["limit"] == 1
        return SimpleNamespace(ping=ping)

    monkeypatch.setattr(api.celery_app.control, "inspect", inspect)
    client = TestClient(api.app)
    assert client.get("/internal/ready").status_code == 401
    result = client.get("/internal/ready", headers={"Authorization": "Bearer test-private-service-token"})
    assert result.status_code == 200
    assert result.json() == {"ok": expected, "redis": True, "worker": expected}


def test_readiness_skips_worker_when_redis_unreachable(monkeypatch):
    monkeypatch.setattr(settings, "GEO_SERVICE_TOKEN", "test-private-service-token")

    def ping():
        raise ConnectionError("private connection details")

    def connect(*args, **kwargs):
        assert kwargs["socket_connect_timeout"] == 1
        assert kwargs["socket_timeout"] == 1
        return SimpleNamespace(ping=ping, close=lambda: None)

    def unexpected(**kwargs):
        pytest.fail("Worker must not be queried after failed Redis ping.")

    monkeypatch.setattr(api.Redis, "from_url", connect)
    monkeypatch.setattr(api.celery_app, "connection_for_read", unexpected)
    client = TestClient(api.app)
    result = client.get("/internal/ready", headers={"Authorization": "Bearer test-private-service-token"})
    assert result.json() == {"ok": False, "redis": False, "worker": False}
    assert client.get("/health").json() == {"ok": True}
