#!/usr/bin/env python3
"""Exercise authenticated HTTP -> Redis -> Celery -> deterministic geometry."""

import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request
import uuid


def main():
    env_path = Path(__file__).resolve().parents[1] / ".env"
    config = {}
    if env_path.exists():
        for raw_line in env_path.read_text().splitlines():
            line = raw_line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                config[key.strip()] = value.strip().strip('"').strip("'")
    config.update(os.environ)
    base = config.get("GEO_URL", "http://127.0.0.1:18000").rstrip("/")
    token = config.get("GEO_SERVICE_TOKEN")
    if not token:
        raise RuntimeError("GEO_SERVICE_TOKEN is missing; run platform-env.sh first.")

    def request(method, path, payload=None, authenticated=True):
        headers = {"Content-Type": "application/json"}
        if authenticated:
            headers["Authorization"] = f"Bearer {token}"
        data = None if payload is None else json.dumps(payload, allow_nan=False).encode()
        req = urllib.request.Request(base + path, data=data, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.load(response)

    units = []
    for alias, lower, upper in [("SMOKE-LOWER", 0, 3), ("SMOKE-UPPER", 2.8, 6)]:
        units.append({
            "id": str(uuid.uuid4()), "alias": alias, "name": alias,
            "kind": "unit", "footprint": [[2, 2], [6, 2], [6, 10], [2, 10]],
            "lower": lower, "upper": upper, "lowerVerified": False,
            "upperVerified": False, "bindings": {}, "revision": 1,
            "levelLabel": alias,
        })
    build_input = {
        "frame": {"id": "LOCAL-SMOKE", "horizontalUnit": "m", "verticalUnit": "m", "benchmark": "BM-SMOKE"},
        "units": units, "context": [],
    }
    build_input["inputFingerprint"] = hashlib.sha256(json.dumps(build_input, sort_keys=True).encode()).hexdigest()
    job_id = str(uuid.uuid4())
    payload = {"jobId": job_id, "operation": "build", "input": build_input}

    try:
        request("POST", "/internal/jobs", payload, authenticated=False)
    except urllib.error.HTTPError as error:
        if error.code not in (401, 403):
            raise RuntimeError(f"Unauthenticated job request returned HTTP {error.code}.") from None
    else:
        raise RuntimeError("Processing endpoint unexpectedly accepted an unauthenticated request.")
    print("PASS: private processing endpoint requires authentication.")

    accepted = request("POST", "/internal/jobs", payload)
    if accepted.get("jobId") != job_id:
        raise RuntimeError("Accepted job ID did not match the submitted job.")
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        job = request("GET", f"/internal/jobs/{job_id}")
        if job.get("status") == "succeeded":
            break
        if job.get("status") == "failed":
            raise RuntimeError(f"Geometry smoke job failed: {job.get('error', 'no error details')}")
        time.sleep(0.5)
    else:
        raise RuntimeError("Geometry smoke job did not complete within 45 seconds.")

    result = job["result"]
    by_alias = {unit["alias"]: unit for unit in result["units"]}
    for alias, expected in [("SMOKE-LOWER", 96), ("SMOKE-UPPER", 102.4)]:
        if not math.isclose(by_alias[alias]["volume"], expected, abs_tol=1e-7):
            raise RuntimeError(f"Unexpected volume for {alias}.")
    overlap_volume = sum(finding.get("overlap", {}).get("volume", 0) for finding in result["findings"])
    if not math.isclose(overlap_volume, 6.4, abs_tol=1e-7):
        raise RuntimeError(f"Expected 6.4 cubic metres overlap; got {overlap_volume}.")
    if result.get("inputFingerprint") != build_input["inputFingerprint"]:
        raise RuntimeError("Result lost its input fingerprint.")
    print("PASS: real queued geometry produced volumes 96 / 102.4 m³ and overlap 6.4 m³.")

    duplicate = request("POST", "/internal/jobs", payload)
    if duplicate.get("jobId") != job_id or duplicate.get("status") != "succeeded":
        raise RuntimeError("Retrying a completed logical job was not idempotent.")
    changed = json.loads(json.dumps(payload))
    changed["input"]["units"][1]["lower"] = 3
    try:
        request("POST", "/internal/jobs", changed)
    except urllib.error.HTTPError as error:
        if error.code != 409:
            raise RuntimeError(f"Conflicting job reuse returned HTTP {error.code}; expected 409.") from None
    else:
        raise RuntimeError("Processing API accepted different input under the same job ID.")
    print("PASS: duplicate jobs are idempotent; conflicting job reuse returns HTTP 409.")
    print("Platform processing smoke passed.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, urllib.error.URLError, KeyError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
