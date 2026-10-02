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
from geo.usp_learning.association.chunked_loss import LOSS_POLICY
from geo.usp_learning.association.reclamation import RECLAMATION_POLICY
from geo.usp_learning.association.query_attention import ATTENTION_POLICY, ATTENTION_CONTROL, query_blocks
from geo.usp_learning.association.student import SETTINGS, SYSTEM_PROMPT
from geo.usp_learning.association.citation_view import (
    checked_citation_teacher, checked_execution, checked_freeze, checked_count_receipts,
    checked_reload_counts, training_plan, same)
from stage_baseline import CODE as BASELINE_CODE, PYTHON_ROOT

BASELINE = isolation.ASSOCIATION_STAGING_PARENT / "baseline-af47550c33ea4dc2a3dc1aebc56363c4"
BASELINE_PROFILE_SHA = "e06f20f9c285af4d3052c441e76a039ad04eba5c6b11fa618ea0a2a2ddbc5438"
EXPECTATIONS_SHA = "061b98c57bdb386c8fc4bce38660b18fd16340d739d40f75b60b10f95a6f93ce"
COORDINATOR = Path("C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin")
ASSIGNMENT = COORDINATOR / "docs/evidence/usp/ml-distillation/adapter-05.query-chunked-sdpa.assignment.json"
TEACHER = Path("E:/BhuAayam-data/task-data/ml-distillation/teacher")
WHEELS = Path("E:/BhuAayam-model-evaluation/20260929/v8-lora-dependencies")
DEPENDENCIES = {
    "peft-0.17.1-py3-none-any.whl": "3d129d64def3d74779c32a080d2567e5f7b674e77d546e3585138216d903f99e",
    "accelerate-1.10.1-py3-none-any.whl": "3621cff60b9a27ce798857ece05e2b9f56fcc71631cfb31ccf71f0359c311f11"}
CODE = tuple(p for p in BASELINE_CODE if not p.endswith("association_student.py")) + (
    "scripts/usp/learning/association/association_adapter.py",
    "services/geo/geo/usp_learning/association/adapter.py",
    "services/geo/geo/usp_learning/association/citation_view.py",
    "services/geo/geo/usp_learning/association/chunked_loss.py",
    "services/geo/geo/usp_learning/association/memory_observation.py",
    "services/geo/geo/usp_learning/association/reclamation.py",
    "services/geo/geo/usp_learning/association/query_attention.py")


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
    assignment = isolation.read(root / "inputs/assignment.json")
    selector = None
    if freeze.get("version") == "association-selector-adapter-freeze/1":
        from geo.usp_learning.association import selector_adapter as selector
    elif (str(freeze.get("version", "")).startswith("association-selector") or "representation" in freeze
          or assignment.get("version") == "association-selector-adapter-execution/1"):
        raise RuntimeError("explicit selector adapter freeze required")
    plan = checked_freeze(freeze, assignment) if selector is None else selector.checked_freeze(freeze, assignment)
    updates = plan["plannedUpdates"]
    require(freeze["fitSettings"] == FIT and freeze["numerics"] == NUMERICS
            and freeze["inputSha256"]["training_data"] == plan["datasetSha256"]
            and freeze["inputSha256"]["assignment"] == isolation.sha(root / "inputs/assignment.json")
            and freeze["memoryExecutionPolicy"] == assignment["memoryExecutionPolicy"]
            and freeze["previousFailureReceiptSha256"] == assignment["previousFailureReceiptSha256"]
            and freeze["previousFailedFit"] == assignment["previousFailedFit"]
            and freeze["lossImplementation"] == LOSS_POLICY, "fit configuration/data drift")
    preflight = isolation.read(output / "token-preflight.json")
    progress = [json.loads(line) for line in (output / "fit-progress.jsonl").read_text().splitlines()]
    checked_count_receipts(plan, preflight, result, manifest, progress, versioned=selector is not None or "datasetDeclaration" in freeze)
    if selector is not None:
        schema = selector.checked_inputs(freeze, assignment, root / "inputs")
        contract, family = isolation.read(root / "inputs/schema-v1.json"), isolation.read(root / "inputs/family-freeze.json")
        rows, delta = selector.checked_teacher((root / "inputs/train-teacher-v2.jsonl").read_bytes(),
            (root / "inputs/train-teacher-selectors-v1.jsonl").read_bytes(), schema, contract, family)
        require(same(isolation.read(output / "teacher-delta.json"), delta), "selector admission receipt drift")
        selector.checked_fit_metadata(preflight, result, manifest, rows, selector.SelectorRepresentation(schema, contract, family))
    elif "datasetDeclaration" in freeze:
        require(freeze.get("auxiliaryInputSha256") == {"train-teacher-v2.jsonl": V2_SHA}, "frozen parent pin drift")
        rows, delta = checked_citation_teacher((root / "inputs/train-teacher-v1.jsonl").read_bytes(),
            (root / "inputs/train-teacher-v2.jsonl").read_bytes(), (root / "inputs/train-teacher-v3.jsonl").read_bytes(),
            freeze["datasetDeclaration"], isolation.read(root / "inputs/schema-v1.json"),
            isolation.read(root / "inputs/family-freeze.json"))
        require(same(isolation.read(output / "teacher-delta.json"), delta)
                and [r["exampleId"] for r in preflight["lengths"]] == [r["input"]["exampleId"] for r in rows],
                "admission receipt or tokenized row identity drift")
    require(result["updates"] == manifest["updates"] == updates and result["baseUnchanged"]
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
    require(result["lossImplementation"] == manifest["lossImplementation"] == LOSS_POLICY, "loss implementation drift")
    equivalence = isolation.read(output / "loss-equivalence.json")
    equivalent_sha = isolation.sha(output / "loss-equivalence.json")
    require(result["lossEquivalenceSha256"] == manifest["lossEquivalenceSha256"] == equivalent_sha
            and equivalence["policy"] == LOSS_POLICY and equivalence["passed"] and equivalence["rngUnchanged"]
            and len(equivalence["cases"]) == 2 and all(case["passed"] for case in equivalence["cases"]), "loss equivalence not proven")
    require(result["memoryPhasesSha256"] == isolation.sha(output / "memory-phases.jsonl"), "phase observations drift")
    attention_control = isolation.read(output / "attention-control.json")
    attention_sha = isolation.sha(output / "attention-control.json")
    require(freeze["attentionImplementation"] == result["attentionImplementation"] == manifest["attentionImplementation"] == ATTENTION_POLICY
            and assignment["attentionControlBeforeFit"] == ATTENTION_CONTROL and attention_control["policy"] == ATTENTION_POLICY
            and attention_control["passed"] and attention_control["trainingRngRestored"] and attention_control["rngUnchangedInsideControl"]
            and len(attention_control["cases"]) == 2 and all(row["passed"] for row in attention_control["cases"])
            and result["attentionControlSha256"] == manifest["attentionControlSha256"] == attention_sha, "attention control not proven")
    require(result["attentionBlocksSha256"] == isolation.sha(output / "attention-blocks.jsonl")
            and result["attentionScopeSha256"] == isolation.sha(output / "attention-scope.json"), "attention observation drift")
    scope = isolation.read(output / "attention-scope.json")
    require(scope == {"restored": True, "globalRegistryUnchanged": True, "fitOnly": True, "layers": 24}, "attention scope not restored")
    blocks = [json.loads(line) for line in (output / "attention-blocks.jsonl").read_text().splitlines()]
    for boundary in ("decoder", "backward"):
        selected = [row for row in blocks if row["boundary"] == boundary]
        require([row["update"] for row in selected] == list(range(1, updates + 1)), "attention block history incomplete")
        for row in selected:
            sizes = [b - a for a, b in query_blocks(row["tokens"])]
            require(row["blockSizes"] == sizes and row["maxQueryBlockTokens"] == max(sizes)
                    and row["fullKeyTokens"] == row["tokens"] and row["minimumBlockStart"] == 0
                    and row["maximumBlockStart"] == (len(sizes) - 1) * 128
                    and set(row["layerCalls"]) == {str(i) for i in range(24)}
                    and all(count == (1 if boundary == "decoder" else 2) for count in row["layerCalls"].values())
                    and row["primitiveCallsStarted"] >= 24 * len(sizes), "attention block bounds or layer coverage changed")
    reclaim_proof = isolation.read(output / "reclamation-control.json")
    reclaim_sha = isolation.sha(output / "reclamation-control.json")
    require(freeze["reclamationImplementation"] == result["reclamationImplementation"] == manifest["reclamationImplementation"] == RECLAMATION_POLICY
            and reclaim_proof["policy"] == RECLAMATION_POLICY and reclaim_proof["passed"] and reclaim_proof["trainingRngRestored"]
            and reclaim_proof["liveForwardStatesEqual"] and reclaim_proof["liveGraphPreserved"]
            and len(reclaim_proof["cases"]) == 2
            and all(len(case["liveGraphSteps"]) == 2 for case in reclaim_proof["cases"])
            and result["reclamationControlSha256"] == manifest["reclamationControlSha256"] == reclaim_sha, "reclamation control not proven")
    phases = [json.loads(line) for line in (output / "memory-phases.jsonl").read_text().splitlines()]
    require({"before_imports", "after_imports", "before_model_load", "after_lora_load", "first_before_decoder",
             "first_after_decoder", "first_after_loss_before_backward", "first_after_backward", "first_before_optimizer_step",
             "after_save_and_base_verification"} <= {row["phase"] for row in phases}, "required fit phase observations missing")
    require([row["update"] for row in phases if row["phase"] == "update_completed"] == list(range(1, updates + 1)), "phase update history incomplete")
    for name in ("example_start", "before_decoder", "after_decoder", "after_loss_before_backward", "after_backward",
                 "before_optimizer_step", "before_reclamation", "after_reclamation",
                 "before_backward_reclamation", "after_backward_reclamation"):
        require([row["update"] for row in phases if row["phase"].removeprefix("first_") == name] == list(range(1, updates + 1)),
                "per-example phase history incomplete: " + name)
    for update in range(1, updates + 1):
        before, after = [next(row for row in phases if row["phase"] == name and row.get("update") == update)
                         for name in ("before_backward_reclamation", "after_backward_reclamation")]
        require(all(before[key] == after[key] for key in ("exampleId", "epoch", "loss", "finite", "supervisedDenominator"))
                and before["finite"] and before["supervisedDenominator"] > 0 and not after["peaksReset"],
                "pre-backward reclamation phase mismatch")
    require({"setup_before_reclamation", "setup_after_reclamation"} <= {row["phase"] for row in phases}, "setup reclamation proof missing")
    require(all("native" in row and "nativeObservationError" not in row and "gpuObservationError" not in row
                and 0 < row["native"]["jobCurrentCommittedBytes"] <= 6 * 1024**3
                and 0 < row["native"]["jobPeakCommittedBytes"] <= 6 * 1024**3 for row in phases), "native fit observations failed")
    for values in ([row["native"]["jobPeakCommittedBytes"] for row in phases],
                   *[[row["gpu"][key] for row in phases if row["gpu"]["measured"]] for key in ("peakAllocatedBytes", "peakReservedBytes")]):
        require(all(new >= old for old, new in zip(values, values[1:])), "cumulative memory peak was reset")
    return {"fitResourceAccepted": True, "fitRoot": str(root), "updates": updates, "trainingPlan": plan,
            "guardSha256": accepted["guardSha256"], "profileSha256": accepted["profileSha256"],
            "adapterManifestSha256": isolation.sha(output / "adapter-manifest.json"),
            "fitResultSha256": isolation.sha(output / "fit-result.json"), "lossEquivalencePassed": True,
            "lossEquivalenceSha256": equivalent_sha, "lossImplementation": LOSS_POLICY,
            "reclamationImplementation": RECLAMATION_POLICY, "reclamationControlPassed": True, "reclamationControlSha256": reclaim_sha,
            "liveGraphControlPassed": True, "preBackwardReclamationHistoryPassed": True,
            "attentionImplementation": ATTENTION_POLICY, "attentionControlPassed": True, "attentionControlSha256": attention_sha,
            "attentionScopeRestored": True, "attentionBlockHistoryPassed": True,
            "attentionBlocksSha256": result["attentionBlocksSha256"], "attentionScopeSha256": result["attentionScopeSha256"],
            "memoryPhasesSha256": result["memoryPhasesSha256"],
            **({"representation": selector.representation_metadata()} if selector is not None else {})}


def stage(action, fit_root=None, *, citation_view_assignment=None):
    require(action in ("fit", "reload"), "unsupported stage action")
    assignment_path = Path(citation_view_assignment) if citation_view_assignment is not None else ASSIGNMENT
    assignment_bytes = assignment_path.read_bytes()
    assignment = json.loads(assignment_bytes)
    declaration = checked_execution(assignment, action) if citation_view_assignment is not None else None
    require(declaration is not None or "datasetDeclaration" not in assignment, "explicit citation-view mode required")
    plan = training_plan(declaration)
    require(isolation.sha(BASELINE / "profile.json") == BASELINE_PROFILE_SHA, "accepted baseline profile drift")
    baseline = isolation.read(BASELINE / "profile.json")
    require(assignment["settings"] == FIT and assignment["teacherV1Sha256"] == V1_SHA
            and assignment["teacherV2Sha256"] == V2_SHA and Path(assignment["unchangedBaseline"]) == BASELINE,
            "frozen assignment changed")
    require((declaration is not None or assignment["task"] == "STUDENT-06") and assignment["unchangedRecipe"]
            and assignment["attentionControlBeforeFit"] == ATTENTION_CONTROL
            and assignment["memoryExecutionPolicy"]["queryChunkedAttention"]["queryChunkTokens"] == 128
            and assignment["memoryExecutionPolicy"].get("preBackwardReclamation")
            and assignment["memoryExecutionPolicy"]["headChunkTokens"] == LOSS_POLICY["headChunkTokens"], "memory repair assignment drift")
    require(isolation.sha(REPO / "docs/evidence/usp/ml-distillation/student/live-graph-reclamation-attempt-v1.json")
            == assignment["previousFailureReceiptSha256"], "historical failure receipt drift")
    fit_proof = accepted_fit(fit_root.resolve()) if action == "reload" else None
    if fit_proof is not None:
        checked_reload_counts(fit_proof, isolation.read(fit_root / "outputs/fit/adapter-manifest.json"),
                              plan, versioned=declaration is not None)
    if action == "fit" and declaration is not None:
        checked_citation_teacher((TEACHER / "train-teacher-v1.jsonl").read_bytes(),
            (TEACHER / "train-teacher-v2.jsonl").read_bytes(), (TEACHER / "train-teacher-v3.jsonl").read_bytes(),
            declaration, isolation.read(BASELINE / "inputs/schema-v1.json"), isolation.read(BASELINE / "inputs/family-freeze.json"))
    elif action == "fit":
        checked_teacher((TEACHER / "train-teacher-v1.jsonl").read_bytes(), (TEACHER / "train-teacher-v2.jsonl").read_bytes(),
            isolation.read(BASELINE / "inputs/schema-v1.json"), isolation.read(BASELINE / "inputs/family-freeze.json"))
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip()
    if declaration is not None:
        require(assignment.get("studentCodeCommit") == commit, "separately frozen student code commit required")
    for relative in (*CODE, "scripts/usp/learning/association/stage_adapter.py"):
        committed = subprocess.check_output(["git", "show", commit + ":" + relative], cwd=REPO)
        require((REPO / relative).read_bytes().replace(b"\r\n", b"\n") == committed, "uncommitted execution source: " + relative)
    require(shutil.disk_usage(BASELINE.parent).free >= 15 * 1024**3, "insufficient private staging disk")
    root = BASELINE.parent / (("adapter-citation-view-" if declaration else "adapter-query-sdpa-") + action + "-" + uuid.uuid4().hex)
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
    for relative, digest in assignment["inspectedAttentionSources"].items():
        if relative.startswith("runtime/"):
            require(files[relative] == digest, "inspected attention dependency drift: " + relative)
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
    copy(assignment_path, "inputs/assignment.json", hashlib.sha256(assignment_bytes).hexdigest())
    if action == "fit":
        for option, name, digest in (("teacher_v1", "train-teacher-v1.jsonl", V1_SHA), ("training_data", "train-teacher-v3.jsonl" if declaration else "train-teacher-v2.jsonl", plan["datasetSha256"])):
            input_names[option] = name
            copy(TEACHER / name, "inputs/" + name, digest)
        if declaration is not None:
            copy(TEACHER / "train-teacher-v2.jsonl", "inputs/train-teacher-v2.jsonl", V2_SHA)
    else:
        input_names.update(input_batch="development.json", adapter_manifest="adapter-manifest.json", fit_proof="fit-proof.json")
        copy(BASELINE / "inputs/development.json", "inputs/development.json", baseline["files"]["inputs/development.json"])
        copy(fit_root / "outputs/fit/adapter-manifest.json", "inputs/adapter-manifest.json", fit_proof["adapterManifestSha256"])
        for name, digest in isolation.read(fit_root / "outputs/fit/adapter-manifest.json")["files"].items():
            copy(fit_root / "outputs/fit/adapter" / name, "inputs/adapter/" + name, digest)
        isolation.write(root / "inputs/fit-proof.json", fit_proof)
        files["inputs/fit-proof.json"] = isolation.sha(root / "inputs/fit-proof.json")
    freeze = {"version": "association-adapter-freeze/5", "action": action, "fitSettings": FIT, "numerics": NUMERICS,
              "memoryExecutionPolicy": assignment["memoryExecutionPolicy"], "lossImplementation": LOSS_POLICY,
              "reclamationImplementation": RECLAMATION_POLICY,
              "attentionImplementation": ATTENTION_POLICY,
              "previousFailedFit": assignment["previousFailedFit"], "previousFailureReceiptSha256": assignment["previousFailureReceiptSha256"],
              "inferenceSettings": SETTINGS, "systemPromptSha256": hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest(),
              "inputSha256": {key: files["inputs/" + name] for key, name in input_names.items()},
              "sourceCommit": commit, "coordinatorHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=COORDINATOR, text=True).strip(),
              "baselineProfileSha256": BASELINE_PROFILE_SHA, "dependencyWheels": DEPENDENCIES,
              "inspectedRuntimeSources": {name: files[name] for name in (
                  "runtime/packages/transformers/models/qwen2/modeling_qwen2.py", "runtime/packages/peft/peft_model.py",
                  "runtime/packages/transformers/integrations/sdpa_attention.py", "runtime/packages/transformers/modeling_utils.py",
                  "runtime/packages/transformers/utils/generic.py", "runtime/packages/torch/nn/functional.py",
                  "runtime/packages/torch/nn/attention/__init__.py",
                  "runtime/packages/peft/tuners/lora/model.py", "runtime/packages/torch/utils/checkpoint.py")},
              "nativeJobObservationSource": {"url": "https://raw.githubusercontent.com/microsoft/win32metadata/main/generation/WinSDK/RecompiledIdlHeaders/um/winnt.h",
                  "observedSha256": "404019933323ca25f5db8ce14437483e1054398ce454d5c75df2e187cec2ae40",
                  "readOnlyQuery": "JobObjectLimitViolationInformation=13, JOBOBJECT_LIMIT_VIOLATION_INFORMATION.JobMemory"},
              "dependencyOrigin": str(WHEELS), "expectedClaimsSha256": EXPECTATIONS_SHA,
              "evaluationAllowed": False, "developmentInputsPresent": action == "reload", "promotionAuthorized": False}
    if declaration is not None:
        freeze.update(version="association-citation-view-freeze/1", datasetDeclaration=declaration, trainingPlan=plan)
        if action == "fit":
            freeze["auxiliaryInputSha256"] = {"train-teacher-v2.jsonl": V2_SHA}
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
    parser.add_argument("--citation-view-assignment", type=Path, help="Separate frozen STUDENT-08-FIT assignment; preparation is refused")
    args = parser.parse_args()
    if (args.action == "reload") != (args.fit_root is not None):
        parser.error("--fit-root is required only for reload")
    stage(args.action, args.fit_root, citation_view_assignment=args.citation_view_assignment)
