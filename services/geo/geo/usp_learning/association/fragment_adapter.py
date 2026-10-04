"""Exact requested-fragment SFT admission; reuse the existing fit and reload."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import re
import sys

from . import fragment_selection as codec
from .adapter import FIT, NUMERICS, digest_file
from .student import SETTINGS
from .fragment_baseline import ARTIFACT_PINS, CASES, MODEL, REVISION, WEIGHTS_SHA
from .chunked_loss import LOSS_POLICY
from .reclamation import RECLAMATION_POLICY
from .query_attention import ATTENTION_POLICY, ATTENTION_CONTROL
from .validation import require, strict_json

IS_FRAGMENT = True
SYSTEM_PROMPT = codec.SYSTEM_PROMPT
DATA_SHA = "32c7fc4071754431f87756d0ebd121539a5357187ef0efb139083f5b86e4d742"
RUNTIME_SHA = "a09ee7907b8dc207b01712d84ec33245218773f479cf91301957ee76b32ae503"
MODEL_PROFILE_SHA = "86b0f0b19d4e740f2e6e38f7eea8eaccd24b7b3072883f8b7d22421c39b8ef75"
REQUIREMENTS_SHA = "c27e534e121858d96dfa531e14374642a43bed9544aeef0426b39353280ab4e3"
VERSIONS = {a: (f"association-fragment-{a}-assignment/1", f"association-fragment-{a}-freeze/1") for a in ("fit", "reload")}
TASKS = {"fit": "STUDENT-19-FRAGMENT-FIT", "reload": "STUDENT-20-FRAGMENT-RELOAD"}
COMMON_PINS = {"schema": "b3a3a64f403d7a5ee0a2ea6ed22c5d418b9af089f75fd9aca8aa0f9a00ab09af",
    "family_freeze": codec.FAMILY_SHA,
    "model_receipt": "4fe6c79e0f4f93fc1552482b9b3e77143492c0bb7f4b9b4f7b84b8c30e9c3ff2"}
BATCH_SHA = "a89a7eaa4917a398b78ac0457eb7fa55223fd877b12306f03ca7801939f4e536"
ROW_PINS = {
    "teacher-fragments-v1-01": "ea18d8f5ffef404a3483280b4fd00890be9b4e389d7924a7337ffbf153d7b8aa",
    "teacher-fragments-v1-02": "e5e4a88e3daf29347512061cc84cad2c8719b0616c45116f6bfc5c9bed3fabe2",
    "teacher-fragments-v1-03": "bb68a39dc9f583e2000ade279c2b122c74a9717fa02626e2a3f137591a843c16",
    "teacher-fragments-v1-04": "58e9a084af6903def56e7e8bf94334032c0e8a5b8a3d0773fa17c59ef7f2a4a8",
    "teacher-fragments-v1-05": "9046d1b77eb19c966b05f7fd0b25d772c5afd210c2a31c7d5367ae868b5cffe3",
    "teacher-fragments-v1-06": "e54926ddadc30a9481ddfb1598e1d954184dbe828c46a65739f556c417bf69c3"}
# Filled from the accepted base's complete transitive source set. New/owned
# hooks are instead bound to the separately approved future execution HEAD.
PROTECTED_PINS = {
    "scripts/usp/learning/association/association_student.py": "63fa1104dd274b63dac1f66d38243995fc195c4bf86f42054b9e3f3185e818db",
    "scripts/usp/learning/association/stage_baseline.py": "926b01c8c85aae962b1699c0e35a07c144993da2846b1016608a350bd1bb2b93",
    "scripts/usp/learning/association/stage_selector_baseline.py": "36bf1c9483c6cfe33f62ecd3520baa18ef60c2fda00aee905354d0e8eec7228a",
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
    "services/geo/geo/usp_learning/association/fragment_baseline.py": "63c923ed5d32593388852aa2e8b7fe6eb96682796295881c5a634c9fc08a778d",
    "services/geo/geo/usp_learning/association/fragment_selection.py": "aa8be20c61fe94eb0c19e5e4c611a1378e7201ec11fbaca605c06bd349af88a0",
    "services/geo/geo/usp_learning/association/memory_observation.py": "ca17af790211021a8ccf7374ae16cc4d714d55f05145f1bd541655d2cf6d143d",
    "services/geo/geo/usp_learning/association/native_candidates.py": "17ce40d8ccb6852edb12986c0ae7a73da7db198f750aa6ed433d28229ac7e1df",
    "services/geo/geo/usp_learning/association/query_attention.py": "715c322f6e4a5383fa42a002292010d6e235f3b5afedb05274f7cb088fb04cec",
    "services/geo/geo/usp_learning/association/reclamation.py": "c1c301bc10f3c59848b2c7e66ed2fa387ad97f500bd948d12f53f7760db00d27",
    "services/geo/geo/usp_learning/association/selector_adapter.py": "c83bc6552691f2eebb592881cd16e15f19df29cf88cab4aac87edbd87876003d",
    "services/geo/geo/usp_learning/association/selector_baseline.py": "7d453d9ddb795f27d17dc8096c0ed9606bb48283e2fa5a61ff03f5c5d3a2cd5d",
    "services/geo/geo/usp_learning/association/selector_constraints.py": "5099dd66c7df12e8799fd4bf65515855e45068c278274c814e80f0ba34fd7064",
    "services/geo/geo/usp_learning/association/selectors.py": "dcb83b6352c8c5972607c616866b11f91767235052cbac8b9606215b80b6863e",
    "services/geo/geo/usp_learning/association/validation.py": "68ebee3f5ca0b6273862003b17db73dcd25495d1623732917467d12ff9ea18c2",
    "services/geo/geo/usp_learning/resources.py": "c46095c1a537208ececcf3b9e8c791fea05020dc73b74e74c350412c66bf9f54"
}
MUTABLE_SOURCES = (
    "scripts/usp/learning/association/association_adapter.py",
    "scripts/usp/learning/association/stage_adapter.py",
    "scripts/usp/learning/association/stage_fragment_adapter.py",
    "services/geo/geo/usp_learning/association/adapter.py",
    "services/geo/geo/usp_learning/association/student.py",
    "services/geo/geo/usp_learning/association/fragment_adapter.py")
SOURCE_PATHS = tuple(sorted((*PROTECTED_PINS, *MUTABLE_SOURCES)))
ACCEPTED_FIT_KEYS = {"root", "sourceCommit", "profileSha256", "guardSha256", "adapterManifestSha256",
    "fitResultSha256", "adapterWeightsSha256", "fitFreezeSha256", "fitAssignmentSha256",
    "acceptedReceiptSha256", "fitProofSha256"}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def same(a, b):
    return codec.canonical(a) == codec.canonical(b)


def serialized(value):
    """Exact bytes emitted by the existing isolation.write helper."""
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n").encode()


def training_plan():
    return {"version": "association-training-plan/1", "datasetSha256": DATA_SHA,
            "teacherExamples": 6, "epochs": FIT["epochs"], "plannedUpdates": 36}


def representation_metadata():
    return {"version": "association-fragment-training/1", "datasetSha256": DATA_SHA,
            "fragment": codec.metadata(), "trainingPlan": training_plan(),
            "target": "unchanged canonical fragment selection JSON plus EOS; assistant-only loss",
            "teacherSupervision": "provisional_synthetic_supervision", "reviewState": "needs_independent_review"}


def memory_policy():
    return {"headChunkTokens": 64, "interUpdateReclamation": True, "preBackwardReclamation": True,
            "queryChunkedAttention": copy.deepcopy(ATTENTION_POLICY)}


def checked_row(row, schema, contract, family, *, row_pins=None):
    row_pins = ROW_PINS if row_pins is None else row_pins
    require(type(row) is dict and set(row) == {"context", "input", "output", "supervision"}, "fragment_training_row_fields")
    context = row["context"]
    require(sha(codec.canonical(row).encode()) == row_pins.get(context.get("exampleId")), "fragment_training_row_pin_drift")
    source_input = codec.checked_context(context, schema, contract, family, ("train",))
    source = codec.Context(codec.canonical(context))
    require(same(row["input"], source.model_input()), "fragment_training_model_input_drift")
    supervision = row["supervision"]
    require(supervision["split"] == "train" and supervision["state"] == "provisional_synthetic_supervision"
            and supervision["reviewState"] == "needs_independent_review" and supervision["sarvamDerived"] is False
            and supervision["systemPromptSha256"] == codec.PROMPT_SHA, "fragment_training_supervision_drift")
    checked = codec.project(codec.canonical(row["output"]), source, schema, contract, family, ("train",))
    require(checked["modelOutputValid"] and not checked["repairApplied"], "fragment_training_target_rejected")
    # Technical identity wrapper, with the entire unchanged teacher row retained.
    # No invented legacy claims/abstentions and no legacy output validator.
    return {"input": source_input, "fragmentTrainingRow": copy.deepcopy(row)}


def checked_teacher(data, schema, contract, family):
    require(len(data) == 82626 and sha(data) == DATA_SHA, "fragment_training_dataset_pin_drift")
    originals = [strict_json(line) for line in data.splitlines()]
    require([r["context"]["exampleId"] for r in originals] == list(ROW_PINS), "fragment_training_order_or_count_drift")
    rows = [checked_row(row, schema, contract, family) for row in originals]
    counts = {"rows": len(rows), "candidateAppearances": sum(len(r["context"]["candidates"]) for r in originals),
              "selectedAppearances": sum(len(r["output"]["selected"]) for r in originals)}
    require(counts == {"rows": 6, "candidateAppearances": 35, "selectedAppearances": 10}, "fragment_training_counts_drift")
    return rows, {"representation": representation_metadata(), "trainingPlan": training_plan(), "counts": counts,
                  "originalRowsAndSupervisionUnchanged": True, "trainFamiliesOnly": True, "sarvamDerived": False}


class FragmentRepresentation:
    system_prompt = SYSTEM_PROMPT

    def __init__(self, schema, contract, family, *, authority=None):
        self.authority = sys.modules[__name__] if authority is None else authority
        self.schema, self.contract, self.family = schema, contract, family

    @property
    def training_plan(self):
        return self.authority.training_plan()

    @property
    def metadata(self):
        return self.authority.representation_metadata()

    def validate_row(self, row):
        require(same(row, self.authority.checked_row(row["fragmentTrainingRow"], self.schema, self.contract, self.family)),
                "fragment_training_wrapper_drift")

    def messages(self, row):
        self.validate_row(row)
        return codec.Context(codec.canonical(row["fragmentTrainingRow"]["context"])).messages()

    def target(self, row):
        self.validate_row(row)
        return codec.canonical(row["fragmentTrainingRow"]["output"])


def allowance(action, enabled=True):
    return {"stageModelRun": enabled, "loadModel": enabled, "fit": enabled and action == "fit",
            "inference": enabled and action == "reload", "evaluation": False, "promotion": False,
            "freshPhases": 1 if enabled else 0}


def auxiliary_pins(action):
    return dict(ARTIFACT_PINS) if action == "reload" else {
        name: ARTIFACT_PINS[name] for name in ("fragment-schema-v1.json", "fragment-prompt.txt")}


def input_names(action):
    common = {"schema": "schema-v1.json", "family_freeze": "family-freeze.json",
              "model_receipt": "model-acquisition.json", "assignment": "assignment.json"}
    # The guard's required historical option is an alias of the same new data.
    return {**common, **({"teacher_v1": "train-teacher-fragments-v1.jsonl", "training_data": "train-teacher-fragments-v1.jsonl"}
        if action == "fit" else {"input_batch": "development.json", "adapter_manifest": "adapter-manifest.json", "fit_proof": "fit-proof.json"})}


def checked_execution(assignment, action, *, _authority=None):
    authority = sys.modules[__name__] if _authority is None else _authority
    require(action in authority.VERSIONS and assignment.get("version") == authority.VERSIONS[action][0]
            and assignment.get("task") == authority.TASKS[action] and assignment.get("action") == action,
            "separate_fragment_adapter_execution_required")
    keys = {"version", "task", "action", "executable", "executionAllowance", "studentCodeCommit", "model", "revision",
            "modelWeightsSha256", "runtimeProfileSha256", "modelProfileSha256", "settings", "numerics", "inferenceSettings",
            "representation", "trainingPlan", "memoryExecutionPolicy", "attentionControlBeforeFit", "runtimeCodeCanonicalLfSha256"}
    if action == "reload":
        keys |= {"acceptedFit", "cases"}
    require(set(assignment) == keys, "fragment_adapter_mixed_or_unknown_fields")
    require(assignment["executable"] is True and same(assignment["executionAllowance"], allowance(action)), "fragment_adapter_execution_disabled")
    expected = {"model": MODEL, "revision": REVISION, "modelWeightsSha256": WEIGHTS_SHA,
        "runtimeProfileSha256": RUNTIME_SHA, "modelProfileSha256": MODEL_PROFILE_SHA, "settings": FIT, "numerics": NUMERICS,
        "inferenceSettings": SETTINGS, "representation": authority.representation_metadata(), "trainingPlan": authority.training_plan(),
        "memoryExecutionPolicy": memory_policy(), "attentionControlBeforeFit": ATTENTION_CONTROL}
    require(all(same(assignment[k], v) for k, v in expected.items()), "fragment_adapter_recipe_drift")
    require(isinstance(assignment["studentCodeCommit"], str) and re.fullmatch(r"[a-f0-9]{40}", assignment["studentCodeCommit"]),
            "fragment_adapter_final_head_required")
    pins = assignment["runtimeCodeCanonicalLfSha256"]
    require(type(pins) is dict and set(pins) == set(authority.SOURCE_PATHS)
            and all(isinstance(v, str) and re.fullmatch(r"[a-f0-9]{64}", v) for v in pins.values())
            and all(pins[p] == v for p, v in authority.PROTECTED_PINS.items()), "fragment_adapter_source_pin_set_drift")
    if action == "reload":
        accepted = assignment["acceptedFit"]
        require(type(accepted) is dict and set(accepted) == ACCEPTED_FIT_KEYS
                and isinstance(accepted["root"], str) and Path(accepted["root"]).is_absolute()
                and isinstance(accepted["sourceCommit"], str) and re.fullmatch(r"[a-f0-9]{40}", accepted["sourceCommit"])
                and all(isinstance(v, str) and re.fullmatch(r"[a-f0-9]{64}", v)
                        for k, v in accepted.items() if k not in ("root", "sourceCommit"))
                and same(assignment["cases"], CASES), "fragment_reload_accepted_fit_required")
    return authority.training_plan()


def make_freeze(assignment, assignment_bytes, physical_pins, *, _authority=None):
    authority = sys.modules[__name__] if _authority is None else _authority
    action = assignment.get("action")
    authority.checked_execution(assignment, action)
    require(same(strict_json(assignment_bytes), assignment) and set(physical_pins) == set(authority.SOURCE_PATHS)
            and all(isinstance(v, str) and re.fullmatch(r"[a-f0-9]{64}", v) for v in physical_pins.values()), "fragment_freeze_bindings_drift")
    inputs = {**COMMON_PINS, "assignment": sha(assignment_bytes)}
    if action == "fit":
        inputs.update(teacher_v1=authority.DATA_SHA, training_data=authority.DATA_SHA)
    else:
        inputs.update(input_batch=BATCH_SHA, adapter_manifest=assignment["acceptedFit"]["adapterManifestSha256"],
                      fit_proof=assignment["acceptedFit"]["fitProofSha256"])
    result = {"version": authority.VERSIONS[action][1], "action": action, "sourceCommit": assignment["studentCodeCommit"],
        "sourcePhysicalSha256": physical_pins, "fitSettings": FIT, "numerics": NUMERICS, "inferenceSettings": SETTINGS,
        "memoryExecutionPolicy": memory_policy(), "lossImplementation": LOSS_POLICY,
        "reclamationImplementation": RECLAMATION_POLICY, "attentionImplementation": ATTENTION_POLICY,
        "systemPromptSha256": codec.PROMPT_SHA, "representation": authority.representation_metadata(), "trainingPlan": authority.training_plan(),
        "runtimeParentProfileSha256": RUNTIME_SHA, "modelParentProfileSha256": MODEL_PROFILE_SHA,
        "inputSha256": inputs, "auxiliaryInputSha256": authority.auxiliary_pins(action), "evaluationAllowed": False,
        "developmentInputsPresent": action == "reload", "trainingInputsPresent": action == "fit",
        "hostTargetsPresent": False, "promotionAuthorized": False}
    if action == "reload":
        result.update(acceptedFit=assignment["acceptedFit"], cases=CASES)
    return result


def checked_freeze(freeze, assignment, *, _authority=None):
    authority = sys.modules[__name__] if _authority is None else _authority
    plan = authority.checked_execution(assignment, freeze.get("action"))
    # Assignment physical bytes are separately checked by checked_inputs/CLI.
    expected = authority.make_freeze(assignment, codec.canonical(assignment).encode(), freeze.get("sourcePhysicalSha256", {}))
    expected["inputSha256"]["assignment"] = freeze.get("inputSha256", {}).get("assignment")
    require(isinstance(expected["inputSha256"]["assignment"], str)
            and re.fullmatch(r"[a-f0-9]{64}", expected["inputSha256"]["assignment"])
            and same(freeze, expected), "fragment_adapter_freeze_drift")
    return plan


def checked_inputs(freeze, assignment, inputs, *, source_root=None, _authority=None):
    authority = sys.modules[__name__] if _authority is None else _authority
    authority.checked_freeze(freeze, assignment)
    inputs = Path(inputs)
    action = freeze["action"]
    names = authority.input_names(action)
    expected_names = {*names.values(), *authority.auxiliary_pins(action), "run-freeze.json", "runtime-requirements-resolved.txt"}
    if action == "reload":
        expected_names.add("adapter")
    require({p.name for p in inputs.iterdir()} == expected_names, "fragment_adapter_unexpected_input")
    for key, name in names.items():
        require(digest_file(inputs / name) == freeze["inputSha256"][key], "fragment_adapter_input_pin_drift:" + key)
    require(same(strict_json((inputs / "assignment.json").read_bytes()), assignment), "fragment_adapter_assignment_drift")
    require(same(strict_json((inputs / "run-freeze.json").read_bytes()), freeze), "fragment_adapter_freeze_file_drift")
    require(digest_file(inputs / "runtime-requirements-resolved.txt") == REQUIREMENTS_SHA, "fragment_runtime_requirements_drift")
    for name, digest in authority.auxiliary_pins(action).items():
        require(digest_file(inputs / name) == digest, "fragment_adapter_auxiliary_pin_drift:" + name)
    source_root = Path(__file__).resolve().parents[5] if source_root is None else Path(source_root)
    for name, digest in freeze["sourcePhysicalSha256"].items():
        raw = (source_root / name).read_bytes()
        require(sha(raw) == digest and sha(raw.replace(b"\r\n", b"\n")) == assignment["runtimeCodeCanonicalLfSha256"][name],
                "fragment_adapter_runtime_source_drift:" + name)
    schema = codec.checked_schema((inputs / "fragment-schema-v1.json").read_bytes())
    contract, family = (strict_json((inputs / names[k]).read_bytes()) for k in ("schema", "family_freeze"))
    receipt = strict_json((inputs / names["model_receipt"]).read_bytes())
    require(receipt["model"] == MODEL and receipt["revision"] == REVISION
            and {r["file"]: r["sha256"] for r in receipt["files"]}["model.safetensors"] == WEIGHTS_SHA, "fragment_adapter_model_drift")
    if action == "fit":
        authority.checked_teacher((inputs / names["training_data"]).read_bytes(), schema, contract, family)
    else:
        checked_development(inputs, schema, contract, family)
        manifest = strict_json((inputs / "adapter-manifest.json").read_bytes())
        proof = strict_json((inputs / "fit-proof.json").read_bytes())
        authority.checked_reload_binding(freeze, proof, manifest)
        from .adapter import verify_adapter_files
        verify_adapter_files(inputs / "adapter", manifest)
    return schema


def checked_cli(args, freeze, *, _authority=None):
    authority = sys.modules[__name__] if _authority is None else _authority
    inputs = args.run_freeze.parent
    require(args.action == freeze["action"], "fragment_cli_action_drift")
    names = authority.input_names(args.action)
    for key, name in names.items():
        require(getattr(args, key) == inputs / name, "fragment_cli_input_alias_drift:" + key)
    for key in {"teacher_v1", "training_data", "input_batch", "adapter_manifest", "fit_proof"} - set(names):
        require(getattr(args, key) is None, "fragment_cli_mixed_phase_input")
    require(args.adapter_dir == (inputs / "adapter" if args.action == "reload" else None), "fragment_cli_adapter_scope_drift")


def checked_development(inputs, schema, contract, family):
    batch = strict_json((inputs / "development.json").read_bytes())
    route = strict_json((inputs / "fragment-route.json").read_bytes())
    sources = codec.checked_route(route, batch["examples"], schema, contract, family, ("development",))
    require([s.input_sha256 for s in sources] == [c["contextSha256"] for c in CASES], "fragment_reload_context_drift")
    return route


def checked_fit_metadata(preflight, result, manifest, rows, representation):
    require(all(same(value.get("representation"), representation.metadata) for value in (preflight, result, manifest))
            and preflight["systemPromptSha256"] == codec.PROMPT_SHA, "fragment_fit_representation_drift")
    require([r["exampleId"] for r in preflight["lengths"]] == [r["input"]["exampleId"] for r in rows]
            and [r["targetSha256"] for r in preflight["lengths"]] == [sha(representation.target(r).encode()) for r in rows],
            "fragment_fit_tokenized_target_drift")


def proof_metadata(root, freeze, *, _authority=None):
    authority = sys.modules[__name__] if _authority is None else _authority
    return {"representation": authority.representation_metadata(), "sourceCommit": freeze["sourceCommit"],
        "fitFreezeSha256": digest_file(root / "inputs/run-freeze.json"),
        "fitAssignmentSha256": digest_file(root / "inputs/assignment.json"),
        "acceptedReceiptSha256": digest_file(root / "receipts/association_adapter-fit-accepted.json")}


def checked_reload_binding(freeze, proof, manifest, *, _authority=None):
    authority = sys.modules[__name__] if _authority is None else _authority
    expected = freeze["acceptedFit"]
    require(same(proof.get("representation"), authority.representation_metadata())
            and same(manifest.get("representation"), authority.representation_metadata())
            and Path(proof["fitRoot"]) == Path(expected["root"])
            and all(proof[k] == expected[k] for k in ACCEPTED_FIT_KEYS - {"root", "adapterWeightsSha256", "fitProofSha256"})
            and sha(serialized(proof)) == expected["fitProofSha256"]
            and manifest["files"]["adapter_model.safetensors"] == expected["adapterWeightsSha256"], "fragment_reload_fit_binding_drift")
    from .citation_view import checked_reload_counts
    checked_reload_counts(proof, manifest, authority.training_plan(), versioned=True)
    require(proof["fitResourceAccepted"] is True and manifest["tensorCount"] == 96
            and manifest["savedStateMatchesTrainableAdapter"] is True
            and manifest["baseParametersBefore"] == manifest["baseParametersAfter"], "fragment_reload_saved_fit_proof_drift")


def checked_loader_authorization(value, route, *, _authority=None):
    authority = sys.modules[__name__] if _authority is None else _authority
    require(type(value) is dict and set(value) == {"freeze", "assignment"}, "fragment_reload_loader_authority_required")
    authority.checked_freeze(value["freeze"], value["assignment"])
    require(value["freeze"]["action"] == "reload" and [sha(codec.canonical(c["context"]).encode()) for c in route["contexts"]]
            == [c["contextSha256"] for c in CASES], "fragment_reload_loader_scope_drift")


def reload_runner(freeze, assignment, inputs, schema, preserve_preflight, *, _authority=None):
    authority = sys.modules[__name__] if _authority is None else _authority
    from functools import partial
    from .student import run_local
    authority.checked_freeze(freeze, assignment)
    require(freeze["action"] == "reload", "fragment_reload_runner_phase_drift")
    route = strict_json((Path(inputs) / "fragment-route.json").read_bytes())
    authorization = {"freeze": freeze, "assignment": assignment}
    authority.checked_loader_authorization(authorization, route)
    return partial(run_local, fragment_route=route, fragment_contract=schema,
                   preserve_preflight=preserve_preflight, fragment_adapter_reload=authorization)
