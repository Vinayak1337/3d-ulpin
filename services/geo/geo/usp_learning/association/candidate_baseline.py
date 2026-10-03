"""Exact admission of accepted CPU candidates for one separately assigned baseline.

No source construction, native initialization, model loader or execution lives
here. Artifact authorities are the accepted STUDENT-12 bytes, not caller hashes.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import re

from . import candidate_selection as candidate
from .selector_baseline import MODEL, REVISION, checked_batch
from .student import SETTINGS
from .validation import require, strict_json

ASSIGNMENT_VERSION = "association-candidate-baseline-assignment/1"
FREEZE_VERSION = "association-candidate-baseline-freeze/1"
TASK = "STUDENT-14-CANDIDATE-BASELINE"
PARENT_PROFILE_SHA = "e06f20f9c285af4d3052c441e76a039ad04eba5c6b11fa618ea0a2a2ddbc5438"
WEIGHTS_SHA = "fdf756fa7fcbe7404d5c60e26bff1a0c8b8aa1f72ced49e7dd0210fe288fb7fe"
INPUT_NAMES = {"input_batch": "development.json", "schema": "schema-v1.json",
               "family_freeze": "family-freeze.json", "model_receipt": "model-acquisition.json"}
INPUT_PINS = {
    "input_batch": "a89a7eaa4917a398b78ac0457eb7fa55223fd877b12306f03ca7801939f4e536",
    "schema": "b3a3a64f403d7a5ee0a2ea6ed22c5d418b9af089f75fd9aca8aa0f9a00ab09af",
    "family_freeze": "93c243f28895ac084c3f1853cba80b9e0b5286f881aba44d6cb7ab6e3a164730",
    "model_receipt": "4fe6c79e0f4f93fc1552482b9b3e77143492c0bb7f4b9b4f7b84b8c30e9c3ff2",
}
ARTIFACT_PINS = {
    "preparation.json": "968fbaae903cda193ebb2d74cc7a54f054136071def8d5431f0c8e61e0690bbc",
    "candidate-route.json": "ac177a8e15fa8bb41226b9a151e0f69ac6c6dcc253063b89c738163b10a60267",
    "context-0.json": "dd66325a702e7647cdfb36375b731b50086a0c51053b3b258a177e5afb9eb63d",
    "context-1.json": "cdd4b3b0e74eed4fb03dfe1159a280605a6c93916f070481af40f80cda40b9cc",
    "candidate-schema-v1.json": "016b415ed96de321c43174023238f8de5582df37dc428731234b6f02a3280574",
    "candidate-prompt.txt": "97354126da61e713fb381c9de46e6966de82ec2424a50feaf93b538d43a6780c",
}
AUXILIARY_NAMES = {*ARTIFACT_PINS, "candidate-assignment.json"}
CASES = [
    {"exampleId": "ifc4-source-native-v1", "inputCanonicalJsonSha256": "da3be49d09c86f4cafd459e9ff89c212f2ef0bbe5958ea98c6a1be3824aac4d4"},
    {"exampleId": "ifc2x3-source-native-v1", "inputCanonicalJsonSha256": "5cdbd1fec015bc2eecde12ee37dea41eeb0fc7c6eb9e7ac8470af04bd74c3a88"},
]
SET_PINS = ["ededc3e493b107fb4d016456d36a86a4d06acb3d689e0c9e14dce2e7928d3d41",
            "64859a859f9096890862e7aaf1aef86ddf281c00c237b41481dd51e3917515e2"]
EXTRA_CODE = ("services/geo/geo/usp_learning/association/candidate_baseline.py",
              "services/geo/geo/usp_learning/association/candidate_selection.py",
              "services/geo/geo/usp_learning/association/native_candidates.py",
              "services/geo/geo/usp_learning/association/selector_constraints.py", "services/geo/geo/native_ifc.py")
# Also bind host-transitive source. The candidate stager copies this complete set
# so the contained preflight can verify the same physical and canonical bytes.
SOURCE_PATHS = (
    "scripts/usp/learning/model_isolation.py", "scripts/usp/security/appcontainer_audit.py",
    "scripts/usp/learning/association/association_student.py", "services/geo/geo/__init__.py",
    "services/geo/geo/usp_learning/__init__.py", "services/geo/geo/usp_learning/resources.py",
    "services/geo/geo/usp_learning/association/__init__.py", "services/geo/geo/usp_learning/association/student.py",
    "services/geo/geo/usp_learning/association/validation.py", "services/geo/geo/usp_learning/association/selectors.py",
    "services/geo/geo/usp_learning/association/selector_baseline.py", *EXTRA_CODE,
    "scripts/usp/learning/association/stage_selector_baseline.py", "scripts/usp/learning/association/stage_baseline.py")
PROTECTED_PINS = {
    "services/geo/geo/usp_learning/association/selectors.py": "dcb83b6352c8c5972607c616866b11f91767235052cbac8b9606215b80b6863e",
    "services/geo/geo/usp_learning/association/candidate_selection.py": "c0475f9156f379cf9c3269e01892d1034699115655139930edfdea40a2b09785",
    "services/geo/geo/usp_learning/association/native_candidates.py": "17ce40d8ccb6852edb12986c0ae7a73da7db198f750aa6ed433d28229ac7e1df",
    "services/geo/geo/usp_learning/association/selector_constraints.py": "5099dd66c7df12e8799fd4bf65515855e45068c278274c814e80f0ba34fd7064",
    "services/geo/geo/native_ifc.py": "f6e8e646987879b238fc91137d26f18c45775ecf6b9ffc312a3639f32a7fb661",
    "scripts/usp/learning/association/stage_baseline.py": "926b01c8c85aae962b1699c0e35a07c144993da2846b1016608a350bd1bb2b93",
}
ALLOWANCE = {"stageModelRun": True, "inference": True, "fit": False, "evaluation": False,
             "promotion": False, "freshBaselinePhases": 1}
ASSIGNMENT_KEYS = {"version", "task", "executionAllowance", "studentCodeCommit", "model", "revision", "adapter",
                   "settings", "baselineProfileSha256", "inputSha256", "acceptedArtifactSha256", "representation",
                   "cases", "runtimeCodeCanonicalLfSha256", "artifactRoot"}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def checked_assignment(value):
    require(type(value) is dict and set(value) == ASSIGNMENT_KEYS
            and value["version"] == ASSIGNMENT_VERSION and value["task"] == TASK,
            "separate_candidate_baseline_assignment_required")
    require(candidate.canonical(value["executionAllowance"]) == candidate.canonical(ALLOWANCE),
            "candidate_baseline_execution_not_authorized")
    require(value["model"] == MODEL and value["revision"] == REVISION and value["adapter"] is None
            and candidate.canonical(value["settings"]) == candidate.canonical(SETTINGS)
            and value["baselineProfileSha256"] == PARENT_PROFILE_SHA,
            "candidate_baseline_model_or_settings_drift")
    require(value["inputSha256"] == INPUT_PINS and value["acceptedArtifactSha256"] == ARTIFACT_PINS
            and value["representation"] == candidate.metadata() and value["cases"] == CASES,
            "candidate_baseline_accepted_authority_drift")
    require(type(value["studentCodeCommit"]) is str and re.fullmatch(r"[a-f0-9]{40}", value["studentCodeCommit"])
            and type(value["artifactRoot"]) is str and Path(value["artifactRoot"]).is_absolute(),
            "candidate_baseline_commit_or_artifact_root_required")
    pins = value["runtimeCodeCanonicalLfSha256"]
    require(type(pins) is dict and set(pins) == set(SOURCE_PATHS)
            and all(type(p) is str and re.fullmatch(r"[a-f0-9]{64}", p) for p in pins.values())
            and all(pins[p] == digest for p, digest in PROTECTED_PINS.items()), "candidate_source_pin_set_drift")
    return value


def checked_payload(assignment, inputs, artifacts):
    """Pure pre-copy/pre-model admission of the retained small artifacts only."""
    checked_assignment(assignment)
    require(set(inputs) == set(INPUT_PINS) and set(artifacts) == set(ARTIFACT_PINS), "candidate_input_set_drift")
    for name, digest in INPUT_PINS.items():
        require(sha(inputs[name]) == digest, "candidate_input_pin_drift:" + name)
    for name, digest in ARTIFACT_PINS.items():
        require(sha(artifacts[name]) == digest, "candidate_artifact_pin_drift:" + name)
    schema = candidate.checked_schema(artifacts["candidate-schema-v1.json"])
    require(artifacts["candidate-prompt.txt"] == candidate.SYSTEM_PROMPT.encode(), "candidate_prompt_bytes_drift")
    batch, contract, family = (strict_json(inputs[k]) for k in ("input_batch", "schema", "family_freeze"))
    checked_batch(batch, CASES, contract, family)
    receipt = strict_json(inputs["model_receipt"])
    require(receipt["model"] == MODEL and receipt["revision"] == REVISION
            and {r["file"]: r["sha256"] for r in receipt["files"]}["model.safetensors"] == WEIGHTS_SHA,
            "candidate_model_receipt_drift")
    preparation = strict_json(artifacts["preparation.json"])
    route = strict_json(artifacts["candidate-route.json"])
    require(preparation["representation"] == candidate.metadata(), "candidate_preparation_representation_drift")
    for index, item in enumerate(route["contexts"]):
        raw = artifacts[f"context-{index}.json"]
        require(item["snapshot"] == strict_json(raw) and item["snapshotSha256"] == sha(raw),
                "candidate_route_snapshot_drift")
    contexts = candidate.checked_route(route, batch["examples"], contract, family, schema)
    require([c.set_sha256 for c in contexts] == SET_PINS, "candidate_set_authority_drift")
    return schema, route


def make_freeze(assignment, assignment_bytes, physical_source_pins):
    checked_assignment(assignment)
    require(strict_json(assignment_bytes) == assignment, "candidate_assignment_bytes_drift")
    require(set(physical_source_pins) == set(SOURCE_PATHS), "candidate_physical_source_set_drift")
    return {"version": FREEZE_VERSION, "settings": SETTINGS, "systemPromptSha256": candidate.PROMPT_SHA,
            "model": MODEL, "modelRevision": REVISION, "adapter": None, "modelWeightsSha256": WEIGHTS_SHA,
            "sourceCommit": assignment["studentCodeCommit"], "baselineProfileSha256": PARENT_PROFILE_SHA,
            "inputSha256": dict(INPUT_PINS), "auxiliaryInputSha256": {**ARTIFACT_PINS,
                "candidate-assignment.json": sha(assignment_bytes)}, "representation": candidate.metadata(),
            "cases": CASES, "candidateSetSha256": SET_PINS, "sourcePhysicalSha256": dict(physical_source_pins),
            "fitPerformed": False, "evaluationAllowed": False, "canonicalAssociationQualified": False,
            "teacherTargetsInPrompt": False, "promotionAuthorized": False}


def checked_run_inputs(freeze, inputs):
    """Containment has already verified the profile; rebind admission to its bytes."""
    require(freeze.get("version") == FREEZE_VERSION and freeze.get("inputSha256") == INPUT_PINS
            and type(freeze.get("auxiliaryInputSha256")) is dict
            and set(freeze["auxiliaryInputSha256"]) == AUXILIARY_NAMES, "candidate_freeze_or_auxiliary_set_drift")
    inputs = Path(inputs)
    assignment_bytes = (inputs / "candidate-assignment.json").read_bytes()
    assignment = checked_assignment(strict_json(assignment_bytes))
    source_pins = freeze.get("sourcePhysicalSha256", {})
    require(freeze == make_freeze(assignment, assignment_bytes, source_pins), "candidate_frozen_assignment_drift")
    source_root = Path(__file__).resolve().parents[5]
    for relative, digest in source_pins.items():
        raw = (source_root / relative).read_bytes()
        require(sha(raw) == digest and sha(raw.replace(b"\r\n", b"\n")) == assignment["runtimeCodeCanonicalLfSha256"][relative],
                "candidate_runtime_source_drift:" + relative)
    schema, route = checked_payload(assignment,
        {key: (inputs / name).read_bytes() for key, name in INPUT_NAMES.items()},
        {name: (inputs / name).read_bytes() for name in ARTIFACT_PINS})
    return schema, assignment, route


def provenance(freeze, freeze_sha256):
    return {"runFreezeSha256": freeze_sha256, "sourceCommit": freeze["sourceCommit"],
            "sourcePhysicalSha256": freeze["sourcePhysicalSha256"], "inputSha256": freeze["inputSha256"],
            "auxiliaryInputSha256": freeze["auxiliaryInputSha256"], "representation": freeze["representation"],
            "candidateSetSha256": freeze["candidateSetSha256"], "modelWeightsSha256": WEIGHTS_SHA,
            "adapter": None, "learnedSelectionAccuracyMeasured": False}
