"""Exact train-only authority for a separately frozen original-base rank fit.

Consumes the accepted pair publication without recompiling or relabelling it.
No native import, model loader, optimizer, reload or launch lives here.
"""
from __future__ import annotations

import copy
from pathlib import Path
import re

from . import adapter, fragment_adapter as legacy, fragment_rank as rank
from .validation import require, strict_json

IS_FRAGMENT = IS_RANK_FIT = True
codec, sha, same, serialized = rank.codec, legacy.sha, legacy.same, legacy.serialized
SYSTEM_PROMPT = rank.SYSTEM_PROMPT
MODEL, REVISION, WEIGHTS_SHA = legacy.MODEL, legacy.REVISION, legacy.WEIGHTS_SHA
RUNTIME_SHA, MODEL_PROFILE_SHA, REQUIREMENTS_SHA = legacy.RUNTIME_SHA, legacy.MODEL_PROFILE_SHA, legacy.REQUIREMENTS_SHA
COMMON_PINS, SETTINGS, ATTENTION_CONTROL = legacy.COMMON_PINS, legacy.SETTINGS, legacy.ATTENTION_CONTROL
VERSIONS = {"fit": ("association-fragment-rank-fit-assignment/1", "association-fragment-rank-fit-freeze/1")}
TASKS = {"fit": "STUDENT-29-FRAGMENT-RANK-FIT"}
STAGE_PREFIX = "adapter-fragment-rank-"
PUBLICATION_ROOT = Path("E:/BhuAayam-data/task-data/ml-distillation/student/fragment-rank-cpu-v1-02a328e15b844c0b8c14d137a1f041fa")
PUBLICATION_SHA = "edffc5d0f047e065f0c1d32f50bc43592206ee9dca224000549f99622cd7cc82"
DATA_NAME = "train-fragment-rank-v1.jsonl"
DATA_SHA = "6dc7c52195c9d19683654c6593dd83b08eefc39327803510fdcaca824df529cd"
AUXILIARY = {
    "publication.json": PUBLICATION_SHA,
    "scoring-inputs.jsonl": "753533a1c654274316aed6b2f06641d20ad47d73bfc2375ba1d73d6e05e12696",
    "lineage.json": "7b2291969484aeccb913704e7d88e295f6d7fd26a6cf0de9aea9c87061fb7026",
    "counts.json": "3e50dc8a3a1bb35d65da810623261981a094660a69b071d59d874e12c0d6109f",
    "policy.json": "9237baa39a7927e4071054bab4fc080356c4f3123d6ac35717f2da4d3b5a2002",
    "system-prompt.txt": rank.PROMPT_SHA,
    "fragment-schema-v1.json": codec.SCHEMA_SHA,
}
PAYLOAD_PINS = {**AUXILIARY, DATA_NAME: DATA_SHA,
    "schema-v1.json": COMMON_PINS["schema"], "family-freeze.json": COMMON_PINS["family_freeze"],
    "model-acquisition.json": COMMON_PINS["model_receipt"]}
PARENT_COUNTS = dict(zip(
    [*(f"teacher-fragments-v1-{i:02}" for i in range(1, 7)),
     "teacher-fragments-v2-pair01-a", "teacher-fragments-v2-pair01-b", "teacher-fragments-v2-pair02-a", "teacher-fragments-v2-pair02-b"],
    [4, 7, 5, 6, 7, 6, 7, 7, 4, 4], strict=True))
COUNTS = {"pairs": 57, "parents": 10, "positive": 12, "negative": 45, "emptyParents": 3, "families": 2}
FIT = {**adapter.FIT, "method": "rank-support LoRA, shared original causal model lifecycle",
    "gradientAccumulation": "one complete parent with exact published 1/(10*candidateCount) weights",
    "loss": "two next-token label logits only; prompt-only forward; no JSON/ID/hash/EOS target loss",
    "maxPromptTokens": 4096, "truncation": False, "excludeOverlongRows": False}
NUMERICS = {**adapter.NUMERICS, "logits": "last prompt position, native 0/1 logits cast float32 before two-label NLL"}
LOSS_POLICY = {"version": "association-fragment-rank-weighted-nll/1", "policySha256": codec.canonical_sha(rank.POLICY),
    "logitsToKeep": 1, "lossDtype": "float32", "weight": "published numerator/denominator = 1/(10*candidateCount)",
    "accumulation": "complete parent; sequential candidate forward/backward, graph released after each; one unscale/check/clip/step",
    "epochReporting": "sum of parent contributions at their successive parameter states; not one full-global per-step objective",
    "proof": {"syntheticOnly": True, "actualLossAndAccumulationHelpers": True, "gradientScale": 128.0,
              "cpuReference": "independent float64 binary NLL and analytic gradient",
              "nativeDevices": ["cpu", "cuda"], "nativeLogitsDtypes": ["float32", "float16"],
              "nativeLossDtype": "float32", "atol": 1e-6, "rtol": 1e-6,
              "fp16GradientAtol": 1e-4, "fp16GradientRtol": 1e-3}}
# Active stage/fit imports, including the shared host stage and guarded worker.
# Unused reload/selector scripts and compiler/test sources are not execution inputs.
SOURCE_PATHS = tuple(sorted((set(legacy.SOURCE_PATHS) - {
    "scripts/usp/learning/association/association_student.py",
    "scripts/usp/learning/association/stage_selector_baseline.py",
    "services/geo/geo/usp_learning/association/selector_adapter.py"}) | {
    "services/geo/geo/usp_learning/association/fragment_rank.py",
    "services/geo/geo/usp_learning/association/fragment_rank_runtime.py",
    "services/geo/geo/usp_learning/association/fragment_rank_adapter.py",
    "services/geo/geo/usp_learning/association/fragment_rank_fit.py",
    "scripts/usp/learning/association/stage_fragment_rank.py"}))
PROTECTED_PINS = {
    "scripts/usp/learning/association/stage_adapter.py": "4293ead8a761c5a7fbe8c9300e642e549bae5c0cc2dbe6d96fbe9d671f239fee",
    "scripts/usp/learning/association/stage_baseline.py": "926b01c8c85aae962b1699c0e35a07c144993da2846b1016608a350bd1bb2b93",
    "scripts/usp/learning/model_isolation.py": "69e51fd895697f224960226cdc1f99499d2b43d0b17ac76638e20cdfa8787676",
    "scripts/usp/security/appcontainer_audit.py": "4a59a18e04cd6fe76590ba929f424271f3dacdfb19ccf5e65fc2ec8048fbdc7f",
    "services/geo/geo/__init__.py": "d10feb73a0713f7c1f57fd7982c1f2916448a1b634984a48646ff4e460b6ad09",
    "services/geo/geo/native_ifc.py": "f6e8e646987879b238fc91137d26f18c45775ecf6b9ffc312a3639f32a7fb661",
    "services/geo/geo/usp_learning/__init__.py": "4b2c1e31b9af2699de2380323db9775e9fc96dd4fab0d6ed5b67b5eeec20a05a",
    "services/geo/geo/usp_learning/association/__init__.py": "bc1a6b2a7a5190bc971e518cce5557a01abf8611c95b2d5e9e463a5abd2c7679",
    "services/geo/geo/usp_learning/association/candidate_baseline.py": "75b231cb665a0301f37568d1a5e4fe3d97385fc6875bf55d055cce6840d210d7",
    "services/geo/geo/usp_learning/association/candidate_selection.py": "c0475f9156f379cf9c3269e01892d1034699115655139930edfdea40a2b09785",
    "services/geo/geo/usp_learning/association/chunked_loss.py": "828a30334bca366299d9b52c88d0968bdfde202bb0505f074e9e570566e3bda7",
    "services/geo/geo/usp_learning/association/citation_view.py": "06d17f65230dfab966b1644d8ee75f8e0394615645c6bcc635a70f6d7ffc2cea",
    "services/geo/geo/usp_learning/association/fragment_adapter.py": "071b171547017f942432105a32cb5303a175d6ec8243c6bf1dd7df1e49e39b4d",
    "services/geo/geo/usp_learning/association/fragment_baseline.py": "63c923ed5d32593388852aa2e8b7fe6eb96682796295881c5a634c9fc08a778d",
    "services/geo/geo/usp_learning/association/fragment_rank.py": "292b9922421b5140f80a615df0cf1f24840c33d9757e58a574d6a7bc46a1af20",
    "services/geo/geo/usp_learning/association/fragment_rank_runtime.py": "96d80aeba24d95e8067efb13082d7aa48176fab2a5524fba33693ea496e0f200",
    "services/geo/geo/usp_learning/association/fragment_selection.py": "aa8be20c61fe94eb0c19e5e4c611a1378e7201ec11fbaca605c06bd349af88a0",
    "services/geo/geo/usp_learning/association/memory_observation.py": "ca17af790211021a8ccf7374ae16cc4d714d55f05145f1bd541655d2cf6d143d",
    "services/geo/geo/usp_learning/association/native_candidates.py": "17ce40d8ccb6852edb12986c0ae7a73da7db198f750aa6ed433d28229ac7e1df",
    "services/geo/geo/usp_learning/association/query_attention.py": "715c322f6e4a5383fa42a002292010d6e235f3b5afedb05274f7cb088fb04cec",
    "services/geo/geo/usp_learning/association/reclamation.py": "c1c301bc10f3c59848b2c7e66ed2fa387ad97f500bd948d12f53f7760db00d27",
    "services/geo/geo/usp_learning/association/selector_baseline.py": "7d453d9ddb795f27d17dc8096c0ed9606bb48283e2fa5a61ff03f5c5d3a2cd5d",
    "services/geo/geo/usp_learning/association/selector_constraints.py": "5099dd66c7df12e8799fd4bf65515855e45068c278274c814e80f0ba34fd7064",
    "services/geo/geo/usp_learning/association/selectors.py": "dcb83b6352c8c5972607c616866b11f91767235052cbac8b9606215b80b6863e",
    "services/geo/geo/usp_learning/association/student.py": "8de7e504c5ca37d54a9a73f05d771e7a344c710086370bfc12fc07f77e8c2798",
    "services/geo/geo/usp_learning/association/validation.py": "68ebee3f5ca0b6273862003b17db73dcd25495d1623732917467d12ff9ea18c2",
    "services/geo/geo/usp_learning/resources.py": "c46095c1a537208ececcf3b9e8c791fea05020dc73b74e74c350412c66bf9f54"
}


def training_plan():
    return {"version": "association-fragment-rank-training-plan/1", "datasetSha256": DATA_SHA,
        "teacherExamples": 10, "epochs": 6, "plannedUpdates": 60, "pairs": 57,
        "plannedCandidateContributions": 342, "parentCandidateCounts": dict(PARENT_COUNTS),
        "counts": dict(COUNTS), "seed": 17, "weighting": rank.POLICY["weight"]}


def representation_metadata():
    return {"version": "association-fragment-rank-training/1", "rank": rank.metadata(),
        "publicationSha256": PUBLICATION_SHA, "datasetSha256": DATA_SHA, "trainingPlan": training_plan(),
        "qualification": "57 related pairs from ten provisional parents in two train families; needs_independent_review",
        "teacherSupervision": "provisional_synthetic_supervision", "reviewState": "needs_independent_review",
        "sarvamDerived": False, "trainOnly": True}


def memory_policy():
    return {"lastPositionHeadTokens": 1, "interCandidateReclamation": True, "preBackwardReclamation": True,
        "retainGradientsUntilCompleteParent": True, "queryChunkedAttention": copy.deepcopy(legacy.ATTENTION_POLICY)}


def allowance(action, enabled=True):
    require(action == "fit", "rank_fit_only")
    return {"stageModelRun": enabled, "loadModel": enabled, "fit": enabled, "inference": False,
            "evaluation": False, "promotion": False, "freshPhases": 1 if enabled else 0}


def disabled_prototype(code_checkpoint, canonical_pins):
    """Review metadata, deliberately not a stageable execution assignment."""
    return {"version": "association-fragment-rank-fit-prototype/1", "executable": False,
        "codeCheckpoint": code_checkpoint, "runtimeCodeCanonicalLfSha256": dict(canonical_pins),
        "futureTask": TASKS["fit"], "futureAssignmentVersion": VERSIONS["fit"][0], "action": "fit",
        "model": MODEL, "revision": REVISION, "modelWeightsSha256": WEIGHTS_SHA,
        "runtimeProfileSha256": RUNTIME_SHA, "modelProfileSha256": MODEL_PROFILE_SHA,
        "publicationSha256": PUBLICATION_SHA, "inputArtifactSha256": dict(PAYLOAD_PINS),
        "settings": FIT, "numerics": NUMERICS, "inferenceSettings": SETTINGS,
        "representation": representation_metadata(), "trainingPlan": training_plan(),
        "memoryExecutionPolicy": memory_policy(), "attentionControlBeforeFit": ATTENTION_CONTROL,
        "lossImplementation": LOSS_POLICY, "phaseInputNames": input_names("fit"),
        "unresolved": "Independent reviewed final clean execution HEAD, positive assignment and exact stage/profile/freeze. Native token/loss/gradient/fit/save/reload remain unrun."}


def auxiliary_pins(action):
    require(action == "fit", "rank_fit_only")
    return dict(AUXILIARY)


def input_names(action):
    require(action == "fit", "rank_fit_only")
    return {"schema": "schema-v1.json", "family_freeze": "family-freeze.json", "model_receipt": "model-acquisition.json",
            "assignment": "assignment.json", "teacher_v1": DATA_NAME, "training_data": DATA_NAME}


def checked_execution(value, action):
    require(action == "fit" and type(value) is dict and value.get("version") == VERSIONS["fit"][0]
            and value.get("task") == TASKS["fit"] and value.get("action") == action, "separate_rank_fit_assignment_required")
    expected = {"model": MODEL, "revision": REVISION, "modelWeightsSha256": WEIGHTS_SHA,
        "runtimeProfileSha256": RUNTIME_SHA, "modelProfileSha256": MODEL_PROFILE_SHA,
        "publicationSha256": PUBLICATION_SHA, "inputArtifactSha256": PAYLOAD_PINS,
        "settings": FIT, "numerics": NUMERICS, "inferenceSettings": SETTINGS,
        "representation": representation_metadata(), "trainingPlan": training_plan(),
        "memoryExecutionPolicy": memory_policy(), "attentionControlBeforeFit": ATTENTION_CONTROL,
        "lossImplementation": LOSS_POLICY}
    require(set(value) == {*expected, "version", "task", "action", "executable", "executionAllowance", "studentCodeCommit",
                           "runtimeCodeCanonicalLfSha256"}, "rank_fit_mixed_or_unknown_fields")
    require(value["executable"] is True and same(value["executionAllowance"], allowance(action)), "rank_fit_execution_disabled")
    require(all(same(value[k], v) for k, v in expected.items()), "rank_fit_recipe_or_data_drift")
    require(type(value["studentCodeCommit"]) is str and re.fullmatch(r"[0-9a-f]{40}", value["studentCodeCommit"]), "rank_fit_final_head_required")
    pins = value["runtimeCodeCanonicalLfSha256"]
    require(type(pins) is dict and set(pins) == set(SOURCE_PATHS)
            and all(type(v) is str and re.fullmatch(r"[0-9a-f]{64}", v) for v in pins.values())
            and all(pins[k] == v for k, v in PROTECTED_PINS.items()), "rank_fit_source_set_drift")
    return training_plan()


def checked_payload(values):
    require(set(values) == set(PAYLOAD_PINS), "rank_fit_payload_set_drift")
    for name, pin in PAYLOAD_PINS.items():
        require(sha(values[name]) == pin, "rank_fit_payload_pin_drift:" + name)
    publication = strict_json(values["publication.json"])
    require(publication["counts"] == COUNTS and publication["policySha256"] == codec.canonical_sha(rank.POLICY)
            and strict_json(values["counts.json"]) == COUNTS and same(strict_json(values["policy.json"]), rank.metadata())
            and values["system-prompt.txt"] == SYSTEM_PROMPT.encode(), "rank_fit_publication_policy_drift")
    for name in set(values) - {"publication.json", "model-acquisition.json"}:
        published = "inputs/" + name if name in {"schema-v1.json", "family-freeze.json", "fragment-schema-v1.json"} else name
        require(publication["files"][published]["sha256"] == PAYLOAD_PINS[name], "rank_fit_publication_binding_drift")
    schema = codec.checked_schema(values["fragment-schema-v1.json"])
    contract, family = strict_json(values["schema-v1.json"]), strict_json(values["family-freeze.json"])
    model = strict_json(values["model-acquisition.json"])
    require(model["model"] == MODEL and model["revision"] == REVISION
            and {r["file"]: r["sha256"] for r in model["files"]}["model.safetensors"] == WEIGHTS_SHA, "rank_fit_original_model_drift")
    pairs = [strict_json(line) for line in values[DATA_NAME].splitlines()]
    inputs = [strict_json(line) for line in values["scoring-inputs.jsonl"].splitlines()]
    lineage = strict_json(values["lineage.json"])["parents"]
    require(len(pairs) == len(inputs) == 57 and [p["exampleId"] for p in lineage] == list(PARENT_COUNTS), "rank_fit_parent_or_pair_count_drift")
    rows, offset, positives = [], 0, 0
    for index, parent in enumerate(lineage):
        count = PARENT_COUNTS[parent["exampleId"]]
        require(parent["parentIndex"] == index and parent["candidateCount"] == count and parent["split"] == "train",
                "rank_fit_parent_identity_drift")
        candidates = []
        for candidate_index in range(count):
            pair, item = pairs[offset], inputs[offset]
            source = rank.scoring_input(item["context"], f"c{candidate_index}", schema, contract, family)
            current = item["context"]["candidates"][candidate_index]
            require(same(strict_json(source.input_json), item) and source.sha256 == pair["scoringInputSha256"]
                    and pair["parentIndex"] == index and pair["parentExampleId"] == parent["exampleId"]
                    and pair["candidateIndex"] == candidate_index and pair["focusCandidateId"] == current["id"]
                    and pair["contextSha256"] == item["candidateSetSha256"] == parent["contextSha256"]
                    and pair["candidateSha256"] == codec.canonical_sha(current)
                    and pair["fragmentSha256"] == codec.canonical_sha(current["fragment"])
                    and pair["parentLineageSha256"] == codec.canonical_sha(parent)
                    and pair["originalTargetSha256"] == parent["targetSha256"] == codec.canonical_sha(parent["target"])
                    and pair["rawParentRowSha256"] == parent["rawParentRowSha256"]
                    and pair["canonicalParentRowSha256"] == parent["canonicalParentRowSha256"]
                    and pair["requestUtf8Sha256"] == parent["requestUtf8Sha256"] == sha(item["context"]["request"].encode()),
                    "rank_fit_pair_lineage_or_order_drift")
            require(pair["version"] == "association-fragment-rank-training-pair/1" and type(pair["label"]) is int
                    and pair["label"] in (0, 1) and pair["targetText"] == str(pair["label"])
                    and pair["label"] == int(current["id"] in parent["target"]["selected"])
                    and pair["weight"] == {"numerator": 1, "denominator": 10 * count}
                    and pair["policySha256"] == codec.canonical_sha(rank.POLICY) and pair["split"] == "train"
                    and pair["familyId"] == parent["familyId"] == item["context"]["familyId"]
                    and pair["supervisionState"] == "provisional_synthetic_supervision"
                    and pair["reviewState"] == "needs_independent_review" and pair["sarvamDerived"] is False,
                    "rank_fit_label_weight_or_split_drift")
            candidates.append({"pair": pair, "scoringInput": item})
            positives += pair["label"]
            offset += 1
        rows.append({"exampleId": parent["exampleId"], "parentIndex": index,
                     "parentLineageSha256": codec.canonical_sha(parent), "candidates": candidates})
    require(positives == 12 and sum(not any(c["pair"]["label"] for c in r["candidates"]) for r in rows) == 3
            and {p["familyId"] for p in pairs} == {"in-haryana-rera-2831", "in-bihar-magnolia-residency"}, "rank_fit_counts_drift")
    return schema, contract, family, rows


def stage_sources(assignment_path, assignment_bytes, baseline, runtime):
    checked_execution(strict_json(assignment_bytes), "fit")
    sources = {}
    for name, pin in PAYLOAD_PINS.items():
        if name == "model-acquisition.json":
            path = baseline / "inputs" / name
        elif name in {"schema-v1.json", "family-freeze.json", "fragment-schema-v1.json"}:
            path = PUBLICATION_ROOT / "inputs" / name
        else:
            path = PUBLICATION_ROOT / name
        sources[name] = (path, pin)
    checked_payload({name: path.read_bytes() for name, (path, _) in sources.items()})
    return {**sources, "assignment.json": (Path(assignment_path), sha(assignment_bytes)),
            "runtime-requirements-resolved.txt": (runtime / "inputs/runtime-requirements-resolved.txt", REQUIREMENTS_SHA)}


def make_freeze(assignment, assignment_bytes, physical_pins):
    checked_execution(assignment, "fit")
    require(same(strict_json(assignment_bytes), assignment) and set(physical_pins) == set(SOURCE_PATHS)
            and all(type(v) is str and re.fullmatch(r"[a-f0-9]{64}", v) for v in physical_pins.values()), "rank_fit_freeze_binding_drift")
    return {"version": VERSIONS["fit"][1], "action": "fit", "sourceCommit": assignment["studentCodeCommit"],
        "sourcePhysicalSha256": dict(physical_pins), "fitSettings": FIT, "numerics": NUMERICS, "inferenceSettings": SETTINGS,
        "memoryExecutionPolicy": memory_policy(), "lossImplementation": LOSS_POLICY,
        "reclamationImplementation": legacy.RECLAMATION_POLICY, "attentionImplementation": legacy.ATTENTION_POLICY,
        "systemPromptSha256": rank.PROMPT_SHA, "representation": representation_metadata(), "trainingPlan": training_plan(),
        "runtimeParentProfileSha256": RUNTIME_SHA, "modelParentProfileSha256": MODEL_PROFILE_SHA,
        "inputSha256": {**COMMON_PINS, "assignment": sha(assignment_bytes), "teacher_v1": DATA_SHA, "training_data": DATA_SHA},
        "auxiliaryInputSha256": AUXILIARY, "developmentInputsPresent": False, "trainingInputsPresent": True,
        "hostTargetsPresent": False, "evaluationAllowed": False, "promotionAuthorized": False}


def checked_freeze(freeze, assignment):
    checked_execution(assignment, "fit")
    expected = make_freeze(assignment, serialized(assignment), freeze.get("sourcePhysicalSha256", {}))
    expected["inputSha256"]["assignment"] = freeze.get("inputSha256", {}).get("assignment")
    require(type(expected["inputSha256"]["assignment"]) is str and re.fullmatch(r"[a-f0-9]{64}", expected["inputSha256"]["assignment"])
            and same(freeze, expected), "rank_fit_freeze_drift")
    return training_plan()


def checked_inputs(freeze, assignment, inputs, *, source_root=None):
    checked_freeze(freeze, assignment)
    inputs = Path(inputs)
    require({p.name for p in inputs.iterdir()} == {*PAYLOAD_PINS, "assignment.json", "runtime-requirements-resolved.txt", "run-freeze.json"},
            "rank_fit_unexpected_input")
    require(sha((inputs / "assignment.json").read_bytes()) == freeze["inputSha256"]["assignment"]
            and same(strict_json((inputs / "assignment.json").read_bytes()), assignment)
            and same(strict_json((inputs / "run-freeze.json").read_bytes()), freeze)
            and sha((inputs / "runtime-requirements-resolved.txt").read_bytes()) == REQUIREMENTS_SHA, "rank_fit_input_authority_drift")
    source_root = Path(__file__).resolve().parents[5] if source_root is None else Path(source_root)
    for name, pin in freeze["sourcePhysicalSha256"].items():
        raw = (source_root / name).read_bytes()
        require(sha(raw) == pin and sha(raw.replace(b"\r\n", b"\n")) == assignment["runtimeCodeCanonicalLfSha256"][name],
                "rank_fit_runtime_source_drift:" + name)
    return checked_payload({name: (inputs / name).read_bytes() for name in PAYLOAD_PINS})


def checked_cli(args, freeze):
    require(args.action == freeze["action"] == "fit" and args.adapter_dir is None, "rank_fit_cli_phase_drift")
    for key, name in input_names("fit").items():
        require(getattr(args, key) == args.run_freeze.parent / name, "rank_fit_cli_input_alias_drift")
    require(all(getattr(args, key) is None for key in ("input_batch", "adapter_manifest", "fit_proof")), "rank_fit_mixed_cli_inputs")


class RankRepresentation:
    is_rank_fit = True
    system_prompt = SYSTEM_PROMPT
    training_plan = property(lambda self: training_plan())
    metadata = property(lambda self: representation_metadata())

    def __init__(self, rows):
        self.rows = tuple(codec.canonical(r) for r in rows)

    def validate_row(self, row):
        index = row.get("parentIndex")
        require(type(index) is int and 0 <= index < 10 and codec.canonical(row) == self.rows[index], "rank_fit_parent_wrapper_drift")

    def messages(self, candidate):
        # Only the already verified source-only scoring structure enters chat.
        return rank.ScoringInput(codec.canonical(candidate["scoringInput"])).messages()


def admit_fit(authority, rows, contract, family):
    require(type(authority) is dict and set(authority) == {"freeze", "assignment", "inputs"}, "rank_fit_loader_authority_required")
    _, expected_contract, expected_family, expected_rows = checked_inputs(authority["freeze"], authority["assignment"], authority["inputs"])
    require(same(rows, expected_rows) and same(contract, expected_contract) and same(family, expected_family), "rank_fit_loader_payload_drift")
    return RankRepresentation(expected_rows)
