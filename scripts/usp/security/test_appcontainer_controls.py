"""Bounded local regression controls for NET-01; no sockets or model execution.

Use a freshly compiled net01_probe.exe in a new owned correction directory.
Receipts stay there; only that directory's temporary SID grants are changed.
"""

from __future__ import annotations

import argparse
import contextlib
import copy
import ctypes
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid
from unittest.mock import patch

import appcontainer_audit as audit


def profile():
    name = "CodexNet01Correction_" + uuid.uuid4().hex
    sid = audit.w.LPVOID()
    result = audit.uenv.CreateAppContainerProfile(name, name, "owned local correction control",
                                                 None, 0, ctypes.byref(sid))
    if result != 0:
        raise OSError(result, "CreateAppContainerProfile")
    return name, sid


def grant(paths, expected_sid, tracked):
    for path in paths:
        tracked.append(path)
        result = subprocess.run(["icacls", str(path), "/grant", f"*{expected_sid}:(RX)"],
                                capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            raise RuntimeError(f"owned grant failed: {path}: {result.returncode}")


def capture_cleanup(paths, expected_sid, name, sid):
    output = io.StringIO()
    with contextlib.redirect_stderr(output):
        audit.cleanup_scope(paths, expected_sid, name, sid)
    return [json.loads(line) for line in output.getvalue().splitlines()]


def assert_revoked(paths, expected_sid):
    for path in paths:
        result = subprocess.run(["icacls", str(path)], capture_output=True, text=True, timeout=30)
        assert result.returncode == 0 and expected_sid not in result.stdout, (path, result.stdout)


def token_rejection(exe, sid, field, value, job_bytes):
    """Inspect the real suspended process, alter one observation, and verify it dies unresumed."""
    real_token = audit.token_data
    real_resume = audit.k32.ResumeThread
    retained = audit.w.HANDLE()
    observations, resumes = [], []
    audit.k32.GetCurrentProcess.restype = audit.w.HANDLE
    audit.k32.DuplicateHandle.argtypes = [audit.w.HANDLE, audit.w.HANDLE, audit.w.HANDLE,
                                        ctypes.POINTER(audit.w.HANDLE), audit.w.DWORD,
                                        audit.w.BOOL, audit.w.DWORD]

    def altered(process):
        observed = real_token(process)
        observations.append(observed.copy())
        current = audit.k32.GetCurrentProcess()
        if not audit.k32.DuplicateHandle(current, process, current, ctypes.byref(retained), 0, False, 2):
            raise audit.win_error("DuplicateHandle test observation")
        return {**observed, field: value}

    def resume(thread):
        resumes.append(True)
        return real_resume(thread)

    try:
        with patch.object(audit, "token_data", altered), patch.object(audit.k32, "ResumeThread", resume):
            try:
                audit.launch(exe, [], sid, 5000, job_memory_bytes=job_bytes)
            except RuntimeError as error:
                assert "token rejected before resume" in str(error), str(error)
            else:
                raise AssertionError("invalid token was accepted")
        assert len(observations) == 1 and not resumes
        assert retained.value and audit.k32.WaitForSingleObject(retained, 0) == 0
        code = audit.w.DWORD()
        assert audit.k32.GetExitCodeProcess(retained, ctypes.byref(code)) and code.value != 259
        return {"field": field, "injectedValue": value, "jobBytes": job_bytes,
                "actualToken": observations[0], "resumeCalls": len(resumes), "terminatedExitCode": code.value}
    finally:
        if retained.value:
            audit.k32.CloseHandle(retained)


def descendant_negatives(observation, expected_sid):
    changes = [({"isAppContainer": False}, None), ({"appContainerSid": "S-1-0-0"}, None),
               ({"capabilityCount": 1}, None), ({}, "capabilityCount")]
    rejected = []
    for values, missing in changes:
        bad = copy.deepcopy(observation)
        rows = [json.loads(line) for line in bad["output"].splitlines()]
        child = next(row for row in rows if row.get("role") == "descendantBeforeResume")
        child.update(values)
        if missing:
            del child[missing]
        bad["output"] = "\n".join(json.dumps(row) for row in rows)
        try:
            audit.validate_descendant(bad, expected_sid)
        except RuntimeError:
            rejected.append({"changed": values, "missing": missing})
        else:
            raise AssertionError("invalid descendant token accepted")
    bad = copy.deepcopy(observation)
    rows = [json.loads(line) for line in bad["output"].splitlines()]
    next(row for row in rows if row.get("kind") == "childResult")["exitCode"] = 9
    bad["output"] = "\n".join(json.dumps(row) for row in rows)
    try:
        audit.validate_descendant(bad, expected_sid)
    except RuntimeError:
        rejected.append({"childExitCode": 9})
    else:
        raise AssertionError("failed descendant exit accepted")
    return rejected


def cleanup_failure(root, mode):
    """Perform the real cleanup first, then inject a reporting failure."""
    paths = [root / (mode + "-first"), root / (mode + "-second")]
    for path in paths:
        path.mkdir()
    name, sid = profile()
    expected_sid = audit.sid_string(sid)
    tracked, actions = [], []
    real_run = audit.subprocess.run
    real_free = audit.adv.FreeSid
    real_delete = audit.uenv.DeleteAppContainerProfile
    freed = deleted = False

    def run(*args, **kwargs):
        result = real_run(*args, **kwargs)
        if "/remove:g" in args[0]:
            actions.append({"revoke": args[0][1], "actualExitCode": result.returncode})
            assert result.returncode == 0
            if len(actions) == 1:
                if mode == "revoke-exception":
                    raise OSError("injected reporting exception after real revocation")
                if mode == "revoke-nonzero":
                    result.returncode = 1
        return result

    def free(pointer):
        nonlocal freed
        result = real_free(pointer)
        freed = not bool(result)
        actions.append({"sidFreed": freed})
        if mode == "free-exception":
            raise OSError("injected reporting exception after real SID free")
        return result

    def delete(profile_name):
        nonlocal deleted
        result = real_delete(profile_name)
        deleted = result == 0
        actions.append({"profileDeleted": deleted, "actualHresult": result})
        return -1 if mode == "profile-nonzero" else result

    try:
        grant(paths, expected_sid, tracked)
        with patch.object(audit.subprocess, "run", run), patch.object(audit.adv, "FreeSid", free), \
                patch.object(audit.uenv, "DeleteAppContainerProfile", delete):
            try:
                capture_cleanup(tracked, expected_sid, name, sid)
            except audit.CleanupError as error:
                outcomes = error.outcomes
            else:
                raise AssertionError("cleanup failure did not fail audit")
        assert len(actions) == 4 and freed and deleted, actions
        assert_revoked(paths, expected_sid)
        return {"mode": mode, "expectedSid": expected_sid, "actions": actions, "outcomes": outcomes,
                "remainingOwnedSidGrants": 0}
    finally:
        # Recovery also covers setup/assertion errors; never free a SID twice.
        if not freed:
            capture_cleanup(tracked, expected_sid, name, sid)
        elif not deleted:
            assert real_delete(name) == 0


def body_failure():
    cleanup = []
    real_cleanup = audit.cleanup_scope

    def captured(*args):
        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            real_cleanup(*args)
        cleanup.extend(json.loads(line) for line in output.getvalue().splitlines())

    with patch.object(sys, "argv", ["appcontainer_audit.py"]), \
            patch.object(audit, "launch", side_effect=RuntimeError("injected body failure")), \
            patch.object(audit, "cleanup_scope", captured):
        try:
            audit.main()
        except RuntimeError as error:
            assert str(error) == "injected body failure"
        else:
            raise AssertionError("body failure was swallowed")
    assert len(cleanup) == 2 and all(not row["failed"] for row in cleanup)
    return {"bodyFailurePropagated": True, "cleanup": cleanup}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    if not root.name.startswith("net01-correction-") or (root / "controls.json").exists():
        raise ValueError("requires a fresh owned net01-correction-* directory")
    exe = (root / "net01_probe.exe").resolve(strict=True)
    marker = root / "handle-marker.txt"
    marker.write_text("NET01_LOCAL_HANDLE_SENTINEL", encoding="ascii")
    sentinel = None
    name, sid = profile()
    expected_sid = audit.sid_string(sid)
    tracked = []
    receipt = {"profile": name, "expectedSid": expected_sid,
               "probeSha256": hashlib.sha256(exe.read_bytes()).hexdigest()}
    try:
        grant([root, exe], expected_sid, tracked)
        sa = audit.SECURITY_ATTRIBUTES(ctypes.sizeof(audit.SECURITY_ATTRIBUTES), None, True)
        sentinel = audit.k32.CreateFileW(str(marker), 0x80000000, 0x3, ctypes.byref(sa), 3, 0, None)
        assert sentinel and sentinel != ctypes.c_void_p(-1).value
        startup = subprocess.STARTUPINFO(lpAttributeList={"handle_list": [sentinel]})
        positive = subprocess.run([str(exe), "handle", str(sentinel)], startupinfo=startup,
                                  close_fds=True, capture_output=True, text=True, timeout=5)
        positive_row = json.loads(positive.stdout)
        assert positive.returncode == 0 and positive_row["readSucceeded"] and positive_row["markerPresent"]
        receipt["sentinelPositive"] = positive_row
        receipt["sentinelBlocked"] = []
        for job in (None, 128 * 1024**2):
            observation = audit.launch(exe, ["handle", str(sentinel)], sid, 5000, job_memory_bytes=job)
            row = json.loads(observation["output"])
            assert observation["exitCode"] == 0 and not row["readSucceeded"] and not row["markerPresent"]
            assert row["error"] == 6, row
            receipt["sentinelBlocked"].append({"jobBytes": job, "observation": observation})
        receipt["rejectedBeforeResume"] = [
            token_rejection(exe, sid, field, value, job)
            for job in (None, 128 * 1024**2)
            for field, value in (("isAppContainer", False), ("appContainerSid", "S-1-0-0"), ("capabilityCount", 1))]
        descendant = audit.launch(exe, ["child"], sid, 5000, job_memory_bytes=128 * 1024**2)
        audit.validate_descendant(descendant, expected_sid)
        receipt["descendant"] = descendant
        receipt["descendantRejected"] = descendant_negatives(descendant, expected_sid)
    finally:
        if sentinel and sentinel != ctypes.c_void_p(-1).value:
            audit.k32.CloseHandle(sentinel)
        receipt["cleanup"] = capture_cleanup(tracked, expected_sid, name, sid)
    assert_revoked(tracked, expected_sid)
    receipt["remainingOwnedSidGrants"] = 0
    receipt["cleanupFailures"] = [cleanup_failure(root, mode) for mode in
                                 ("revoke-nonzero", "revoke-exception", "free-exception", "profile-nonzero")]
    receipt["bodyFailure"] = body_failure()
    receipt["sourceSha256"] = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in
                               (Path(audit.__file__), Path(__file__), Path(__file__).with_name("net01_probe.c"))}
    receipt["status"] = "local_controls_pass"
    (root / "controls.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": receipt["status"], "receipt": str(root / "controls.json")}))


if __name__ == "__main__":
    main()
