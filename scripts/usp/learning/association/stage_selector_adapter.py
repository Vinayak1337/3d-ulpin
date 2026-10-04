"""Stage only a separately frozen selector fit OR reload; PREP cannot stage."""
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
from stage_adapter import CODE as ADAPTER_CODE, PYTHON_ROOT, TEACHER, EXPECTATIONS_SHA, accepted_fit
from geo.usp_learning.association import selector_adapter as selector
from geo.usp_learning.association.adapter import FIT, NUMERICS
from geo.usp_learning.association.student import SETTINGS
from geo.usp_learning.association.chunked_loss import LOSS_POLICY
from geo.usp_learning.association.reclamation import RECLAMATION_POLICY
from geo.usp_learning.association.query_attention import ATTENTION_POLICY
from geo.usp_learning.association.validation import require, strict_json

RUNTIME = isolation.ASSOCIATION_STAGING_PARENT / "adapter-citation-view-fit-fffafce9835d4f59bef71f4377bb5619"
RUNTIME_SHA = "a09ee7907b8dc207b01712d84ec33245218773f479cf91301957ee76b32ae503"
BASELINE = isolation.ASSOCIATION_STAGING_PARENT / "selector-baseline-d5cce4ac0de0494ca17fee3a3e5b1b69"
BASELINE_SHA = "083145a4da0e41143e7adee67ca0e9b779ac9fa352cff0139c23791db08075a7"
CODE = (*ADAPTER_CODE, "services/geo/geo/usp_learning/association/selectors.py",
        "services/geo/geo/usp_learning/association/selector_baseline.py",
        "services/geo/geo/usp_learning/association/selector_adapter.py")
SOURCE_PATHS = (*CODE, "scripts/usp/learning/association/stage_adapter.py",
                "scripts/usp/learning/association/stage_selector_adapter.py")
CONSTRAINT_SOURCE = "services/geo/geo/usp_learning/association/selector_constraints.py"
CHANGED_SHARED_SEAMS = {"scripts/usp/learning/association/association_adapter.py",
                        "services/geo/geo/usp_learning/association/adapter.py"}


def source_pins(assignment, donor_files):
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip()
    require(commit == assignment["studentCodeCommit"] and not subprocess.check_output(
        ["git", "status", "--porcelain"], cwd=REPO, text=True).strip(), "selector_adapter_clean_frozen_head_required")
    expected = assignment.get("runtimeCodeCanonicalLfSha256", {})
    paths = (*SOURCE_PATHS, CONSTRAINT_SOURCE) if "generationConstraints" in assignment else SOURCE_PATHS
    require(type(expected) is dict and set(expected) == set(paths), "selector_adapter_source_pin_set_drift")
    pins = {}
    for name in paths:
        raw = (REPO / name).read_bytes()
        canonical = raw.replace(b"\r\n", b"\n")
        require(canonical == subprocess.check_output(["git", "show", commit + ":" + name], cwd=REPO)
                and hashlib.sha256(canonical).hexdigest() == expected[name], "selector_adapter_code_pin_drift:" + name)
        pins[name] = hashlib.sha256(raw).hexdigest()
        if name in ADAPTER_CODE and name not in CHANGED_SHARED_SEAMS:
            require(pins[name] == donor_files["code/" + name], "selector_adapter_protected_source_drift:" + name)
    return commit, pins


def stage(action, assignment_path, fit_root=None):
    assignment_path = Path(assignment_path)
    assignment_bytes = assignment_path.read_bytes()
    assignment = strict_json(assignment_bytes)
    plan = selector.checked_execution(assignment, action)  # before runtime inspection or mkdir
    constrained = "generationConstraints" in assignment
    require((action == "reload") == (fit_root is not None), "selector_adapter_fit_root_scope_drift")
    require(assignment.get("runtimeProfileSha256") == RUNTIME_SHA
            and isolation.sha(RUNTIME / "profile.json") == RUNTIME_SHA, "selector_adapter_runtime_profile_drift")
    donor = isolation.read(RUNTIME / "profile.json")
    require(isolation.sha(RUNTIME / "inputs/run-freeze.json") == donor["files"]["inputs/run-freeze.json"], "selector_adapter_runtime_freeze_drift")
    donor_freeze = isolation.read(RUNTIME / "inputs/run-freeze.json")
    for key in ("previousFailedFit", "previousFailureReceiptSha256"):
        require(assignment.get(key) == donor_freeze[key], "selector_adapter_history_pin_drift")
    commit, pins = source_pins(assignment, donor["files"])
    schema_path = Path(assignment["selectorSchema"])
    schema_bytes = schema_path.read_bytes()
    selector_contract = selector.checked_schema(schema_bytes)
    names = {"schema": "schema-v1.json", "family_freeze": "family-freeze.json", "model_receipt": "model-acquisition.json"}
    for key, name in names.items():
        require(isolation.sha(RUNTIME / "inputs" / name) == selector.COMMON_INPUT_PINS[key], "selector_adapter_parent_input_drift")
    if action == "fit":
        selector.checked_teacher((TEACHER / "train-teacher-v2.jsonl").read_bytes(),
            (TEACHER / "train-teacher-selectors-v1.jsonl").read_bytes(), selector_contract,
            isolation.read(RUNTIME / "inputs/schema-v1.json"), isolation.read(RUNTIME / "inputs/family-freeze.json"))
        fit_proof = None
    else:
        fit_root = Path(fit_root).resolve()
        fit_proof = accepted_fit(fit_root)  # unchanged count/base/save/resource/cleanup machinery
        selector.checked_reload_binding({"acceptedFit": assignment["acceptedFit"]}, fit_proof,
                                       isolation.read(fit_root / "outputs/fit/adapter-manifest.json"))
        require(isolation.sha(BASELINE / "profile.json") == BASELINE_SHA
                and isolation.sha(BASELINE / "inputs/development.json") == selector.BATCH_SHA, "selector_adapter_development_pin_drift")
    require(shutil.disk_usage(RUNTIME.parent).free >= 15 * 1024**3, "selector_adapter_disk_headroom")
    root = RUNTIME.parent / ("adapter-selector-" + action + "-" + uuid.uuid4().hex)
    root.mkdir()
    for name in (*isolation.READONLY, "outputs", "scratch", "state", "receipts"):
        (root / name).mkdir()
    files, copied = {}, {"fileCount": 0, "bytes": 0}

    def copy(source, relative, expected):
        require(not source.is_symlink() and not source.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT,
                "selector_adapter_copy_reparse_refused")
        destination = isolation.safe_path(root, relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        digest, size = hashlib.sha256(), 0
        with source.open("rb") as src, destination.open("xb") as dst:
            while block := src.read(8 * 1024**2):
                dst.write(block); digest.update(block); size += len(block)
        require(digest.hexdigest() == expected, "selector_adapter_copy_pin_drift:" + relative)
        files[relative] = digest.hexdigest()
        copied["fileCount"] += 1; copied["bytes"] += size

    print(json.dumps({"stage": str(root), "action": action, "copyingAcceptedRuntimeAndModel": True}), flush=True)
    for relative, digest in donor["files"].items():
        if relative.startswith(("runtime/", "model/")):
            copy(isolation.safe_path(RUNTIME, relative), relative, digest)
    for relative in ((*CODE, CONSTRAINT_SOURCE) if constrained else CODE):
        copy(REPO / relative, "code/" + relative, pins[relative])
    for name in (*names.values(), "runtime-requirements-resolved.txt"):
        copy(RUNTIME / "inputs" / name, "inputs/" + name, donor["files"]["inputs/" + name])
    names["assignment"] = "assignment.json"
    copy(assignment_path, "inputs/assignment.json", hashlib.sha256(assignment_bytes).hexdigest())
    copy(schema_path, "inputs/selector-schema-v1.json", hashlib.sha256(schema_bytes).hexdigest())
    with (root / "inputs/selector-prompt.txt").open("xb") as stream:
        stream.write(selector.SYSTEM_PROMPT.encode())
    files["inputs/selector-prompt.txt"] = selector.PROMPT_SHA
    if action == "fit":
        # Retain the allowed historical CLI option name; its pinned contents are the v2 parent.
        names.update(teacher_v1="train-teacher-v2.jsonl", training_data="train-teacher-selectors-v1.jsonl")
        for key, digest in (("teacher_v1", selector.V2_SHA), ("training_data", selector.DATA_SHA)):
            copy(TEACHER / names[key], "inputs/" + names[key], digest)
    else:
        names.update(input_batch="development.json", adapter_manifest="adapter-manifest.json", fit_proof="fit-proof.json")
        copy(BASELINE / "inputs/development.json", "inputs/development.json", selector.BATCH_SHA)
        copy(fit_root / "outputs/fit/adapter-manifest.json", "inputs/adapter-manifest.json", fit_proof["adapterManifestSha256"])
        for name, digest in isolation.read(fit_root / "outputs/fit/adapter-manifest.json")["files"].items():
            copy(fit_root / "outputs/fit/adapter" / name, "inputs/adapter/" + name, digest)
        isolation.write(root / "inputs/fit-proof.json", fit_proof)
        files["inputs/fit-proof.json"] = isolation.sha(root / "inputs/fit-proof.json")
    freeze = {"version": selector.FREEZE_VERSION, "action": action, "sourceCommit": commit,
        "fitSettings": FIT, "numerics": NUMERICS, "inferenceSettings": SETTINGS,
        "memoryExecutionPolicy": assignment["memoryExecutionPolicy"], "lossImplementation": LOSS_POLICY,
        "reclamationImplementation": RECLAMATION_POLICY, "attentionImplementation": ATTENTION_POLICY,
        "previousFailedFit": assignment["previousFailedFit"], "previousFailureReceiptSha256": assignment["previousFailureReceiptSha256"],
        "representation": selector.representation_metadata(), "trainingPlan": plan, "systemPromptSha256": selector.PROMPT_SHA,
        "inputSha256": {key: files["inputs/" + name] for key, name in names.items()},
        "auxiliaryInputSha256": {name: files["inputs/" + name] for name in ("selector-schema-v1.json", "selector-prompt.txt")},
        "runtimeParentProfileSha256": RUNTIME_SHA, "dependencyWheels": donor_freeze["dependencyWheels"],
        "inspectedRuntimeSources": donor_freeze["inspectedRuntimeSources"], "expectedClaimsSha256": EXPECTATIONS_SHA,
        "evaluationAllowed": False, "developmentInputsPresent": action == "reload", "promotionAuthorized": False}
    if action == "reload":
        freeze.update(cases=assignment["cases"], acceptedFit=assignment["acceptedFit"])
    if constrained:
        from geo.usp_learning.association.selector_constraints import FREEZE_VERSION, TOKENIZER_PINS
        for name, expected in TOKENIZER_PINS.items():
            require(files["model/" + name] == expected, "selector_constraint_staged_tokenizer_drift")
        freeze.update(version=FREEZE_VERSION, generationConstraints=assignment["generationConstraints"])
    isolation.write(root / "inputs/run-freeze.json", freeze)
    files["inputs/run-freeze.json"] = isolation.sha(root / "inputs/run-freeze.json")
    selector.checked_inputs(freeze, assignment, root / "inputs")
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
    isolation.write(root / "stage.json", {"root": str(root), "action": action, "profileSha256": isolation.sha(root / "profile.json"),
        "copied": copied, "command": command, "fitRoot": str(fit_root) if fit_root else None,
        "sourceExpectations": "E:/BhuAayam-data/task-data/ml-distillation/student/development-v1/expectations.json",
        "relocation": "Pinned accepted runtime/model copy. Fit receives original train-only selectors and v2 parent; reload receives only development and the exact accepted adapter."})
    print(json.dumps({"stage": str(root), "profileSha256": isolation.sha(root / "profile.json"), "copied": copied}), flush=True)
    return root


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("fit", "reload"))
    parser.add_argument("--assignment", type=Path, required=True)
    parser.add_argument("--fit-root", type=Path)
    args = parser.parse_args()
    stage(args.action, args.assignment, args.fit_root)
