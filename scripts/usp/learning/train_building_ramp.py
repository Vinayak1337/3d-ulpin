#!/usr/bin/env python3
"""Plan continuation of the exact deployed RF-DETR source with standard Transformers Trainer.

Plan-only uses stdlib, reads hashes/COCO metadata, and never imports Torch or CUDA.
Fitting requires a separate root authorization and effective resource handoff.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import copy
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import struct
import sys
import time
from types import FunctionType

VERSION = "ramp-transformers-training-plan/1"
BASE_SHA = "f254c1400f780f7ea72a6bc588a2150bf8b4d8845ded7269655e26a275f41ac7"
BASE_BYTES = 141551436
CONFIG_SHA = "41aeed5933ae681d700978ded204c67ec756c775bbaa466ae3b0b11122b5f5c7"
PROCESSOR_SHA = "54287bdd487c98a439f9c8c8039b69544dce6fc1735dca50ca4de4d5bbf27382"
PACKAGES = {"torch": "2.14.0", "torchvision": "0.29.0", "transformers": "5.17.0",
            "accelerate": "1.15.0", "pycocotools": "2.0.11", "pillow": "12.3.0",
            "safetensors": "0.8.0", "numpy": "2.5.3", "scipy": "1.18.1"}
MOUNT_VERSION = "ramp-mounted-training-config/1"
BOUND_MOUNT_VERSION = "ramp-mounted-training-config/2"
RUNTIME_SHA = "6f801e596890067be2bf61b673958645c378480db6203dba277243f4427ef615"
LOCK_SHA = "0a049c8f7e893df7a8a6a579a81dcca2f2554c700883dbe1a4be661a5d2fa7d8"
ORIGINAL_CONFIG_SHA = "237c0f3815a66151a462f5d0bbe30a23e8cb4b8c9822c44cf2250f57c01107e2"
ORIGINAL_PLAN_SHA = "bf69a1f7aff08844e6b2899f66dee58f78a6435e13b52f188a4f36dcca9f1d6d"
ORIGINAL_SCRIPT_SHA = "40dd3ae09a8edebaf1248b03d80a69808d170f6164ebcd9c340aa4d155a85b84"
PORTABLE_SHA = "5063af10cd818804c93196df6cb80f1b5ddf428d58a4f3439e56e3447afd4267"
MOUNT_DESTINATIONS = {"model": "/inputs/model", "train": "/inputs/coco/train",
    "valid": "/inputs/coco/valid", "manifest": "/inputs/coco/manifest.json",
    "descriptor": "/inputs/coco/provenance/portable-v1/descriptor.json",
    "checks": "/inputs/coco/provenance/portable-v1/checks.json",
    **{k: f"/inputs/coco/provenance/portable-v1/input-metadata/input-{k}.json"
       for k in ["trainOriginal", "developmentOriginal", "developmentObserved"]},
    "originalConfig": "/inputs/plan/original-config.json", "originalPlan": "/inputs/plan/original-plan.json",
    "originalScript": "/inputs/plan/original-trainer.py", "adapter": "/inputs/plan/train_building_ramp.py"}
RUNTIME_DESTINATIONS = {"runtimeReceipt": "/inputs/plan/runtime-binding.json",
    "packageLock": "/inputs/plan/environment-lock.json", "installedMetadata": "/inputs/plan/installed-metadata.json",
    "imageMetadata": "/inputs/plan/layer-image-inspect.json"}
PILOT_VERSION = "ramp-pilot-training-plan/1"
PILOT_ROOT = Path("E:/BhuAayam-data/task-data/d07-rfdetr-repaired-pilot-20261006")
PILOT_TASK = "D07-RFDETR-REPAIRED-PILOT-FIT"
PILOT_EXECUTE_TASK = "D07-RFDETR-REPAIRED-PILOT-FIT-EXECUTE"
PILOT_SCOPE = "one_fixed_repaired_pilot_fit_no_evaluation"
PILOT_OUTPUT = "/outputs/rfdetr/repaired-pilot-fit-v1"
PILOT_UNMOUNTED_ROLES = {"valid", "developmentOriginal", "developmentObserved"}
PILOT_UNMOUNTED_PATHS = ("/inputs/coco/valid/",
    "/inputs/coco/provenance/portable-v1/input-metadata/input-developmentOriginal.json",
    "/inputs/coco/provenance/portable-v1/input-metadata/input-developmentObserved.json")
ROOT_THREAD = "01a0ed8a-4383-79c3-a0ae-35c1e969ef66"
GPU_UUID = "GPU-3989f368-bd26-bd52-9daf-037a9862f82f"
# These are retained metadata identities, not new data/model validation receipts.
PILOT_EVIDENCE = {
    "mountedConfig": (52751, "14d3936c88b983a5838f027bc411c9a656804de6b301f8e5be6d1aa6a87cf367"),
    "mountedPlan": (26107, "14343270b4511007b6d0bdbcfb6b4f473f4f60b20d5ee49f95b971af7fcdb9ac"),
    "allocation": (31595, "3f31d467c9ca8f6c92e02d7a09ffbb0fee7d51cd0d4dc3642629a32b02c074da"),
    "baseline": (17457, "0997be82e44c33943c828f76ecd42cc6e556944180d904f2c1416eda88521483"),
    "baselineScore": (129769, "9239661b104c58dc8d00252170d5c7fcfb41cb2e9b6f4cb6106638c096163355"),
    "controls": (15034, "133f7c27494d7b78056097b0f621c06e963cb757597e728e6efbf4a4ddcdee7c"),
    "repairConfirmation": (6141, "6c14117b7cdf0860b1890e69afe4cf0c3d0941ec2f0d7496eaeb53f11249e9c2"),
    "repairResult": (31213, "dfe7edb80e765719ab85c413ca6adbc269d63a378ddacc64cbdc0aecb8597f65"),
}
PILOT_BOUNDS = {"cpu": 2, "computeThreads": 2, "containerMemoryBytes": 5 * 1024**3,
    "swapBytes": 0, "pids": 32, "hostJobMemoryBytes": 512 * 1024**2,
    "gpuAllocationBytes": 5 * 1024**3, "fitAndCleanupSeconds": 900,
    "cleanupReserveSeconds": 45, "innerFitSeconds": 855}
PILOT_DECISION = {"maskIoUMin": 0.4683830, "maskRecallMin": 0.5380144,
    "maskPrecisionMin": 0.8266567, "emptyFalsePositiveScenesMax": 1,
    "emptyScenes": 5, "role": "open_cohort_decision_not_model_readiness",
    "report": ["polygon_matches", "polygon_false_positives", "polygon_misses", "geometry_omissions"],
    "candidateEvaluation": "later_separately_assigned_teacher_saved_final_ALL24_once_FP32_432_confidence0.5_logit0_cached_production_scorer",
    "finalAccess": False, "checkpointOrThresholdSelection": False}
EMPTY_MASK_LOSS = {
    "revision": "ulpin-rfdetr-empty-mask-scalar/1",
    "library": "transformers", "version": "5.17.0",
    "sourcesCanonicalLfSha256": {
        "loss_rf_detr": "db5a352ca7c9c0e0cfc2af7af29e6d348ec72391b5b82b38fedf23f0b4d32ece",
        "loss_lw_detr": "c7b271e3011dca508736fd8fec310a137e57da96b3dcdad2c60bc3d22ef5ce98"},
    "change": "Only empty matched mask CE/dice return source_masks.sum() scalar zeros",
    "scope": "RF-DETR segmentation model instance during explicitly bound operation"}


def scalar_empty_rfdetr_loss(implementation):
    """Keep upstream entry bytecode; isolate one criterion subclass in its globals.

    No installed file, loss mapping or upstream class is mutated. The shallow
    globals copy substitutes only the empty-mask subclass used by this callable;
    original matcher, CE/boxes, normalization, aux/encoder and weighted sum run.
    Call only after the caller's model/process authority has been checked.
    """
    require(implementation == EMPTY_MASK_LOSS, "Named empty-mask loss revision/source binding required")
    import transformers
    from transformers.loss import loss_rf_detr, loss_lw_detr
    require(transformers.__version__ == EMPTY_MASK_LOSS["version"], "Empty-mask repair library version drift")
    for name, module in [("loss_rf_detr", loss_rf_detr), ("loss_lw_detr", loss_lw_detr)]:
        data = Path(module.__file__).read_bytes()
        require(len(data) <= 64 * 1024 and hashlib.sha256(data.replace(b"\r\n", b"\n")).hexdigest() ==
                EMPTY_MASK_LOSS["sourcesCanonicalLfSha256"][name], "Empty-mask repair upstream source drift")
    original = loss_rf_detr.RfDetrForSegmentationLoss

    class ScalarEmptyMaskLoss(loss_rf_detr.RfDetrImageLoss):
        def loss_masks(self, outputs, targets, indices, num_boxes):
            if "pred_masks" not in outputs:
                return super().loss_masks(outputs, targets, indices, num_boxes)
            source_masks = outputs["pred_masks"][self._get_source_permutation_idx(indices)]
            if source_masks.numel() == 0:
                # The sum remains connected to the prediction graph. Do not sum
                # the already-broadcast empty total: that would erase CE/boxes.
                zero = source_masks.sum()
                return {"loss_mask_ce": zero, "loss_mask_dice": zero}
            return super().loss_masks(outputs, targets, indices, num_boxes)

    repaired = FunctionType(original.__code__,
        {**original.__globals__, "RfDetrImageLoss": ScalarEmptyMaskLoss},
        name=original.__name__, argdefs=original.__defaults__, closure=original.__closure__)
    repaired.__kwdefaults__ = original.__kwdefaults__
    repaired.loss_implementation = copy.deepcopy(EMPTY_MASK_LOSS)
    return repaired


@contextmanager
def repaired_rfdetr_model_loss(model, implementation):
    """Install only on this model, then restore its prior explicit/default loss."""
    repaired = scalar_empty_rfdetr_loss(implementation)
    from transformers.loss.loss_rf_detr import RfDetrForSegmentationLoss
    require(model.loss_function is RfDetrForSegmentationLoss, "Repair requires original RF-DETR segmentation loss")
    had_override = hasattr(model, "_loss_function")
    previous = getattr(model, "_loss_function", None)
    model.loss_function = repaired
    try:
        yield repaired
    finally:
        if had_override:
            model.loss_function = previous
        else:
            del model._loss_function


def pilot_arguments():
    """One fixed recipe; no user-selected sweep, precision or evaluation override."""
    return {"output_dir": PILOT_OUTPUT, "num_train_epochs": 6,
        "per_device_train_batch_size": 1, "per_device_eval_batch_size": 1,
        "gradient_accumulation_steps": 4, "learning_rate": 1e-4, "weight_decay": 1e-4,
        "seed": 42, "data_seed": 42, "dataloader_num_workers": 0,
        "remove_unused_columns": False, "eval_strategy": "no", "save_strategy": "no",
        "load_best_model_at_end": False, "do_eval": False, "prediction_loss_only": True,
        "report_to": "none", "push_to_hub": False, "fp16": False, "bf16": False,
        "gradient_checkpointing": False, "optim": "adamw_torch", "logging_steps": 1,
        "logging_nan_inf_filter": False, "label_names": ["labels"], "use_cpu": False,
        "torch_compile": False, "max_steps": -1, "lr_scheduler_type": "linear",
        "warmup_steps": 0, "max_grad_norm": 1.0, "auto_find_batch_size": False, "tf32": False}


def pilot_evidence(entries):
    require(set(entries) == set(PILOT_EVIDENCE), "Exact complete pilot evidence required")
    values = {}
    for key, entry in entries.items():
        require((entry["bytes"], entry["sha256"]) == PILOT_EVIDENCE[key], f"Pilot {key} identity drift")
        path = unlinked(entry["path"])
        require(path.stat().st_size == entry["bytes"], f"Pilot {key} metadata size drift")
        check_pin({**entry, "path": str(path)})
        values[key] = read_json(entry["path"], 1024**2)
    wrapper, prior, overlay, baseline = [values[k] for k in ["mountedConfig", "mountedPlan", "allocation", "baseline"]]
    require(wrapper["schemaVersion"] == BOUND_MOUNT_VERSION and wrapper["trainingAuthorized"] is False and
            prior["runtimeBinding"] == wrapper["runtimeBinding"] and prior["trainingAuthorized"] is False,
            "Reuse unchanged bound preparation")
    require(overlay["schemaVersion"] == "ramp-pilot-allocation-overlay/1" and
            overlay["partition"] == {"experimentalTrainingAllocated": 24, "openDevelopmentAllocated": 24,
                "finalTestAllocated": 0, "unallocated": 0, "fitAdmitted": 0} and
            overlay["executionReservation"]["trainingAuthorized"] is False, "Frozen whole-group allocation required")
    require([(g["role"], g["parentCapture"], g["images"], g["publisherInstances"], g["sourceEmptyImages"])
            for g in overlay["groups"]] == [("experimental_training", "105001001597B000", 24, 263, 1),
                ("open_development", "104001002CA32300", 24, 178, 5)], "Pilot roles/counts cannot change")
    require(baseline["status"] == "all24_own_route_baseline_and_cached_production050_scoring_completed" and
            baseline["contract"]["baselinePolicy"]["items"] == 24 and baseline["decision"]["fit"] is False and
            baseline["decision"]["onnxEquivalence"] is False and
            baseline["numericalObservations"]["state"] == "all24_numeric_parity_failed" and
            baseline["scoring"]["correctedResult"]["sha256"] == entries["baselineScore"]["sha256"],
            "Own-route measured baseline required; failed ONNX parity remains separate")
    require(values["controls"]["status"] == "actual_native_cpu_processor_and_tiny_gpu_controls_passed_model_unrun",
            "Retain accepted controls; they do not authorize this new process")
    confirmation, result = values["repairConfirmation"], values["repairResult"]
    require(confirmation["commit"] == "ba81c4e798c555a7bbc1ee209619887bf68a45b0" and
            confirmation["state"] == "repaired_cpu_contract_confirmed_no_training" and
            confirmation["lossRevision"] == EMPTY_MASK_LOSS["revision"] and
            confirmation["positive"]["exactUnpatchedTelemetryEquality"] is True and
            confirmation["empty"]["mask12ScalarZeros"] is True and
            confirmation["empty"]["other24ExactlyUnchanged"] is True and
            confirmation["artifacts"]["result"]["sha256"] == entries["repairResult"]["sha256"] and
            result["state"] == "both_controls_finite" and result["forwardCalls"] == 2,
            "Exact repaired two-input CPU confirmation required; no historical CUDA attribution")
    return values


def pilot_inventory(wrapper, script, adapter_host):
    """Retain exact training inputs; development payload/annotation snapshots stay unmounted."""
    return [{**row, "hostPin": {**script, "path": adapter_host}, "containerPin": script}
        if row["containerPin"]["path"] == script["path"] else copy.deepcopy(row)
        for row in wrapper["inventory"]
        if not any(row["containerPin"]["path"].startswith(p) for p in PILOT_UNMOUNTED_PATHS)]


def validate_pilot(plan):
    require(plan["schemaVersion"] == PILOT_VERSION and plan["task"] == PILOT_TASK and
            plan["trainingAuthorized"] is False and plan["state"] == "prepared_only",
            "Historical pilot is not the named repaired plan; preparation grants no fit permission")
    require(plan.get("lossImplementation") == EMPTY_MASK_LOSS and
            plan.get("coupledChanges", {}).get("emptyMaskLoss") == EMPTY_MASK_LOSS["revision"],
            "Historical pilot cannot execute changed loss: new named repair plan required")
    require(plan["planSha256"] == digest({k: v for k, v in plan.items() if k != "planSha256"}), "Pilot plan drift")
    require(plan["trainingArguments"] == pilot_arguments() and plan["bounds"] == PILOT_BOUNDS and
            plan["decision"] == PILOT_DECISION, "Fixed pilot recipe/bounds/decision changed")
    require(not any(m["role"] in PILOT_UNMOUNTED_ROLES or
                    m["containerPath"].rstrip("/") == "/inputs/coco" for m in plan["mounts"]) and
            not any(any(r["containerPin"]["path"].startswith(p) for p in PILOT_UNMOUNTED_PATHS)
                    for r in plan["inventory"]), "Development must be unmounted during repaired fit")
    require(plan["budget"] == {"trainExamples": 144, "optimizerUpdates": 36, "epochs": 6,
        "developmentExamplesDuringFit": 0, "finalExamples": 0}, "Fixed pilot budget changed")
    require(set(plan["evidence"]) == set(PILOT_EVIDENCE) and
            all((p["bytes"], p["sha256"]) == PILOT_EVIDENCE[k] for k, p in plan["evidence"].items()), "Evidence authority drift")
    require([p["split"] for p in plan["pools"]] == ["train", "valid"] and
            [(p["images"], p["instances"]) for p in plan["pools"]] == [(24, 263), (24, 178)] and
            (plan["trainSource"], plan["developmentSource"]) == ("ramp-barishal", "ramp-karnataka"), "Whole-group role drift")
    require(plan["memberIdentityDigest"] == "77e70e0947766378e131b1829a572a951840913389b48eeab1f2d7a264a6d7bd" and
            digest(plan["members"]) == plan["memberIdentityDigest"] and len(plan["members"]) == 48,
            "Frozen complete membership changed")


def prepare_pilot(spec_path):
    """Freeze accepted metadata only. Never read model tensors or image payloads."""
    spec = read_json(spec_path, 1024**2)
    require(set(spec) == {"schemaVersion", "evidence", "outputHost"} and
            spec["schemaVersion"] == "ramp-pilot-preparation/1" and
            unlinked(spec["outputHost"]) == unlinked(PILOT_ROOT / "output"), "Finite pilot preparation scope required")
    values = pilot_evidence(spec["evidence"])
    prior, wrapper, overlay, baseline = [values[k] for k in ["mountedPlan", "mountedConfig", "allocation", "baseline"]]
    runtime = sealed_runtime(next({"path": m["hostPath"], "bytes": 6417, "sha256": RUNTIME_SHA}
        for m in wrapper["mounts"] if m["role"] == "runtimeReceipt"))
    require(runtime["imageDigest"] == wrapper["runtimeBinding"]["imageDigest"] and
            runtime["packageVersions"] == wrapper["runtimeBinding"]["packageVersions"], "Sealed pilot environment drift")
    mounts = [copy.deepcopy(m) for m in wrapper["mounts"] if m["role"] not in PILOT_UNMOUNTED_ROLES]
    next(m for m in mounts if m["role"] == "adapter")["hostPath"] = str(PILOT_ROOT / "train_building_ramp.py")
    evidence = {}
    for key, entry in spec["evidence"].items():
        destination = f"/inputs/pilot/{key}.json"
        mounts.append({"role": key, "hostPath": entry["path"], "containerPath": destination, "readOnly": True, "kind": "file"})
        evidence[key] = {**entry, "path": destination}
    script = {**file_pin(__file__), "path": "/inputs/plan/train_building_ramp.py"}
    inventory = pilot_inventory(wrapper, script, str(PILOT_ROOT / "train_building_ramp.py"))
    score = baseline["scoring"]
    plan = {"schemaVersion": PILOT_VERSION, "task": PILOT_TASK, "state": "prepared_only",
        "trainingAuthorized": False, "scriptPin": script, "evidence": evidence,
        "lossImplementation": copy.deepcopy(EMPTY_MASK_LOSS),
        "runtimeBinding": wrapper["runtimeBinding"], "mounts": mounts, "inventory": inventory,
        "outputHost": spec["outputHost"], "trainingArguments": pilot_arguments(), "bounds": PILOT_BOUNDS,
        "budget": {"trainExamples": 144, "optimizerUpdates": 36, "epochs": 6, "developmentExamplesDuringFit": 0, "finalExamples": 0},
        "decision": PILOT_DECISION, "groups": overlay["groups"], "members": overlay["members"],
        "memberIdentityDigest": overlay["memberIdentityDigest"],
        **{k: prior[k] for k in ["weights", "modelConfig", "processorConfig", "datasetManifest", "pools",
            "trainSource", "developmentSource", "classMapping", "initialHead", "preprocessing"]},
        "measuredBaseline": {"ownerCommit": "07d726337703bd88a91b38f28074d404cc6231f1",
            "mask": score["maskAndPolygonBuildingMetrics"]["mask"], "polygons": score["objects"]["polygons"],
            "emptyScenes": score["emptyScenes"], "omissions": score["omissions"],
            "observedResidual": "roof_pixel_recall0.4880144; polygon67matched43FP111missed; emptyFP1of5",
            "onnxParity": "FAILED; not an own-route completion/adaptation gate; no equivalence claim"},
        "coupledChanges": {"emptyMaskLoss": EMPTY_MASK_LOSS["revision"],
            "principalChange": "Only empty-mask scalar repair; original six-epoch Trainer recipe unchanged",
            "executionReceiptChanges": "New code/plan/output/root scope and confirmation pins; development data unmounted"},
        "supervision": "Publisher-human CC-BY-NC research rooftops only; pretraining overlap/independent local audit/ignore ambiguity unknown; clipping and roof-vs-ground limits retained; no operational labels",
        "authorizationContract": {"schemaVersion": "ramp-pilot-training-authorization/1", "rootThreadId": ROOT_THREAD,
            "scope": PILOT_SCOPE, "currentPidRequired": True,
            "rootAssignmentTask": PILOT_EXECUTE_TASK, "gpuUuid": GPU_UUID,
            "lossImplementation": copy.deepcopy(EMPTY_MASK_LOSS),
            "required": ["exact_plan_code_recipe_split_baseline", "later_root_fit_assignment", "current_pid_native_mount_environment_resource_proof", "sole_gpu_handoff"]},
        "checkpointInterface": {"directory": PILOT_OUTPUT + "/checkpoint",
            "files": ["model.safetensors", "config.json", "preprocessor_config.json"],
            "result": PILOT_OUTPUT + "/result.json", "selection": "fixed_final_only",
            "teacherPermission": "information_only; separate root assignment required"},
        "blockers": ["Later explicit root fit assignment and fresh current-PID native/resource/sole-GPU proof",
            "Actual fit capacity/finite losses/parameter integrity unrun", "Later separately assigned saved-checkpoint ALL24 comparison unrun"]}
    plan["planSha256"] = digest(plan)
    validate_pilot(plan)
    return plan


def check_pilot_gate(path, expected_sha, plan):
    validate_pilot(plan)
    require(path is not None and expected_sha is not None, "Pilot fitting blocked: later root authorization/current-process handoff required")
    require(file_pin(unlinked(path))["sha256"] == expected_sha, "Pilot authorization hash drift")
    gate = read_json(path, 1024**2)
    require(gate["schemaVersion"] == "ramp-pilot-training-authorization/1" and gate["rootThreadId"] == ROOT_THREAD and
            gate["rootAuthorized"] is True and gate["scope"] == PILOT_SCOPE and
            gate["planSha256"] == plan["planSha256"] and gate["scriptSha256"] == file_pin(__file__)["sha256"] == plan["scriptPin"]["sha256"] and
            gate["recipe"] == pilot_arguments() and gate["bounds"] == PILOT_BOUNDS and gate["evidence"] == plan["evidence"] and
            gate.get("lossImplementation") == plan["lossImplementation"],
            "Exact pilot code/plan/recipe/source authority required")
    check_pin(gate["rootAssignment"])
    assignment = read_json(gate["rootAssignment"]["path"], 1024**2)
    require(assignment["schemaVersion"] == "ramp-pilot-root-assignment/1" and
            assignment["task"] == PILOT_EXECUTE_TASK and assignment["rootThreadId"] == ROOT_THREAD and
            assignment["fitAuthorized"] is True and assignment["evaluationAuthorized"] is False and
            assignment["planSha256"] == plan["planSha256"] and assignment["scriptSha256"] == plan["scriptPin"]["sha256"] and
            isinstance(gate["modelOwnerThreadId"], str) and len(gate["modelOwnerThreadId"]) == 36 and
            assignment["modelOwnerThreadId"] == gate["modelOwnerThreadId"] and
            assignment.get("lossImplementation") == plan["lossImplementation"],
            "Preparation or baseline assignment grants no fit permission")
    require(gate.get("lossDiagnostics") is not True or assignment.get("lossDiagnostics") is True,
            "Loss telemetry must be explicitly included in the exact new root assignment")
    check_pin(gate["preflightReceipt"])
    proof = read_json(gate["preflightReceipt"]["path"], 1024**2)
    require(proof["pid"] == os.getpid() and proof["imageDigest"] == plan["runtimeBinding"]["imageDigest"] and
            proof["gpuUuid"] == GPU_UUID and proof["gpuOwnerTransferred"] is True and proof["modelOwner"] == gate["modelOwnerThreadId"] and
            proof["effectiveNetworkDenied"] is True and proof["effectiveResourceLimits"] is True and
            proof["exactMountsAndEnvironmentVerified"] is True and proof["bounds"] == PILOT_BOUNDS and
            proof["planSha256"] == plan["planSha256"], "Fresh exclusive contained pilot process required")
    values = pilot_evidence(plan["evidence"])
    require(plan["groups"] == values["allocation"]["groups"] and plan["members"] == values["allocation"]["members"],
            "Frozen allocation authority changed")
    runtime = sealed_runtime(plan["runtimeBinding"]["receipt"], plan["mounts"])
    require(runtime == plan["runtimeBinding"] and sys.platform == "linux" and os.uname().machine == "x86_64" and
            ".".join(map(str, sys.version_info[:3])) == runtime["pythonVersion"] and
            Path(sys.executable).resolve() == Path(runtime["pythonExecutable"]).resolve() and
            all(importlib.metadata.version(k) == v for k, v in runtime["packageVersions"].items()), "Exact sealed134-package process required")
    prior = read_json(plan["evidence"]["mountedPlan"]["path"])
    require(all(plan[k] == prior[k] for k in ["weights", "modelConfig", "processorConfig", "datasetManifest", "pools",
        "trainSource", "developmentSource", "classMapping", "initialHead", "preprocessing"]), "Original input contract drift")
    adapter_host = next(m["hostPath"] for m in plan["mounts"] if m["role"] == "adapter")
    expected_source_mounts = [copy.deepcopy(m) for m in values["mountedConfig"]["mounts"]
        if m["role"] not in PILOT_UNMOUNTED_ROLES]
    next(m for m in expected_source_mounts if m["role"] == "adapter")["hostPath"] = adapter_host
    require(plan["mounts"][:len(expected_source_mounts)] == expected_source_mounts and
            [m["role"] for m in plan["mounts"][len(expected_source_mounts):]] == list(PILOT_EVIDENCE),
            "Exact training-only source mounts required")
    expected_inventory = pilot_inventory(values["mountedConfig"], plan["scriptPin"], adapter_host)
    require(plan["inventory"] == expected_inventory, "Complete retained input inventory required")
    for row in plan["inventory"]: check_pin(row["containerPin"])
    gate.update(authorizedPid=os.getpid(), authorizationSha256=expected_sha)
    return gate


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def unlinked(path):
    """Refuse links/reparse points before resolution, including existing ancestors."""
    path = Path(path).absolute()
    for item in [path, *path.parents]:
        if item.exists() or item.is_symlink():
            require(not item.is_symlink() and not (getattr(item.lstat(), "st_file_attributes", 0) & 0x400),
                    f"Linked/reparse input or output: {item}")
    return path.resolve()


def foreign_path(value):
    path = PureWindowsPath(value) if PureWindowsPath(value).drive else PurePosixPath(value)
    require(path.is_absolute() and ".." not in path.parts, f"Noncanonical/unmapped path: {value}")
    return path


def rebase(value, mounts):
    path = foreign_path(value)
    matches = []
    for mount in mounts:
        host = foreign_path(mount["hostPath"])
        if type(host) is type(path) and (path == host or mount["kind"] == "directory" and path.is_relative_to(host)):
            matches.append(str(PurePosixPath(mount["containerPath"]) / path.relative_to(host).as_posix()))
    require(len(matches) == 1, f"Expected exactly one explicit mapping: {value}")
    return matches[0]


def mapped_pin(pin, mounts):
    return {**pin, "path": rebase(pin["path"], mounts)}


def portable_inputs(descriptor_path):
    descriptor = read_json(descriptor_path)
    require(file_pin(descriptor_path)["sha256"] == PORTABLE_SHA and
            descriptor["schemaVersion"] == "ramp-coco-portable-provenance/1", "Unsealed portable descriptor")
    refs = {"descriptor": file_pin(descriptor_path), "manifest": descriptor["legacyManifest"],
            "train": descriptor["exportAnnotations"]["train"], "valid": descriptor["exportAnnotations"]["valid"],
            "checks": descriptor["checks"]}
    refs.update({k: v["sourceManifest"] for k, v in descriptor["inputMetadataSnapshots"].items()})
    for key, pin in list(refs.items()):
        if key == "descriptor": continue
        path = unlinked(Path(descriptor_path).parent / pin["path"])
        root = Path(descriptor_path).parent.parent.parent.resolve()
        require(path.is_relative_to(root), "Portable dependency escapes export root")
        refs[key] = {**pin, "path": str(path)}
        check_pin(refs[key])
    # All sourceManifest paths in the old export are historical locators. Only the
    # unchanged snapshots beside this sealed descriptor become runtime dependencies.
    return refs


def sealed_runtime(pin, mounts=None):
    """Bind the exact ENV metadata receipt, never arbitrary version overrides."""
    require(pin["sha256"] == RUNTIME_SHA and pin["bytes"] == 6417, "Unsealed runtime binding")
    check_pin({**pin, "path": str(unlinked(pin["path"]))})
    runtime = read_json(pin["path"])
    require(runtime["schemaVersion"] == "rfdetr-runtime-binding/1" and runtime["platform"] == "linux/amd64" and
            runtime["pullPolicy"] == "never" and runtime["trainingAuthorized"] is False, "Unsupported runtime scope")
    for key in ["packageLock", "installedMetadata", "imageMetadata"]:
        if mounts is not None: runtime[key] = mapped_pin(runtime[key], mounts)
        check_pin({**runtime[key], "path": str(unlinked(runtime[key]["path"]))})
    lock = read_json(runtime["packageLock"]["path"])
    installed = read_json(runtime["installedMetadata"]["path"])
    image = read_json(runtime["imageMetadata"]["path"])
    require(runtime["packageLock"]["sha256"] == LOCK_SHA and lock["schemaVersion"] == "rfdetr-linux-environment-lock/1" and
            lock["python"] == runtime["pythonVersion"] and lock["platform"] == runtime["platform"] and
            lock["installedPackageVersions"] == runtime["packageVersions"] == installed["installedPackageVersions"] and
            len(runtime["packageVersions"]) == 134 and installed["environmentLockSha256"] == LOCK_SHA and
            installed["pythonEntrypoint"] == runtime["pythonExecutable"], "Runtime/package lock metadata disagree")
    require(image["Id"] == image["Descriptor"]["digest"] == runtime["imageDigest"] == runtime["imageReference"] and
            image["Descriptor"]["annotations"]["config.digest"] == runtime["imageConfigDigest"] and
            image["Os"] + "/" + image["Architecture"] == runtime["platform"] and
            image["Config"]["User"] == runtime["imageUser"] == "10001:10001" and
            image["Config"]["Env"] == runtime["imageEnvironment"] and
            image["Config"]["Entrypoint"] == runtime["imageEntrypoint"] == [runtime["pythonExecutable"]], "Sealed image metadata disagree")
    runtime.update(receipt=pin, rootfsLayerDiffIds=image["RootFS"]["Layers"])
    return runtime


def prepare_mounted(spec_path):
    """Cheap metadata mapping of the already verified plan; no COCO/RLE replay."""
    spec = read_json(spec_path, 1024**2)
    require(set(spec) == {"schemaVersion", "originalConfig", "originalPlan", "originalScript", "portableDescriptor",
                         "adapter", "mounts", "output", "runtimeBinding"} and
            spec["schemaVersion"] in {"ramp-mount-map/1", "ramp-mount-map/2"}, "Unsupported mount-map fields/version")
    runtime = sealed_runtime(spec["runtimeBinding"]) if spec["runtimeBinding"] is not None else None
    require((spec["schemaVersion"] == "ramp-mount-map/2") == (runtime is not None), "Map version/runtime binding mismatch")
    destinations = {**MOUNT_DESTINATIONS, **(RUNTIME_DESTINATIONS if runtime else {})}
    for key, sha in [("originalConfig", ORIGINAL_CONFIG_SHA), ("originalPlan", ORIGINAL_PLAN_SHA),
                     ("originalScript", ORIGINAL_SCRIPT_SHA), ("portableDescriptor", PORTABLE_SHA)]:
        require(spec[key]["sha256"] == sha, f"Unsealed {key}")
        check_pin(spec[key])
    check_pin(spec["adapter"])
    require(spec["adapter"]["sha256"] == file_pin(__file__)["sha256"], "Adapter source differs from running script")
    config = read_json(spec["originalConfig"]["path"])
    original = read_json(spec["originalPlan"]["path"])
    unsigned = {k: v for k, v in original.items() if k != "planSha256"}
    require(digest(unsigned) == original["planSha256"], "Original plan canonical digest drift")
    require(config["trainSource"] == original["trainSource"] == "ramp-barishal" and
            config["developmentSource"] == original["developmentSource"] == "ramp-karnataka", "Pool roles cannot be swapped")
    refs = portable_inputs(spec["portableDescriptor"]["path"])
    expected = {"model": str(Path(config["weights"]["path"]).parent),
        "train": str(Path(config["datasetRoot"]) / "train"), "valid": str(Path(config["datasetRoot"]) / "valid"),
        "manifest": config["datasetManifest"]["path"],
        **{k: refs[k]["path"] for k in ["descriptor", "checks", "trainOriginal", "developmentOriginal", "developmentObserved"]},
        **{k: spec[k]["path"] for k in ["originalConfig", "originalPlan", "originalScript", "adapter"]}}
    runtime_refs = {} if runtime is None else {"runtimeReceipt": spec["runtimeBinding"],
        **{k: runtime[k] for k in ["packageLock", "installedMetadata", "imageMetadata"]}}
    expected.update({k: p["path"] for k, p in runtime_refs.items()})
    mounts = spec["mounts"]
    require(len(mounts) == len(expected) and {m["role"] for m in mounts} == set(expected), "Finite input roles required")
    output = spec["output"]
    require(set(output) == {"hostPath", "containerPath", "readOnly", "kind"} and output["containerPath"] == "/outputs/rfdetr" and
            output["readOnly"] is False and output["kind"] == "directory", "One isolated writable output required")
    out = unlinked(output["hostPath"])
    task_root = unlinked(Path(spec_path).parent)
    require(task_root == unlinked("E:/BhuAayam-data/task-data/d07-rfdetr-mounted-plan-20261005") and
            out == task_root / ("output-runtime-v1" if runtime else "output"), "Output must be the assigned task's isolated output directory")
    require(not out.exists() or out.is_dir() and not any(out.iterdir()), "Output must be new/empty task-owned directory")
    host_roots = []
    for mount in mounts:
        require(set(mount) == {"role", "hostPath", "containerPath", "readOnly", "kind"}, "Unknown mount field")
        role = mount["role"]
        path = unlinked(mount["hostPath"])
        kind = "directory" if role in {"model", "train", "valid"} else "file"
        require(path == unlinked(expected[role]) and mount["kind"] == kind and mount["readOnly"] is True and
                mount["containerPath"] == destinations[role], "Unsupported/writable input mount")
        require(path.is_dir() if kind == "directory" else path.is_file(), "Mount type mismatch")
        require(not out.is_relative_to(path) and not path.is_relative_to(out), "Output overlaps protected input")
        require(all(not path.is_relative_to(p) and not p.is_relative_to(path) for p in host_roots), "Overlapping input mounts")
        host_roots.append(path)
        mount["hostPath"] = str(path)
    # Directory inventory is exact. Retained image pins are reused; newly check
    # bytes/paths only here, with full image/hash validation left to actual runtime.
    inventory = [config[k] for k in ["weights", "modelConfig", "processorConfig", "datasetManifest", "trainAnnotations", "developmentAnnotations"]]
    inventory += [spec[k] for k in ["originalConfig", "originalPlan", "originalScript", "adapter"]]
    inventory += [p for k, p in refs.items() if k not in {"manifest", "train", "valid"}]
    inventory += list(runtime_refs.values())
    for pool in original["pools"]:
        require(pool["split"] in {"train", "valid"} and pool["images"] == 24 and len(pool["imagePins"]) == 24, "Unsupported pool")
        inventory.extend(pool["imagePins"])
    require([p["split"] for p in original["pools"]] == ["train", "valid"] and
            sum(p["instances"] for p in original["pools"]) == 441, "Original 48-image/441-instance scope changed")
    paths = {unlinked(p["path"]): p for p in inventory}
    require(len(paths) == len(inventory), "Duplicate inventory input")
    for mount in mounts:
        root = Path(mount["hostPath"])
        children = [unlinked(p) for p in root.rglob("*")] if mount["kind"] == "directory" else []
        actual = {root} if mount["kind"] == "file" else {p for p in children if p.is_file()}
        require(actual == {p for p in paths if p == root or mount["kind"] == "directory" and p.is_relative_to(root)}, "Unlisted/missing mount input")
    for path, pin in paths.items():
        require(path.is_file() and path.stat().st_size == pin["bytes"], f"Inventory size drift: {path}")
    images = [p for pool in original["pools"] for p in pool["imagePins"]]
    for pin in inventory:
        if pin not in images: check_pin(pin)
    view = copy.deepcopy(config)
    for key in ["weights", "modelConfig", "processorConfig", "datasetManifest", "trainAnnotations", "developmentAnnotations"]:
        view[key] = mapped_pin(config[key], mounts)
    view["datasetRoot"] = "/inputs/coco"
    view["outputDir"] = "/outputs/rfdetr/fit"
    mapped = copy.deepcopy(original)
    for key in ["weights", "modelConfig", "processorConfig", "datasetManifest"]:
        mapped[key] = mapped_pin(original[key], mounts)
    for pool in mapped["pools"]:
        pool["annotationPin"] = mapped_pin(pool["annotationPin"], mounts)
        pool["imagePins"] = [mapped_pin(p, mounts) for p in pool["imagePins"]]
    # Old scriptPin is an origin identity; it must not point at the new adapter.
    mapped["scriptPin"] = mapped_pin(spec["originalScript"], mounts)
    mapped["configPin"] = mapped_pin(spec["originalConfig"], mounts)
    mapped["trainingArguments"]["output_dir"] = view["outputDir"]
    if runtime:
        runtime = copy.deepcopy(runtime)
        for key in ["receipt", "packageLock", "installedMetadata", "imageMetadata"]:
            runtime[key] = mapped_pin(runtime[key], mounts)
    wrapper = {"schemaVersion": BOUND_MOUNT_VERSION if runtime else MOUNT_VERSION, "kind": "metadata_only_mapping_not_runtime_validation",
        "config": view, "mounts": mounts, "output": {**output, "hostPath": str(out)},
        "originalConfig": mapped_pin(spec["originalConfig"], mounts), "originalPlan": mapped_pin(spec["originalPlan"], mounts),
        "originalScript": mapped_pin(spec["originalScript"], mounts), "adapter": mapped_pin(spec["adapter"], mounts),
        "portableInputs": {k: mapped_pin(p, mounts) for k, p in refs.items()}, "runtimeBinding": runtime,
        "inventory": [{"hostPin": p, "containerPin": mapped_pin(p, mounts),
                       "verification": "retained_sha256_and_current_path_size" if p in images else "current_exact_bytes_sha256"} for p in inventory],
        "trainingAuthorized": False, "fitAdmission": "not_fit_admitted"}
    mapped.update({"schemaVersion": "ramp-mounted-training-plan/2" if runtime else "ramp-mounted-training-plan/1", "originalPlanSha256": original["planSha256"],
        "mountedConfigSha256": digest(wrapper), "adapterPin": wrapper["adapter"], "runtimeBinding": runtime,
        "installedPackageMetadata": None, "kind": wrapper["kind"], "trainingAuthorized": False,
        "blockers": ([] if runtime else ["Sealed compatible Linux runtime/dependency lock"]) + ["Actual mounted-process containment and input readback",
                     *original["blockers"]]})
    if runtime: mapped["expectedPackageVersions"] = runtime["packageVersions"]
    del mapped["planSha256"]
    mapped["planSha256"] = digest(mapped)
    return {"mountedConfig": wrapper, "mountedPlan": mapped}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path, limit=32 * 1024**2):
    path = Path(path)
    require(path.is_file() and path.stat().st_size <= limit, f"Missing/oversized JSON: {path}")
    def invalid(value):
        raise ValueError(f"Non-finite JSON: {value}")
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(path.read_bytes(), parse_constant=invalid, object_pairs_hook=unique_pairs)


def file_pin(path, max_bytes=512 * 1024**2):
    path = Path(path).resolve(strict=True)
    require(path.is_file() and 0 < path.stat().st_size <= max_bytes, f"Invalid artifact size: {path}")
    with path.open("rb") as stream:
        sha = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": sha}


def check_pin(pin):
    require(set(pin) == {"path", "bytes", "sha256"}, "Artifact requires path/bytes/sha256")
    actual = file_pin(pin["path"])
    require(actual["bytes"] == pin["bytes"] and actual["sha256"] == pin["sha256"], f"Artifact drift: {pin['path']}")
    return Path(actual["path"])


def contained(path, root):
    path = Path(path).resolve(strict=True)
    require(path.is_relative_to(root), f"Path escapes dataset: {path}")
    return path


def validate_pool(root, split, annotation_pin):
    path = check_pin(annotation_pin)
    require(path == root / split / "_annotations.coco.json", "Unexpected COCO split path")
    coco = read_json(path)
    require(len(coco["categories"]) == 1 and coco["categories"][0]["id"] == 1 and coco["categories"][0]["name"] == "rooftop_building", "Expected one rooftop_building category, id1")
    images = coco["images"]
    require(len(images) == 24, f"Expected the fixed 24 {split} images")
    indexed = {}
    pins = []
    for image in images:
        image_id = image["id"]
        require(isinstance(image_id, int) and image_id not in indexed, "Duplicate/invalid image ID")
        require(isinstance(image["file_name"], str) and Path(image["file_name"]).name == image["file_name"], "Expected local PNG filename")
        image_path = contained(root / split / image["file_name"], root / split)
        with image_path.open("rb") as stream:
            head = stream.read(24)
        require(head[:16] == b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR", "Expected lossless PNG")
        width, height = struct.unpack(">II", head[16:24])
        require([width, height] == [image["width"], image["height"]] and 0 < width * height <= 4_000_000, "Image frame mismatch/too large")
        indexed[image_id] = image
        pins.append(file_pin(image_path, 16 * 1024**2))
    require(len({p["sha256"] for p in pins}) == len(pins), "Repeated image bytes inside pool")
    seen = set()
    for ann in coco["annotations"]:
        require(isinstance(ann["id"], int) and ann["id"] not in seen, "Duplicate/invalid annotation ID")
        seen.add(ann["id"])
        require(ann["image_id"] in indexed and ann["category_id"] == 1 and ann["iscrowd"] == 0, "Annotation identity/class/crowd mismatch")
        image = indexed[ann["image_id"]]
        x, y, w, h = ann["bbox"]
        require(all(isinstance(v, (int, float)) and math.isfinite(v) for v in [x, y, w, h, ann["area"]]), "Invalid bbox/area")
        require(0 <= x < x+w <= image["width"] and 0 <= y < y+h <= image["height"] and 0 < ann["area"] <= w*h, "Out-of-frame bbox/area")
        rle = ann["segmentation"]
        require(isinstance(rle, dict) and rle["size"] == [image["height"], image["width"]], "Expected source-frame RLE, preserving holes")
        require(isinstance(rle["counts"], (str, list)) and len(rle["counts"]) > 0, "Invalid RLE counts")
        if isinstance(rle["counts"], list):
            require(all(isinstance(v, int) and v >= 0 for v in rle["counts"]) and sum(rle["counts"]) == image["width"]*image["height"], "Incomplete RLE")
    return {"split": split, "annotationPin": annotation_pin, "imagePins": pins, "images": len(images), "instances": len(seen)}


def mounted_view(wrapper):
    """Resolve only declared POSIX inputs; source snapshots stay unchanged."""
    bound = wrapper["schemaVersion"] == BOUND_MOUNT_VERSION
    require(wrapper["schemaVersion"] in {MOUNT_VERSION, BOUND_MOUNT_VERSION} and wrapper["fitAdmission"] == "not_fit_admitted" and
            wrapper["trainingAuthorized"] is False, "Mounted configuration grants no fit admission")
    destinations = {**MOUNT_DESTINATIONS, **(RUNTIME_DESTINATIONS if bound else {})}
    require({m["role"] for m in wrapper["mounts"]} == set(destinations) and
            len(wrapper["mounts"]) == len(destinations) and
            all(m["readOnly"] is True and m["containerPath"] == destinations[m["role"]]
                for m in wrapper["mounts"]), "Unsupported mounted input scope")
    if bound:
        runtime = sealed_runtime(wrapper["runtimeBinding"]["receipt"], wrapper["mounts"])
        require(runtime == wrapper["runtimeBinding"], "Mounted runtime differs from sealed ENV metadata")
        require(sys.platform == "linux" and os.uname().machine == "x86_64" and
                ".".join(map(str, sys.version_info[:3])) == runtime["pythonVersion"] and
                Path(sys.executable).resolve() == Path(runtime["pythonExecutable"]).resolve(), "Actual process Python/platform differs from runtime binding")
    else:
        require(wrapper["runtimeBinding"] is None, "Version1 has no compatible runtime binding")
    for key, sha in [("originalConfig", ORIGINAL_CONFIG_SHA), ("originalPlan", ORIGINAL_PLAN_SHA),
                     ("originalScript", ORIGINAL_SCRIPT_SHA)]:
        require(wrapper[key]["sha256"] == sha, f"Unsealed mounted {key}")
        check_pin(wrapper[key])
    require(check_pin(wrapper["adapter"]) == Path(__file__).resolve(), "Run the declared mounted adapter")
    original = read_json(wrapper["originalConfig"]["path"])
    view = copy.deepcopy(original)
    for key in ["weights", "modelConfig", "processorConfig", "datasetManifest", "trainAnnotations", "developmentAnnotations"]:
        view[key] = mapped_pin(view[key], wrapper["mounts"])
    view.update(datasetRoot="/inputs/coco", outputDir="/outputs/rfdetr/fit")
    require(view == wrapper["config"], "Mounted config changes more than declared paths")
    refs = portable_inputs(wrapper["portableInputs"]["descriptor"]["path"])
    require(refs == wrapper["portableInputs"], "Mounted portable provenance differs from sealed descriptor")
    manifest = read_json(view["datasetManifest"]["path"])
    for split, key in zip(manifest["splits"], ["trainOriginal", "developmentOriginal"]):
        require(split["sourceManifest"]["sha256"] == refs[key]["sha256"] and
                split["sourceManifest"]["bytes"] == refs[key]["bytes"], "Snapshot differs from original export input")
        split["sourceManifest"] = refs[key]
        split["annotations"] = mapped_pin(split["annotations"], wrapper["mounts"])
    for row in manifest["images"]:
        row["image"] = mapped_pin(row["image"], wrapper["mounts"])
    return view, manifest


def build_plan(config_path):
    config_path = Path(config_path).resolve(strict=True)
    config = read_json(config_path, 1024**2)
    mounted = config if config.get("schemaVersion") in {MOUNT_VERSION, BOUND_MOUNT_VERSION} else None
    mounted_manifest = None
    if mounted:
        config, mounted_manifest = mounted_view(mounted)
    require(config["schemaVersion"] == VERSION and config["modelScope"] == "exact_deployed_transformers_source", "Wrong plan/model scope")
    weights = check_pin(config["weights"])
    require(config["weights"]["sha256"] == BASE_SHA and config["weights"]["bytes"] == BASE_BYTES, "Only the exact deployed model source checkpoint is supported")
    model_config = check_pin(config["modelConfig"])
    processor_config = check_pin(config["processorConfig"])
    require(model_config == weights.parent / "config.json" and processor_config == weights.parent / "preprocessor_config.json", "Original model/processor files must be beside checkpoint")
    require(config["modelConfig"]["sha256"] == CONFIG_SHA and config["processorConfig"]["sha256"] == PROCESSOR_SHA, "Checkpoint configuration drift")
    architecture = read_json(model_config)
    require(architecture["architectures"] == ["RfDetrForInstanceSegmentation"] and architecture["id2label"] == {"0": "building"} and architecture["label2id"] == {"building": 0}, "Existing one-class head must remain unchanged")
    root = Path(config["datasetRoot"]).resolve(strict=True)
    require(not (root / "test").exists(), "A final/test directory is forbidden in this preparation pool")
    manifest_path = check_pin(config["datasetManifest"])
    require(manifest_path.parent == root, "Dataset manifest must be adjacent to pools")
    pools = [validate_pool(root, s, config[key]) for s, key in [("train", "trainAnnotations"), ("valid", "developmentAnnotations")]]
    require(not ({p["sha256"] for p in pools[0]["imagePins"]} & {p["sha256"] for p in pools[1]["imagePins"]}), "Train/development image overlap")
    # The data owner pins source identities, label provenance, conservative site groups and ambiguity policy.
    # A separate frozen eligibility receipt is required at execution; export alone grants no fit admission.
    manifest = mounted_manifest if mounted_manifest is not None else read_json(manifest_path)
    require(manifest["task"] == "D06-RAMP-COCO-PREP" and manifest["fitAdmission"] == "not_fit_admitted" and manifest["finalOrTestSelection"] is False, "Expected prepared research pools, not implicit fit/final admission")
    require([s["split"] for s in manifest["splits"]] == ["train", "valid"] and manifest["splits"][0]["sourceParent"] == "105001001597B000" and manifest["splits"][1]["sourceParent"] == "104001002CA32300", "Fixed source groups changed")
    require(manifest["splits"][0]["sourceGroup"] != manifest["splits"][1]["sourceGroup"], "Source group overlap")
    require(all(s["annotations"] == config[k] for s, k in zip(manifest["splits"], ["trainAnnotations", "developmentAnnotations"])), "COCO pins differ from provenance manifest")
    mapped = {(row["split"], row["imageId"]): row for row in manifest["images"]}
    require(len(mapped) == 48, "Expected complete source provenance for every exported image")
    for pool, source_split in zip(pools, manifest["splits"]):
        coco = read_json(pool["annotationPin"]["path"])
        for image, image_pin in zip(coco["images"], pool["imagePins"]):
            row = mapped[(pool["split"], image["id"])]
            require(row["sourceGroup"] == source_split["sourceGroup"] and row["sourceParent"] == source_split["sourceParent"], "Source grouping drift")
            require(row["image"]["sha256"] == image_pin["sha256"] and row["image"]["bytes"] == image_pin["bytes"] and Path(row["image"]["path"]).resolve() == Path(image_pin["path"]), "Image differs from retained source mapping")
    require(config["trainSource"] == "ramp-barishal" and config["developmentSource"] == "ramp-karnataka", "Pool roles cannot be swapped")
    require(config["libraryVersion"] == "5.17.0", "Unreviewed Transformers version")
    require(isinstance(config["seed"], int) and 0 <= config["seed"] < 2**32, "Invalid seed")
    epochs = config["epochs"]
    require(isinstance(epochs, int) and 1 <= epochs <= 5, "Preparation supports one bounded experiment of 1–5 epochs")
    output = Path(config["outputDir"]).resolve()
    protected = [root, weights.parent, config_path.parent]
    require(all(not output.is_relative_to(p) and not p.is_relative_to(output) for p in protected), "Output overlaps retained data/config/weights")
    versions = {}
    expected_versions = mounted["runtimeBinding"]["packageVersions"] if mounted and mounted["runtimeBinding"] else PACKAGES
    for name in expected_versions:
        try: versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError: versions[name] = None
    kwargs = {"output_dir": str(output), "num_train_epochs": epochs, "per_device_train_batch_size": 1,
              "per_device_eval_batch_size": 1, "gradient_accumulation_steps": 4,
              "learning_rate": 1e-4, "weight_decay": 1e-4, "seed": config["seed"], "data_seed": config["seed"],
              "dataloader_num_workers": 0, "remove_unused_columns": False, "eval_strategy": "epoch",
              "save_strategy": "no", "prediction_loss_only": True, "report_to": "none", "push_to_hub": False,
              "fp16": True, "gradient_checkpointing": True, "optim": "adamw_torch", "logging_steps": 1,
              "label_names": ["labels"], "use_cpu": False, "torch_compile": False}
    plan = {"schemaVersion": VERSION, "scriptPin": file_pin(__file__), "configPin": file_pin(config_path), "datasetManifest": config["datasetManifest"],
            "lossImplementation": copy.deepcopy(EMPTY_MASK_LOSS),
            "coupledChanges": {"emptyMaskLoss": EMPTY_MASK_LOSS["revision"]},
            "weights": config["weights"], "modelConfig": config["modelConfig"], "processorConfig": config["processorConfig"],
            "modelScope": config["modelScope"], "libraryVersion": "5.17.0",
            "pools": pools, "trainSource": config["trainSource"], "developmentSource": config["developmentSource"],
            "trainingArguments": kwargs, "classMapping": {"cocoCategory1": "rooftop_building", "modelLabel0": "building", "mappingScope": "explicit research roof target; no cadastral/operational footprint truth"},
            "initialHead": "Original one-class config/weights retained; no num_labels override, ignore_mismatched_sizes or head reinitialization.",
            "checkpointLoading": "Publisher safetensors/config pins match deployed ONNX source; source-verified supervised loss; numerical model/ONNX parity and capacity unexecuted.",
            "preprocessing": "RGB Pillow bilinear square432 then original processor rescale/ImageNet normalization with resize disabled. Targets: standard pycocotools RLE decode, Pillow nearest masks, scaled source boxes; originals untouched. No inference profile/threshold change.",
            "installedPackageMetadata": versions, "trainingAuthorized": False,
            "blockers": ["Root measured-residual authorization", "Frozen eligible source-group supervision and category/head baseline",
                         "Unchanged source-checkpoint open-development baseline and Torch/ONNX preprocessing parity", "Single model/GPU ownership transfer",
                         "Effective network/resource preflight for this exact training process", "Isolated resolved dependency lock and safe matching checkpoint loading"]}
    if mounted:
        plan.update(schemaVersion="ramp-mounted-runtime-plan/2" if mounted["runtimeBinding"] else "ramp-mounted-runtime-plan/1", runtimeBinding=mounted["runtimeBinding"],
                    portableInputs=mounted["portableInputs"], originalPlan=mounted["originalPlan"],
                    mountedConfigVersion=mounted["schemaVersion"])
        if mounted["runtimeBinding"]:
            require(versions == expected_versions, "Actual package metadata differs from complete134-package sealed lock")
            plan["expectedPackageVersions"] = expected_versions
        plan["blockers"].insert(0, "Actual mounted-process qualification and root authorization")
    encoded = json.dumps(plan, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    plan["planSha256"] = hashlib.sha256(encoded).hexdigest()
    return plan, manifest


def check_gate(path, expected_sha, plan):
    if plan["schemaVersion"] == PILOT_VERSION:
        return check_pilot_gate(path, expected_sha, plan)
    require(path is not None and expected_sha is not None, "Execution blocked: a root authorization/handoff receipt and exact hash are required")
    if plan["schemaVersion"] in {"ramp-mounted-runtime-plan/1", "ramp-mounted-runtime-plan/2"}:
        require(False, "Mounted execution blocked: actual-process qualification/root authorization gate remains unassigned")
    require(file_pin(path)["sha256"] == expected_sha, "Authorization receipt hash mismatch")
    gate = read_json(path, 1024**2)
    require(gate["schemaVersion"] == "ramp-training-authorization/1" and gate["planSha256"] == plan["planSha256"], "Authorization belongs to another plan")
    require(gate["rootThreadId"] == "01a0ed8a-4383-79c3-a0ae-35c1e969ef66" and gate["rootAuthorized"] is True, "Root has not authorized fitting")
    require(plan.get("lossImplementation") == EMPTY_MASK_LOSS and gate.get("lossImplementation") == EMPTY_MASK_LOSS,
            "New exact authorization must bind named empty-mask loss repair")
    for name in ["measuredResidual", "frozenEligibleGroupedSupervision", "sameCheckpointDevelopmentBaseline", "torchOnnxPreprocessingParity", "environmentLock"]:
        check_pin(gate[name])
    preflight = gate["preflight"]
    require(preflight["pid"] == os.getpid() and preflight["gpuOwnerTransferred"] is True, "No live exclusive resource handoff for this process")
    require(preflight["effectiveNetworkDenied"] is True and preflight["effectiveResourceLimits"] is True, "Effective network/resource guard not verified")
    check_pin(preflight["receipt"])
    require(all(plan["installedPackageMetadata"][p] and plan["installedPackageMetadata"][p].split("+")[0] == v for p, v in PACKAGES.items()), "Install the isolated pinned recipe and freeze dependencies before execution")
    return gate


def finite_rfdetr_loss(loss, components, tensor_api):
    return (loss is not None and loss.numel() == 1 and tensor_api.isfinite(loss).all().item() and
            all(tensor_api.isfinite(v).all().item() for v in components.values()))


def diagnostic_tensor(value, tensor_api):
    """Detached, JSON-safe metadata; an empty finite tensor is not a scalar loss."""
    if value is None:
        return {"present": False}
    value = value.detach()
    finite = tensor_api.isfinite(value)
    count = value.numel()
    all_finite = bool(finite.all().item())
    return {"present": True, "shape": list(value.shape), "numel": count,
        "dtype": str(value.dtype), "allFinite": all_finite,
        "nonfiniteValues": count - int(finite.sum().item()),
        "minimum": value.min().item() if count and all_finite else None,
        "maximum": value.max().item() if count and all_finite else None}


class LossDiagnostics:
    """Opt-in observer, reusable by a separately authorized forward-only launcher.

    Holds only detached summaries, never changes targets/loss/gradients or retries.
    It grants no model, fitting, data or resource authority.
    """
    def __init__(self, tensor_api, output, global_step=lambda: 0):
        self.tensor_api, self.output, self.global_step = tensor_api, Path(output), global_step
        self.sources, self.current, self.last_finite = {}, None, None
        self.parameter_state = self.gradient_state = None
        self.last_finite_parameters = self.last_finite_gradients = None
        self.forward_calls = 0

    def register_sources(self, images, annotations):
        self.sources = {im["id"]: {"fileName": im["file_name"],
            "annotationIds": [a["id"] for a in annotations[im["id"]]]} for im in images}

    def before_forward(self, module, args, kwargs):
        targets = kwargs.get("labels")
        require(isinstance(targets, list) and len(targets) <= 4, "Diagnostic target batch bound exceeded")
        self.forward_calls += 1
        rows = []
        for target in targets:
            ids = target["image_id"].detach().reshape(-1).tolist()
            require(len(ids) == 1, "Diagnostic requires one literal source image ID per target")
            source = self.sources.get(ids[0])
            require(source is not None and len(source["annotationIds"]) <= 512 and
                    len(source["fileName"]) <= 1024, "Diagnostic source metadata missing or oversized")
            rows.append({"imageId": ids[0], **source,
                "targets": {key: diagnostic_tensor(target.get(key), self.tensor_api)
                    for key in ["class_labels", "boxes", "masks"]}})
        self.current = {"forwardOrdinal": self.forward_calls, "optimizerUpdates": self.global_step(), "inputs": rows}

    def after_forward(self, outputs, valid):
        require(self.current is not None, "Diagnostic input hook did not capture this forward")
        components = outputs.loss_dict
        require(isinstance(components, dict) and len(components) <= 128 and
                all(isinstance(k, str) and len(k) <= 128 for k in components), "Diagnostic named-loss bound exceeded")
        self.current.update(total=diagnostic_tensor(outputs.loss, self.tensor_api),
            components={k: diagnostic_tensor(v, self.tensor_api) for k, v in sorted(components.items())})
        if valid:
            self.last_finite = self.current
            return
        total = self.current["total"]
        self.current["guardReasons"] = (["missing_total"] if not total["present"] else
            (["non_scalar_total"] if total["numel"] != 1 else []) +
            (["nonfinite_total"] if not total["allFinite"] else []))
        self.current["nonfiniteComponents"] = [k for k, v in self.current["components"].items()
            if v["present"] and not v["allFinite"]]
        if self.current["nonfiniteComponents"]:
            self.current["guardReasons"].append("nonfinite_components")
        self.current["nonScalarComponents"] = [k for k, v in self.current["components"].items()
            if v["present"] and v["numel"] != 1]
        self.current["predictions"] = {key: diagnostic_tensor(getattr(outputs, key, None), self.tensor_api)
            for key in ["logits", "pred_boxes", "pred_masks"]}
        self.write_failure()

    def capture_state(self, model, gradients=False):
        present, absent, bad_count, bad_names = 0, 0, 0, []
        for name, parameter in model.named_parameters():
            value = parameter.grad if gradients else parameter
            if value is None:
                absent += 1
                continue
            present += 1
            if not self.tensor_api.isfinite(value.detach()).all().item():
                bad_count += 1
                if len(bad_names) < 8: bad_names.append(name)
        state = {"optimizerUpdates": self.global_step(), "presentTensors": present, "absentTensors": absent,
            "allFinite": bad_count == 0, "nonfiniteTensors": bad_count, "firstNonfiniteNames": bad_names,
            "phase": "before_optimizer_after_standard_clipping" if gradients else "initial_or_after_optimizer"}
        if gradients:
            state["upcomingOptimizerUpdate"] = self.global_step() + 1
            self.gradient_state = state
            if present and not bad_count: self.last_finite_gradients = state
        else:
            self.parameter_state = state
            if present and not bad_count: self.last_finite_parameters = state

    def write_failure(self):
        receipt = {"schemaVersion": "ramp-loss-diagnostics/1", "state": "stopped_before_backward",
            "failingForward": self.current, "lastFiniteForward": self.last_finite,
            "latestParameters": self.parameter_state, "latestGradients": self.gradient_state,
            "lastFiniteParameters": self.last_finite_parameters, "lastFiniteGradients": self.last_finite_gradients,
            "optimizerOrBackwardRunByObserver": False, "retryAuthorized": False}
        encoded = (json.dumps(receipt, indent=2, allow_nan=False) + "\n").encode()
        require(len(encoded) <= 256 * 1024, "Diagnostic receipt byte bound exceeded")
        with (self.output / "loss-diagnostics.json").open("xb") as handle:
            handle.write(encoded)


def execute(plan, gate, loss_diagnostics=False):
    pilot = plan["schemaVersion"] == PILOT_VERSION
    require(not loss_diagnostics or (pilot and gate.get("lossDiagnostics") is True),
            "Loss telemetry requires explicit opt-in in a new exact pilot authorization")
    if pilot:
        validate_pilot(plan)
        require(gate.get("authorizedPid") == os.getpid() and gate.get("planSha256") == plan["planSha256"] and
                gate.get("authorizationSha256"), "Pilot fitting blocked: check the exact current-process authorization first")
        output = unlinked(plan["trainingArguments"]["output_dir"])
        require(output == Path(PILOT_OUTPUT) and not output.exists(), "New isolated repaired pilot output required")
        output.mkdir(parents=True, exist_ok=False)
        (output / "plan.json").write_text(json.dumps(plan, indent=2)+"\n")
    try:
        return execute_trainer(plan, gate, time.monotonic(), loss_diagnostics=loss_diagnostics)
    except BaseException as error:
        if pilot:
            # Preserve the failed attempt, including any partial checkpoint. No
            # OOM/nonfinite/compatibility retry, precision fallback or overwrite.
            (output / "failure.json").write_text(json.dumps({"schemaVersion": "ramp-pilot-training-failure/1",
                "state": "stopped_unqualified", "planSha256": plan["planSha256"],
                "task": PILOT_TASK, "lossImplementation": plan["lossImplementation"],
                "errorType": type(error).__name__, "error": str(error)[:4000],
                "retryAuthorized": False, "evaluationRun": False, "promotion": False}, indent=2)+"\n")
        raise


def execute_trainer(plan, gate, started=None, *, loss_diagnostics=False):
    require(plan.get("lossImplementation") == EMPTY_MASK_LOSS and gate.get("lossImplementation") == EMPTY_MASK_LOSS,
            "Trainer blocked before imports: explicit loss implementation binding required")
    require(not loss_diagnostics or (plan["schemaVersion"] == PILOT_VERSION and gate.get("lossDiagnostics") is True),
            "Loss telemetry requires checked opt-in pilot authority")
    if plan["schemaVersion"] == PILOT_VERSION:
        require(gate.get("authorizedPid") == os.getpid() and gate.get("planSha256") == plan["planSha256"] and
                gate.get("authorizationSha256"), "Pilot Trainer blocked before heavy imports: checked process authority required")
    # This layer supplements the required external process guard; it does not claim
    # to enforce OS/CUDA limits or block native egress by itself.
    os.environ.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
                       "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2", "WANDB_MODE": "disabled"})
    def offline(event, args):
        if event in {"socket.connect", "socket.getaddrinfo", "socket.bind", "socket.sendto", "subprocess.Popen", "os.system"}:
            raise RuntimeError("Training is local and offline; network/child launch refused")
    sys.addaudithook(offline)
    import torch
    import numpy as np
    from PIL import Image
    from pycocotools import mask as coco_mask
    from transformers import RfDetrForInstanceSegmentation, RfDetrImageProcessor, Trainer, TrainerCallback, TrainingArguments, set_seed
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    require(torch.cuda.is_available() and torch.cuda.device_count() == 1, "Preflight must expose exactly one authorized GPU")
    pilot = plan["schemaVersion"] == PILOT_VERSION
    output = Path(plan["trainingArguments"]["output_dir"])
    if not pilot:
        output.mkdir(parents=True, exist_ok=False)
        (output / "plan.json").write_text(json.dumps(plan, indent=2)+"\n")
    set_seed(plan["trainingArguments"]["seed"])
    original = str(Path(plan["weights"]["path"]).parent)
    model, loading = RfDetrForInstanceSegmentation.from_pretrained(original, local_files_only=True, use_safetensors=True, attn_implementation="eager", output_loading_info=True)
    require(not any(loading.get(k) for k in ["missing_keys", "unexpected_keys", "mismatched_keys", "error_msgs"]), "Matching checkpoint failed complete load; no random replacement allowed")
    require(model.config.id2label == {0: "building"} and model.config.num_labels == 1, "Original classification head changed")
    processor = RfDetrImageProcessor.from_pretrained(original, local_files_only=True)
    started = started if started is not None else time.monotonic()
    observed = {"forwardCalls": 0, "trainExamples": 0}
    diagnostics = LossDiagnostics(torch, output, lambda: trainer.state.global_step) if loss_diagnostics else None
    parameter_signature = None
    if pilot:
        require(model.config.num_queries == 200 and model.config.disable_custom_kernels is True, "Original query/kernel contract changed")
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.cuda.set_per_process_memory_fraction(PILOT_BOUNDS["gpuAllocationBytes"] / torch.cuda.get_device_properties(0).total_memory, 0)
        require(all(p.dtype == torch.float32 and torch.isfinite(p).all().item() for p in model.parameters()), "Original FP32 parameters must be finite")
        parameter_signature = [(n, tuple(p.shape), str(p.dtype), p.requires_grad) for n, p in model.named_parameters()]

        def finite_loss(module, inputs, outputs):
            require(time.monotonic() - started <= PILOT_BOUNDS["innerFitSeconds"], "Pilot inner fit deadline exceeded")
            require(torch.cuda.memory_allocated() <= PILOT_BOUNDS["gpuAllocationBytes"] and
                    torch.cuda.memory_reserved() <= PILOT_BOUNDS["gpuAllocationBytes"], "Pilot GPU allocation exceeded")
            loss = outputs.loss
            valid = finite_rfdetr_loss(loss, outputs.loss_dict, torch)
            if diagnostics:
                try:
                    diagnostics.after_forward(outputs, valid)
                except Exception as error:
                    print(f"Loss telemetry unavailable: {type(error).__name__}: {str(error)[:500]}", file=sys.stderr)
            require(valid, "Nonfinite built-in loss; stop before backward and retain the attempt")
            observed["forwardCalls"] += 1
        model.register_forward_hook(finite_loss)

    class CocoPool:
        """Small source adapter only; losses, optimizer, evaluation and fitting belong to Trainer."""
        def __init__(self, pool):
            self.path = Path(pool["annotationPin"]["path"])
            data = read_json(self.path)
            self.images = data["images"]
            self.annotations = {image["id"]: [] for image in self.images}
            for ann in data["annotations"]: self.annotations[ann["image_id"]].append(ann)
            if diagnostics: diagnostics.register_sources(self.images, self.annotations)

        def __len__(self): return len(self.images)

        def __getitem__(self, index):
            if pilot:
                observed["trainExamples"] += 1
            source = self.images[index]
            with Image.open(self.path.parent / source["file_name"]) as image:
                rgb = image.convert("RGB").resize((432, 432), Image.Resampling.BILINEAR)
            sx, sy = 432/source["width"], 432/source["height"]
            annotations, masks = [], []
            for original_ann in self.annotations[source["id"]]:
                rle = original_ann["segmentation"]
                if isinstance(rle["counts"], list): rle = coco_mask.frPyObjects(rle, source["height"], source["width"])
                decoded = coco_mask.decode(rle)
                mask = np.asarray(Image.fromarray(decoded).resize((432, 432), Image.Resampling.NEAREST)).copy()
                require(mask.shape == (432, 432) and mask.any(), "Resize erased an instance; retain source and revise the bounded preparation rather than dropping it")
                masks.append(torch.as_tensor(mask, dtype=torch.uint8))
                x, y, w, h = original_ann["bbox"]
                annotations.append({"id": original_ann["id"], "image_id": source["id"], "category_id": 0,
                                    "iscrowd": 0, "bbox": [x*sx, y*sy, w*sx, h*sy], "area": int(mask.sum())})
            encoded = processor(images=rgb, annotations={"image_id": source["id"], "annotations": annotations},
                                return_segmentation_masks=False, do_resize=False, do_pad=False, return_tensors="pt")
            target = encoded["labels"][0]
            require(len(target["class_labels"]) == len(annotations), "Processor discarded source instances")
            target["masks"] = torch.stack(masks) if masks else torch.zeros((0, 432, 432), dtype=torch.uint8)
            return {"pixel_values": encoded["pixel_values"][0], "labels": target}

    def collate(batch):
        return {"pixel_values": torch.stack([b["pixel_values"] for b in batch]),
                "pixel_mask": torch.ones((len(batch), 432, 432), dtype=torch.bool), "labels": [b["labels"] for b in batch]}

    trainer = Trainer(model=model, args=TrainingArguments(**plan["trainingArguments"]),
                      train_dataset=CocoPool(plan["pools"][0]), eval_dataset=None if pilot else CocoPool(plan["pools"][1]),
                      data_collator=collate, processing_class=processor)
    if pilot:
        # RF-DETR's built-in object/mask loss does not consume num_items_in_batch.
        # Use the documented standard Trainer accumulation normalization.
        trainer.model_accepts_loss_kwargs = False
    if diagnostics:
        diagnostics.capture_state(model)
        model.register_forward_pre_hook(diagnostics.before_forward, with_kwargs=True)

        class DiagnosticCallback(TrainerCallback):
            def on_pre_optimizer_step(self, args, state, control, **kwargs):
                diagnostics.capture_state(kwargs["model"], gradients=True)

            def on_optimizer_step(self, args, state, control, **kwargs):
                # Trainer increments global_step after this callback. Identify the
                # completed update explicitly, retaining the ordinary callback order.
                diagnostics.capture_state(kwargs["model"])
                diagnostics.parameter_state["optimizerUpdates"] = state.global_step + 1

        trainer.add_callback(DiagnosticCallback())
    with repaired_rfdetr_model_loss(model, plan["lossImplementation"]):
        fitted = trainer.train()
    require(math.isfinite(fitted.metrics["train_loss"]), "Non-finite training loss; keep the failed run for diagnosis")
    if pilot:
        require(time.monotonic() - started <= PILOT_BOUNDS["innerFitSeconds"], "Pilot fit deadline exceeded before final save")
        require(trainer.state.global_step == 36 and observed == {"forwardCalls": 144, "trainExamples": 144} and
                trainer.state.epoch == 6.0, "Fixed six-epoch whole-pool training did not complete")
        require(not any(k.startswith("eval_") for row in trainer.state.log_history for k in row), "Unexpected development evaluation")
        require(parameter_signature == [(n, tuple(p.shape), str(p.dtype), p.requires_grad) for n, p in model.named_parameters()] and
                all(torch.isfinite(p).all().item() for p in model.parameters()) and
                model.config.id2label == {0: "building"} and model.config.num_labels == 1, "Final parameter/head integrity failed")
    if pilot:
        # Standard model/processor serialization, one fixed final directory;
        # no epoch/optimizer checkpoint or best-model selection.
        model.save_pretrained(str(output / "checkpoint"), safe_serialization=True)
        processor.save_pretrained(str(output / "checkpoint"))
    else:
        trainer.save_model(str(output / "checkpoint"))
    selected = output / "checkpoint" / "model.safetensors"
    result = {"schemaVersion": "ramp-training-result/1", "planSha256": plan["planSha256"],
              "lossImplementation": plan["lossImplementation"],
              "state": "fit_completed_unqualified", "selectedCheckpoint": file_pin(selected),
              "metrics": fitted.metrics, "developmentLossHistory": trainer.state.log_history,
              "trainingConfig": plan["trainingArguments"], "heldOutTestOpened": False,
              "promotion": False, "accuracyQualification": False}
    if pilot:
        result.update(schemaVersion="ramp-pilot-training-result/1", fixedFinalCheckpoint=True,
            trainingObservations=observed, optimizerUpdates=trainer.state.global_step,
            trainingLossHistory=trainer.state.log_history, developmentLossHistory=[], evaluationRun=False,
            authorizationSha256=gate["authorizationSha256"], decision=plan["decision"],
            checkpointFiles={name: file_pin(output / "checkpoint" / name) for name in plan["checkpointInterface"]["files"]})
        result.update(task=PILOT_TASK, bounds=plan["bounds"], allForwardLossesFinite=True,
            finalParametersFinite=True, fitEpochs=trainer.state.epoch,
            rootAssignment=gate["rootAssignment"], preflightReceipt=gate["preflightReceipt"])
    (output / "result.json").write_text(json.dumps(result, indent=2, allow_nan=False)+"\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--prepare-mounted", type=Path, help="Finite host mount map; reuse sealed plan without data validation/model imports")
    parser.add_argument("--prepare-pilot", type=Path, help="Freeze fixed research pilot from accepted metadata only; no fit permission")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--plan-only", action="store_true", help="Default; no Torch/Transformers/CUDA import or fitting")
    mode.add_argument("--execute", action="store_true")
    parser.add_argument("--authorization", type=Path)
    parser.add_argument("--authorization-sha256")
    parser.add_argument("--loss-diagnostics", action="store_true", help="Opt-in loss metadata for an independently authorized pilot; grants no execution permission")
    args = parser.parse_args()
    require(not args.loss_diagnostics or (args.execute and not args.prepare_pilot and not args.prepare_mounted),
            "Loss diagnostics requires separately authorized execution")
    if args.prepare_pilot:
        require(not args.prepare_mounted and not args.config and not args.execute and not args.authorization and
                not args.authorization_sha256, "Pilot preparation accepts no execution/config override")
        print(json.dumps(prepare_pilot(args.prepare_pilot), indent=2, allow_nan=False))
        return
    if args.prepare_mounted:
        require(not args.config and not args.execute and not args.authorization and not args.authorization_sha256,
                "Mount preparation is metadata-only and accepts no execution/config override")
        print(json.dumps(prepare_mounted(args.prepare_mounted), indent=2))
        return
    require(args.config is not None, "--config or --prepare-mounted is required")
    if args.execute:
        require(args.authorization is not None and args.authorization_sha256 is not None,
                "Execution blocked: a root authorization/handoff receipt and exact hash are required")
    candidate = read_json(args.config, 1024**2)
    if candidate.get("schemaVersion") == PILOT_VERSION:
        validate_pilot(candidate)
        if args.execute:
            gate = check_gate(args.authorization, args.authorization_sha256, candidate)
            print(json.dumps(execute(candidate, gate, loss_diagnostics=args.loss_diagnostics), indent=2, allow_nan=False))
        else:
            print(json.dumps(candidate, indent=2, allow_nan=False))
        return
    if candidate.get("schemaVersion") in {MOUNT_VERSION, BOUND_MOUNT_VERSION} and args.execute:
        require(False, "Mounted execution blocked: actual-mounted-process qualification and root authorization remain unassigned")
    require(not args.loss_diagnostics, "Loss diagnostics supports only a separately authorized fixed pilot")
    plan, _ = build_plan(args.config)
    if args.execute:
        gate = check_gate(args.authorization, args.authorization_sha256, plan)
        print(json.dumps(execute(plan, gate), indent=2))
    else:
        print(json.dumps(plan, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, TypeError) as error:
        print(json.dumps({"state": "blocked", "error": str(error)}), file=sys.stderr)
        raise SystemExit(2)
