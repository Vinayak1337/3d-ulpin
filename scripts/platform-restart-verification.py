#!/usr/bin/env python3
"""Verify launcher recovery and persistent data across a coordinated stack restart."""

import argparse
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:3000"


def read_json(route):
    with urllib.request.urlopen(BASE + "/api/v1" + route, timeout=15) as response:
        return json.load(response)


def fingerprint(value):
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()


def run(command, timeout=150):
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        # Commands print only operational status, never resolved environment values.
        raise RuntimeError(f"Command {' '.join(command)} failed: {(result.stderr or result.stdout)[-1000:]}")
    return result.stdout


def compose(action, service):
    return run(["bash", "-c", 'source scripts/platform-lib.sh; ulpin_compose --profile app "$1" "$2"', "bash", action, service], timeout=35)


def listeners():
    output = run(["lsof", "-nP", "-i4TCP@127.0.0.1:3000", "-sTCP:LISTEN", "-t"], timeout=5)
    pids = sorted(set(output.split()))
    assert len(pids) == 1, f"Expected one port3000 web listener, got {len(pids)}."
    return pids


def wait_healthy(timeout=40):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            health = read_json("/health")
            if health.get("ok"):
                return health
        except (urllib.error.URLError, ValueError):
            pass
        time.sleep(0.5)
    raise AssertionError("Application health did not recover within the deadline.")


def source_record(source):
    with urllib.request.urlopen(BASE + f"/api/v1/sources/{source['id']}/file", timeout=15) as response:
        payload = response.read()
    digest = hashlib.sha256(payload).hexdigest()
    assert len(payload) == source["bytes"], f"Byte count changed for source {source['id']}."
    assert digest == source["sha256"], f"Stored original hash mismatch for source {source['id']}."
    return {key: source[key] for key in ["id", "familyId", "revision", "name", "bytes", "sha256", "status"]} | {"downloadSha256": digest}


def snapshot():
    records = []
    for case in sorted(read_json("/cases"), key=lambda value: value["id"]):
        detail = read_json(f"/cases/{case['id']}")
        pending = [job for job in detail["jobs"] if job["status"] in ["queued", "running"]]
        assert not pending, f"Case {case['id']} has active processing; wait before disrupting services."
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            sources = list(pool.map(source_record, detail["sources"]))
        model = detail["model"]
        records.append({
            "caseId": case["id"], "name": case["name"], "revision": case["revision"],
            "candidateFingerprint": fingerprint(detail["units"]),
            "unitRevisions": [{"id": unit["id"], "revision": unit["revision"]} for unit in detail["units"]],
            "model": None if model is None else {
                "id": model["id"], "revision": model["revision"],
                "inputFingerprint": model["inputFingerprint"],
                "completeModelSha256": fingerprint(model),
                "findingIds": [finding["id"] for finding in model["findings"]],
                "findingsSha256": fingerprint(model["findings"]),
            },
            "sources": sorted(sources, key=lambda source: source["id"]),
        })
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-disruptive-checks", action="store_true", help="Confirm a coordinated idle window; this briefly stops the shared Docker stack.")
    if not parser.parse_args().run_disruptive_checks:
        parser.error("Use --run-disruptive-checks only in a coordinated idle window.")
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    assert read_json("/health")["ok"] is True
    initial_listener = listeners()
    before = snapshot()
    checkpoint = ROOT / "test-results/platform-restart-before.json"
    checkpoint.parent.mkdir(exist_ok=True)
    checkpoint.write_text(json.dumps({"capturedAt": started, "webListenerPids": initial_listener, "cases": before}, indent=2) + "\n")
    print(f"Captured {len(before)} cases, {sum(bool(case['model']) for case in before)} current models, and {sum(len(case['sources']) for case in before)} original source hashes.", flush=True)

    worker_down = None
    recovered = False
    try:
        compose("stop", "worker")
        worker_down = read_json("/health")
        assert worker_down["ok"] is False and worker_down["services"]["worker"] is False, worker_down
        assert all(worker_down["services"][name] for name in ["database", "storage", "processor", "redis"]), worker_down
        print("PASS worker stop is visible in application health; running pnpm demo recovery.", flush=True)
        launcher_output = run(["pnpm", "demo"])
        assert "Processing services recovered." in launcher_output, "Launcher did not take the existing-web recovery path."
        wait_healthy()
        assert listeners() == initial_listener, "Launcher replaced or duplicated the existing web server."
        recovered = True
    finally:
        if not recovered:
            compose("start", "worker")
            wait_healthy()
    print("PASS pnpm demo recovered the worker and returned without a second web server.", flush=True)

    try:
        run(["bash", "scripts/platform-stop.sh"])
        print("Stopped complete Docker application stack; persistent volumes retained.", flush=True)
    finally:
        run(["bash", "scripts/platform-start.sh"])
        wait_healthy()
    assert listeners() == initial_listener, "Docker stack restart unexpectedly changed the host web listener."
    after = snapshot()
    assert after == before, "Case IDs, revisions, candidate/model data, findings, or original source hashes changed across restart."
    final_health = read_json("/health")
    assert final_health["ok"] is True
    evidence = {
        "startedAt": started, "completedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "target": BASE, "status": "PASS", "webListenerPidsBeforeAndAfter": initial_listener,
        "launcherRecovery": {"command": "pnpm demo", "workerDownHealth": worker_down, "sameWebListener": True},
        "stackRestart": {"stop": "bash scripts/platform-stop.sh", "start": "bash scripts/platform-start.sh", "volumesRemoved": False},
        "finalHealth": final_health, "before": before, "after": after,
    }
    destination = ROOT / "test-results/platform-restart-verification.json"
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(evidence, indent=2) + "\n")
    print("PASS all case/model IDs, revisions, findings and original source hashes survived complete Docker stack restart.", flush=True)
    print(f"PASS all services healthy; evidence: {destination.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    main()
