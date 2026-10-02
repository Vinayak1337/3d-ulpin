"""CPU-only admission for coordinator-frozen citation views; never assembles a dataset.

The /1 declaration and citationViewAugmentation metadata contract are documented in
student/citation-view-preparation.md. Unknown layouts require explicit review.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import random
import re

from .validation import require, strict_json, validate_output

VERSION = "association-citation-view-dataset/1"
POLICY = "opaque_keys_reverse_evidence/1"
FIT_ASSIGNMENT_VERSION = "association-citation-view-fit-assignment/1"
TEACHER_ASSIGNMENT_SHA = "e5cfa3cadb6b547ec14d03b24513963e28259f9c3b8efa1a3caa0aa9d1232244"
PROVENANCE = {"task": "TEACHER-03", "assignmentVersion": "ml-distillation-citation-view-preparation/1",
              "path": "C:/Users/kvina/.codex/worktrees/ml-orchestrator-20261002/3d-ulpin/docs/evidence/usp/ml-distillation/teacher-03.citation-view.assignment.json",
              "gitCommit": "334467e30cd648a83aec3bec84140bf974b0a5f4",
              "canonicalLfSha256": TEACHER_ASSIGNMENT_SHA,
              "workerBaseCommit": "59afe9b78b06f6452abbeeba27a73b46653b64d3"}
PARENT_PATH = "E:/BhuAayam-data/task-data/ml-distillation/teacher/train-teacher-v2.jsonl"
ROW_HASH_CONVENTION = "raw UTF-8 JSONL row payload, excluding its LF terminator"
COUNTS = {"rows": 22, "claims": 124, "conflicts": 4, "abstentions": 44, "canonicalAbstentions": 22}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    # Type-sensitive equality: bool/int and int/float substitutions are not invariants.
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def same(left, right):
    return canonical(left) == canonical(right)


def checked_declaration(declaration):
    from .adapter import V2_SHA
    require(isinstance(declaration, dict) and set(declaration) == {
        "version", "frozen", "datasetSha256", "rows", "parent", "transform", "provenance"}, "citation_view_declaration_required")
    require(declaration["version"] == VERSION and declaration["frozen"] is True, "citation_view_not_frozen")
    digest = declaration["datasetSha256"]
    require(isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest)
            and digest not in ("0" * 64, V2_SHA), "citation_view_digest_required")
    require(type(declaration["rows"]) is int and declaration["rows"] == COUNTS["rows"], "citation_view_row_declaration_drift")
    require(same(declaration["parent"], {"sha256": V2_SHA, "rows": 11})
            and declaration["transform"] == POLICY and same(declaration["provenance"], PROVENANCE),
            "citation_view_parent_policy_or_provenance_drift")
    return declaration


def training_plan(declaration=None):
    from .adapter import FIT, V2_SHA
    require(FIT["batchSize"] == FIT["gradientAccumulation"] == 1 and FIT["epochs"] == 6, "training_count_recipe_changed")
    if declaration is None:
        return {"version": "association-training-plan/1", "datasetSha256": V2_SHA,
                "teacherExamples": 11, "epochs": 6, "plannedUpdates": 66}
    checked_declaration(declaration)
    return {"version": "association-training-plan/1", "datasetSha256": declaration["datasetSha256"],
            "teacherExamples": declaration["rows"], "epochs": FIT["epochs"],
            "plannedUpdates": declaration["rows"] * FIT["epochs"],
            "declarationSha256": sha(canonical(declaration).encode("utf-8"))}


def epoch_orders(plan):
    from .adapter import FIT
    rng = random.Random(FIT["seed"])
    orders = []
    for _ in range(plan["epochs"]):
        order = list(range(plan["teacherExamples"]))
        rng.shuffle(order)
        orders.append(order)
    return orders


def epoch_means(losses, plan):
    require(len(losses) == plan["plannedUpdates"] and all(type(v) in (int, float) and math.isfinite(v) for v in losses),
            "training_loss_count_or_value_drift")
    count = plan["teacherExamples"]
    return [sum(losses[i:i + count]) / count for i in range(0, len(losses), count)]


def checked_execution(assignment, action):
    """Preparation assignments cannot opt into execution by supplying a data path."""
    require(assignment.get("version") == FIT_ASSIGNMENT_VERSION and assignment.get("task") == "STUDENT-08-FIT",
            "separate_citation_view_fit_assignment_required")
    allowance = assignment.get("executionAllowance", {})
    require(allowance.get("stageModelRun") is True and allowance.get("fit") is True
            and (action == "fit" or action == "reload" and allowance.get("inference") is True),
            "citation_view_execution_not_authorized")
    declaration = checked_declaration(assignment.get("datasetDeclaration"))
    require(same(assignment.get("trainingPlan"), training_plan(declaration)), "assignment_training_plan_drift")
    return declaration


def checked_freeze(freeze, assignment):
    """Returns the only count plan accepted by fit, acceptance and reload."""
    declaration = freeze.get("datasetDeclaration")
    if "datasetDeclaration" in freeze or "datasetDeclaration" in assignment:
        require(same(declaration, checked_execution(assignment, freeze["action"]))
                and freeze["version"] == "association-citation-view-freeze/1", "citation_view_freeze_drift")
        plan = training_plan(declaration)
        require(same(freeze.get("trainingPlan"), plan), "frozen_training_plan_drift")
        require(isinstance(assignment.get("studentCodeCommit"), str)
                and re.fullmatch(r"[0-9a-f]{40}", assignment["studentCodeCommit"])
                and freeze.get("sourceCommit") == assignment["studentCodeCommit"], "frozen_student_code_drift")
    else:
        require(not str(freeze["version"]).startswith("association-citation-view")
                and assignment.get("version") != FIT_ASSIGNMENT_VERSION, "citation_view_declaration_missing")
        plan = training_plan()
        if "trainingPlan" in freeze:
            require(same(freeze["trainingPlan"], plan), "legacy_training_plan_drift")
    if freeze["action"] == "fit":
        require(freeze["inputSha256"]["training_data"] == plan["datasetSha256"], "frozen_training_data_drift")
    return plan


def checked_variant(parent, variant, parent_line, declaration, contract, family_freeze):
    """Check one actual/in-memory variant by inverse recovery, never generate rows."""
    from .adapter import V2_SHA
    checked_declaration(declaration)
    require(same(strict_json(parent_line), parent), "citation_view_parent_row_drift")
    example_id = parent["input"]["exampleId"]
    old_order = [fragment["key"] for fragment in parent["input"]["evidence"]]
    mapping = {key: "view01:k-" + sha((example_id + "\0" + key).encode("utf-8"))[:16] for key in old_order}
    require(len(mapping) == len(old_order) == len(set(mapping.values())), "citation_view_key_collision")
    new_order = [mapping[key] for key in reversed(old_order)]
    require(variant["input"]["exampleId"] == example_id + "-citation-view01", "citation_view_example_id_drift")
    require([f["key"] for f in variant["input"]["evidence"]] == new_order, "citation_view_order_or_key_drift")
    metadata = {"version": POLICY, "parentDatasetPath": PARENT_PATH, "parentDatasetSha256": V2_SHA,
                "parentRowSha256": sha(parent_line), "parentExampleId": example_id,
                "parentRowHashConvention": ROW_HASH_CONVENTION,
                "keyBijection": [{"oldKey": key, "newKey": mapping[key]} for key in old_order],
                "oldEvidenceOrder": old_order, "newEvidenceOrder": new_order,
                "assignment": declaration["provenance"]}
    require(same(variant["supervision"].get("citationViewAugmentation"), metadata), "citation_view_metadata_drift")
    require(variant["supervision"].get("augmentation") is True, "citation_view_augmentation_flag_required")
    recovered = copy.deepcopy(variant)
    recovered["input"]["exampleId"] = example_id
    inverse = {new: old for old, new in mapping.items()}
    recovered["input"]["evidence"].reverse()
    for fragment in recovered["input"]["evidence"]:
        fragment["key"] = inverse[fragment["key"]]
    for kind in ("claims", "conflicts", "abstentions"):
        for decision in recovered["output"][kind]:
            for citation in decision["citations"]:
                require(citation["key"] in inverse, "citation_view_unknown_citation")
                citation["key"] = inverse[citation["key"]]
    recovered["supervision"].pop("citationViewAugmentation")
    recovered["supervision"]["augmentation"] = parent["supervision"]["augmentation"]
    require(same(recovered, parent), "citation_view_inverse_drift")
    validate_output(variant["output"], variant["input"], contract, family_freeze, ("train",))


def checked_citation_teacher(v1_bytes, parent_bytes, data_bytes, declaration, contract, family_freeze):
    from .adapter import checked_teacher
    checked_declaration(declaration)
    parents, legacy_delta = checked_teacher(v1_bytes, parent_bytes, contract, family_freeze)
    require(sha(data_bytes) == declaration["datasetSha256"], "citation_view_dataset_pin_drift")
    require(parent_bytes.endswith(b"\n") and data_bytes.startswith(parent_bytes), "citation_view_original_prefix_changed")
    parent_lines = parent_bytes.split(b"\n")[:-1]
    suffix_lines = data_bytes[len(parent_bytes):].splitlines(keepends=True)
    require(len(parent_lines) == len(suffix_lines) == len(parents) == 11, "citation_view_row_count_drift")
    variants = [strict_json(line) for line in suffix_lines]
    for parent, variant, line in zip(parents, variants, parent_lines):
        checked_variant(parent, variant, line, declaration, contract, family_freeze)
    rows = parents + variants
    require(len({row["input"]["exampleId"] for row in rows}) == declaration["rows"], "citation_view_duplicate_example")
    counts = {"rows": len(rows), **{kind: sum(len(row["output"][kind]) for row in rows)
              for kind in ("claims", "conflicts", "abstentions")},
              "canonicalAbstentions": sum(a == {"code": "no_canonical_targets", "citations": []}
                  for row in rows for a in row["output"]["abstentions"])}
    require(counts == COUNTS, "citation_view_label_counts_drift")
    return rows, {"version": VERSION, "legacyParentDelta": legacy_delta, "counts": counts,
                  "declaration": declaration, "trainingPlan": training_plan(declaration),
                  "exactOriginalPrefix": True, "inverseRecoveryChecked": True, "trainFamiliesOnly": True}


def checked_reload_counts(proof, manifest, plan, *, versioned):
    require(type(proof["updates"]) is type(manifest["updates"]) is int and proof["updates"] == manifest["updates"] == plan["plannedUpdates"],
            "accepted_fit_update_count_drift")
    for value in (proof, manifest):
        if versioned or "trainingPlan" in value:
            require(same(value.get("trainingPlan"), plan), "accepted_fit_training_plan_drift")
    # Historical reload remains restricted to the original 66-update teacher.
    require(versioned or plan == training_plan(), "legacy_reload_plan_changed")


def checked_count_receipts(plan, preflight, result, manifest, progress, *, versioned):
    """Bind order, per-step history and loss denominators to the admitted rows."""
    count, updates = plan["teacherExamples"], plan["plannedUpdates"]
    for value in (preflight, result, manifest):
        if versioned or "trainingPlan" in value:
            require(same(value.get("trainingPlan"), plan), "fit_receipt_training_plan_drift")
    lengths = preflight["lengths"]
    require(len(lengths) == count and len({r["exampleId"] for r in lengths}) == count
            and preflight["plannedUpdates"] == result["updates"] == manifest["updates"] == updates
            and result["teacherExamples"] == count, "fit_receipt_count_drift")
    orders = epoch_orders(plan)
    require(preflight["epochOrder"] == orders, "fit_epoch_order_drift")
    expected = [(epoch + 1, lengths[index]["exampleId"]) for epoch, order in enumerate(orders) for index in order]
    require(len(progress) == updates and [r["update"] for r in progress] == list(range(1, updates + 1))
            and [(r["epoch"], r["exampleId"]) for r in progress] == expected, "fit_progress_order_or_count_drift")
    require([r["loss"] for r in progress] == result["stepLosses"]
            and result["epochMeanLoss"] == epoch_means(result["stepLosses"], plan), "fit_epoch_mean_drift")

    tokens = {row["exampleId"]: row for row in lengths}
    require(all(row["supervisedTokens"] == tokens[row["exampleId"]]["assistantJsonPlusEosTokens"]
                and row["combinedTokens"] == tokens[row["exampleId"]]["combinedTokens"] for row in progress)
            and result["supervisedTokens"] == sum(row["supervisedTokens"] for row in progress),
            "fit_supervised_token_count_drift")
