"""Exact target-free admission for one separately frozen fragment baseline.

Uses the accepted codec and existing staging/worker interfaces. No model loader,
source reconstruction, target comparison or execution authority is created here.
"""
from __future__ import annotations

from pathlib import Path
import re

from . import candidate_baseline as base, fragment_selection as codec
from .validation import require, strict_json

ASSIGNMENT_VERSION = "association-fragment-baseline-assignment/1"
FREEZE_VERSION = "association-fragment-baseline-freeze/1"
TASK = "STUDENT-17-FRAGMENT-BASELINE"
MODEL, REVISION, WEIGHTS_SHA = base.MODEL, base.REVISION, base.WEIGHTS_SHA
SETTINGS, PARENT_PROFILE_SHA = base.SETTINGS, base.PARENT_PROFILE_SHA
ALLOWANCE, ASSIGNMENT_KEYS = base.ALLOWANCE, base.ASSIGNMENT_KEYS
STUDENT_SHA = "22fddd9ac9dbab6bf23f45ab9a1356d21113a66a8d8b3bd5f7caae859d001761"
INPUT_NAMES = {"input_batch": "development.json", "schema": "legacy-schema-v1.json",
               "family_freeze": "family-freeze.json", "model_receipt": "model-acquisition.json"}
INPUT_PINS = {**base.INPUT_PINS, "family_freeze": codec.FAMILY_SHA}
ARTIFACT_PINS = {
    "preparation.json": "eef78431d063df9a2b9e337b74fe6ce7d6b40a63783a9e5eb7b583688bc41bc4",
    "fragment-schema-v1.json": "a7f289ea272e933b20cd9b5e06fae53c6f0d77daeaf878bb8a2aad65ee7d9082",
    "fragment-prompt.txt": "d3a93d1323145cf31db765de8647d5f0ce252f653b6b38273fc5a184fd00dbac",
    "fragment-route.json": "cd2af2b714a4bea4d60ea176454d2c843dcf09c4645b237e5eaabb3dff3f471d",
    "context-0.json": "d25e7d4ecde0223c1fc250e60604f3ef059eb614bb7886c3a3725e855c40b0f5",
    "context-1.json": "d688e27b96e484ea36d4cd7b39c5f67f0955d358a791af1960ffd455786ed90c",
}
AUXILIARY_NAMES = {*ARTIFACT_PINS, "fragment-assignment.json"}
CASES = [
    {**base.CASES[0], "contextSha256": ARTIFACT_PINS["context-0.json"], "candidateCount": 4,
     "request": "Retrieve the fragment that supplies the IfcBuilding Name."},
    {**base.CASES[1], "contextSha256": ARTIFACT_PINS["context-1.json"], "candidateCount": 3,
     "request": "Retrieve any supplied non-null numerical elevation value for IfcBuilding."},
]
EXTRA_CODE = ("services/geo/geo/usp_learning/association/fragment_selection.py",
              "services/geo/geo/usp_learning/association/fragment_baseline.py")
SOURCE_PATHS = (*base.SOURCE_PATHS, *EXTRA_CODE)
PROTECTED_PINS = {**base.PROTECTED_PINS,
    "services/geo/geo/usp_learning/association/student.py": STUDENT_SHA,
    "services/geo/geo/usp_learning/association/candidate_baseline.py": "75b231cb665a0301f37568d1a5e4fe3d97385fc6875bf55d055cce6840d210d7",
    "services/geo/geo/usp_learning/association/selector_baseline.py": "7d453d9ddb795f27d17dc8096c0ed9606bb48283e2fa5a61ff03f5c5d3a2cd5d",
    "services/geo/geo/usp_learning/association/fragment_selection.py": "aa8be20c61fe94eb0c19e5e4c611a1378e7201ec11fbaca605c06bd349af88a0",
}
sha = base.sha


def checked_assignment(value):
    require(type(value) is dict and set(value) == ASSIGNMENT_KEYS
            and value["version"] == ASSIGNMENT_VERSION and value["task"] == TASK,
            "separate_fragment_baseline_assignment_required")
    require(codec.canonical(value["executionAllowance"]) == codec.canonical(ALLOWANCE), "fragment_execution_not_authorized")
    require(value["model"] == MODEL and value["revision"] == REVISION and value["adapter"] is None
            and codec.canonical(value["settings"]) == codec.canonical(SETTINGS)
            and value["baselineProfileSha256"] == PARENT_PROFILE_SHA, "fragment_model_or_settings_drift")
    require(value["inputSha256"] == INPUT_PINS and value["acceptedArtifactSha256"] == ARTIFACT_PINS
            and value["representation"] == codec.metadata() and value["cases"] == CASES,
            "fragment_accepted_authority_drift")
    require(type(value["studentCodeCommit"]) is str and re.fullmatch(r"[a-f0-9]{40}", value["studentCodeCommit"])
            and type(value["artifactRoot"]) is str and Path(value["artifactRoot"]).is_absolute(), "fragment_commit_or_root_required")
    pins = value["runtimeCodeCanonicalLfSha256"]
    require(type(pins) is dict and set(pins) == set(SOURCE_PATHS)
            and all(type(p) is str and re.fullmatch(r"[a-f0-9]{64}", p) for p in pins.values())
            and all(pins[p] == digest for p, digest in PROTECTED_PINS.items()), "fragment_source_pin_set_drift")
    return value


def checked_payload(assignment, inputs, artifacts):
    """Pure exact admission; all targets and host acceptance records are excluded."""
    checked_assignment(assignment)
    require(set(inputs) == set(INPUT_PINS) and set(artifacts) == set(ARTIFACT_PINS), "fragment_input_set_drift")
    for name, digest in INPUT_PINS.items():
        require(sha(inputs[name]) == digest, "fragment_input_pin_drift:" + name)
    for name, digest in ARTIFACT_PINS.items():
        require(sha(artifacts[name]) == digest, "fragment_artifact_pin_drift:" + name)
    schema = codec.checked_schema(artifacts["fragment-schema-v1.json"])
    require(artifacts["fragment-prompt.txt"] == codec.SYSTEM_PROMPT.encode(), "fragment_prompt_bytes_drift")
    batch, contract, family = (strict_json(inputs[k]) for k in ("input_batch", "schema", "family_freeze"))
    base.checked_batch(batch, CASES, contract, family)
    receipt = strict_json(inputs["model_receipt"])
    require(receipt["model"] == MODEL and receipt["revision"] == REVISION
            and {r["file"]: r["sha256"] for r in receipt["files"]}["model.safetensors"] == WEIGHTS_SHA,
            "fragment_model_receipt_drift")
    preparation = strict_json(artifacts["preparation.json"])
    require(preparation["sourceOnly"] is True and preparation["expectationOrTargetFilesInSourceInputs"] is False
            and preparation["representation"] == codec.metadata(), "fragment_source_preparation_drift")
    route = strict_json(artifacts["fragment-route.json"])
    contexts = codec.checked_route(route, batch["examples"], schema, contract, family, ("development",))
    for index, (item, context, case) in enumerate(zip(route["contexts"], contexts, CASES)):
        raw = artifacts[f"context-{index}.json"]
        snapshot = context.snapshot()
        require(item["context"] == strict_json(raw) and item["contextSha256"] == sha(raw) == case["contextSha256"]
                and snapshot["exampleId"] == case["exampleId"] and snapshot["request"] == case["request"]
                and len(snapshot["candidates"]) == case["candidateCount"], "fragment_context_authority_drift")
    return schema, route


def make_freeze(assignment, assignment_bytes, physical_source_pins):
    checked_assignment(assignment)
    require(strict_json(assignment_bytes) == assignment, "fragment_assignment_bytes_drift")
    require(set(physical_source_pins) == set(SOURCE_PATHS), "fragment_physical_source_set_drift")
    return {"version": FREEZE_VERSION, "settings": SETTINGS, "systemPromptSha256": codec.PROMPT_SHA,
        "model": MODEL, "modelRevision": REVISION, "adapter": None, "modelWeightsSha256": WEIGHTS_SHA,
        "sourceCommit": assignment["studentCodeCommit"], "baselineProfileSha256": PARENT_PROFILE_SHA,
        "inputSha256": dict(INPUT_PINS), "auxiliaryInputSha256": {**ARTIFACT_PINS, "fragment-assignment.json": sha(assignment_bytes)},
        "representation": codec.metadata(), "cases": CASES, "sourcePhysicalSha256": dict(physical_source_pins),
        "retrievalOnly": True, "hostTargetsInStage": False, "fitPerformed": False, "evaluationAllowed": False,
        "canonicalAssociationQualified": False, "teacherTargetsInPrompt": False, "promotionAuthorized": False}


def checked_run_inputs(freeze, inputs):
    require(freeze.get("version") == FREEZE_VERSION and freeze.get("inputSha256") == INPUT_PINS
            and type(freeze.get("auxiliaryInputSha256")) is dict and set(freeze["auxiliaryInputSha256"]) == AUXILIARY_NAMES,
            "fragment_freeze_or_auxiliary_set_drift")
    inputs = Path(inputs)
    assignment_bytes = (inputs / "fragment-assignment.json").read_bytes()
    assignment = checked_assignment(strict_json(assignment_bytes))
    source_pins = freeze.get("sourcePhysicalSha256", {})
    require(freeze == make_freeze(assignment, assignment_bytes, source_pins), "fragment_frozen_assignment_drift")
    source_root = Path(__file__).resolve().parents[5]
    for relative, digest in source_pins.items():
        raw = (source_root / relative).read_bytes()
        require(sha(raw) == digest and sha(raw.replace(b"\r\n", b"\n")) == assignment["runtimeCodeCanonicalLfSha256"][relative],
                "fragment_runtime_source_drift:" + relative)
    schema, route = checked_payload(assignment,
        {key: (inputs / name).read_bytes() for key, name in INPUT_NAMES.items()},
        {name: (inputs / name).read_bytes() for name in ARTIFACT_PINS})
    return schema, assignment, route


def provenance(freeze, freeze_sha256):
    return {"runFreezeSha256": freeze_sha256, "sourceCommit": freeze["sourceCommit"],
        "sourcePhysicalSha256": freeze["sourcePhysicalSha256"], "inputSha256": freeze["inputSha256"],
        "auxiliaryInputSha256": freeze["auxiliaryInputSha256"], "representation": freeze["representation"],
        "sourceCases": freeze["cases"], "modelWeightsSha256": WEIGHTS_SHA, "adapter": None,
        "retrievalOnly": True, "expectedSelectionsEvaluated": False, "learnedRelevanceAccuracyMeasured": False}
