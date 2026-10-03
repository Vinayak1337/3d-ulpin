"""Target-free authority for one separately assigned original-base rank run.

Metadata is not a launch. STUDENT-25/26 preparation cannot satisfy this contract.
The existing stage, loader, containment profile and supervisor own execution.
"""
from __future__ import annotations

from pathlib import Path
import re

from . import fragment_baseline as source, fragment_rank as rank
from .validation import require, strict_json

codec, sha = rank.codec, source.sha
ASSIGNMENT_VERSION = "association-fragment-rank-baseline-assignment/1"
FREEZE_VERSION = "association-fragment-rank-baseline-freeze/1"
TASK = "STUDENT-27-FRAGMENT-RANK-BASELINE"
MODEL, REVISION, WEIGHTS_SHA = source.MODEL, source.REVISION, source.WEIGHTS_SHA
SETTINGS, ALLOWANCE = source.SETTINGS, source.ALLOWANCE
INPUT_NAMES, INPUT_PINS, CASES = source.INPUT_NAMES, source.INPUT_PINS, source.CASES
# The historical generative prompt is neither read nor staged for ranking.
ARTIFACT_PINS = {k: v for k, v in source.ARTIFACT_PINS.items() if k != "fragment-prompt.txt"}
ASSIGNMENT_NAME = "fragment-rank-assignment.json"
AUXILIARY_NAMES = {*ARTIFACT_PINS, ASSIGNMENT_NAME}
DONORS = {
    "runtime": {"root": "E:/BhuAayam-data/task-data/ml-distillation/student/adapter-citation-view-fit-fffafce9835d4f59bef71f4377bb5619",
                "profileSha256": "a09ee7907b8dc207b01712d84ec33245218773f479cf91301957ee76b32ae503"},
    "model": {"root": "E:/BhuAayam-data/task-data/ml-distillation/student/fragment-baseline-6d2a6e03ea684bdcb30fabb45d4dbe80",
              "profileSha256": "86b0f0b19d4e740f2e6e38f7eea8eaccd24b7b3072883f8b7d22421c39b8ef75"},
}
SOURCE_PATHS = (*source.SOURCE_PATHS,
    "services/geo/geo/usp_learning/association/fragment_rank.py",
    "services/geo/geo/usp_learning/association/fragment_rank_baseline.py",
    "services/geo/geo/usp_learning/association/fragment_rank_runtime.py")
# Current protected sources from the accepted STUDENT-25 source snapshot.
# Historical generative pins remain unchanged in their own admission modules.
PROTECTED_PINS = {
    **{k: v for k, v in source.PROTECTED_PINS.items() if not k.endswith("/student.py")},
    "scripts/usp/learning/model_isolation.py": "69e51fd895697f224960226cdc1f99499d2b43d0b17ac76638e20cdfa8787676",
    "scripts/usp/security/appcontainer_audit.py": "4a59a18e04cd6fe76590ba929f424271f3dacdfb19ccf5e65fc2ec8048fbdc7f",
    "services/geo/geo/__init__.py": "d10feb73a0713f7c1f57fd7982c1f2916448a1b634984a48646ff4e460b6ad09",
    "services/geo/geo/usp_learning/__init__.py": "4b2c1e31b9af2699de2380323db9775e9fc96dd4fab0d6ed5b67b5eeec20a05a",
    "services/geo/geo/usp_learning/resources.py": "c46095c1a537208ececcf3b9e8c791fea05020dc73b74e74c350412c66bf9f54",
    "services/geo/geo/usp_learning/association/__init__.py": "bc1a6b2a7a5190bc971e518cce5557a01abf8611c95b2d5e9e463a5abd2c7679",
    "services/geo/geo/usp_learning/association/validation.py": "68ebee3f5ca0b6273862003b17db73dcd25495d1623732917467d12ff9ea18c2",
    "services/geo/geo/usp_learning/association/fragment_baseline.py": "63c923ed5d32593388852aa2e8b7fe6eb96682796295881c5a634c9fc08a778d",
}
ASSIGNMENT_KEYS = (source.ASSIGNMENT_KEYS - {"baselineProfileSha256"}) | {"donors"}


def checked_assignment(value):
    require(type(value) is dict and set(value) == ASSIGNMENT_KEYS
            and value["version"] == ASSIGNMENT_VERSION and value["task"] == TASK,
            "separate_rank_baseline_assignment_required")
    require(codec.canonical(value["executionAllowance"]) == codec.canonical(ALLOWANCE), "rank_execution_not_authorized")
    require(value["model"] == MODEL and value["revision"] == REVISION and value["adapter"] is None
            and codec.canonical(value["settings"]) == codec.canonical(SETTINGS)
            and value["donors"] == DONORS, "rank_model_settings_or_donors_drift")
    require(value["inputSha256"] == INPUT_PINS and value["acceptedArtifactSha256"] == ARTIFACT_PINS
            and value["representation"] == rank.metadata() and value["cases"] == CASES,
            "rank_accepted_authority_drift")
    require(type(value["studentCodeCommit"]) is str and re.fullmatch(r"[a-f0-9]{40}", value["studentCodeCommit"])
            and type(value["artifactRoot"]) is str and Path(value["artifactRoot"]).is_absolute(), "rank_commit_or_root_required")
    pins = value["runtimeCodeCanonicalLfSha256"]
    require(type(pins) is dict and set(pins) == set(SOURCE_PATHS)
            and all(type(p) is str and re.fullmatch(r"[a-f0-9]{64}", p) for p in pins.values())
            and all(pins[p] == digest for p, digest in PROTECTED_PINS.items()), "rank_source_pin_set_drift")
    return value


def checked_payload(assignment, inputs, artifacts):
    checked_assignment(assignment)
    require(set(inputs) == set(INPUT_PINS) and set(artifacts) == set(ARTIFACT_PINS), "rank_input_set_drift")
    for values, pins in ((inputs, INPUT_PINS), (artifacts, ARTIFACT_PINS)):
        for name, digest in pins.items():
            require(sha(values[name]) == digest, "rank_input_pin_drift:" + name)
    schema = codec.checked_schema(artifacts["fragment-schema-v1.json"])
    batch, contract, family = (strict_json(inputs[k]) for k in ("input_batch", "schema", "family_freeze"))
    source.base.checked_batch(batch, CASES, contract, family)
    receipt = strict_json(inputs["model_receipt"])
    require(receipt["model"] == MODEL and receipt["revision"] == REVISION
            and {r["file"]: r["sha256"] for r in receipt["files"]}["model.safetensors"] == WEIGHTS_SHA,
            "rank_original_model_receipt_drift")
    preparation = strict_json(artifacts["preparation.json"])
    require(preparation["sourceOnly"] is True and preparation["expectationOrTargetFilesInSourceInputs"] is False
            and preparation["representation"] == codec.metadata(), "rank_source_preparation_drift")
    route = strict_json(artifacts["fragment-route.json"])
    contexts = codec.checked_route(route, batch["examples"], schema, contract, family, ("development",))
    require(len(contexts) == 2, "rank_two_contexts_required")
    for index, (item, context, case) in enumerate(zip(route["contexts"], contexts, CASES, strict=True)):
        raw, snapshot = artifacts[f"context-{index}.json"], context.snapshot()
        require(item["context"] == strict_json(raw) and item["contextSha256"] == sha(raw) == case["contextSha256"]
                and snapshot["exampleId"] == case["exampleId"] and snapshot["request"] == case["request"]
                and len(snapshot["candidates"]) == case["candidateCount"], "rank_context_authority_drift")
        for candidate in snapshot["candidates"]:
            rank.scoring_input(snapshot, candidate["id"], schema, contract, family, allowed_splits=("development",))
    return schema, route


def make_freeze(assignment, assignment_bytes, physical_source_pins):
    checked_assignment(assignment)
    require(strict_json(assignment_bytes) == assignment, "rank_assignment_bytes_drift")
    require(type(physical_source_pins) is dict and set(physical_source_pins) == set(SOURCE_PATHS)
            and all(type(p) is str and re.fullmatch(r"[a-f0-9]{64}", p) for p in physical_source_pins.values()),
            "rank_physical_source_set_drift")
    return {"version": FREEZE_VERSION, "settings": SETTINGS, "systemPromptSha256": rank.PROMPT_SHA,
        "model": MODEL, "modelRevision": REVISION, "adapter": None, "modelWeightsSha256": WEIGHTS_SHA,
        "sourceCommit": assignment["studentCodeCommit"], "donors": DONORS,
        "inputSha256": dict(INPUT_PINS), "auxiliaryInputSha256": {**ARTIFACT_PINS, ASSIGNMENT_NAME: sha(assignment_bytes)},
        "representation": rank.metadata(), "cases": CASES, "sourcePhysicalSha256": dict(physical_source_pins),
        "retrievalOnly": True, "hostTargetsInStage": False, "fitPerformed": False, "evaluationAllowed": False,
        "canonicalAssociationQualified": False, "teacherTargetsInPrompt": False, "promotionAuthorized": False}


def checked_run_inputs(freeze, inputs):
    require(type(freeze) is dict and freeze.get("version") == FREEZE_VERSION and freeze.get("inputSha256") == INPUT_PINS
            and type(freeze.get("auxiliaryInputSha256")) is dict and set(freeze["auxiliaryInputSha256"]) == AUXILIARY_NAMES,
            "rank_freeze_or_auxiliary_set_drift")
    inputs = Path(inputs)
    assignment_bytes = (inputs / ASSIGNMENT_NAME).read_bytes()
    assignment = checked_assignment(strict_json(assignment_bytes))
    source_pins = freeze.get("sourcePhysicalSha256", {})
    require(freeze == make_freeze(assignment, assignment_bytes, source_pins), "rank_frozen_assignment_drift")
    source_root = Path(__file__).resolve().parents[5]
    for relative, digest in source_pins.items():
        raw = (source_root / relative).read_bytes()
        require(sha(raw) == digest and sha(raw.replace(b"\r\n", b"\n")) == assignment["runtimeCodeCanonicalLfSha256"][relative],
                "rank_runtime_source_drift:" + relative)
    schema, route = checked_payload(assignment,
        {key: (inputs / name).read_bytes() for key, name in INPUT_NAMES.items()},
        {name: (inputs / name).read_bytes() for name in ARTIFACT_PINS})
    return schema, assignment, route


def checked_loader_authority(authority, examples, contract, family):
    require(type(authority) is dict and set(authority) == {"freeze", "inputs"}, "rank_explicit_loader_authority_required")
    schema, _, route = checked_run_inputs(authority["freeze"], authority["inputs"])
    # Caller options cannot substitute another batch or split after admission.
    source.base.checked_batch({"version": "association-development/1", "examples": examples}, CASES, contract, family)
    contexts = codec.checked_route(route, examples, schema, contract, family, ("development",))
    return schema, contexts


def provenance(freeze, freeze_sha256):
    return {**source.provenance(freeze, freeze_sha256), "donors": freeze["donors"],
            "policySha256": codec.canonical_sha(rank.POLICY), "nativeTokensVerifiedByMetadata": False}
