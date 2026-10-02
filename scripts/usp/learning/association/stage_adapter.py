"""Fresh fit/reload stages, reusing only the accepted baseline runtime/model bytes."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import uuid
import zipfile

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "scripts/usp/learning"), str(REPO / "services/geo"), str(Path(__file__).resolve().parent)]
import model_isolation as isolation
from geo.usp_learning.association.adapter import FIT, NUMERICS, V1_SHA, V2_SHA, checked_teacher, verify_adapter_files
from geo.usp_learning.association.student import SETTINGS, SYSTEM_PROMPT
from stage_baseline import CODE as BASELINE_CODE, PYTHON_ROOT

BASELINE = isolation.ASSOCIATION_STAGING_PARENT / "baseline-af47550c33ea4dc2a3dc1aebc56363c4"
BASELINE_PROFILE_SHA = "e06f20f9c285af4d3052c441e76a039ad04eba5c6b11fa618ea0a2a2ddbc5438"
EXPECTATIONS_SHA = "061b98c57bdb386c8fc4bce38660b18fd16340d739d40f75b60b10f95a6f93ce"
COORDINATOR = Path("C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin")
ASSIGNMENT = COORDINATOR / "docs/evidence/usp/ml-distillation/adapter-01.assignment.json"
TEACHER = Path("E:/BhuAayam-data/task-data/ml-distillation/teacher")
WHEELS = Path("E:/BhuAayam-model-evaluation/20260929/v8-lora-dependencies")
DEPENDENCIES = {
    "peft-0.17.1-py3-none-any.whl": "3d129d64def3d74779c32a080d2567e5f7b674e77d546e3585138216d903f99e",
    "accelerate-1.10.1-py3-none-any.whl": "3621cff60b9a27ce798857ece05e2b9f56fcc71631cfb31ccf71f0359c311f11"}
CODE = tuple(p for p in BASELINE_CODE if not p.endswith("association_student.py")) + (
    "scripts/usp/learning/association/association_adapter.py",
    "services/geo/geo/usp_learning/association/adapter.py")


def require(value, message):
    if not value:
        raise RuntimeError(message)


def accepted_outputs(root, action):
    root = Path(root).resolve()
    require(root.parent == isolation.ASSOCIATION_STAGING_PARENT, "unexpected run root")
    accepted = isolation.read(root / f"receipts/association_adapter-{action}-accepted.json")
    guard_path = root / f"receipts/association_adapter-{action}-guard.json"
    require(isolation.sha(guard_path) == accepted["guardSha256"], "fit/reload guard drift")
    guard = isolation.read(guard_path)
    require(guard["outputsAccepted"] and guard["failure"] is None, "outputs not accepted")
    isolation.accept_launch(guard["observation"], 6 * 1024**3, guard["cleanup"])
    require(0 < guard["observation"]["peakProcessRssBytes"] <= 6 * 1024**3, "RSS bound missing")
    require(isolation.sha(root / "profile.json") == accepted["profileSha256"] == guard["profileSha256"], "profile drift")
    actual = {}
    for path in (root / "outputs").rglob("*"):
        isolation.safe_path(root, path.relative_to(root).as_posix())
        if path.is_file():
            actual[path.relative_to(root / "outputs").as_posix()] = isolation.sha(path)
    require(actual == accepted["artifacts"], "accepted artifacts changed")
    return guard, accepted


def accepted_fit(root):
    guard, accepted = accepted_outputs(root, "fit")
    output = root / "outputs/fit"
    result = isolation.read(output / "fit-result.json")
    manifest = isolation.read(output / "adapter-manifest.json")
    completion = isolation.read(output / "completion.json")
    require(completion["supervisor"] == guard, "completion guard differs")
    for key, name in (("fitResultSha256", "fit-result.json"), ("tokenPreflightSha256", "token-preflight.json"),
                      ("adapterManifestSha256", "adapter-manifest.json")):
        require(completion[key] == isolation.sha(output / name), "completion artifact drift")
    require(completion["runFreezeSha256"] == isolation.sha(root / "inputs/run-freeze.json"), "fit freeze drift")
    freeze = isolation.read(root / "inputs/run-freeze.json")
    require(freeze["fitSettings"] == FIT and freeze["numerics"] == NUMERICS
            and freeze["inputSha256"]["training_data"] == V2_SHA, "fit configuration/data drift")
    require(result["updates"] == manifest["updates"] == 66 and result["baseUnchanged"]
            and not result["developmentOpened"] and not result["evaluationOpened"], "incomplete or contaminated fit")
    require(manifest["settings"] == FIT and manifest["numerics"] == NUMERICS
            and manifest["savedStateMatchesTrainableAdapter"] and manifest["tensorCount"] == 96
            and manifest["trainableParameters"] == 540672
            and manifest["baseParametersBefore"] == manifest["baseParametersAfter"], "adapter manifest drift")
    gpu = result["gpu"]
    require(gpu["maxCudaAllocatedBytes"] <= 6 * 1024**3 and gpu["maxCudaReservedBytes"] <= 6 * 1024**3
            and gpu["minimumSampledFreeCudaBytes"] >= 1536 * 1024**2, "GPU bound failed")
    verify_adapter_files(output / "adapter", manifest)
    require(result["adapterManifestSha256"] == isolation.sha(output / "adapter-manifest.json"), "manifest result drift")
    return {"fitResourceAccepted": True, "fitRoot": str(root), "updates": 66,
            "guardSha256": accepted["guardSha256"], "profileSha256": accepted["profileSha256"],
            "adapterManifestSha256": isolation.sha(output / "adapter-manifest.json"),
            "fitResultSha256": isolation.sha(output / "fit-result.json")}


def stage(action, fit_root=None):
    require(action in ("fit", "reload"), "unsupported stage action")
    require(isolation.sha(BASELINE / "profile.json") == BASELINE_PROFILE_SHA, "accepted baseline profile drift")
    baseline = isolation.read(BASELINE / "profile.json")
    assignment_bytes = ASSIGNMENT.read_bytes()
    assignment = json.loads(assignment_bytes)
    require(assignment["settings"] == FIT and assignment["teacherV1Sha256"] == V1_SHA
            and assignment["teacherV2Sha256"] == V2_SHA and Path(assignment["unchangedBaseline"]) == BASELINE,
            "frozen assignment changed")
    fit_proof = accepted_fit(fit_root.resolve()) if action == "reload" else None
    if action == "fit":
        checked_teacher((TEACHER / "train-teacher-v1.jsonl").read_bytes(), (TEACHER / "train-teacher-v2.jsonl").read_bytes(),
            isolation.read(BASELINE / "inputs/schema-v1.json"), isolation.read(BASELINE / "inputs/family-freeze.json"))
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip()
    for relative in (*CODE, "scripts/usp/learning/association/stage_adapter.py"):
        committed = subprocess.check_output(["git", "show", commit + ":" + relative], cwd=REPO)
        require((REPO / relative).read_bytes().replace(b"\r\n", b"\n") == committed, "uncommitted execution source: " + relative)
    require(shutil.disk_usage(BASELINE.parent).free >= 15 * 1024**3, "insufficient private staging disk")
    root = BASELINE.parent / ("adapter-" + action + "-" + uuid.uuid4().hex)
    root.mkdir()
    for name in (*isolation.READONLY, "outputs", "scratch", "state", "receipts"):
        (root / name).mkdir()
    files, copied = {}, {"fileCount": 0, "bytes": 0}

    def copy(source, relative, expected=None):
        require(not source.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT, "source reparse refused")
        destination = isolation.safe_path(root, relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        digest, size = hashlib.sha256(), 0
        with source.open("rb") as src, destination.open("xb") as dst:
            while block := src.read(8 * 1024**2):
                dst.write(block); digest.update(block); size += len(block)
        require(expected is None or digest.hexdigest() == expected, "copy source pin drift: " + relative)
        files[relative] = digest.hexdigest()
        copied["fileCount"] += 1; copied["bytes"] += size

    print(json.dumps({"stage": str(root), "action": action, "copyingAcceptedRuntimeAndModel": True}), flush=True)
    for relative, digest in baseline["files"].items():
        if relative.startswith(("runtime/", "model/")):
            copy(isolation.safe_path(BASELINE, relative), relative, digest)
    for name, digest in DEPENDENCIES.items():
        wheel = WHEELS / name
        require(isolation.sha(wheel) == digest, "offline wheel pin drift")
        package, version = name.split("-")[:2]
        with zipfile.ZipFile(wheel) as archive:
            for item in archive.infolist():
                if item.is_dir():
                    continue
                relative = PurePosixPath(item.filename)
                require(not relative.is_absolute() and ".." not in relative.parts
                        and "\\" not in item.filename and relative.parts[0] in (package, f"{package}-{version}.dist-info")
                        and relative.suffix not in (".pth", ".pyc", ".pyo")
                        and not stat.S_ISLNK(item.external_attr >> 16), "unsupported wheel entry")
                destination = isolation.safe_path(root, "runtime/packages/" + relative.as_posix())
                destination.parent.mkdir(parents=True, exist_ok=True)
                raw = archive.read(item)
                with destination.open("xb") as stream:
                    stream.write(raw)
                files[destination.relative_to(root).as_posix()] = hashlib.sha256(raw).hexdigest()
                copied["fileCount"] += 1; copied["bytes"] += len(raw)
    for relative in CODE:
        copy(REPO / relative, "code/" + relative)
    input_names = {"schema": "schema-v1.json", "family_freeze": "family-freeze.json", "model_receipt": "model-acquisition.json"}
    for name in (*input_names.values(), "runtime-requirements-resolved.txt"):
        copy(BASELINE / "inputs" / name, "inputs/" + name, baseline["files"]["inputs/" + name])
    input_names["assignment"] = "assignment.json"
    copy(ASSIGNMENT, "inputs/assignment.json", hashlib.sha256(assignment_bytes).hexdigest())
    if action == "fit":
        for option, name, digest in (("teacher_v1", "train-teacher-v1.jsonl", V1_SHA), ("training_data", "train-teacher-v2.jsonl", V2_SHA)):
            input_names[option] = name
            copy(TEACHER / name, "inputs/" + name, digest)
    else:
        input_names.update(input_batch="development.json", adapter_manifest="adapter-manifest.json", fit_proof="fit-proof.json")
        copy(BASELINE / "inputs/development.json", "inputs/development.json", baseline["files"]["inputs/development.json"])
        copy(fit_root / "outputs/fit/adapter-manifest.json", "inputs/adapter-manifest.json", fit_proof["adapterManifestSha256"])
        for name, digest in isolation.read(fit_root / "outputs/fit/adapter-manifest.json")["files"].items():
            copy(fit_root / "outputs/fit/adapter" / name, "inputs/adapter/" + name, digest)
        isolation.write(root / "inputs/fit-proof.json", fit_proof)
        files["inputs/fit-proof.json"] = isolation.sha(root / "inputs/fit-proof.json")
    freeze = {"version": "association-adapter-freeze/1", "action": action, "fitSettings": FIT, "numerics": NUMERICS,
              "inferenceSettings": SETTINGS, "systemPromptSha256": hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest(),
              "inputSha256": {key: files["inputs/" + name] for key, name in input_names.items()},
              "sourceCommit": commit, "coordinatorHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=COORDINATOR, text=True).strip(),
              "baselineProfileSha256": BASELINE_PROFILE_SHA, "dependencyWheels": DEPENDENCIES,
              "dependencyOrigin": str(WHEELS), "expectedClaimsSha256": EXPECTATIONS_SHA,
              "evaluationAllowed": False, "developmentInputsPresent": action == "reload", "promotionAuthorized": False}
    isolation.write(root / "inputs/run-freeze.json", freeze)
    files["inputs/run-freeze.json"] = isolation.sha(root / "inputs/run-freeze.json")
    profile = {"schemaVersion": "usp-qwen-containment-v1", "root": str(root), "python": "runtime/python.exe",
               "packageRoots": ["runtime/packages"], "jobMemoryBytes": 6 * 1024**3, "timeoutSeconds": 600, "files": files}
    isolation.write(root / "profile.json", profile)
    command = [str(PYTHON_ROOT / "python.exe"), "-B", "-I", "-S", str(REPO / "scripts/usp/learning/association/association_adapter.py"), action]
    for key, name in input_names.items():
        command.extend(["--" + key.replace("_", "-"), str(root / "inputs" / name)])
    if action == "reload":
        command.extend(["--adapter-dir", str(root / "inputs/adapter")])
    command.extend(["--run-freeze", str(root / "inputs/run-freeze.json"), "--output-dir", str(root / "outputs" / action),
                    "--containment-profile", str(root / "profile.json"), "--containment-sha256", isolation.sha(root / "profile.json")])
    isolation.write(root / "stage.json", {"root": str(root), "action": action, "profileSha256": isolation.sha(root / "profile.json"),
        "copied": copied, "command": command, "fitRoot": str(fit_root) if fit_root else None,
        "sourceExpectations": isolation.read(BASELINE / "stage.json")["sourceExpectations"],
        "relocation": "Fresh private copy of pinned baseline runtime/model plus two pinned offline wheels; no shared environment edits."})
    print(json.dumps({"stage": str(root), "profileSha256": isolation.sha(root / "profile.json"), "copied": copied}), flush=True)
    return root


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("fit", "reload"))
    parser.add_argument("--fit-root", type=Path)
    args = parser.parse_args()
    if (args.action == "reload") != (args.fit_root is not None):
        parser.error("--fit-root is required only for reload")
    stage(args.action, args.fit_root)
