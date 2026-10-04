"""Pinned selector admission and representation hooks; no fitting implementation."""
from __future__ import annotations

import copy
import hashlib
from pathlib import Path
import re

from .adapter import FIT, NUMERICS, V2_SHA
from .student import SETTINGS
from .selectors import POLICY, PROMPT_VERSION, PROMPT_SHA, SCHEMA_SHA, SYSTEM_PROMPT, canonical, checked_schema, context, project
from .selector_baseline import MODEL, REVISION
from .query_attention import ATTENTION_CONTROL
from .query_attention import ATTENTION_POLICY
from .chunked_loss import LOSS_POLICY
from .reclamation import RECLAMATION_POLICY
from .validation import require, strict_json

FREEZE_VERSION = "association-selector-adapter-freeze/1"
EXECUTION_VERSION = "association-selector-adapter-execution/1"
DATA_SHA = "36649ae4f7ca82e50366a627abdc89e02696f0c56cc0a5b648b88a07403cd9cb"
MEMORY_POLICY_SHA = "d9d3b38aaedfba617256f35fc01d2e475885cfb0570981a6a7b007df8f5034d4"
COMMON_INPUT_PINS = {
    "schema": "b3a3a64f403d7a5ee0a2ea6ed22c5d418b9af089f75fd9aca8aa0f9a00ab09af",
    "family_freeze": "93c243f28895ac084c3f1853cba80b9e0b5286f881aba44d6cb7ab6e3a164730",
    "model_receipt": "4fe6c79e0f4f93fc1552482b9b3e77143492c0bb7f4b9b4f7b84b8c30e9c3ff2",
}
BATCH_SHA = "a89a7eaa4917a398b78ac0457eb7fa55223fd877b12306f03ca7801939f4e536"
CASES = [
    {"exampleId": "ifc4-source-native-v1", "inputCanonicalJsonSha256": "da3be49d09c86f4cafd459e9ff89c212f2ef0bbe5958ea98c6a1be3824aac4d4"},
    {"exampleId": "ifc2x3-source-native-v1", "inputCanonicalJsonSha256": "5cdbd1fec015bc2eecde12ee37dea41eeb0fc7c6eb9e7ac8470af04bd74c3a88"},
]
COUNTS = {"rows": 11, "claims": 62, "conflicts": 2, "abstentions": 22, "canonicalAbstentions": 11}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def same(left, right):
    return canonical(left) == canonical(right)


def training_plan():
    return {"version": "association-training-plan/1", "datasetSha256": DATA_SHA,
            "teacherExamples": 11, "epochs": 6, "plannedUpdates": 66}


def representation_metadata():
    return {"version": "association-selector-training/1", "datasetSha256": DATA_SHA, "parentSha256": V2_SHA,
            "promptVersion": PROMPT_VERSION, "systemPromptSha256": PROMPT_SHA,
            "selectorSchemaCanonicalLfSha256": SCHEMA_SHA, "lexicalPolicy": copy.deepcopy(POLICY),
            "target": "canonical raw selector JSON plus EOS; expanded strings for admission only",
            "teacherSupervision": "provisional; not independent truth or operational facts"}


def checked_row(parent, row, parent_line, selector_contract, contract, family):
    require(set(row) == set(parent) == {"input", "output", "supervision"}
            and same(row["input"], parent["input"]), "selector_teacher_source_or_input_drift")
    supervision = copy.deepcopy(row["supervision"])
    projection = supervision.pop("selectorProjection", {})
    require(same(supervision, parent["supervision"]) and supervision.get("split") == "train"
            and supervision.get("augmentation") is False, "selector_teacher_supervision_drift")
    require(projection.get("version") == "ml-distill-selector-projection/1"
            and projection.get("parentDatasetSha256") == V2_SHA
            and projection.get("parentRawRowSha256") == sha(parent_line)
            and projection.get("policyVersion") == POLICY["version"]
            and projection.get("selectorSchemaSha256") == SCHEMA_SHA, "selector_teacher_parent_or_policy_drift")
    source = context(row["input"], contract, family, ("train",))
    checked = project(canonical(row["output"]), source, selector_contract, contract, family, ("train",))
    require(checked["modelOutputValid"] and same(checked["acceptedProjection"], parent["output"]),
            "selector_teacher_target_or_expansion_drift")
    # The existing fit validator sees legacy strings; the encoder gets pointers separately.
    return {"input": copy.deepcopy(row["input"]), "output": checked["acceptedProjection"],
            "selectorTarget": copy.deepcopy(row["output"]), "selectorInputSha256": source.input_sha256}


def checked_teacher(parent_bytes, data_bytes, selector_contract, contract, family):
    require(sha(parent_bytes) == V2_SHA, "selector_parent_pin_drift")
    require(len(data_bytes) == 78908 and sha(data_bytes) == DATA_SHA, "selector_teacher_pin_drift")
    parents, targets = parent_bytes.splitlines(), data_bytes.splitlines()
    require(len(parents) == len(targets) == 11, "selector_teacher_row_count_drift")
    rows = [checked_row(strict_json(p), strict_json(t), p, selector_contract, contract, family)
            for p, t in zip(parents, targets)]
    require(len({r["input"]["exampleId"] for r in rows}) == 11, "selector_teacher_duplicate_row")
    counts = {"rows": len(rows), **{k: sum(len(r["output"][k]) for r in rows) for k in ("claims", "conflicts", "abstentions")},
              "canonicalAbstentions": sum(d == {"code": "no_canonical_targets", "citations": []}
                  for r in rows for d in r["output"]["abstentions"])}
    require(counts == COUNTS, "selector_teacher_label_count_drift")
    return rows, {"representation": representation_metadata(), "counts": counts, "trainingPlan": training_plan(),
                  "exactParentExpansion": True, "sourceInputsUnchanged": True, "trainFamiliesOnly": True}


class SelectorRepresentation:
    system_prompt = SYSTEM_PROMPT

    def __init__(self, selector_contract, contract, family):
        self.selector_contract, self.contract, self.family = selector_contract, contract, family

    @property
    def training_plan(self):
        return training_plan()

    @property
    def metadata(self):
        return representation_metadata()

    def source(self, row):
        return context(row["input"], self.contract, self.family, ("train",),
                       expected_input_sha256=row["selectorInputSha256"])

    def messages(self, row):
        return self.source(row).messages()

    def target(self, row):
        target = canonical(row["selectorTarget"])
        checked = project(target, self.source(row), self.selector_contract, self.contract, self.family, ("train",))
        require(checked["modelOutputValid"] and same(checked["acceptedProjection"], row["output"]),
                "selector_encoder_target_drift")
        return target


def checked_execution(assignment, action):
    # First check: PREP never inspects runtime files or reaches mkdir/copy.
    constrained = assignment.get("version") == "association-selector-constrained-execution/1"
    require(((assignment.get("version") == EXECUTION_VERSION and assignment.get("task") == "STUDENT-10-SELECTOR-FIT")
             or (constrained and assignment.get("task") == "STUDENT-11-CONSTRAINED-RELOAD" and action == "reload"))
            and action in ("fit", "reload") and assignment.get("action") == action,
            "separate_selector_adapter_execution_required")
    if constrained:
        from .selector_constraints import checked_metadata
        checked_metadata(assignment.get("generationConstraints"))
    else:
        require("generationConstraints" not in assignment, "selector_unversioned_constraints_refused")
    require(same(assignment.get("executionAllowance"), {"stageModelRun": True, "loadModel": True,
        "fit": action == "fit", "inference": action == "reload", "evaluation": False, "promotion": False, "freshPhases": 1}),
        "selector_adapter_execution_not_authorized")
    require(not any(k in assignment for k in ("datasetDeclaration", "trainingDiagnostic")), "selector_adapter_mixed_mode_refused")
    require(same(assignment.get("settings"), FIT) and same(assignment.get("numerics"), NUMERICS)
            and same(assignment.get("inferenceSettings"), SETTINGS)
            and assignment.get("model") == MODEL and assignment.get("revision") == REVISION
            and assignment.get("teacherV2Sha256") == V2_SHA
            and same(assignment.get("representation"), representation_metadata())
            and same(assignment.get("trainingPlan"), training_plan()), "selector_adapter_recipe_drift")
    policy = assignment.get("memoryExecutionPolicy", {})
    require(sha(canonical({k: v for k, v in policy.items() if k not in ("causeQualification", "continuation")}).encode()) == MEMORY_POLICY_SHA
            and same(assignment.get("attentionControlBeforeFit"), ATTENTION_CONTROL), "selector_adapter_memory_policy_drift")
    require(isinstance(assignment.get("studentCodeCommit"), str)
            and re.fullmatch(r"[a-f0-9]{40}", assignment["studentCodeCommit"]), "selector_adapter_code_commit_required")
    if action == "reload":
        require(same(assignment.get("cases"), CASES) and assignment.get("inputBatchSha256") == BATCH_SHA,
                "selector_reload_input_drift")
        accepted = assignment.get("acceptedFit", {})
        require(set(accepted) == {"root", "profileSha256", "guardSha256", "adapterManifestSha256", "fitResultSha256", "adapterWeightsSha256"}
                and isinstance(accepted["root"], str)
                and all(isinstance(v, str) and re.fullmatch(r"[a-f0-9]{64}", v) for k, v in accepted.items() if k != "root"),
                "selector_reload_frozen_fit_required")
    else:
        require(not any(k in assignment for k in ("acceptedFit", "cases", "inputBatchSha256")), "selector_fit_development_fields_refused")
    return training_plan()


def checked_freeze(freeze, assignment):
    plan = checked_execution(assignment, freeze["action"])
    constrained = assignment.get("version") == "association-selector-constrained-execution/1"
    expected_version = "association-selector-constrained-freeze/1" if constrained else FREEZE_VERSION
    if constrained:
        require(same(freeze.get("generationConstraints"), assignment["generationConstraints"]), "selector_frozen_constraints_drift")
    else:
        require("generationConstraints" not in freeze, "selector_unversioned_constraints_refused")
    require(not any(k in freeze for k in ("datasetDeclaration", "trainingDiagnostic")), "selector_adapter_mixed_mode_refused")
    require(freeze.get("version") == expected_version and freeze.get("sourceCommit") == assignment["studentCodeCommit"]
            and same(freeze.get("representation"), representation_metadata()) and same(freeze.get("trainingPlan"), plan)
            and freeze.get("systemPromptSha256") == PROMPT_SHA
            and freeze.get("evaluationAllowed") is False and freeze.get("promotionAuthorized") is False
            and freeze.get("developmentInputsPresent") is (freeze["action"] == "reload"), "selector_adapter_freeze_drift")
    require(same(freeze.get("fitSettings"), FIT) and same(freeze.get("numerics"), NUMERICS)
            and same(freeze.get("inferenceSettings"), SETTINGS)
            and same(freeze.get("memoryExecutionPolicy"), assignment["memoryExecutionPolicy"])
            and same(freeze.get("lossImplementation"), LOSS_POLICY)
            and same(freeze.get("reclamationImplementation"), RECLAMATION_POLICY)
            and same(freeze.get("attentionImplementation"), ATTENTION_POLICY)
            and all(freeze.get(k) == assignment.get(k) for k in ("previousFailedFit", "previousFailureReceiptSha256")),
            "selector_adapter_frozen_recipe_drift")
    keys = {"schema", "family_freeze", "model_receipt", "assignment"}
    keys |= {"teacher_v1", "training_data"} if freeze["action"] == "fit" else {"input_batch", "adapter_manifest", "fit_proof"}
    require(set(freeze.get("inputSha256", {})) == keys, "selector_adapter_input_set_drift")
    for key, digest in COMMON_INPUT_PINS.items():
        require(freeze["inputSha256"][key] == digest, "selector_adapter_common_input_drift")
    if freeze["action"] == "fit":
        require(not any(k in freeze for k in ("acceptedFit", "cases", "inputBatchSha256")), "selector_fit_development_fields_refused")
        require(freeze["inputSha256"]["teacher_v1"] == V2_SHA and freeze["inputSha256"]["training_data"] == DATA_SHA,
                "selector_adapter_training_input_drift")
    else:
        require(freeze["inputSha256"]["input_batch"] == BATCH_SHA and same(freeze.get("cases"), CASES)
                and same(freeze.get("acceptedFit"), assignment["acceptedFit"])
                and freeze["inputSha256"]["adapter_manifest"] == assignment["acceptedFit"]["adapterManifestSha256"],
                "selector_adapter_reload_binding_drift")
    return plan


def checked_inputs(freeze, assignment, inputs):
    checked_freeze(freeze, assignment)
    inputs = Path(inputs)
    auxiliary = freeze.get("auxiliaryInputSha256", {})
    require(set(auxiliary) == {"selector-schema-v1.json", "selector-prompt.txt"}
            and auxiliary["selector-prompt.txt"] == PROMPT_SHA, "selector_adapter_auxiliary_set_drift")
    for name, digest in auxiliary.items():
        require(sha((inputs / name).read_bytes()) == digest, "selector_adapter_auxiliary_pin_drift")
    require((inputs / "selector-prompt.txt").read_bytes() == SYSTEM_PROMPT.encode(), "selector_adapter_prompt_drift")
    names = {"schema-v1.json", "family-freeze.json", "model-acquisition.json", "assignment.json", "run-freeze.json",
             "runtime-requirements-resolved.txt", *auxiliary}
    names |= {"train-teacher-v2.jsonl", "train-teacher-selectors-v1.jsonl"} if freeze["action"] == "fit" else {
        "development.json", "adapter-manifest.json", "fit-proof.json", "adapter"}
    require({p.name for p in inputs.iterdir()} == names, "selector_adapter_unexpected_input")
    return checked_schema((inputs / "selector-schema-v1.json").read_bytes())


def checked_fit_metadata(preflight, result, manifest, rows, representation):
    require(all(same(r.get("representation"), representation.metadata) for r in (preflight, result, manifest))
            and preflight.get("systemPromptSha256") == PROMPT_SHA, "selector_fit_representation_drift")
    require([r["exampleId"] for r in preflight["lengths"]] == [r["input"]["exampleId"] for r in rows],
            "selector_fit_row_identity_drift")
    require([r["targetSha256"] for r in preflight["lengths"]] == [sha(representation.target(r).encode()) for r in rows],
            "selector_fit_raw_target_digest_drift")


def checked_reload_binding(freeze, proof, manifest):
    require(same(proof.get("representation"), representation_metadata())
            and same(manifest.get("representation"), representation_metadata()), "selector_reload_representation_drift")
    expected = freeze["acceptedFit"]
    require(Path(proof["fitRoot"]) == Path(expected["root"])
            and all(proof[k] == expected[k] for k in ("profileSha256", "guardSha256", "adapterManifestSha256", "fitResultSha256"))
            and manifest["files"]["adapter_model.safetensors"] == expected["adapterWeightsSha256"],
            "selector_reload_fit_proof_drift")
