"""Mandatory local Qwen containment. Acquisition and E5 are separate routes.

The OS token/Job boundary precedes interpreter startup. The -I -S bootstrap
verifies it again before adding pinned package paths or executing model roles.
Child outputs are provisional until the host writes an acceptance receipt.
"""
from __future__ import annotations

import contextlib
import ctypes
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import stat
import subprocess
import sys
import time
import types
import uuid

STAGING_PARENT = Path("E:/BhuAayam-data/task-data/desktop-model-egress-enforcement")
ASSOCIATION_STAGING_PARENT = Path("E:/BhuAayam-data/task-data/ml-distillation/student")
SHELL = Path("C:/Users/kvina/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe")
SHELL_SHA = "362a356ce7f0940ec74f73a8fc2c990a2cc24a38a11c90bbd8eca947110ad139"
MODULE_SHA = "60e8b93ee7a9111d38912c7d45ce83a56dccf772bd974b96bd3cc4c678744560"
HELPER = "scripts/usp/learning/model_isolation.py"
HARNESS = "scripts/usp/security/appcontainer_audit.py"
# Canonical LF source of the reviewed primitive at candidate 2f0928e. Early
# token checks have no profile yet; reject source drift before executing it.
HARNESS_SOURCE_SHA256 = "4a59a18e04cd6fe76590ba929f424271f3dacdfb19ccf5e65fc2ec8048fbdc7f"
ASSOCIATION_ROLE = "association_student.py"
ROLES = ("compare_reranker.py", "train_reranker_lora.py", "control.py", ASSOCIATION_ROLE)
READONLY = ("runtime", "code", "inputs", "model")
_BOUNDARY = None


def require(value, message):
    if not value:
        raise RuntimeError("Qwen containment: " + message)


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024**2), b""):
            digest.update(block)
    return digest.hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write(path, value):
    with Path(path).open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
        stream.write("\n")


def safe_path(root, relative):
    require(isinstance(relative, str) and not Path(relative).is_absolute(), "relative staged path required")
    path = root / relative
    require(path.absolute() == path.resolve() and path.is_relative_to(root), "path escapes or redirects staging")
    for item in (path, *path.parents):
        if item.exists():
            require(not (item.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT), "reparse path rejected")
        if item == root:
            break
    return path


def audit_module(path, expected_source_sha256=None):
    require(os.name == "nt", "Windows AppContainer profile required; no fallback")
    raw = Path(path).read_bytes()
    source = raw.replace(b"\r\n", b"\n")
    require(hashlib.sha256(source).hexdigest() == HARNESS_SOURCE_SHA256, "harness source SHA256 drift before execution")
    if expected_source_sha256 is not None:
        require(hashlib.sha256(raw).hexdigest() == expected_source_sha256, "profile harness source SHA256 drift before execution")
    # The canonical bytes verified above are exactly the compile input. Host
    # caches are neither read nor deleted; supported checkout EOLs stay pinned.
    module = types.ModuleType("model_appcontainer")
    module.__file__ = str(path)
    exec(compile(source, str(path), "exec"), module.__dict__)
    return module


def load_profile(path, digest, *, host=True):
    require(os.name == "nt", "Windows AppContainer profile required; no fallback")
    require(path is not None and isinstance(digest, str) and len(digest) == 64, "explicit profile and SHA256 required")
    path = Path(path).absolute()
    root = path.parent
    if host:
        for parent in root.parents:
            require(not (parent.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT), "reparse staging ancestor rejected")
    require(root.parent in (STAGING_PARENT, ASSOCIATION_STAGING_PARENT) and path.name == "profile.json", "new task-private profile required")
    safe_path(root, path.name)
    require(sha(path) == digest, "profile SHA256 drift")
    profile = read(path)
    require(profile["schemaVersion"] == "usp-qwen-containment-v1", "unsupported profile")
    require(profile["root"] == str(root), "profile root drift")
    require(type(profile["jobMemoryBytes"]) is int and 0 < profile["jobMemoryBytes"] <= 6 * 1024**3,
            "invalid declared Job cap")
    require(type(profile["timeoutSeconds"]) is int and 0 < profile["timeoutSeconds"] <= 600, "invalid deadline")
    actual = {}
    for directory in READONLY:
        parent = safe_path(root, directory)
        require(parent.is_dir(), "missing readonly staging directory")
        for item in parent.rglob("*"):
            safe_path(root, item.relative_to(root).as_posix())
            if item.is_file():
                actual[item.relative_to(root).as_posix()] = sha(item)
    require(actual == profile["files"], "staged code/runtime/input/model bytes drift")
    for relative in ("python", *profile["packageRoots"]):
        if relative == "python":
            executable = safe_path(root, profile["python"])
            require(executable.is_file() and profile["python"].startswith("runtime/"), "pinned runtime executable required")
        else:
            require(relative.startswith("runtime/") and safe_path(root, relative).is_dir(), "pinned package path required")
    for relative in (("outputs", "scratch", "state", "receipts") if host else ("outputs", "scratch", "state")):
        require(safe_path(root, relative).is_dir(), "missing owned output/control scope")
    return root, profile


def native_boundary(api, expected_sid, memory_bytes):
    try:
        token = api.token_data(api.w.HANDLE(-1))
    except OSError as error:
        raise RuntimeError("Qwen containment: uncontained role refused; token could not be verified") from error
    api.require_container_token(token, expected_sid)
    limits = api.job_limits(None, api.w.HANDLE(-1), memory_bytes)
    return {"token": token, "effectiveJob": limits}


def require_model_boundary(args=None):
    """Environment markers locate evidence; only real OS token/Job permits roles."""
    api = audit_module(Path(__file__).resolve().parents[3] / HARNESS)
    try:
        token = api.token_data(api.w.HANDLE(-1))
    except OSError as error:
        raise RuntimeError("Qwen containment: uncontained role refused before model/dependency imports; token could not be verified") from error
    # Fail before reading a supplied profile, session or any model/private input.
    require(token.get("isAppContainer") is True and token.get("capabilityCount") == 0,
            "uncontained role refused before model/dependency imports")
    session_path = os.environ.get("USP_MODEL_SESSION")
    session_sha = os.environ.get("USP_MODEL_SESSION_SHA256")
    require(session_path and session_sha and sha(session_path) == session_sha, "missing or changed launch session")
    session = read(session_path)
    global _BOUNDARY
    if _BOUNDARY is None:
        root, profile = load_profile(session["profile"], session["profileSha256"], host=False)
        _BOUNDARY = (root, profile, session_sha)
    else:
        root, profile, cached_session_sha = _BOUNDARY
        require(cached_session_sha == session_sha and sha(session["profile"]) == session["profileSha256"], "active profile/session drift")
    require(Path(session_path).parent == root / "state", "session escapes owned control scope")
    require(session["jobMemoryBytes"] == profile["jobMemoryBytes"], "session cap drift")
    native_boundary(api, session["sid"], session["jobMemoryBytes"])
    require(sha(__file__) == profile["files"]["code/" + HELPER], "bootstrap code drift")
    if args is not None:
        require(Path(args.containment_profile) == Path(session["profile"])
                and args.containment_sha256 == session["profileSha256"], "role profile differs from launch")
        require(Path(args.output_dir).is_relative_to(root / "outputs"), "role output escapes provisional scope")
    return root, profile, session


def local_model_path():
    root, _, _ = require_model_boundary()
    return root / "model"


def explicit_environment(root, session_path):
    windows = str(Path(os.environ.get("SystemRoot", "C:/Windows")).resolve())
    return {"SystemRoot": windows, "WINDIR": windows, "SystemDrive": Path(windows).drive,
            "ComSpec": windows + "\\System32\\cmd.exe", "PATH": windows + "\\System32;" + windows,
            "TEMP": str(root / "scratch"), "TMP": str(root / "scratch"),
            "USERPROFILE": str(root / "scratch"), "LOCALAPPDATA": str(root / "scratch"),
            "HF_HOME": str(root / "scratch/hf"), "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
            "HF_HUB_DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1", "WANDB_DISABLED": "true",
            "TOKENIZERS_PARALLELISM": "false", "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2",
            "CUBLAS_WORKSPACE_CONFIG": ":4096:8", "USP_MODEL_SESSION": str(session_path),
            "USP_MODEL_SESSION_SHA256": sha(session_path)}


def checked_command(root, profile, command, profile_path, profile_sha):
    require(len(command) >= 3 and Path(command[1]).name in ROLES, "known pinned Qwen role required")
    role = Path(command[1]).name
    association = role == ASSOCIATION_ROLE
    require(root.parent == (ASSOCIATION_STAGING_PARENT if association else STAGING_PARENT), "role staging scope mismatch")
    script = safe_path(root, "code/scripts/usp/learning/association/" + role if association else
                       ("code/control.py" if role == "control.py" else "code/scripts/usp/learning/" + role))
    require(script.relative_to(root).as_posix() in profile["files"], "role code is not pinned")
    args = list(command[2:])
    require(args[0] in ("prepare", "run"), "only prepare/run roles allowed")
    allowed = {"--corpus", "--input-proof", "--originals-dir", "--retained-dir", "--baseline-dir",
               "--e5-result", "--output-dir", "--containment-profile", "--containment-sha256"}
    if association:
        require(args[0] == "run", "association baseline exposes only run")
        allowed = {"--input-batch", "--schema", "--family-freeze", "--model-receipt", "--run-freeze",
                   "--output-dir", "--containment-profile", "--containment-sha256"}
    seen = set()
    require(len(args[1:]) % 2 == 0, "explicit role arguments required")
    for key, value in zip(args[1::2], args[2::2]):
        require(key in allowed and key not in seen, "unknown/duplicate role argument")
        seen.add(key)
        if key == "--containment-sha256":
            require(value == profile_sha, "command profile pin mismatch")
        elif key == "--containment-profile":
            require(Path(value) == profile_path, "command profile mismatch")
        else:
            path = Path(value)
            require(path.is_absolute() and path.is_relative_to(root), "role path outside owned stage")
            safe_path(root, path.relative_to(root).as_posix())
            require(path.is_relative_to(root / "outputs") if key == "--output-dir"
                    else any(path.is_relative_to(root / directory) for directory in READONLY), "role path scope mismatch")
            if association and key != "--output-dir":
                require(path.is_relative_to(root / "inputs") and path.is_file(), "association input must be a pinned input file")
    require({"--output-dir", "--containment-profile", "--containment-sha256"} <= seen, "missing contained role arguments")
    if association:
        require(seen == allowed, "missing association input arguments")
    return script, args


def accept_launch(observation, cap, cleanup):
    require(observation.get("exitCode") == 0 and observation.get("outputTruncated") is False,
            "child exit/output rejected")
    require(observation.get("tokenValidatedBeforeResume") is True and observation.get("jobValidatedBeforeResume") is True,
            "missing pre-resume boundary evidence")
    require(observation.get("jobClosed") is True, "missing owned Job cleanup evidence")
    effective = observation.get("effectiveJobBeforeResume", {})
    require(effective.get("limitFlags") == 0x2200 and effective.get("jobMemoryLimitBytes") == cap, "effective cap evidence rejected")
    peak = observation.get("peakJobMemoryBytes")
    require(type(peak) is int and 0 < peak <= cap, "missing/invalid/over-limit Job peak; outputs remain provisional")
    require(cleanup.get("passed") is True, "cleanup failed; outputs remain provisional")


def launch_model(command, output_dir, limits, profile_path, profile_sha):
    root, profile = load_profile(profile_path, profile_sha)
    profile_path = Path(profile_path).absolute()
    script, args = checked_command(root, profile, command, profile_path, profile_sha)
    require(Path(output_dir).absolute() == root / "receipts", "host guard receipt must use protected receipt scope")
    require(profile["jobMemoryBytes"] <= limits["maxPeakProcessRssBytes"] and profile["timeoutSeconds"] <= limits["maxRunSeconds"],
            "profile exceeds caller resource budget")
    for relative in (HELPER, HARNESS):
        require(sha(Path(__file__).resolve().parents[3] / relative) == profile["files"]["code/" + relative], "launch/bootstrap code drift")
    api = audit_module(Path(__file__).resolve().parents[3] / HARNESS, profile["files"]["code/" + HARNESS])
    label = script.stem + "-" + args[0]
    write(root / "state" / (label + "-attempt.json"), {"profileSha256": profile_sha, "oneAttemptIncludingFailure": True})
    name = "CodexQwen_" + uuid.uuid4().hex
    sid = api.w.LPVOID()
    granted, owner_scopes, commands = [], [], []
    profile_created = False
    expected_sid, observation, failure, cleanup = None, {}, None, {"passed": False}
    started = time.monotonic()

    def cmd(argv):
        entry = {"argv": argv}
        try:
            result = subprocess.run(argv, capture_output=True, text=True, timeout=30)
            entry.update(exitCode=result.returncode, stdout=result.stdout, stderr=result.stderr)
        except BaseException as error:
            entry.update(errorType=type(error).__name__, message=str(error))
            raise
        finally:
            commands.append(entry)
        require(result.returncode == 0, "owned ACL/metadata command failed")
        return result.stdout

    def owner(path):
        literal = str(path).replace("'", "''")
        ps = "$ErrorActionPreference='Stop';$a=Get-Acl -LiteralPath '" + literal + "';" \
             "$s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;" \
             "@{owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;sid=$s;sddl=$a.Sddl}|ConvertTo-Json -Compress"
        return json.loads(cmd([str(SHELL), "-NoProfile", "-NonInteractive", "-Command", ps]))

    try:
        require(sha(SHELL) == SHELL_SHA and sha(SHELL.parent / "Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1") == MODULE_SHA,
                "metadata shell/module pins changed")
        for path in [root, *root.rglob("*")]:
            safe_path(root, path.relative_to(root).as_posix())
        for path in (root, *(root / p for p in (*READONLY, "outputs", "scratch", "state", "receipts"))):
            facts = owner(path)
            require(facts["owner"] == facts["sid"], "staging scope not owned by current account")
        for path in (root / "outputs", root / "scratch"):
            facts = owner(path)
            require(f";;;{facts['sid']})" not in facts["sddl"], "existing explicit owner grants rejected")
            owner_scopes.append((path, facts["sid"]))
            cmd(["icacls", str(path), "/grant", f"*{facts['sid']}:(WO)"])
            cmd(["icacls", str(path), "/setintegritylevel", "(OI)(CI)L"])
            facts = owner(path)
            require(f"(A;;WO;;;{facts['sid']})" in facts["sddl"], "owner WO readback mismatch")
            require("Low Mandatory Level:(OI)(CI)(NW)" in cmd(["icacls", str(path)]), "low label readback mismatch")
        require(api.uenv.CreateAppContainerProfile(name, name, "pinned local Qwen execution", None, 0, ctypes.byref(sid)) == 0,
                "AppContainer profile creation failed")
        profile_created = True
        expected_sid = api.sid_string(sid)
        session_path = root / "state" / (label + "-session.json")
        write(session_path, {"profile": str(profile_path), "profileSha256": profile_sha, "sid": expected_sid,
              "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=Path(__file__).resolve().parents[3], text=True).strip(),
              "jobMemoryBytes": profile["jobMemoryBytes"], "script": str(script), "args": args})
        scopes = [(root, "(RX)"), (profile_path, "(R)"), (root / "state", "(RX)"), (session_path, "(R)")]
        scopes += [(root / directory, "(OI)(CI)(RX)") for directory in READONLY]
        scopes += [(root / directory, "(OI)(CI)(M)") for directory in ("outputs", "scratch")]
        for path, rights in scopes:
            granted.append(path)
            cmd(["icacls", str(path), "/grant", f"*{expected_sid}:{rights}"])
        bootstrap = root / "code" / HELPER
        observation = api.launch(root / profile["python"], ["-B", "-I", "-S", str(bootstrap), "--bootstrap"], sid,
                                profile["timeoutSeconds"] * 1000, job_memory_bytes=profile["jobMemoryBytes"],
                                explicit_environment=explicit_environment(root, session_path), rss_limit_bytes=limits["maxPeakProcessRssBytes"])
    except BaseException as error:
        failure = {"type": type(error).__name__, "message": str(error)}
    finally:
        failures = []
        cleanup_log = io.StringIO()
        try:
            if profile_created:
                with contextlib.redirect_stderr(cleanup_log):
                    api.cleanup_scope(granted, expected_sid, name, sid)
        except BaseException as error:
            failures.append(str(error))
        for path, owner_sid in reversed(owner_scopes):
            for argv in (["icacls", str(path), "/setintegritylevel", "(OI)(CI)M"],
                         ["icacls", str(path), "/remove:g", "*" + owner_sid]):
                try:
                    cmd(argv)
                except BaseException as error:
                    failures.append(str(error))
            try:
                require(f";;;{owner_sid})" not in owner(path)["sddl"], "owner grant remains after cleanup")
                require("Medium Mandatory Level:(OI)(CI)(NW)" in cmd(["icacls", str(path)]), "Medium restoration failed")
            except BaseException as error:
                failures.append(str(error))
        cleanup = {"passed": not failures, "errors": failures, "appcontainerActions": cleanup_log.getvalue(),
                   "ownerScopesAttempted": len(owner_scopes), "profileCreated": profile_created}
    try:
        require(failure is None, str(failure))
        api.require_container_token(observation.get("token", {}), expected_sid)
        rss = observation.get("peakProcessRssBytes")
        require(type(rss) is int and 0 < rss <= limits["maxPeakProcessRssBytes"], "missing/invalid/over-limit RSS evidence")
        accept_launch(observation, profile["jobMemoryBytes"], cleanup)
        for item in (root / "outputs", *(root / "outputs").rglob("*")):
            safe_path(root, item.relative_to(root).as_posix())
    except BaseException as error:
        failure = failure or {"type": type(error).__name__, "message": str(error)}
    receipt = {"exitCode": 1 if failure else 0, "failure": failure, "observation": observation,
               "cleanup": cleanup, "commands": commands, "profile": name, "sid": expected_sid,
               "profileSha256": profile_sha, "elapsedSeconds": time.monotonic() - started,
               "limits": limits, "outputsAccepted": failure is None}
    if failure is None and args[0] == "run" and script.name != "control.py":
        try:
            destination = Path(args[args.index("--output-dir") + 1])
            if script.name == "compare_reranker.py":
                write(destination / "run/run.json", {**read(destination / "run/result.json"), "supervisor": receipt})
            elif script.name == ASSOCIATION_ROLE:
                write(destination / "completion.json", {"supervisor": receipt,
                      "runFreezeSha256": sha(Path(args[args.index("--run-freeze") + 1])),
                      "rawOutputsSha256": sha(destination / "raw-outputs.json"), "resultSha256": sha(destination / "result.json"),
                      "evaluationOpened": False, "qualification": "source_native_development_only", "promoted": False})
            else:
                write(destination / "completion.json", {"supervisor": receipt, "freezeSha256": sha(destination / "freeze.json"),
                      "artifacts": {p.relative_to(destination).as_posix(): sha(p) for p in destination.rglob("*") if p.is_file()},
                      "evaluationOpened": False, "diagnosticSplitOpened": False, "promoted": False})
        except BaseException as error:
            receipt.update(exitCode=1, outputsAccepted=False, failure={"type": type(error).__name__, "message": str(error)})
            failure = receipt["failure"]
    receipt_path = root / "receipts" / (label + "-guard.json")
    write(receipt_path, receipt)
    if failure is None:
        write(root / "receipts" / (label + "-accepted.json"), {"guardSha256": sha(receipt_path),
              "profileSha256": profile_sha, "artifacts": {p.relative_to(root / "outputs").as_posix(): sha(p)
              for p in (root / "outputs").rglob("*") if p.is_file()}})
    return receipt


def bootstrap():
    root, profile, session = require_model_boundary()
    # -S prevents .pth/site execution; pinned paths are enabled only after token/Job checks.
    sys.path[:0] = [str(root / "code/services/geo"), str(root / "code/scripts/usp/learning"),
                   *(str(root / item) for item in profile["packageRoots"])]
    sys.modules["model_isolation"] = sys.modules[__name__]
    sys.argv = [session["script"], *session["args"], "--_worker"]
    runpy.run_path(session["script"], run_name="__main__")


if __name__ == "__main__":
    require(sys.argv[1:] == ["--bootstrap"], "only the restricted bootstrap role is exposed")
    bootstrap()
