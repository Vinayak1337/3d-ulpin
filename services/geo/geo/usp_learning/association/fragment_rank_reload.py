"""Separate accepted final-phase reload authority; no native imports at admission.

Training identities refer to immutable retained bytes. New execution sources do
not rebind the checkpoint. The existing shared PEFT lifecycle owns native load.
"""
from __future__ import annotations

import math
from pathlib import Path
import re
import struct
import types

from . import fragment_rank_baseline as baseline, fragment_rank_phase_adapter as phase
from . import fragment_rank_checkpoint as checkpoint, adapter
from .validation import require, strict_json

sha, same, codec = checkpoint.sha, checkpoint.same, baseline.codec
ASSIGNMENT_VERSION = "association-fragment-rank-reload-assignment/1"
FREEZE_VERSION = "association-fragment-rank-reload-freeze/1"
TASK = "STUDENT-FRAGMENT-RANK-RELOAD"
ASSIGNMENT_NAME = "fragment-rank-reload-assignment.json"
MODEL, REVISION, WEIGHTS_SHA = baseline.MODEL, baseline.REVISION, baseline.WEIGHTS_SHA
SETTINGS, ALLOWANCE, DONORS = baseline.SETTINGS, baseline.ALLOWANCE, baseline.DONORS
INPUT_NAMES, INPUT_PINS, ARTIFACT_PINS, CASES = baseline.INPUT_NAMES, baseline.INPUT_PINS, baseline.ARTIFACT_PINS, baseline.CASES
FIT_ROOT = "E:/BhuAayam-data/task-data/ml-distillation/student/adapter-fragment-rank-phase-fit-cca373df707d4380a020a933b0811472"
FIT_COMMIT = "7a7b6eb5c6fd0ed2f63eb03197e7f5f6999ed270"
EXPERIMENT = "4415b7cc039c4e3a853682297f0ed28e"
ACCEPTANCE_SHA = "15c91a03e316c67570e4b34a200c9ae268fd2de0ef7adf75e4fc62a204a4f00c"
REVIEW_SHA = "cda8d0f67e1105c98f42b76accc2f2d1aecc20cc6aa9d22aa5a1053c4ba8b310"
COORDINATOR = "C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/"
ACCEPTED_FIT = {"root": FIT_ROOT, "acceptancePath": COORDINATOR + "student-fragment-rank-phase-3-native-acceptance-v1.json",
    "acceptanceSha256": ACCEPTANCE_SHA, "reviewPath": COORDINATOR + "student-fragment-rank-phase-3-native-acceptance-review-v1.json",
    "reviewSha256": REVIEW_SHA}
ADAPTER_PINS = {"README.md": "d58f094333cfc1c4dd7444763d0d4900fa12102545f64c28d5689920da5f1793",
    "adapter_config.json": "caddd7cee4ba510b73088fa191db872b6a1947f023ae35bc5b6f64a3e5b5b584",
    "adapter_model.safetensors": "544f198727df29a629cd9ae4540a221adb27cdb390116d8ddb7b03a302da832b"}
ADAPTER_ID = {"acceptedFitSha256": ACCEPTANCE_SHA, "trainingSourceCommit": FIT_COMMIT,
    "experimentId": EXPERIMENT, "filesSha256": ADAPTER_PINS, "updates": 60, "candidateContributions": 342}
PROTECTED_PINS = {k: v for k, v in phase.PROTECTED_PINS.items()
    if not k.endswith(("/student.py", "/fragment_rank_runtime.py"))}
PROTECTED_PINS.update({
    "scripts/usp/learning/association/association_adapter.py": "3bf37e002fdba17e8a60d498bd2fc8593c6c935524ea3ff5bc51e7123c1422d4",
    "scripts/usp/learning/association/stage_fragment_adapter.py": "1ee5a84260d15d07d77dda02ab292bd474863999beb559a9c19b1d916471b776",
    "scripts/usp/learning/association/stage_fragment_rank_phase.py": "6bd9d6789f76adbcb0c5872d7f319d9b8812da05cd2dd03b21cf9545f1c82662",
    "services/geo/geo/usp_learning/association/adapter.py": "301084077551063fd833ade16d46aa20923e6a091374bb0e6f307eb54a8ff3a1",
    "services/geo/geo/usp_learning/association/fragment_rank_checkpoint.py": "162901af3fbef48d613fcf69bc4cde8fd55634f31346cd67e3bd8b7bdb0f6706",
    "services/geo/geo/usp_learning/association/fragment_rank_phase_adapter.py": "0507c7e23d5b3ff8fc06f49e016166c0fbaef6b9fe8d5faa6ebbfe6ce7f27a45"})
SOURCE_PATHS = tuple(sorted(set(baseline.SOURCE_PATHS) | set(phase.SOURCE_PATHS) | {
    "services/geo/geo/usp_learning/association/fragment_rank_reload.py",
    "scripts/usp/learning/association/stage_fragment_rank_reload.py"}))
ASSIGNMENT_KEYS = baseline.ASSIGNMENT_KEYS | {"executable", "acceptedFit"}
FIT_FILES = {"acceptance.json": "", "review.json": "", "assignment.json": "inputs/assignment.json",
    "freeze.json": "inputs/run-freeze.json", "guard.json": "receipts/association_adapter-fit-guard.json",
    "accepted-map.json": "receipts/association_adapter-fit-accepted.json",
    "completion.json": "outputs/fit/completion.json", "result.json": "outputs/fit/fit-result.json",
    "adapter-manifest.json": "outputs/fit/adapter-manifest.json", "token-preflight.json": "outputs/fit/token-preflight.json",
    "checkpoint-proof.json": "inputs/previous-checkpoint-proof.json",
    **{"checkpoint/" + n: "outputs/fit/checkpoint/" + n for n in checkpoint.FILES},
    **{"adapter/" + n: "outputs/fit/adapter/" + n for n in ADAPTER_PINS}}


def checked_assignment(value, *, verified_root=None):
    checkpoint.exact(value, ASSIGNMENT_KEYS, "rank_reload_assignment_fields")
    require(value["version"] == ASSIGNMENT_VERSION and value["task"] == TASK and value["executable"] is True
        and same(value["executionAllowance"], ALLOWANCE), "separate_positive_rank_reload_required")
    require(value["model"] == MODEL and value["revision"] == REVISION and same(value["adapter"], ADAPTER_ID)
        and same(value["acceptedFit"], ACCEPTED_FIT) and same(value["settings"], SETTINGS)
        and same(value["donors"], DONORS), "rank_reload_model_fit_or_settings_drift")
    require(value["inputSha256"] == INPUT_PINS and value["acceptedArtifactSha256"] == ARTIFACT_PINS
        and same(value["representation"], baseline.rank.metadata()) and same(value["cases"], CASES), "rank_reload_payload_drift")
    require(type(value["studentCodeCommit"]) is str and re.fullmatch(r"[a-f0-9]{40}", value["studentCodeCommit"]), "rank_reload_execution_head")
    # Historical locations are lexical in a child; only copied authorities may be read there.
    location = checkpoint.checked_path if verified_root is None else checkpoint.metadata_path
    location(value["artifactRoot"])
    for name in ("root", "acceptancePath", "reviewPath"): location(value["acceptedFit"][name])
    pins = value["runtimeCodeCanonicalLfSha256"]
    require(type(pins) is dict and set(pins) == set(SOURCE_PATHS) and all(phase.digest(v) for v in pins.values())
        and all(pins[k] == v for k, v in PROTECTED_PINS.items()), "rank_reload_source_pins")
    return value


def checked_payload(assignment, inputs, artifacts):
    checked_assignment(assignment)
    return baseline.checked_source_payload(inputs, artifacts)


def fit_pins(acceptance, accepted):
    return {"acceptance.json": ACCEPTANCE_SHA, "review.json": REVIEW_SHA,
        **{name: acceptance[key] for name, key in (("assignment.json", "assignmentSha256"), ("freeze.json", "freezeSha256"),
            ("guard.json", "guardSha256"), ("accepted-map.json", "acceptedMapSha256"), ("completion.json", "completionSha256"),
            ("result.json", "fitResultSha256"), ("adapter-manifest.json", "adapterManifestSha256"), ("checkpoint-proof.json", "checkpointProofSha256"))},
        "token-preflight.json": accepted["artifacts"]["fit/token-preflight.json"],
        **{"checkpoint/" + n: pin for n, pin in acceptance["checkpointFiles"].items()},
        **{"adapter/" + n: pin for n, pin in ADAPTER_PINS.items()}}


def serialized_adapter_check(raw, checkpoint_raw):
    """Exact bounded fp32 payload equality under the sole default-name bijection."""
    require(8 < len(raw) <= checkpoint.MAX_TENSORS, "rank_reload_adapter_size")
    size = struct.unpack("<Q", raw[:8])[0]
    require(0 < size <= checkpoint.MAX_HEADER and 8 + size <= len(raw), "rank_reload_adapter_header")
    header = strict_json(raw[8:8 + size]); metadata = header.pop("__metadata__", None)
    require(metadata is None or metadata == {"format": "pt"}, "rank_reload_adapter_metadata")
    shapes = checkpoint.production_shapes()
    names = {k.replace(".default.", "."): k for k in shapes}
    require(len(names) == len(shapes) == 96 and set(header) == set(names), "rank_reload_adapter_name_bijection")
    master_header = checkpoint.checked_tensor_bytes(checkpoint_raw, shapes, 60)
    master_start = 8 + struct.unpack("<Q", checkpoint_raw[:8])[0]
    ranges = []
    for name, master in names.items():
        row = header[name]; checkpoint.exact(row, ("dtype", "shape", "data_offsets"), "rank_reload_adapter_fields")
        require(row["dtype"] == "F32" and same(row["shape"], shapes[master]), "rank_reload_adapter_shape_dtype")
        offsets = row["data_offsets"]
        require(type(offsets) is list and len(offsets) == 2 and all(type(n) is int and n >= 0 for n in offsets), "rank_reload_adapter_offsets")
        start, end = offsets
        require(end - start == math.prod(shapes[master]) * 4 and end <= len(raw) - 8 - size, "rank_reload_adapter_extent")
        a, b = master_header["master:" + master]["data_offsets"]
        require(raw[8 + size + start:8 + size + end] == checkpoint_raw[master_start + a:master_start + b], "rank_reload_adapter_checkpoint_mismatch")
        ranges.append((start, end))
    ranges.sort()
    require(ranges[0][0] == 0 and all(a[1] == b[0] for a, b in zip(ranges, ranges[1:]))
        and ranges[-1][1] == len(raw) - 8 - size, "rank_reload_adapter_gaps_overlap_suffix")
    return {"tensorCount": 96, "parameters": sum(math.prod(s) for s in shapes.values()), "savedEqualsCheckpointMasters": True,
        "nameMapping": "bijective removal of .default. from checkpoint master names", "dtype": "float32"}


def checked_fit_bundle(paths, *, verified_root=None):
    """Validate immutable fit evidence; no training payload or native proof rerun."""
    checkpoint.exact(paths, FIT_FILES, "rank_reload_fit_file_set")
    raw = {n: checkpoint.read_bytes(p, checkpoint.MAX_TENSORS, verified_root=verified_root) for n, p in paths.items()}
    require(sha(raw["acceptance.json"]) == ACCEPTANCE_SHA and sha(raw["review.json"]) == REVIEW_SHA, "rank_reload_independent_acceptance_pin")
    acceptance, accepted, guard = (strict_json(raw[n]) for n in ("acceptance.json", "accepted-map.json", "guard.json"))
    pins = fit_pins(acceptance, accepted)
    require(all(sha(raw[n]) == pins[n] for n in FIT_FILES), "rank_reload_fit_artifact_pin")
    require(acceptance["accepted"] is True and acceptance["version"] == "association-rank-phase-acceptance/1"
        and checkpoint.metadata_path(acceptance["root"]) == checkpoint.metadata_path(FIT_ROOT), "rank_reload_final_acceptance")
    require(guard["outputsAccepted"] is True and guard["failure"] is None and guard["cleanup"]["passed"] is True
        and guard["observation"]["jobClosed"] is True and accepted["guardSha256"] == pins["guard.json"], "rank_reload_fit_guard")
    for n, relative in FIT_FILES.items():
        if relative.startswith("outputs/"):
            require(accepted["artifacts"][relative.removeprefix("outputs/")] == pins[n], "rank_reload_fit_accepted_map")
    assignment, freeze, result, manifest, complete, preflight = (strict_json(raw[n]) for n in
        ("assignment.json", "freeze.json", "result.json", "adapter-manifest.json", "completion.json", "token-preflight.json"))
    phase.checked_execution(assignment, "fit", verified_root=verified_root)
    require(assignment["studentCodeCommit"] == FIT_COMMIT and assignment["experimentId"] == EXPERIMENT
        and same(assignment["phase"], phase.phase(3)) and same(phase.binding(assignment), acceptance["binding"]), "rank_reload_fit_binding")
    phase.checked_freeze(freeze, assignment, verified_root=verified_root)
    require(same(complete["supervisor"], guard) and complete["runFreezeSha256"] == pins["freeze.json"]
        and complete["fitResultSha256"] == pins["result.json"] and complete["adapterManifestSha256"] == pins["adapter-manifest.json"]
        and complete["tokenPreflightSha256"] == pins["token-preflight.json"]
        and all(complete[k] is False for k in ("developmentOpened", "evaluationOpened", "promoted")), "rank_reload_fit_completion")
    state, checkpoint_raw, checkpoint_manifest = checkpoint.read_checkpoint(
        {n: paths["checkpoint/" + n] for n in checkpoint.FILES}, binding=acceptance["binding"],
        shapes=checkpoint.production_shapes(), schedule=phase.schedule(), boundaries=(60,),
        expected_pins=acceptance["checkpointFiles"], verified_root=verified_root)
    phase.checked_phase_result(result, manifest, assignment, state, checkpoint_manifest)
    phase.checked_proof(strict_json(raw["checkpoint-proof.json"]))
    require(result["checkpointProofSha256"] == pins["checkpoint-proof.json"] and result["supervisedTokens"] == 342
        and all(result[k] is False for k in ("developmentOpened", "evaluationOpened")), "rank_reload_fit_closed_scope")
    for record in (preflight, manifest):
        require(all(same(record[k], v) for k, v in (("settings", phase.FIT), ("numerics", phase.NUMERICS),
            ("trainingPlan", phase.training_plan()), ("representation", phase.representation_metadata()),
            ("lossImplementation", phase.LOSS_POLICY))), "rank_reload_fit_recipe")
    for k, v in (("settings", phase.FIT), ("numerics", phase.NUMERICS)):
        require(k not in result or same(result[k], v), "rank_reload_optional_recipe_drift")
    require(manifest["files"] == ADAPTER_PINS and manifest["updates"] == 60 and state["cursor"]["contributions"] == 342,
        "rank_reload_adapter_manifest")
    directory = checkpoint.checked_path(paths["adapter/adapter_config.json"].parent, verified_root=verified_root)
    adapter.verify_adapter_files(directory, manifest)
    serialized_adapter_check(raw["adapter/adapter_model.safetensors"], checkpoint_raw)
    return {"acceptance": acceptance, "pins": pins, "manifest": manifest, "adapterDirectory": directory,
        "adapterRaw": raw["adapter/adapter_model.safetensors"], "checkpointRaw": checkpoint_raw}


def accepted_fit_files(assignment):
    """Host-only authority before mkdir, copy, guard or native effects."""
    checked_assignment(assignment)
    from stage_adapter import accepted_outputs
    root = checkpoint.checked_path(FIT_ROOT)
    paths = {n: checkpoint.checked_path(ACCEPTED_FIT["acceptancePath"] if n == "acceptance.json" else
        ACCEPTED_FIT["reviewPath"] if n == "review.json" else root / relative) for n, relative in FIT_FILES.items()}
    guard, accepted = accepted_outputs(root, "fit")
    bundle = checked_fit_bundle(paths)
    require(same(guard, strict_json(paths["guard.json"].read_bytes())) and same(accepted, strict_json(paths["accepted-map.json"].read_bytes())),
        "rank_reload_host_guard_drift")
    freeze = strict_json(paths["freeze.json"].read_bytes())
    # Host-only hash admission preserves historical training input identities;
    # labels are not parsed, copied into reload inputs or supplied to the scorer.
    for key, pin in freeze["inputSha256"].items():
        original = checkpoint.checked_path(root / "inputs" / phase.input_names("fit")[key])
        require(adapter.digest_file(original) == pin, "rank_reload_historical_input_drift")
    for name, pin in freeze["auxiliaryInputSha256"].items():
        original = checkpoint.checked_path(root / "inputs" / name)
        require(adapter.digest_file(original) == pin, "rank_reload_historical_auxiliary_drift")
    for name, pin in freeze["sourcePhysicalSha256"].items():
        data = checkpoint.read_bytes(root / "code" / name, checkpoint.MAX_TENSORS)
        require(sha(data) == pin and sha(data.replace(b"\r\n", b"\n")) == bundle["acceptance"]["binding"]["sourceCanonicalLfSha256"][name],
            "rank_reload_historical_source_drift")
    return {"accepted-fit/" + n: (paths[n], pin) for n, pin in bundle["pins"].items()}


def make_freeze(assignment, assignment_bytes, physical_pins, fit_file_pins, *, verified_root=None):
    checked_assignment(assignment, verified_root=verified_root)
    require(same(strict_json(assignment_bytes), assignment) and set(physical_pins) == set(SOURCE_PATHS)
        and all(phase.digest(v) for v in physical_pins.values()), "rank_reload_physical_sources")
    require(set(fit_file_pins) == {"accepted-fit/" + n for n in FIT_FILES} and all(phase.digest(v) for v in fit_file_pins.values()), "rank_reload_copied_fit_pins")
    return {"version": FREEZE_VERSION, "settings": SETTINGS, "systemPromptSha256": baseline.rank.PROMPT_SHA,
        "model": MODEL, "modelRevision": REVISION, "modelWeightsSha256": WEIGHTS_SHA, "adapter": ADAPTER_ID,
        "sourceCommit": assignment["studentCodeCommit"], "trainingSourceCommit": FIT_COMMIT, "donors": DONORS,
        "sourcePhysicalSha256": physical_pins, "inputSha256": INPUT_PINS,
        "auxiliaryInputSha256": {**ARTIFACT_PINS, ASSIGNMENT_NAME: sha(assignment_bytes), **fit_file_pins},
        "representation": baseline.rank.metadata(), "cases": CASES, "retrievalOnly": True, "hostTargetsInStage": False,
        "fitPerformed": False, "evaluationAllowed": False, "teacherTargetsInPrompt": False, "promotionAuthorized": False,
        "canonicalAssociationQualified": False}


def checked_run_inputs(freeze, inputs, *, verified_root=None, profile=None, source_root=None):
    inputs = checkpoint.checked_path(inputs, verified_root=verified_root)
    read = lambda n: checkpoint.read_bytes(inputs / n, checkpoint.MAX_TENSORS, verified_root=verified_root)
    raw = read(ASSIGNMENT_NAME); assignment = checked_assignment(strict_json(raw), verified_root=verified_root)
    names = {*ARTIFACT_PINS, ASSIGNMENT_NAME, *("accepted-fit/" + n for n in FIT_FILES)}
    require(set(freeze.get("auxiliaryInputSha256", {})) == names, "rank_reload_auxiliary_set")
    fit_file_pins = {n: freeze["auxiliaryInputSha256"][n] for n in names if n.startswith("accepted-fit/")}
    require(same(freeze, make_freeze(assignment, raw, freeze["sourcePhysicalSha256"], fit_file_pins, verified_root=verified_root)), "rank_reload_frozen_assignment")
    for n, pin in freeze["auxiliaryInputSha256"].items(): require(sha(read(n)) == pin, "rank_reload_auxiliary_pin")
    source_root = Path(__file__).resolve().parents[5] if source_root is None else source_root
    for n, pin in freeze["sourcePhysicalSha256"].items():
        data = checkpoint.read_bytes(Path(source_root) / n, checkpoint.MAX_TENSORS, verified_root=verified_root)
        require(sha(data) == pin and sha(data.replace(b"\r\n", b"\n")) == assignment["runtimeCodeCanonicalLfSha256"][n], "rank_reload_current_source_pin")
    schema, route = baseline.checked_source_payload({k: read(n) for k, n in INPUT_NAMES.items()}, {n: read(n) for n in ARTIFACT_PINS})
    paths = {n: inputs / "accepted-fit" / n for n in FIT_FILES}
    bundle = checked_fit_bundle(paths, verified_root=verified_root)
    require(fit_file_pins == {"accepted-fit/" + n: v for n, v in bundle["pins"].items()}, "rank_reload_fit_freeze_pins")
    if verified_root is None:
        # Host revalidates original accepted outputs, not just copies.
        originals = accepted_fit_files(assignment)
        require({n: v for n, (_, v) in originals.items()} == fit_file_pins, "rank_reload_host_original_drift")
    else:
        require(type(profile) is dict and Path(profile["root"]) == Path(verified_root), "rank_reload_verified_profile_required")
        expected = {**{"code/" + n: p for n, p in freeze["sourcePhysicalSha256"].items()},
            **{"inputs/" + n: p for n, p in freeze["auxiliaryInputSha256"].items()},
            **{"inputs/" + INPUT_NAMES[k]: p for k, p in INPUT_PINS.items()}}
        require(all(profile["files"].get(n) == p for n, p in expected.items()), "rank_reload_profile_pins")
        require(profile["files"].get("inputs/run-freeze.json") == sha(read("run-freeze.json")), "rank_reload_profile_freeze_pin")
        allowed_inputs = {"inputs/" + n for n in freeze["auxiliaryInputSha256"]} | {
            "inputs/" + n for n in INPUT_NAMES.values()} | {"inputs/run-freeze.json", "inputs/runtime-requirements-resolved.txt"}
        require({n for n in profile["files"] if n.startswith("inputs/")} == allowed_inputs
            and {n for n in profile["files"] if n.startswith("code/")} == {"code/" + n for n in SOURCE_PATHS}, "rank_reload_profile_input_source_set")
        receipt = strict_json(read(INPUT_NAMES["model_receipt"]))
        model_pins = {"model/" + r["file"]: r["sha256"] for r in receipt["files"]}
        require({n: p for n, p in profile["files"].items() if n.startswith("model/")} == model_pins, "rank_reload_profile_model_set")
    return schema, assignment, route, bundle


def provenance(freeze, freeze_sha256):
    return {**baseline.provenance(freeze, freeze_sha256), "adapter": ADAPTER_ID,
        "adapterApplied": True, "acceptedFitSha256": ACCEPTANCE_SHA,
        "trainingSourceCommit": FIT_COMMIT, "experimentId": EXPERIMENT, "adapterFilesSha256": ADAPTER_PINS,
        "adapterTrainingUpdates": 60, "adapterTrainingContributions": 342, "trainingLabelsQualification": "needs_independent_review",
        "fitPerformedInThisProcess": False, "teacherInputsInReload": False}


class _Session:
    """Capability for the unchanged shared load_local closure, never caller hooks."""
    def __init__(self, authority, bundle, loader):
        require(isinstance(loader, types.FunctionType) and loader.__globals__ is adapter.__dict__
            and loader.__code__ in adapter.reload_and_compare.__code__.co_consts, "rank_reload_shared_loader_required")
        closure = dict(zip(loader.__code__.co_freevars, (c.cell_contents for c in loader.__closure__), strict=True))
        require(set(closure) == {"adapter_dir", "verified"} and closure["adapter_dir"] == bundle["adapterDirectory"]
            and type(closure["verified"]) is dict, "rank_reload_loader_closure")
        self.authority, self.bundle, self.loader, self.shared_proof = authority, bundle, loader, closure["verified"]
        self.model, self.proof = None, None

    def admit(self, examples, contract, family, boundary):
        require(type(boundary) is tuple and boundary[0] == self.authority["verified_root"]
            and same(boundary[1], self.authority["profile"]), "rank_reload_actual_boundary_required")
        schema, _, route, bundle = checked_run_inputs(**self.authority)
        require(bundle["pins"] == self.bundle["pins"], "rank_reload_session_input_drift")
        baseline.source.base.checked_batch({"version": "association-development/1", "examples": examples}, CASES, contract, family)
        return schema, codec.checked_route(route, examples, schema, contract, family, ("development",))

    def verify_native(self, model, torch):
        from peft import PeftModel, get_peft_model_state_dict
        from transformers import Qwen2ForCausalLM
        require(isinstance(model, PeftModel) and type(model.get_base_model()) is Qwen2ForCausalLM
            and model.config.model_type == "qwen2" and set(model.peft_config) == {"default"}
            and model.active_adapters == ["default"], "rank_reload_native_wrapper_identity")
        adapter.check_adapter_config(model.peft_config["default"].to_dict())
        require(not model.training and all(not m.training for m in model.modules())
            and all(not p.requires_grad and p.grad is None for p in model.parameters()), "rank_reload_frozen_eval_required")
        layers = [m for m in model.modules() if hasattr(m, "lora_A")]
        require(len(layers) == 48 and all(not m.disable_adapters and not m.merged for m in layers), "rank_reload_disabled_or_merged_adapter")
        shapes = checkpoint.production_shapes(); state = get_peft_model_state_dict(model)
        raw = self.bundle["adapterRaw"]; offset = 8 + struct.unpack("<Q", raw[:8])[0]
        header = strict_json(raw[8:offset]); header.pop("__metadata__", None)
        require(set(state) == set(header) and len(state) == 96, "rank_reload_native_tensor_names")
        for name, value in state.items():
            a, b = header[name]["data_offsets"]
            require(value.dtype == torch.float32 and list(value.shape) == header[name]["shape"]
                and value.detach().cpu().contiguous().numpy().tobytes() == raw[offset + a:offset + b], "rank_reload_native_tensor_value")
        frozen = [(n, p) for n, p in model.named_parameters() if n not in shapes]
        require(len(frozen) == 290 and {n for n, _ in model.named_parameters()} == {*shapes, *(n for n, _ in frozen)}
            and all(p.dtype == torch.float32 for n, p in model.named_parameters() if n in shapes), "rank_reload_native_parameter_set")
        base = adapter._tensor_digest(frozen)
        require(base == phase.BASE and self.shared_proof == {"tensorCount": 96, "savedTensorsExact": True,
            "explicitLocalBase": True, "remoteBaseLookup": False}, "rank_reload_native_base_or_shared_proof")
        self.model = model
        self.proof = {"version": "association-fragment-rank-native-reload-proof/1", "native": True, "passed": True,
            "savedTensorsExact": True, "loadedEqualsSavedEqualsCheckpointMasters": True, "tensorCount": 96,
            "trainableParameters": 540672, "allParametersFrozen": True, "evalOnly": True, "adapterMerged": False,
            "baseBefore": base, "acceptedFitSha256": ACCEPTANCE_SHA, "adapterFilesSha256": ADAPTER_PINS,
            "trainingSourceCommit": FIT_COMMIT, "fitPerformedInThisProcess": False, "optimizerCreated": False}
        return self.proof

    def finish(self, model):
        require(self.model is model and type(self.proof) is dict and self.proof["passed"] is True, "rank_reload_native_proof_required")
        base = adapter._tensor_digest((n, p) for n, p in model.named_parameters() if n not in checkpoint.production_shapes())
        require(base == phase.BASE and all(not p.requires_grad and p.grad is None for p in model.parameters()), "rank_reload_base_changed_during_scores")
        self.proof.update(baseAfter=base, baseUnchanged=True)
        return self.proof


def run(examples, contract, family, model_path, require_boundary, preserve_raw, *, rank_reload_authority, preserve_preflight, preserve_technical):
    boundary = require_boundary()
    checkpoint.exact(rank_reload_authority, ("freeze", "inputs", "verified_root", "profile"), "rank_reload_explicit_authority")
    require(type(boundary) is tuple and boundary[0] == rank_reload_authority["verified_root"]
        and same(boundary[1], rank_reload_authority["profile"]), "rank_reload_actual_boundary_required")
    _, _, _, bundle = checked_run_inputs(**rank_reload_authority)
    require(checkpoint.checked_path(model_path, verified_root=boundary[0]) == boundary[0] / "model", "rank_reload_original_local_model")
    from .student import run_local

    def runner(*args, model_loader, **kwargs):
        return run_local(*args, **kwargs, rank_reload_session=_Session(rank_reload_authority, bundle, model_loader),
            preserve_preflight=preserve_preflight, preserve_technical=preserve_technical)

    raw, result = adapter.reload_and_compare(examples, contract, family, model_path, bundle["adapterDirectory"], bundle["manifest"],
        require_boundary, preserve_raw, inference_runner=runner)
    # Shared legacy fitPerformed denotes historical training; this result uses
    # current-process semantics and retains that history explicitly.
    result.update(fitPerformed=False, fitPerformedInThisProcess=False, adapterTrainingUpdates=60,
        adapterTrainingContributions=342, teacherOutputsUsed=True, teacherInputsInReload=False,
        trainingLabelsQualification="needs_independent_review", acceptedFitSha256=ACCEPTANCE_SHA, trainingSourceCommit=FIT_COMMIT)
    return raw, result


def disabled_prototype(code_commit, source_pins):
    return {"version": "association-fragment-rank-reload-prototype/1", "executable": False,
        "executionAllowance": None, "positiveAssignment": None, "finalExecutionHead": None,
        "codeCheckpoint": code_commit, "runtimeCodeCanonicalLfSha256": source_pins,
        "futureAssignmentVersion": ASSIGNMENT_VERSION, "futureFreezeVersion": FREEZE_VERSION,
        "futureTask": TASK, "acceptedFit": ACCEPTED_FIT, "adapter": ADAPTER_ID,
        "nativeReloadPerformed": False, "comparisonPerformed": False}
