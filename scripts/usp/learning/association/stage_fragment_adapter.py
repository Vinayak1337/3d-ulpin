"""Separate frozen fragment fit/reload stages; preparation never grants execution."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import uuid

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "scripts/usp/learning"), str(REPO / "services/geo"), str(Path(__file__).resolve().parent)]
import model_isolation as isolation
from stage_adapter import PYTHON_ROOT, accepted_fit
from geo.usp_learning.association import fragment_adapter as fragment
from geo.usp_learning.association.validation import require, strict_json

RUNTIME = isolation.ASSOCIATION_STAGING_PARENT / "adapter-citation-view-fit-fffafce9835d4f59bef71f4377bb5619"
BASELINE = isolation.ASSOCIATION_STAGING_PARENT / "fragment-baseline-6d2a6e03ea684bdcb30fabb45d4dbe80"
TRAINING = Path("E:/BhuAayam-data/task-data/ml-distillation/teacher/train-teacher-fragments-v1.jsonl")


def checked_sources(assignment, *, fragment=fragment):
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip()
    require(commit == assignment["studentCodeCommit"] and not subprocess.check_output(
        ["git", "status", "--porcelain"], cwd=REPO, text=True).strip(), "fragment_adapter_clean_frozen_head_required")
    pins = {}
    for name in fragment.SOURCE_PATHS:
        raw = (REPO / name).read_bytes()
        canonical = raw.replace(b"\r\n", b"\n")
        require(canonical == subprocess.check_output(["git", "show", commit + ":" + name], cwd=REPO)
                and fragment.sha(canonical) == assignment["runtimeCodeCanonicalLfSha256"][name],
                "fragment_adapter_source_git_pin_drift:" + name)
        pins[name] = fragment.sha(raw)
    return pins


def donor_metadata():
    # Only these profile manifests are needed for preparation metadata. Runtime
    # and weight contents are copied/verified solely by a future positive stage.
    require(isolation.sha(RUNTIME / "profile.json") == fragment.RUNTIME_SHA
            and isolation.sha(BASELINE / "profile.json") == fragment.MODEL_PROFILE_SHA, "fragment_adapter_donor_profile_drift")
    runtime, baseline = isolation.read(RUNTIME / "profile.json"), isolation.read(BASELINE / "profile.json")
    require(Path(runtime["root"]) == RUNTIME and Path(baseline["root"]) == BASELINE, "fragment_adapter_donor_root_drift")
    require(runtime["files"]["inputs/runtime-requirements-resolved.txt"] == fragment.REQUIREMENTS_SHA
            and baseline["files"]["model/model.safetensors"] == fragment.WEIGHTS_SHA, "fragment_adapter_donor_metadata_drift")
    return runtime, baseline


def stage(action, assignment_path, fit_root=None, *, fragment=fragment, training=TRAINING, training_sources=None):
    assignment_path = Path(assignment_path)
    assignment_bytes = assignment_path.read_bytes()
    assignment = strict_json(assignment_bytes)
    fragment.checked_execution(assignment, action)  # PREP/mixed/version refusal before effects or donor reads.
    require((action == "reload") == (fit_root is not None), "fragment_adapter_fit_root_scope_drift")
    pins = checked_sources(assignment, fragment=fragment)
    runtime, baseline = donor_metadata()
    names = fragment.input_names(action)
    proof = None
    if getattr(fragment, "IS_RANK_FIT", False):
        require(training_sources is None and training == TRAINING, "rank_fit_mixed_training_sources")
        sources = fragment.stage_sources(assignment_path, assignment_bytes, BASELINE, RUNTIME)
    else:
        sources = {}
        for key in fragment.COMMON_PINS:
            origin = "legacy-schema-v1.json" if key == "schema" else names[key]
            sources[names[key]] = (BASELINE / "inputs" / origin, fragment.COMMON_PINS[key])
        sources["assignment.json"] = (assignment_path, fragment.sha(assignment_bytes))
        sources["runtime-requirements-resolved.txt"] = (RUNTIME / "inputs/runtime-requirements-resolved.txt", fragment.REQUIREMENTS_SHA)
        for name, digest in fragment.auxiliary_pins(action).items():
            sources[name] = ((training_sources or {}).get(name, BASELINE / "inputs" / name), digest)
        schema = fragment.codec.checked_schema(sources["fragment-schema-v1.json"][0].read_bytes())
        contract, family = (isolation.read(sources[names[k]][0]) for k in ("schema", "family_freeze"))
        if action == "fit":
            fragment.checked_teacher(training.read_bytes(), schema, contract, family)
            sources[names["training_data"]] = (training, fragment.DATA_SHA)
        else:
            fit_root = Path(fit_root).resolve()
            require(fit_root == Path(assignment["acceptedFit"]["root"]), "fragment_adapter_fit_root_binding_drift")
            proof = accepted_fit(fit_root)
            manifest_path = fit_root / "outputs/fit/adapter-manifest.json"
            manifest = isolation.read(manifest_path)
            fragment.checked_reload_binding({"acceptedFit": assignment["acceptedFit"]}, proof, manifest)
            sources["development.json"] = (BASELINE / "inputs/development.json", fragment.BATCH_SHA)
            sources["adapter-manifest.json"] = (manifest_path, assignment["acceptedFit"]["adapterManifestSha256"])
            for name, digest in manifest["files"].items():
                sources["adapter/" + name] = (fit_root / "outputs/fit/adapter" / name, digest)
            fragment.checked_development(BASELINE / "inputs", schema, contract, family)
    for name, (path, expected) in sources.items():
        require(isolation.sha(path) == expected, "fragment_adapter_source_input_pin_drift:" + name)
    if action == "fit" and training_sources is not None:
        fragment.checked_support_files({name: sources[name][0].read_bytes() for name in fragment.SUPPORT_PINS}, training.read_bytes())
    freeze = fragment.make_freeze(assignment, assignment_bytes, pins)
    require(shutil.disk_usage(RUNTIME.parent).free >= 15 * 1024**3, "fragment_adapter_disk_headroom")
    root = RUNTIME.parent / (getattr(fragment, "STAGE_PREFIX", "adapter-fragment-") + action + "-" + uuid.uuid4().hex)
    root.mkdir()
    for name in (*isolation.READONLY, "outputs", "scratch", "state", "receipts"):
        (root / name).mkdir()
    files, copied = {}, {"fileCount": 0, "bytes": 0}

    def copy(source, relative, expected):
        # Same exclusive bounded copy/profile recipe as the accepted stagers;
        # safe_path/write/accepted_fit stay the existing authorities.
        require(not source.is_symlink() and not source.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT,
                "fragment_adapter_copy_reparse_refused")
        destination = isolation.safe_path(root, relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        digest, size = hashlib.sha256(), 0
        with source.open("rb") as src, destination.open("xb") as dst:
            while block := src.read(8 * 1024**2):
                dst.write(block); digest.update(block); size += len(block)
        require(digest.hexdigest() == expected, "fragment_adapter_copy_pin_drift:" + relative)
        files[relative] = digest.hexdigest()
        copied["fileCount"] += 1; copied["bytes"] += size

    print(json.dumps({"stage": str(root), "action": action, "copyingAcceptedRuntimeAndModel": True}), flush=True)
    for donor_root, profile, prefix in ((RUNTIME, runtime, "runtime/"), (BASELINE, baseline, "model/")):
        for relative, digest in profile["files"].items():
            if relative.startswith(prefix):
                copy(isolation.safe_path(donor_root, relative), relative, digest)
    for relative in fragment.SOURCE_PATHS:
        copy(REPO / relative, "code/" + relative, pins[relative])
    for name, (source, digest) in sources.items():
        copy(source, "inputs/" + name, digest)
    if proof is not None:
        isolation.write(root / "inputs/fit-proof.json", proof)
        files["inputs/fit-proof.json"] = isolation.sha(root / "inputs/fit-proof.json")
    isolation.write(root / "inputs/run-freeze.json", freeze)
    files["inputs/run-freeze.json"] = isolation.sha(root / "inputs/run-freeze.json")
    fragment.checked_inputs(freeze, assignment, root / "inputs", source_root=root / "code")
    profile = {"schemaVersion": "usp-qwen-containment-v1", "root": str(root), "python": "runtime/python.exe",
               "packageRoots": ["runtime/packages"], "jobMemoryBytes": 6 * 1024**3, "timeoutSeconds": 600, "files": files}
    isolation.write(root / "profile.json", profile)
    command = [str(PYTHON_ROOT / "python.exe"), "-B", "-I", "-S", str(REPO / "scripts/usp/learning/association/association_adapter.py"), action]
    for key, name in names.items():
        command.extend(["--" + key.replace("_", "-"), str(root / "inputs" / name)])
    if action == "reload":
        command.extend(["--adapter-dir", str(root / "inputs/adapter")])
    command.extend(["--run-freeze", str(root / "inputs/run-freeze.json"), "--output-dir", str(root / "outputs" / action),
                    "--containment-profile", str(root / "profile.json"), "--containment-sha256", isolation.sha(root / "profile.json")])
    isolation.write(root / "stage.json", {"root": str(root), "action": action, "command": command,
        "profileSha256": isolation.sha(root / "profile.json"), "sourcePhysicalSha256": pins, "copied": copied,
        "runtimeDonorProfileSha256": fragment.RUNTIME_SHA, "modelDonorProfileSha256": fragment.MODEL_PROFILE_SHA,
        "fitRoot": str(fit_root) if fit_root else None, "hostExpectationsPresent": False})
    print(json.dumps({"stage": str(root), "profileSha256": isolation.sha(root / "profile.json"), "copied": copied}), flush=True)
    return root


def phase_template(action, *, fragment=fragment, entrypoint=None):
    """Planning metadata only. Neither template admits staging or native work."""
    require(action in fragment.VERSIONS, "fragment_template_phase")
    assignment = {"version": fragment.VERSIONS[action][0], "task": fragment.TASKS[action], "action": action,
        "executable": False, "executionAllowance": fragment.allowance(action, False), "studentCodeCommit": None,
        "model": fragment.MODEL, "revision": fragment.REVISION, "modelWeightsSha256": fragment.WEIGHTS_SHA,
        "runtimeProfileSha256": fragment.RUNTIME_SHA, "modelProfileSha256": fragment.MODEL_PROFILE_SHA,
        "settings": fragment.FIT, "numerics": fragment.NUMERICS, "inferenceSettings": fragment.SETTINGS,
        "representation": fragment.representation_metadata(), "trainingPlan": fragment.training_plan(),
        "memoryExecutionPolicy": fragment.memory_policy(), "attentionControlBeforeFit": fragment.ATTENTION_CONTROL,
        "runtimeCodeCanonicalLfSha256": {p: None for p in fragment.SOURCE_PATHS}}
    if action == "reload":
        assignment.update(acceptedFit={k: None for k in sorted(fragment.ACCEPTED_FIT_KEYS)}, cases=fragment.CASES)
    return {"executable": False, "assignment": assignment,
        "stageCommand": [str(PYTHON_ROOT / "python.exe"), "-B", "-I", "-S", str(Path(__file__).resolve() if entrypoint is None else entrypoint), action,
                         "--assignment", "<separate-positive-frozen-assignment>",
                         *(["--fit-root", "<accepted-fit-root>"] if action == "reload" else [])],
        "runCommand": None, "runFreezeSha256": None, "phaseProfileSha256": None,
        "unresolved": "Final approved clean HEAD/source pins, positive phase assignment and generated exact profile/freeze; reload additionally requires accepted saved-fit proof/hashes."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("fit", "reload"))
    parser.add_argument("--assignment", type=Path, required=True)
    parser.add_argument("--fit-root", type=Path)
    args = parser.parse_args()
    stage(args.action, args.assignment, args.fit_root)
