"""Independent 20-update phase authority and accepted full-state chain."""
from __future__ import annotations

import copy
import math
from pathlib import Path
import re

from . import fragment_rank_adapter as rank, fragment_rank_checkpoint as checkpoint
from .citation_view import epoch_orders
from .validation import require, strict_json

IS_FRAGMENT = IS_RANK_FIT = IS_RANK_PHASE = True
codec, sha, same, serialized = rank.codec, rank.sha, rank.same, rank.serialized
SYSTEM_PROMPT, MODEL, REVISION, WEIGHTS_SHA = rank.SYSTEM_PROMPT, rank.MODEL, rank.REVISION, rank.WEIGHTS_SHA
RUNTIME_SHA, MODEL_PROFILE_SHA, REQUIREMENTS_SHA = rank.RUNTIME_SHA, rank.MODEL_PROFILE_SHA, rank.REQUIREMENTS_SHA
COMMON_PINS, SETTINGS, FIT, NUMERICS, LOSS_POLICY = rank.COMMON_PINS, rank.SETTINGS, rank.FIT, rank.NUMERICS, rank.LOSS_POLICY
ATTENTION_CONTROL, DATA_SHA = rank.ATTENTION_CONTROL, rank.DATA_SHA
VERSIONS = {"fit": ("association-fragment-rank-phase-fit-assignment/1", "association-fragment-rank-phase-fit-freeze/1")}
TASK = "STUDENT-31-FRAGMENT-RANK-PHASE-FIT"
STAGE_PREFIX = "adapter-fragment-rank-phase-"
SOURCE_PATHS = tuple(sorted((set(rank.SOURCE_PATHS) - {"scripts/usp/learning/association/stage_fragment_rank.py"}) | {
    "services/geo/geo/usp_learning/association/fragment_rank_phase_adapter.py",
    "services/geo/geo/usp_learning/association/fragment_rank_checkpoint.py",
    "scripts/usp/learning/association/stage_fragment_rank_phase.py"}))
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
    "services/geo/geo/usp_learning/association/fragment_rank_adapter.py": "55b8f4d90bc33551fb9ae0776b62a60b4bbda7b69ef66956e79f6395a25669ab",
    "services/geo/geo/usp_learning/association/fragment_rank_fit.py": "b082400d907e1732d8d674870078e76df92780618763390437a23dc6dd2c847c",
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
BASE = {"tensorCount": 290, "sha256": "7c651c8be4013651138142820f0e895a170054851eb3edd6ed3fcd64027b0c44"}
CHECKPOINT_INPUTS = {name: "previous-" + name for name in checkpoint.FILES}

BALANCED_VERSIONS = {"fit": ("association-fragment-rank-balanced-phase-fit-assignment/1", "association-fragment-rank-balanced-phase-fit-freeze/1")}
BALANCED_TASK = "STUDENT-45-FRAGMENT-RANK-BALANCED-PHASE-FIT"
BALANCED_STAGE_PREFIX = "adapter-rank-b-"
BALANCED_SOURCE_PATHS = tuple(sorted((*SOURCE_PATHS, "services/geo/geo/usp_learning/association/fragment_rank_balance.py")))
# Separate current authority. Historical PROTECTED_PINS are preserved verbatim.
BALANCED_PROTECTED_PINS = {'scripts/usp/learning/association/association_student.py': 'e1d844d0bde0663714331df0da922bcc695a5e9855c27a58a9b3d2faea8aa140', 'scripts/usp/learning/association/stage_adapter.py': '4293ead8a761c5a7fbe8c9300e642e549bae5c0cc2dbe6d96fbe9d671f239fee', 'scripts/usp/learning/association/stage_baseline.py': '926b01c8c85aae962b1699c0e35a07c144993da2846b1016608a350bd1bb2b93', 'scripts/usp/learning/association/stage_fragment_adapter.py': '1ee5a84260d15d07d77dda02ab292bd474863999beb559a9c19b1d916471b776', 'scripts/usp/learning/association/stage_fragment_rank_reload.py': '81ade8c724cccb1d783d773c6c09e9a7298c13b8c4994bfcd01c03c4e6dffe52', 'scripts/usp/learning/association/stage_selector_baseline.py': '351a1417bacd7de54f76eb799e6635636227642ff4801e11920f22684403ee91', 'scripts/usp/learning/model_isolation.py': '69e51fd895697f224960226cdc1f99499d2b43d0b17ac76638e20cdfa8787676', 'scripts/usp/security/appcontainer_audit.py': '4a59a18e04cd6fe76590ba929f424271f3dacdfb19ccf5e65fc2ec8048fbdc7f', 'services/geo/geo/__init__.py': 'd10feb73a0713f7c1f57fd7982c1f2916448a1b634984a48646ff4e460b6ad09', 'services/geo/geo/native_ifc.py': 'f6e8e646987879b238fc91137d26f18c45775ecf6b9ffc312a3639f32a7fb661', 'services/geo/geo/usp_learning/__init__.py': '4b2c1e31b9af2699de2380323db9775e9fc96dd4fab0d6ed5b67b5eeec20a05a', 'services/geo/geo/usp_learning/association/__init__.py': 'bc1a6b2a7a5190bc971e518cce5557a01abf8611c95b2d5e9e463a5abd2c7679', 'services/geo/geo/usp_learning/association/candidate_baseline.py': '75b231cb665a0301f37568d1a5e4fe3d97385fc6875bf55d055cce6840d210d7', 'services/geo/geo/usp_learning/association/candidate_selection.py': 'c0475f9156f379cf9c3269e01892d1034699115655139930edfdea40a2b09785', 'services/geo/geo/usp_learning/association/chunked_loss.py': '828a30334bca366299d9b52c88d0968bdfde202bb0505f074e9e570566e3bda7', 'services/geo/geo/usp_learning/association/citation_view.py': '06d17f65230dfab966b1644d8ee75f8e0394615645c6bcc635a70f6d7ffc2cea', 'services/geo/geo/usp_learning/association/fragment_adapter.py': '071b171547017f942432105a32cb5303a175d6ec8243c6bf1dd7df1e49e39b4d', 'services/geo/geo/usp_learning/association/fragment_baseline.py': '63c923ed5d32593388852aa2e8b7fe6eb96682796295881c5a634c9fc08a778d', 'services/geo/geo/usp_learning/association/fragment_rank.py': '292b9922421b5140f80a615df0cf1f24840c33d9757e58a574d6a7bc46a1af20', 'services/geo/geo/usp_learning/association/fragment_rank_adapter.py': '55b8f4d90bc33551fb9ae0776b62a60b4bbda7b69ef66956e79f6395a25669ab', 'services/geo/geo/usp_learning/association/fragment_rank_baseline.py': '6f09cdb4ac8112d0831dc5206822637e0d0147f390f905643d875291a50ad1c4', 'services/geo/geo/usp_learning/association/fragment_rank_checkpoint.py': '162901af3fbef48d613fcf69bc4cde8fd55634f31346cd67e3bd8b7bdb0f6706', 'services/geo/geo/usp_learning/association/fragment_rank_reload.py': 'c4ef3046500a04c555cd429e6fca9978aa10cc1fb1f02c2e875ec9f5a8085257', 'services/geo/geo/usp_learning/association/fragment_rank_runtime.py': '376f1e3d075ecada452c5352199fbee278b09f961f372b50a436068794ca8598', 'services/geo/geo/usp_learning/association/fragment_selection.py': 'aa8be20c61fe94eb0c19e5e4c611a1378e7201ec11fbaca605c06bd349af88a0', 'services/geo/geo/usp_learning/association/memory_observation.py': 'ca17af790211021a8ccf7374ae16cc4d714d55f05145f1bd541655d2cf6d143d', 'services/geo/geo/usp_learning/association/native_candidates.py': '17ce40d8ccb6852edb12986c0ae7a73da7db198f750aa6ed433d28229ac7e1df', 'services/geo/geo/usp_learning/association/query_attention.py': '715c322f6e4a5383fa42a002292010d6e235f3b5afedb05274f7cb088fb04cec', 'services/geo/geo/usp_learning/association/reclamation.py': 'c1c301bc10f3c59848b2c7e66ed2fa387ad97f500bd948d12f53f7760db00d27', 'services/geo/geo/usp_learning/association/selector_baseline.py': '7d453d9ddb795f27d17dc8096c0ed9606bb48283e2fa5a61ff03f5c5d3a2cd5d', 'services/geo/geo/usp_learning/association/selector_constraints.py': '5099dd66c7df12e8799fd4bf65515855e45068c278274c814e80f0ba34fd7064', 'services/geo/geo/usp_learning/association/selectors.py': 'dcb83b6352c8c5972607c616866b11f91767235052cbac8b9606215b80b6863e', 'services/geo/geo/usp_learning/association/student.py': '8cfd44daedbd9c31616198cf31dcd6d76e68d426b5f4735dcb879b16aadf6bc8', 'services/geo/geo/usp_learning/association/validation.py': '68ebee3f5ca0b6273862003b17db73dcd25495d1623732917467d12ff9ea18c2', 'services/geo/geo/usp_learning/resources.py': 'c46095c1a537208ececcf3b9e8c791fea05020dc73b74e74c350412c66bf9f54'}


def _configuration(assignment=None):
    if assignment is None or assignment.get("version") != BALANCED_VERSIONS["fit"][0]:
        return {"versions": VERSIONS, "task": TASK, "sources": SOURCE_PATHS, "protected": PROTECTED_PINS,
                "prefix": STAGE_PREFIX, "plan": rank.training_plan(), "representation": rank.representation_metadata(),
                "loss": LOSS_POLICY, "fields": {}, "objective": None}
    from . import fragment_rank_balance as balance
    objective = balance.admit(assignment.get("objective"), assignment.get("objectiveSha256"))
    fields = balance.fields(objective)
    plan = {**rank.training_plan(), "version": "association-fragment-rank-balanced-training-plan/1",
            "weighting": "original rational times fixed class multiplier; no per-parent renormalization", **fields}
    representation = {**rank.representation_metadata(), "version": "association-fragment-rank-balanced-training/1",
                      "trainingPlan": plan, **fields}
    return {"versions": BALANCED_VERSIONS, "task": BALANCED_TASK, "sources": BALANCED_SOURCE_PATHS,
            "protected": BALANCED_PROTECTED_PINS, "prefix": BALANCED_STAGE_PREFIX, "plan": plan,
            "representation": representation, "loss": balance.loss_policy(LOSS_POLICY), "fields": fields, "objective": objective}


def balanced_metadata_assignment():
    """Constant metadata only; deliberately lacks every execution identity/allowance."""
    from . import fragment_rank_balance as balance
    return {"version": BALANCED_VERSIONS["fit"][0], **balance.fields(balance.admit(balance.record(), balance.OBJECTIVE_SHA256))}



def training_plan(assignment=None):
    return _configuration(assignment)["plan"]


def schedule():
    ids = list(rank.PARENT_COUNTS)
    return [{"update": e * 10 + j + 1, "epoch": e + 1, "exampleId": ids[index],
             "parentIndex": index, "candidates": rank.PARENT_COUNTS[ids[index]]}
            for e, order in enumerate(epoch_orders(training_plan())) for j, index in enumerate(order)]


def phase(value):
    require(type(value) is int and value in (1, 2, 3), "rank_phase_ordinal")
    return {"number": value, "startUpdate": (value - 1) * 20, "endUpdate": value * 20,
            "localUpdates": 20, "localContributions": 114, "final": value == 3}


def representation_metadata(assignment=None):
    return _configuration(assignment)["representation"]


def memory_policy():
    return rank.memory_policy()


def input_names(action):
    return rank.input_names(action)


def binding(assignment, number=None, previous_hash=None):
    config = _configuration(assignment)
    n = assignment["phase"]["number"] if number is None else number
    previous_hash = (None if assignment["previous"] is None else assignment["previous"]["checkpointFiles"]["manifest.json"]) if number is None else previous_hash
    return {"experimentId": assignment["experimentId"], "phase": phase(n), "previousCheckpointManifestSha256": previous_hash,
        "sourceCommit": assignment["studentCodeCommit"], "sourceCanonicalLfSha256": assignment["runtimeCodeCanonicalLfSha256"],
        "model": MODEL, "revision": REVISION, "weightsSha256": WEIGHTS_SHA, "base": BASE,
        "publicationSha256": rank.PUBLICATION_SHA, "inputPins": rank.PAYLOAD_PINS,
        "policySha256": codec.canonical_sha(rank.rank.POLICY), "promptSha256": rank.rank.PROMPT_SHA,
        "fit": FIT, "numerics": NUMERICS, "loss": config["loss"], "scheduleSha256": checkpoint.sha(checkpoint.canonical(schedule())), **config["fields"]}


def recipe(assignment=None):
    config = _configuration(assignment)
    return {"model": MODEL, "revision": REVISION, "modelWeightsSha256": WEIGHTS_SHA,
        "runtimeProfileSha256": RUNTIME_SHA, "modelProfileSha256": MODEL_PROFILE_SHA,
        "publicationSha256": rank.PUBLICATION_SHA, "inputArtifactSha256": rank.PAYLOAD_PINS,
        "settings": FIT, "numerics": NUMERICS, "inferenceSettings": SETTINGS,
        "representation": config["representation"], "trainingPlan": config["plan"],
        "memoryExecutionPolicy": memory_policy(), "attentionControlBeforeFit": ATTENTION_CONTROL,
        "lossImplementation": config["loss"], "checkpointSchema": checkpoint.schema(), "checkpointProof": checkpoint.PROOF_POLICY, **config["fields"]}


def digest(value):
    return type(value) is str and re.fullmatch(r"[a-f0-9]{64}", value)


def checked_execution(value, action, *, verified_root=None):
    config = _configuration(value)
    expected = recipe(value)
    checkpoint.exact(value, (*expected, "version", "task", "action", "executable", "executionAllowance", "studentCodeCommit",
                             "runtimeCodeCanonicalLfSha256", "experimentId", "phase", "previous"), "rank_phase_assignment_fields")
    require(action == value["action"] == "fit" and value["version"] == config["versions"]["fit"][0] and value["task"] == config["task"],
            "separate_rank_phase_assignment_required")
    require(value["executable"] is True and same(value["executionAllowance"], rank.allowance("fit"))
            and all(same(value[k], v) for k, v in expected.items()), "rank_phase_recipe_or_authority")
    require(type(value["studentCodeCommit"]) is str and re.fullmatch(r"[a-f0-9]{40}", value["studentCodeCommit"])
            and type(value["experimentId"]) is str and re.fullmatch(r"[a-f0-9]{32}", value["experimentId"]), "rank_phase_identity")
    pins = value["runtimeCodeCanonicalLfSha256"]
    require(type(pins) is dict and set(pins) == set(config["sources"]) and all(digest(v) for v in pins.values())
            and all(pins[k] == v for k, v in config["protected"].items() if k in config["sources"]), "rank_phase_source_pins")
    number = value["phase"].get("number")
    require(same(value["phase"], phase(number)), "rank_phase_range")
    previous = value["previous"]
    if number == 1:
        require(previous is None, "rank_phase_first_must_be_original")
    else:
        checkpoint.exact(previous, ("root", "acceptancePath", "acceptanceSha256", "checkpointFiles", "binding", "guardSha256",
            "acceptedMapSha256", "completionSha256", "fitResultSha256", "adapterManifestSha256", "freezeSha256", "assignmentSha256", "checkpointProofSha256"),
            "rank_phase_previous_fields")
        require(all(digest(previous[k]) for k in previous if k.endswith("Sha256")), "rank_phase_previous_hash")
        checkpoint.exact(previous["checkpointFiles"], checkpoint.FILES, "rank_phase_previous_file_set")
        require(all(digest(v) for v in previous["checkpointFiles"].values()), "rank_phase_previous_file_pins")
        # Original predecessor locations are host metadata in a contained child.
        # The stager validates their filesystem authority before copying; child
        # admission reads only the exact pinned copies in its verified profile.
        location = checkpoint.checked_path if verified_root is None else checkpoint.metadata_path
        root = location(previous["root"])
        require(root.parent == rank.PUBLICATION_ROOT.parent and root.name.startswith(config["prefix"] + "fit-"), "rank_phase_previous_root")
        receipt = location(previous["acceptancePath"])
        require(receipt != root and root not in receipt.parents, "rank_phase_independent_acceptance_required")
        old = previous["binding"]; prior_hash = old.get("previousCheckpointManifestSha256")
        require((number == 2 and prior_hash is None or number == 3 and digest(prior_hash))
                and same(old, binding(value, number - 1, prior_hash)), "rank_phase_chain_binding")
    return config["plan"]


def acceptance_body(previous):
    balanced = "objective" in previous["binding"]
    if balanced:
        from . import fragment_rank_balance as balance
        balance.admit(previous["binding"]["objective"], previous["binding"].get("objectiveSha256"))
    return {"version": "association-rank-balanced-phase-acceptance/1" if balanced else "association-rank-phase-acceptance/1", "accepted": True,
            **{k: v for k, v in previous.items() if k not in ("acceptancePath", "acceptanceSha256")}}


def previous_input_pins(assignment):
    previous = assignment["previous"]
    return {} if previous is None else {**{CHECKPOINT_INPUTS[n]: v for n, v in previous["checkpointFiles"].items()},
                                       "previous-acceptance.json": previous["acceptanceSha256"],
                                       "previous-checkpoint-proof.json": previous["checkpointProofSha256"]}


def make_freeze(assignment, assignment_bytes, physical_pins, *, verified_root=None):
    checked_execution(assignment, "fit", verified_root=verified_root)
    config = _configuration(assignment)
    require(same(strict_json(assignment_bytes), assignment) and set(physical_pins) == set(config["sources"])
            and all(digest(v) for v in physical_pins.values()), "rank_phase_freeze_sources")
    return {"version": config["versions"]["fit"][1], "action": "fit", "sourceCommit": assignment["studentCodeCommit"],
        "sourcePhysicalSha256": dict(physical_pins), "binding": binding(assignment), "phase": assignment["phase"],
        "fitSettings": FIT, "numerics": NUMERICS, "inferenceSettings": SETTINGS, "representation": config["representation"],
        "trainingPlan": config["plan"], "memoryExecutionPolicy": memory_policy(), "lossImplementation": config["loss"],
        "reclamationImplementation": rank.legacy.RECLAMATION_POLICY, "attentionImplementation": rank.legacy.ATTENTION_POLICY,
        "systemPromptSha256": rank.rank.PROMPT_SHA, "inputSha256": {**COMMON_PINS, "assignment": sha(assignment_bytes),
        "teacher_v1": DATA_SHA, "training_data": DATA_SHA}, "auxiliaryInputSha256": {**rank.AUXILIARY, **previous_input_pins(assignment)},
        "checkpointSchema": checkpoint.schema(), "checkpointProof": checkpoint.PROOF_POLICY,
        "developmentInputsPresent": False, "hostTargetsPresent": False, "evaluationAllowed": False, "promotionAuthorized": False, **config["fields"]}


def checked_freeze(freeze, assignment, *, verified_root=None):
    checked_execution(assignment, "fit", verified_root=verified_root)
    expected = make_freeze(assignment, serialized(assignment), freeze.get("sourcePhysicalSha256", {}), verified_root=verified_root)
    expected["inputSha256"]["assignment"] = freeze.get("inputSha256", {}).get("assignment")
    require(digest(expected["inputSha256"]["assignment"]) and same(freeze, expected), "rank_phase_freeze_drift")
    return training_plan(assignment)


def checked_cli(args, freeze):
    rank.checked_cli(args, freeze)


def checked_inputs(freeze, assignment, inputs, *, source_root=None, verified_root=None):
    checked_freeze(freeze, assignment, verified_root=verified_root)
    inputs = checkpoint.checked_path(inputs, verified_root=verified_root)
    if verified_root is not None:
        require(inputs == Path(verified_root) / "inputs", "rank_phase_contained_inputs")
    names = {*rank.PAYLOAD_PINS, "assignment.json", "runtime-requirements-resolved.txt", "run-freeze.json", *previous_input_pins(assignment)}
    require({p.name for p in inputs.iterdir()} == names, "rank_phase_input_set")
    for name in names: checkpoint.checked_path(inputs / name, verified_root=verified_root)
    require(sha((inputs / "assignment.json").read_bytes()) == freeze["inputSha256"]["assignment"]
            and same(strict_json((inputs / "assignment.json").read_bytes()), assignment)
            and same(strict_json((inputs / "run-freeze.json").read_bytes()), freeze)
            and sha((inputs / "runtime-requirements-resolved.txt").read_bytes()) == REQUIREMENTS_SHA, "rank_phase_input_authority")
    source_root = Path(__file__).resolve().parents[5] if source_root is None else Path(source_root)
    if verified_root is not None:
        require(source_root == Path(verified_root) / "code", "rank_phase_contained_sources")
    for name, pin in freeze["sourcePhysicalSha256"].items():
        raw = checkpoint.checked_path(source_root / name, verified_root=verified_root).read_bytes()
        require(sha(raw) == pin and sha(raw.replace(b"\r\n", b"\n")) == assignment["runtimeCodeCanonicalLfSha256"][name], "rank_phase_source_drift")
    if assignment["previous"] is not None:
        previous = assignment["previous"]
        proof_raw = checkpoint.read_bytes(inputs / "previous-acceptance.json", checkpoint.MAX_JSON, verified_root=verified_root)
        require(sha(proof_raw) == previous["acceptanceSha256"] and same(strict_json(proof_raw), acceptance_body(previous)), "rank_phase_acceptance_copy")
        control_raw = checkpoint.read_bytes(inputs / "previous-checkpoint-proof.json", checkpoint.MAX_JSON, verified_root=verified_root)
        require(sha(control_raw) == previous["checkpointProofSha256"], "rank_phase_checkpoint_proof_pin")
        checked_proof(strict_json(control_raw))
        state, _, _ = checkpoint.read_checkpoint({n: inputs / CHECKPOINT_INPUTS[n] for n in checkpoint.FILES},
            binding=previous["binding"], shapes=checkpoint.production_shapes(), schedule=schedule(), boundaries=(20, 40), expected_pins=previous["checkpointFiles"], verified_root=verified_root)
        require(state["cursor"]["updates"] == assignment["phase"]["startUpdate"], "rank_phase_resume_cursor")
    return rank.checked_payload({name: (inputs / name).read_bytes() for name in rank.PAYLOAD_PINS})


def stage_sources(assignment_path, assignment_bytes, baseline, runtime):
    assignment = strict_json(assignment_bytes); checked_execution(assignment, "fit")
    # Reuse the immutable payload mapping, not v1 execution admission.
    sources = {}
    for name, pin in rank.PAYLOAD_PINS.items():
        base = baseline / "inputs" if name == "model-acquisition.json" else rank.PUBLICATION_ROOT
        path = base / ("inputs/" + name if name in {"schema-v1.json", "family-freeze.json", "fragment-schema-v1.json"} else name)
        sources[name] = (path, pin)
    rank.checked_payload({n: p.read_bytes() for n, (p, _) in sources.items()})
    if assignment["previous"] is not None:
        sources.update(accepted_previous(assignment))
    return {**sources, "assignment.json": (Path(assignment_path), sha(assignment_bytes)),
            "runtime-requirements-resolved.txt": (runtime / "inputs/runtime-requirements-resolved.txt", REQUIREMENTS_SHA)}


def accepted_previous(assignment):
    """Host-only: guard accepted map AND independent acceptance, before copying."""
    from stage_adapter import accepted_outputs
    previous = assignment["previous"]; root = checkpoint.checked_path(previous["root"])
    raw = checkpoint.read_bytes(previous["acceptancePath"], checkpoint.MAX_JSON)
    require(sha(raw) == previous["acceptanceSha256"] and same(strict_json(raw), acceptance_body(previous)), "rank_phase_independent_acceptance")
    guard, accepted = accepted_outputs(root, "fit")
    paths = {"guardSha256": root / "receipts/association_adapter-fit-guard.json", "acceptedMapSha256": root / "receipts/association_adapter-fit-accepted.json",
        "completionSha256": root / "outputs/fit/completion.json", "fitResultSha256": root / "outputs/fit/fit-result.json",
        "adapterManifestSha256": root / "outputs/fit/adapter-manifest.json", "freezeSha256": root / "inputs/run-freeze.json",
        "assignmentSha256": root / "inputs/assignment.json"}
    for key, path in paths.items(): require(sha(checkpoint.read_bytes(path, 4 * 1024**2)) == previous[key], "rank_phase_preceding_receipt_pin")
    complete = strict_json(paths["completionSha256"].read_bytes())
    require(same(complete["supervisor"], guard) and complete["runFreezeSha256"] == previous["freezeSha256"]
            and complete["fitResultSha256"] == previous["fitResultSha256"] and complete["adapterManifestSha256"] == previous["adapterManifestSha256"]
            and complete["tokenPreflightSha256"] == sha((root / "outputs/fit/token-preflight.json").read_bytes()), "rank_phase_completion_binding")
    old_assignment = strict_json(paths["assignmentSha256"].read_bytes()); old_freeze = strict_json(paths["freezeSha256"].read_bytes())
    checked_inputs(old_freeze, old_assignment, root / "inputs", source_root=root / "code")
    require(same(binding(old_assignment), previous["binding"]), "rank_phase_previous_assignment_identity")
    state, _, manifest = checkpoint.read_checkpoint({n: root / "outputs/fit/checkpoint" / n for n in checkpoint.FILES},
        binding=previous["binding"], shapes=checkpoint.production_shapes(), schedule=schedule(), boundaries=(20, 40), expected_pins=previous["checkpointFiles"])
    result = strict_json(paths["fitResultSha256"].read_bytes()); adapter_manifest = strict_json(paths["adapterManifestSha256"].read_bytes())
    checked_phase_result(result, adapter_manifest, old_assignment, state, manifest)
    checked_output_history(root, old_assignment, result, adapter_manifest, state)
    control_path = root / ("outputs/fit/checkpoint-equivalence.json" if old_assignment["phase"]["number"] == 1 else "inputs/previous-checkpoint-proof.json")
    control_raw = checkpoint.read_bytes(control_path, checkpoint.MAX_JSON)
    require(sha(control_raw) == previous["checkpointProofSha256"] == result["checkpointProofSha256"], "rank_phase_checkpoint_proof_binding")
    checked_proof(strict_json(control_raw))
    return {**{CHECKPOINT_INPUTS[n]: (root / "outputs/fit/checkpoint" / n, pin) for n, pin in previous["checkpointFiles"].items()},
            "previous-acceptance.json": (Path(previous["acceptancePath"]), previous["acceptanceSha256"]),
            "previous-checkpoint-proof.json": (control_path, previous["checkpointProofSha256"])}


def checked_proof(proof):
    require(proof.get("passed") is True and proof.get("native") is True and proof.get("trainingRngRestored") is True
            and proof.get("freshObjects") is True and proof.get("exactLossesGradientsMastersOptimizerScalerRngCursor") is True
            and same(proof.get("policy"), checkpoint.PROOF_POLICY), "rank_phase_native_checkpoint_proof_required")


def checked_phase_result(result, manifest, assignment, state, checkpoint_manifest):
    p = assignment["phase"]; config = _configuration(assignment)
    balanced = config["objective"] is not None
    require(result["version"] == ("association-rank-balanced-phase-result/1" if balanced else "association-rank-phase-result/1") and result["phase"] == p and result["updates"] == p["endUpdate"]
            and result["localUpdates"] == 20 and result["localContributions"] == 114 and result["candidateContributions"] == p["number"] * 114
            and result["fitPerformed"] is p["final"] and result["phaseCompleted"] is True and result["baseUnchanged"] is True
            and same(result["binding"], binding(assignment)) and result["stepLosses"] == state["cursor"]["losses"]
            and result["checkpointManifestSha256"] == sha(checkpoint.canonical(checkpoint_manifest)), "rank_phase_result_binding")
    require(manifest["version"] == ("association-rank-balanced-phase-manifest/1" if balanced else "association-rank-phase-manifest/1") and manifest["phase"] == p
            and manifest["baseParametersBefore"] == manifest["baseParametersAfter"] == BASE
            and manifest["checkpointManifestSha256"] == result["checkpointManifestSha256"]
            and manifest["savedStateMatchesTrainableAdapter"] is True and manifest["trainableParameters"] == 540672
            and manifest["tensorCount"] == 96 and same(manifest["binding"], binding(assignment)), "rank_phase_manifest_binding")
    for record in (result, manifest):
        require(all(same(record.get(k), v) for k, v in config["fields"].items()), "balanced_phase_output_objective")
    require(manifest["finalAdapter"] is p["final"] and (p["final"] or manifest["files"] == {}), "rank_phase_premature_final_adapter")


def checked_balanced_loss_proof(proof, assignment):
    config = _configuration(assignment)
    require(config["objective"] is not None, "balanced_loss_proof_authority")
    from . import fragment_rank_balance as balance
    from .fragment_rank_runtime import analytic_gradient
    cases = [(2.0, -3.0, 0), (2.0, -3.0, 1), (0.0, 0.0, 1), (-1000.0, 1000.0, 0)]
    weight = lambda label: balance.effective_weight(label, {"numerator": 1, "denominator": 40}, config["objective"])
    factor = lambda label: weight(label)["numerator"] / weight(label)["denominator"]
    reference_loss = math.fsum(rank.rank.binary_loss(a, b, label) * factor(label) for a, b, label in cases)
    reference_gradient = [math.fsum(analytic_gradient(a, b, label)[i] * factor(label) for a, b, label in cases) for i in (0, 1)]
    records = proof.get("records")
    require(proof.get("passed") is True and proof.get("syntheticOnly") is True
            and proof.get("actualLossAndAccumulationHelpers") is True and same(proof.get("lossImplementation"), config["loss"])
            and all(same(proof.get(k), v) for k, v in config["fields"].items())
            and type(records) is list and len(records) == 4
            and [(r.get("device"), r.get("nativeLogitsDtype")) for r in records]
                == [(d, t) for d in ("cpu", "cuda") for t in ("torch.float32", "torch.float16")],
            "balanced_native_weighted_proof_required")
    close = lambda a, b, absolute, relative: type(a) in (float, int) and math.isfinite(a) and math.isclose(a, b, abs_tol=absolute, rel_tol=relative)
    require(close(proof.get("referenceLoss"), reference_loss, 1e-6, 1e-6)
            and type(proof.get("referenceGradient")) is list and len(proof["referenceGradient"]) == 2
            and all(close(a, b, 1e-6, 1e-6) for a, b in zip(proof["referenceGradient"], reference_gradient, strict=True)),
            "balanced_native_reference_drift")
    for r in records:
        half = r["nativeLogitsDtype"] == "torch.float16"
        require(r.get("contributions") == 4 and r.get("completions") == 1 and r.get("gradientScale") == 128
                and r.get("lossDtype") == "float32" and close(r.get("loss"), reference_loss, 1e-6, 1e-6)
                and type(r.get("gradient")) is list and len(r["gradient"]) == 2
                and all(close(a, b, 1e-4 if half else 1e-6, 1e-3 if half else 1e-6)
                        for a, b in zip(r["gradient"], reference_gradient, strict=True)), "balanced_native_weighted_proof_values")


def checked_output_recipe(preflight, result, manifest, assignment):
    """Shared result writer binds fit/numerics without duplicating those fields."""
    require(assignment.get("version") in (VERSIONS["fit"][0], BALANCED_VERSIONS["fit"][0]),
            "separate_rank_phase_assignment_required")
    config = _configuration(assignment)
    for record in (preflight, result, manifest):
        require(same(record.get("trainingPlan"), config["plan"]) and same(record.get("lossImplementation"), config["loss"])
                and same(record.get("representation"), config["representation"])
                and all(same(record.get(k), v) for k, v in config["fields"].items()), "rank_phase_output_recipe")
    for record in (preflight, manifest):
        require(same(record.get("settings"), FIT) and same(record.get("numerics"), NUMERICS), "rank_phase_output_recipe")
    require(same(result["binding"].get("fit"), FIT) and same(result["binding"].get("numerics"), NUMERICS), "rank_phase_output_recipe")
    for key, expected in (("settings", FIT), ("numerics", NUMERICS)):
        require(key not in result or same(result[key], expected), "rank_phase_output_recipe")


def checked_output_history(root, assignment, result, manifest, state):
    """Verify phase-specific receipts behind the protected accepted-output map."""
    config = _configuration(assignment)
    output = root / "outputs/fit"
    read = lambda name: strict_json(checkpoint.read_bytes(output / name, 8 * 1024**2))
    jsonlines = lambda name: [strict_json(line) for line in checkpoint.read_bytes(output / name, 16 * 1024**2).splitlines()]
    preflight = read("token-preflight.json")
    checked_output_recipe(preflight, result, manifest, assignment)
    require(preflight["epochOrder"] == epoch_orders(config["plan"]) and preflight["excludedRows"] == []
            and preflight["truncation"] is False and preflight["maximumCombinedTokens"] <= 4096
            and len(preflight["lengths"]) == 10 and sum(len(p["focuses"]) for p in preflight["lengths"]) == 57,
            "rank_phase_output_tokens")
    require(same(read("teacher-delta.json"), config["representation"]) and result["developmentOpened"] is False
            and result["evaluationOpened"] is False and read("attention-scope.json")["restored"] is True,
            "rank_phase_output_scope")
    for filename in ("loss-equivalence.json", "attention-control.json", "reclamation-control.json"):
        require(read(filename)["passed"] is True, "rank_phase_native_control_failed")
    if config["objective"] is not None:
        from . import fragment_rank_balance as balance
        _, _, _, rows = rank.checked_payload({n: (root / "inputs" / n).read_bytes() for n in rank.PAYLOAD_PINS})
        pairs = {r["exampleId"]: [c["pair"] for c in r["candidates"]] for r in rows}
        mass = balance.mass_summary([p for values in pairs.values() for p in values], config["objective"])
        for record in (preflight, result, manifest):
            require(all(same(record.get(k), v) for k, v in config["fields"].items())
                    and same(record.get("objectiveMassSummary"), mass), "balanced_output_mass_provenance")
        for parent in preflight["lengths"]:
            require(len(parent["focuses"]) == len(pairs[parent["exampleId"]]), "balanced_preflight_candidate_count")
            for focus, pair in zip(parent["focuses"], pairs[parent["exampleId"]], strict=True):
                require(focus["candidateIndex"] == pair["candidateIndex"] and focus["pairSha256"] == codec.canonical_sha(pair)
                        and all(same(focus.get(k), v) for k, v in balance.weight_fields(pair["label"], pair["weight"], config["objective"]).items()),
                        "balanced_preflight_weight_provenance")
        checked_balanced_loss_proof(read("loss-equivalence.json"), assignment)
    for record in (result, manifest):
        for key, filename in (("lossEquivalenceSha256", "loss-equivalence.json"), ("attentionControlSha256", "attention-control.json"),
                              ("reclamationControlSha256", "reclamation-control.json")):
            require(record[key] == sha((output / filename).read_bytes()), "rank_phase_output_proof_hash")
    for key, filename in (("memoryPhasesSha256", "memory-phases.jsonl"), ("attentionBlocksSha256", "attention-blocks.jsonl"),
                          ("attentionScopeSha256", "attention-scope.json"), ("adapterManifestSha256", "adapter-manifest.json")):
        require(result[key] == sha((output / filename).read_bytes()), "rank_phase_output_artifact_hash")
    p = assignment["phase"]; expected = schedule()[p["startUpdate"]:p["endUpdate"]]
    progress = jsonlines("fit-progress.jsonl")
    require(len(progress) == 20, "rank_phase_progress_count")
    for record, scheduled in zip(progress, expected, strict=True):
        require(all(record[k] == scheduled[k] for k in ("update", "epoch", "exampleId"))
                and record["candidateContributions"] == scheduled["candidates"]
                and record["loss"] == state["cursor"]["losses"][record["update"] - 1]
                and math.isfinite(record["gradientNormBeforeClip"]) and record["gradientNormBeforeClip"] > 0
                and record["gradientScale"] == 128, "rank_phase_progress_drift")
        if config["objective"] is not None:
            current = pairs[scheduled["exampleId"]]
            require(all(same(record.get(k), v) for k, v in config["fields"].items())
                    and same(record.get("originalCandidateWeights"), [p["weight"] for p in current])
                    and same(record.get("effectiveCandidateWeights"), [balance.effective_weight(p["label"], p["weight"], config["objective"]) for p in current]),
                    "balanced_progress_weight_provenance")
    history = jsonlines("memory-phases.jsonl")
    identity = lambda row: (row["update"], row["epoch"], row["exampleId"], row["candidateIndex"])
    expected_candidates = [(r["update"], r["epoch"], r["exampleId"], c) for r in expected for c in range(r["candidates"])]
    for name in ("before_decoder", "after_decoder", "after_loss_before_backward", "before_backward_reclamation",
                 "after_backward_reclamation", "after_backward", "after_candidate_reclamation"):
        selected = [r for r in history if r["phase"] == name]
        require([identity(r) for r in selected] == expected_candidates, "rank_phase_candidate_history")
        if config["objective"] is not None:
            for record in selected:
                pair = pairs[record["exampleId"]][record["candidateIndex"]]
                require(all(same(record.get(k), v) for k, v in config["fields"].items())
                        and all(same(record.get(k), v) for k, v in balance.weight_fields(pair["label"], pair["weight"], config["objective"]).items()),
                        "balanced_candidate_weight_provenance")
        if name == "after_candidate_reclamation":
            require(all(r["accumulatedGradientsRetained"] is True and r["peaksReset"] is False for r in selected), "rank_phase_gradient_reclamation")
    steps = [r for r in history if r["phase"] in ("first_before_optimizer_step", "before_optimizer_step")]
    require([r["update"] for r in steps] == [r["update"] for r in expected] and all(r["frozenGradientsAbsent"] for r in steps),
            "rank_phase_step_history")
    from .query_attention import query_blocks
    tokens = {(p["exampleId"], f["candidateIndex"]): f["inputTokens"] for p in preflight["lengths"] for f in p["focuses"]}
    blocks = jsonlines("attention-blocks.jsonl")
    for boundary, multiplier in (("decoder", 1), ("backward", 3)):
        selected = [r for r in blocks if r["boundary"] == boundary]
        require([identity(r) for r in selected] == expected_candidates, "rank_phase_attention_history")
        for r in selected:
            count = tokens[(r["exampleId"], r["candidateIndex"])]; q = query_blocks(count)
            require(r["tokens"] == r["fullKeyTokens"] == count and r["blockSizes"] == [b - a for a, b in q]
                    and r["layerCalls"] == {str(i): 1 if boundary == "decoder" else 2 for i in range(24)}
                    and r["primitiveCallsStarted"] == len(q) * 24 * multiplier and r["maxQueryBlockTokens"] <= 128,
                    "rank_phase_attention_blocks")
    if assignment["previous"] is not None:
        old, _, _ = checkpoint.read_checkpoint({n: root / "inputs" / CHECKPOINT_INPUTS[n] for n in checkpoint.FILES},
            binding=assignment["previous"]["binding"], shapes=checkpoint.production_shapes(), schedule=schedule(), boundaries=(20, 40),
            expected_pins=assignment["previous"]["checkpointFiles"])
        require(state["cursor"]["losses"][:p["startUpdate"]] == old["cursor"]["losses"], "rank_phase_loss_prefix_rewritten")


def admit_fit(authority, rows, contract, family):
    checkpoint.exact(authority, ("freeze", "assignment", "inputs", "verified_root"), "rank_phase_loader_authority")
    require(authority["verified_root"] is not None, "rank_phase_verified_root_required")
    _, c, f, expected = checked_inputs(authority["freeze"], authority["assignment"], authority["inputs"], verified_root=authority["verified_root"])
    require(same(rows, expected) and same(contract, c) and same(family, f), "rank_phase_loader_payload")
    config = _configuration(authority["assignment"])
    if config["objective"] is not None:
        from . import fragment_rank_balance as balance
        balance.mass_summary([c["pair"] for r in expected for c in r["candidates"]], config["objective"])
    return rank.RankRepresentation(expected)


def disabled_prototype(number, code_checkpoint, source_pins):
    return {"version": "association-rank-phase-prototype/1", "executable": False, "futureTask": TASK,
        "futureAssignmentVersion": VERSIONS["fit"][0], "codeCheckpoint": code_checkpoint,
        "runtimeCodeCanonicalLfSha256": source_pins, "phase": phase(number), **recipe(),
        "unresolved": "Separate positive final-clean-head assignment and experiment identity; phases2/3 additionally require independently accepted preceding full-state checkpoint. Native serializer/equivalence/phase work unrun."}


class PhaseSession:
    """Bookkeeping hooks only; shared adapter owns loading, updates and final save."""
    def __init__(self, authority, rows=None):
        self.assignment = authority["assignment"]
        checked_execution(self.assignment, "fit", verified_root=authority["verified_root"])
        self.config = _configuration(self.assignment)
        self.objective = self.config["objective"]
        self.provenance = dict(self.config["fields"])
        if self.objective is not None:
            from . import fragment_rank_balance as balance
            self.provenance["objectiveMassSummary"] = balance.mass_summary([c["pair"] for r in rows for c in r["candidates"]], self.objective)
        self.inputs = Path(authority["inputs"])
        self.verified_root = authority["verified_root"]
        self.phase = self.assignment["phase"]
        self.binding = binding(self.assignment)
        self.start, self.end = self.phase["startUpdate"], self.phase["endUpdate"]
        self.checkpoint_manifest = None

    def controls(self, torch, output_dir, write, phases):
        if self.start == 0:
            checkpoint.run_equivalence(torch, output_dir, write, phases, verified_root=self.verified_root)
            path = Path(output_dir) / "checkpoint-equivalence.json"
        else:
            path = self.inputs / "previous-checkpoint-proof.json"
        raw = checkpoint.read_bytes(path, checkpoint.MAX_JSON, verified_root=self.verified_root)
        checked_proof(strict_json(raw)); self.proof_sha = sha(raw)

    def initialize(self, torch, trainable, optimizer, scaler, base):
        require(base == BASE, "rank_phase_original_base_digest")
        if self.start == 0:
            return 0, 0, []
        previous = self.assignment["previous"]
        state, raw, _ = checkpoint.read_checkpoint({n: self.inputs / CHECKPOINT_INPUTS[n] for n in checkpoint.FILES},
            binding=previous["binding"], shapes=checkpoint.production_shapes(), schedule=schedule(), boundaries=(20, 40), expected_pins=previous["checkpointFiles"], verified_root=self.verified_root)
        restored = checkpoint.restore(state, raw, torch=torch, trainable=trainable, optimizer=optimizer, scaler=scaler,
            binding=previous["binding"], shapes=checkpoint.production_shapes(), schedule=schedule(), boundaries=(20, 40))
        require(restored["updates"] == self.start, "rank_phase_start_cursor")
        return restored["updates"], restored["contributions"], restored["losses"]

    def save(self, torch, trainable, optimizer, scaler, output_dir, updates, contributions, losses, base_before, base_after):
        require(updates == self.end and contributions == self.phase["number"] * 114 and base_before == base_after == BASE,
                "rank_phase_end_boundary")
        cursor = {"updates": updates, "contributions": contributions, "losses": losses,
                  "scheduleSha256": checkpoint.sha(checkpoint.canonical(schedule()))}
        state, tensors = checkpoint.capture(torch, trainable, optimizer, scaler, self.binding, cursor,
            checkpoint.production_shapes(), schedule(), (20, 40, 60))
        self.checkpoint_manifest = checkpoint.publish(Path(output_dir) / "checkpoint", state, tensors, torch=torch,
            binding=self.binding, shapes=checkpoint.production_shapes(), schedule=schedule(), boundaries=(20, 40, 60), verified_root=self.verified_root)
        self.manifest_sha = sha(checkpoint.canonical(self.checkpoint_manifest))

    def manifest_fields(self):
        return {"version": "association-rank-balanced-phase-manifest/1" if self.objective is not None else "association-rank-phase-manifest/1", **self.provenance, "phase": self.phase, "binding": self.binding,
            "checkpointManifestSha256": self.manifest_sha, "checkpointProofSha256": self.proof_sha,
            "finalAdapter": self.phase["final"], "localUpdates": 20, "localContributions": 114}

    def result_fields(self, losses):
        return {"version": "association-rank-balanced-phase-result/1" if self.objective is not None else "association-rank-phase-result/1", **self.provenance, "phase": self.phase, "binding": self.binding,
            "checkpointManifestSha256": self.manifest_sha, "checkpointProofSha256": self.proof_sha,
            "checkpointProofOrigin": "this_phase" if self.start == 0 else "accepted_first_phase",
            "phaseCompleted": True, "fitPerformed": self.phase["final"], "localUpdates": 20, "localContributions": 114,
            "epochSumParentContributions": [math.fsum(losses[i:i + 10]) for i in range(0, len(losses), 10)]}


class _BalancedAuthority:
    """Closed stager/worker view. Every operation requires the exact distinct assignment."""
    IS_FRAGMENT = IS_RANK_FIT = IS_RANK_PHASE = True
    VERSIONS, TASK, STAGE_PREFIX = BALANCED_VERSIONS, BALANCED_TASK, BALANCED_STAGE_PREFIX
    SOURCE_PATHS, PROTECTED_PINS = BALANCED_SOURCE_PATHS, BALANCED_PROTECTED_PINS
    SYSTEM_PROMPT, RUNTIME_SHA, MODEL_PROFILE_SHA, REQUIREMENTS_SHA = SYSTEM_PROMPT, RUNTIME_SHA, MODEL_PROFILE_SHA, REQUIREMENTS_SHA
    COMMON_PINS, DATA_SHA, sha, checkpoint = COMMON_PINS, DATA_SHA, staticmethod(sha), checkpoint
    input_names, checked_cli = staticmethod(input_names), staticmethod(checked_cli)

    @staticmethod
    def checked_execution(assignment, action, **scope):
        require(assignment.get("version") == BALANCED_VERSIONS["fit"][0], "balanced_phase_assignment_required")
        return checked_execution(assignment, action, **scope)

    @staticmethod
    def checked_freeze(freeze, assignment, **scope):
        require(freeze.get("version") == BALANCED_VERSIONS["fit"][1] and assignment.get("version") == BALANCED_VERSIONS["fit"][0], "balanced_phase_freeze_required")
        return checked_freeze(freeze, assignment, **scope)

    @staticmethod
    def checked_inputs(freeze, assignment, inputs, **scope):
        _BalancedAuthority.checked_freeze(freeze, assignment, **{k: v for k, v in scope.items() if k == "verified_root"})
        return checked_inputs(freeze, assignment, inputs, **scope)

    @staticmethod
    def make_freeze(assignment, raw, pins, **scope):
        _BalancedAuthority.checked_execution(assignment, "fit", **scope)
        return make_freeze(assignment, raw, pins, **scope)

    @staticmethod
    def stage_sources(assignment_path, raw, baseline, runtime):
        _BalancedAuthority.checked_execution(strict_json(raw), "fit")
        return stage_sources(assignment_path, raw, baseline, runtime)

    @staticmethod
    def representation_metadata():
        return representation_metadata(balanced_metadata_assignment())


BALANCED_AUTHORITY = _BalancedAuthority()


def disabled_balanced_prototype(number, code_checkpoint, source_pins):
    return {"version": "association-rank-balanced-phase-prototype/1", "executable": False, "futureTask": BALANCED_TASK,
        "futureAssignmentVersion": BALANCED_VERSIONS["fit"][0], "codeCheckpoint": code_checkpoint,
        "runtimeCodeCanonicalLfSha256": source_pins, "phase": phase(number), **recipe(balanced_metadata_assignment()),
        "unresolved": "Separate positive final-clean-head identity/experiment assignment; phases2/3 need independently accepted immediate same-objective checkpoint. Balanced native loss/gradient and all phase work unrun. Balanced reload deferred."}
