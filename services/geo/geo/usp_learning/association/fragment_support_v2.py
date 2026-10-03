"""Exact ten-row support-pair authority; one shared fragment fitter/proof path."""
from __future__ import annotations

from functools import partial
from pathlib import Path
import sys

from . import fragment_adapter as v1
from .fragment_adapter import (
    IS_FRAGMENT, SYSTEM_PROMPT, FIT, NUMERICS, SETTINGS, MODEL, REVISION, WEIGHTS_SHA,
    RUNTIME_SHA, MODEL_PROFILE_SHA, REQUIREMENTS_SHA, COMMON_PINS, CASES,
    ACCEPTED_FIT_KEYS, ATTENTION_CONTROL, codec, sha, same, serialized, allowance,
    memory_policy, checked_development, checked_fit_metadata, require, strict_json)

DATA_SHA = "ff366335b907d13f8128c22788d9bb65ad6c94eac7972052b2be458f90c8c7fd"
DATA_NAME = "train-teacher-fragments-v2.jsonl"
VERSIONS = {a: (f"association-fragment-support-{a}-assignment/2", f"association-fragment-support-{a}-freeze/2")
            for a in ("fit", "reload")}
TASKS = {"fit": "STUDENT-22-FRAGMENT-SUPPORT-V2-FIT", "reload": "STUDENT-23-FRAGMENT-SUPPORT-V2-RELOAD"}
STAGE_PREFIX = "adapter-fragment-support-v2-"
SUPPORT_PINS = {
    "train-teacher-fragments-v1.jsonl": v1.DATA_SHA,
    "rows-v2.receipt.json": "23e55431848c7c4a771dc33d1d72467d221c66c12791c15d888af80bb716b555",
    "source-support-v2.receipt.json": "a96c15a2b019633c7c2c5afdbf87d57537f0aaf16a08de41db4f7fa201915257",
    "training-row-pins-v2.json": "35f8ff921997cfa26dc0fe61185a758520be31975598a5e3cb45ed66b55f7676"}
ROW_PINS = {**v1.ROW_PINS,
    "teacher-fragments-v2-pair01-a": "2e0cd2c693f33d263fe599dfa7822d3d431f12a70d91eca23d2d518ab3ae8d7c",
    "teacher-fragments-v2-pair01-b": "909e3621de425d7fe9835b45c8129c6d9d861cea1430ea027006b0243ecaaaab",
    "teacher-fragments-v2-pair02-a": "b066025f1c298fb87937467d8ddb28531a0072fd9bdbdd0f55caf70acf8e1fb5",
    "teacher-fragments-v2-pair02-b": "c2f9f69b88a6489cd929b565cfac9a5858db17fd7d380e6f16f41f1a3252a6cd"}
PROTECTED_PINS = {**v1.PROTECTED_PINS,
    "services/geo/geo/usp_learning/association/adapter.py": "25dff6e136b9878bf82a1d6a254eb117250833613f68be59d36543684d74e881"}
SOURCE_PATHS = tuple(sorted((*v1.SOURCE_PATHS,
    "services/geo/geo/usp_learning/association/fragment_support_v2.py",
    "scripts/usp/learning/association/stage_fragment_support_v2.py")))


def training_plan():
    return {"version": "association-training-plan/1", "datasetSha256": DATA_SHA,
            "teacherExamples": 10, "epochs": FIT["epochs"], "plannedUpdates": 60}


def representation_metadata():
    return {**v1.representation_metadata(), "version": "association-fragment-support-training/2",
            "datasetSha256": DATA_SHA, "trainingPlan": training_plan(), "supportInputSha256": dict(SUPPORT_PINS)}


def object_sha(value):
    return sha(codec.canonical(value).encode())


def checked_row(row, schema, contract, family):
    # A whole-row pin binds every context/input/target/supervision field, including
    # parent/pair/receipt references. Preserve the exact v1 codec/wrapper checks.
    return v1.checked_row(row, schema, contract, family, row_pins=ROW_PINS)


def checked_data(data):
    require(len(data) == 138050 and sha(data) == DATA_SHA, "fragment_support_dataset_pin_drift")
    require(sha(data[:82626]) == v1.DATA_SHA, "fragment_support_parent_prefix_drift")
    lines = data.splitlines()
    originals = [strict_json(line) for line in lines]
    require([r["context"]["exampleId"] for r in originals] == list(ROW_PINS)
            and [sha(line) for line in lines] == list(ROW_PINS.values())
            and [object_sha(r) for r in originals] == list(ROW_PINS.values()), "fragment_support_row_pins_drift")
    return originals


def checked_teacher(data, schema, contract, family):
    originals = checked_data(data)
    rows = [checked_row(row, schema, contract, family) for row in originals]
    counts = {"rows": len(rows), "candidateAppearances": sum(len(r["context"]["candidates"]) for r in originals),
              "selectedAppearances": sum(len(r["output"]["selected"]) for r in originals),
              "emptySelections": sum(not r["output"]["selected"] for r in originals)}
    require(counts == {"rows": 10, "candidateAppearances": 57, "selectedAppearances": 12, "emptySelections": 3},
            "fragment_support_counts_drift")
    return rows, {"representation": representation_metadata(), "trainingPlan": training_plan(), "counts": counts,
                  "originalRowsAndSupervisionUnchanged": True, "trainFamiliesOnly": True, "sarvamDerived": False}


def checked_support_files(values, data):
    """Bind supplied receipts without reconstructing/requalifying source evidence."""
    require(set(values) == set(SUPPORT_PINS) and all(sha(values[k]) == v for k, v in SUPPORT_PINS.items()),
            "fragment_support_receipt_pin_drift")
    originals = checked_data(data)
    require(data[:82626] == values["train-teacher-fragments-v1.jsonl"], "fragment_support_parent_bytes_drift")
    pins = strict_json(values["training-row-pins-v2.json"])
    receipts = strict_json(values["rows-v2.receipt.json"])["rows"]
    support = strict_json(values["source-support-v2.receipt.json"])["rows"]
    by_id = {r["context"]["exampleId"]: r for r in originals}
    for row, pin in zip(originals, pins["rows"], strict=True):
        require(pin["exampleId"] == row["context"]["exampleId"]
                and pin["rawRowSha256"] == pin["canonicalRowSha256"] == object_sha(row)
                and pin["contextSha256"] == object_sha(row["context"])
                and pin["targetSha256"] == object_sha(row["output"]), "fragment_support_component_pin_drift")
    for row, receipt, source in zip(originals[6:], receipts, support, strict=True):
        supervision = row["supervision"]
        parent = by_id[receipt["parent"]["exampleId"]]
        require(receipt["annotationId"] == source["annotationId"] == row["context"]["exampleId"]
                and receipt["pairId"] == source["pairId"] == supervision["pairId"]
                and same(receipt["parent"], supervision["parent"]) and same(source["parent"], supervision["parent"])
                and receipt["rawRowSha256"] == object_sha(row) and receipt["contextSha256"] == object_sha(row["context"])
                and receipt["selected"] == row["output"]["selected"]
                and object_sha(source) == supervision["sourceReceiptRowCompactSha256"]
                and same(row["context"]["candidates"], parent["context"]["candidates"]), "fragment_support_parent_pair_drift")
        expected_parent = {"exampleId": parent["context"]["exampleId"], "rawRowSha256": object_sha(parent),
            "contextSha256": object_sha(parent["context"]), "candidatesCompactSha256": object_sha(parent["context"]["candidates"]),
            "inputCompactSha256": object_sha(parent["input"]), "supervisionCompactSha256": object_sha(parent["supervision"])}
        require(same(receipt["parent"], expected_parent), "fragment_support_parent_components_drift")
        for candidate, decision in zip(row["context"]["candidates"], source["decisions"], strict=True):
            fragment = candidate["fragment"]
            require(candidate["id"] == decision["candidateId"] and object_sha(fragment) == decision["fragmentCompactSha256"]
                    and fragment["sourceSha256"] == decision["sourceSha256"] and same(fragment["locator"], decision["locator"])
                    and decision["observableQuote"] in fragment["text"]
                    and sha(decision["observableQuote"].encode()) == decision["quoteUtf8Sha256"]
                    and (decision["decision"] == "selected") == (candidate["id"] in row["output"]["selected"]),
                    "fragment_support_source_binding_drift")


class FragmentRepresentation(v1.FragmentRepresentation):
    def __init__(self, schema, contract, family):
        super().__init__(schema, contract, family, authority=sys.modules[__name__])


def input_names(action):
    names = v1.input_names(action)
    if action == "fit":
        names.update(teacher_v1=DATA_NAME, training_data=DATA_NAME)
    return names


def auxiliary_pins(action):
    return {**v1.auxiliary_pins(action), **(SUPPORT_PINS if action == "fit" else {})}


def checked_inputs(freeze, assignment, inputs, *, source_root=None):
    schema = v1.checked_inputs(freeze, assignment, inputs, source_root=source_root, _authority=sys.modules[__name__])
    if freeze["action"] == "fit":
        inputs = Path(inputs)
        checked_support_files({name: (inputs / name).read_bytes() for name in SUPPORT_PINS}, (inputs / DATA_NAME).read_bytes())
    return schema


# Bind only the explicit v2 leaf; no mutation of v1 module constants or defaults.
checked_execution = partial(v1.checked_execution, _authority=sys.modules[__name__])
make_freeze = partial(v1.make_freeze, _authority=sys.modules[__name__])
checked_freeze = partial(v1.checked_freeze, _authority=sys.modules[__name__])
checked_cli = partial(v1.checked_cli, _authority=sys.modules[__name__])
proof_metadata = partial(v1.proof_metadata, _authority=sys.modules[__name__])
checked_reload_binding = partial(v1.checked_reload_binding, _authority=sys.modules[__name__])
checked_loader_authorization = partial(v1.checked_loader_authorization, _authority=sys.modules[__name__])
reload_runner = partial(v1.reload_runner, _authority=sys.modules[__name__])
