from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json

from redis import Redis

from . import settings


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical(value: dict) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def signature(operation: str, data: dict) -> str:
    return hashlib.sha256(canonical({"operation": operation, "input": data}).encode()).hexdigest()


class JobConflict(ValueError):
    pass


class JobStore:
    def __init__(self, client=None):
        self.client = client if client is not None else Redis.from_url(settings.REDIS_URL, decode_responses=True, socket_connect_timeout=5, socket_timeout=5)

    def key(self, identity: str) -> str:
        return f"ulpin:geo:job:{identity}"

    def read(self, identity: str) -> dict | None:
        raw = self.client.get(self.key(identity))
        return json.loads(raw) if raw else None

    def create(self, identity: str, operation: str, data: dict) -> tuple[dict, bool]:
        digest = signature(operation, data)
        entry = {"jobId": identity, "operation": operation, "input": data, "signature": digest, "status": "queued", "createdAt": now(), "updatedAt": now(), "dispatched": False}
        if self.client.set(self.key(identity), canonical(entry), nx=True):
            return entry, True
        existing = self.read(identity)
        if existing is None or existing["signature"] != digest:
            raise JobConflict("This jobId is already associated with different input. Create a new job ID.")
        return existing, False

    def update(self, identity: str, **changes) -> dict:
        # WATCH prevents worker/dispatcher transitions from overwriting one another.
        from redis.exceptions import WatchError
        with self.client.pipeline() as pipe:
            while True:
                try:
                    pipe.watch(self.key(identity))
                    raw = pipe.get(self.key(identity))
                    if not raw:
                        raise KeyError(identity)
                    entry = json.loads(raw)
                    entry.update(changes, updatedAt=now())
                    pipe.multi()
                    pipe.set(self.key(identity), canonical(entry))
                    pipe.execute()
                    return entry
                except WatchError:
                    continue

    def claim(self, identity: str, owner: str) -> bool:
        return bool(self.client.set(f"{self.key(identity)}:lock", owner, nx=True, ex=180))

    def release(self, identity: str, owner: str) -> None:
        # Compare and delete atomically so an old worker cannot clear a new lease.
        from redis.exceptions import WatchError
        key = f"{self.key(identity)}:lock"
        with self.client.pipeline() as pipe:
            while True:
                try:
                    pipe.watch(key)
                    if pipe.get(key) != owner:
                        return
                    pipe.multi()
                    pipe.delete(key)
                    pipe.execute()
                    return
                except WatchError:
                    continue


def public_job(entry: dict, include_result: bool = True) -> dict:
    result = {"jobId": entry["jobId"], "status": entry["status"]}
    if include_result:
        for key in ("result", "error"):
            if key in entry:
                result[key] = entry[key]
    return result
