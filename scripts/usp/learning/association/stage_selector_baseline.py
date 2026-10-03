"""Prepare a future selector baseline only from a separate frozen assignment.

This leaf reuses the original contained association_student.py run role. No new
runtime, dependency, permission, fit, or command capability is introduced.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import uuid

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "scripts/usp/learning"), str(REPO / "services/geo"), str(Path(__file__).resolve().parent)]
import model_isolation as isolation
from stage_baseline import CODE as BASELINE_CODE, PYTHON_ROOT
from geo.usp_learning.association.student import SETTINGS
from geo.usp_learning.association.selectors import POLICY, PROMPT_VERSION, PROMPT_SHA, SCHEMA_SHA, SYSTEM_PROMPT, checked_schema
from geo.usp_learning.association.selector_baseline import FREEZE_VERSION, checked_assignment, checked_batch, checked_run_inputs
from geo.usp_learning.association.validation import require, strict_json

BASELINE = isolation.ASSOCIATION_STAGING_PARENT / "baseline-af47550c33ea4dc2a3dc1aebc56363c4"
BASELINE_PROFILE_SHA = "e06f20f9c285af4d3052c441e76a039ad04eba5c6b11fa618ea0a2a2ddbc5438"
CODE = (*BASELINE_CODE, "services/geo/geo/usp_learning/association/selectors.py",
        "services/geo/geo/usp_learning/association/selector_baseline.py")
SOURCE_PATHS = (*CODE, "scripts/usp/learning/association/stage_selector_baseline.py")
# Exact later versions already accepted/executed by STUDENT-08; other protected
# sources still require their unchanged original baseline profile bytes.
ACCEPTED_LATER_SOURCE_SHA256 = {
    "scripts/usp/learning/model_isolation.py": "69e51fd895697f224960226cdc1f99499d2b43d0b17ac76638e20cdfa8787676",
    "services/geo/geo/usp_learning/association/student.py": "a380d21dbfceea8012a979182cb9c2f7956b222e984d5c923025ab9e3d34cc87",
}


def checked_source_pins(source_bytes, baseline_files, assigned_canonical_pins, *, candidate_mode=False, fragment_mode=False, rank_mode=False):
    """Pure pre-mkdir check of both assignment and protected-source authorities."""
    paths = SOURCE_PATHS
    require(sum((candidate_mode, fragment_mode, rank_mode)) <= 1, "mixed_baseline_source_modes_refused")
    if rank_mode:
        from geo.usp_learning.association import fragment_rank_baseline as rank
        paths = rank.SOURCE_PATHS
    elif fragment_mode:
        from geo.usp_learning.association import fragment_baseline as fragment
        paths = fragment.SOURCE_PATHS
        require(set(paths) == {*fragment.base.SOURCE_PATHS, *fragment.EXTRA_CODE}, "fragment_transitive_source_set_drift")
    elif candidate_mode:
        from geo.usp_learning.association import candidate_baseline as candidate
        paths = candidate.SOURCE_PATHS
        require(set(paths) == {*SOURCE_PATHS, *candidate.EXTRA_CODE, "scripts/usp/learning/association/stage_baseline.py"},
                "candidate_transitive_source_set_drift")
    require(set(source_bytes) == set(paths) and type(assigned_canonical_pins) is dict
            and set(assigned_canonical_pins) == set(paths), "selector_assignment_code_pin_set_drift")
    pins = {}
    for relative in paths:
        raw = source_bytes[relative]
        require(hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest() == assigned_canonical_pins[relative],
                "selector_assignment_code_pin_drift:" + relative)
        pins[relative] = hashlib.sha256(raw).hexdigest()
        if rank_mode:
            if relative in rank.PROTECTED_PINS:
                require(assigned_canonical_pins[relative] == rank.PROTECTED_PINS[relative], "rank_protected_source_drift:" + relative)
            continue
        if candidate_mode and relative in candidate.PROTECTED_PINS:
            require(assigned_canonical_pins[relative] == candidate.PROTECTED_PINS[relative], "candidate_protected_source_drift:" + relative)
        if fragment_mode and relative in fragment.PROTECTED_PINS:
            require(assigned_canonical_pins[relative] == fragment.PROTECTED_PINS[relative], "fragment_protected_source_drift:" + relative)
        if relative in BASELINE_CODE and not relative.endswith("association_student.py"):
            expected = (ACCEPTED_LATER_SOURCE_SHA256[relative] if relative in ACCEPTED_LATER_SOURCE_SHA256
                        else baseline_files["code/" + relative])
            if fragment_mode and relative == "services/geo/geo/usp_learning/association/student.py":
                # Only this exact new route admits the separately accepted hook.
                expected = fragment.STUDENT_SHA
            require(pins[relative] == expected, "selector_protected_source_drift:" + relative)
    return pins


def checked_stage_assignment(assignment):
    """Pure positive admission, called before donor inspection or stage effects."""
    if assignment.get("version") == "association-fragment-rank-baseline-assignment/1":
        from geo.usp_learning.association import fragment_rank_baseline
        return fragment_rank_baseline.checked_assignment(assignment), "fragment-rank"
    if assignment.get("version") == "association-fragment-baseline-assignment/1":
        from geo.usp_learning.association import fragment_baseline
        return fragment_baseline.checked_assignment(assignment), "fragment"
    if assignment.get("version") == "association-candidate-baseline-assignment/1":
        from geo.usp_learning.association import candidate_baseline as candidate
        return candidate.checked_assignment(assignment), "candidate"
    require(not {"fragmentRoute", "fragmentContract", "fragmentSchemaCanonicalLfSha256"} & set(assignment),
            "separate_fragment_execution_required")
    return checked_assignment(assignment), "selector"


def rank_donor_plan(admission):
    """Read only pinned profiles; copy only each donor's authorized subset later."""
    plan = {}
    for kind, donor in admission.DONORS.items():
        parent = Path(donor["root"])
        raw = (parent / "profile.json").read_bytes()
        require(hashlib.sha256(raw).hexdigest() == donor["profileSha256"], "rank_donor_profile_drift:" + kind)
        profile = strict_json(raw)
        require(Path(profile["root"]).resolve() == parent.resolve() and type(profile["files"]) is dict,
                "rank_donor_root_drift")
        subset = {name: digest for name, digest in profile["files"].items() if name.startswith(kind + "/")}
        require(subset and ("runtime/python.exe" if kind == "runtime" else "model/model.safetensors") in subset,
                "rank_donor_subset_missing")
        if kind == "runtime":
            name = "inputs/runtime-requirements-resolved.txt"
            subset[name] = profile["files"][name]
        for name, digest in subset.items():
            require(name not in plan, "rank_duplicate_donor_path")
            plan[name] = (isolation.safe_path(parent, name), digest)
    return plan


def stage(assignment_path):
    assignment_path = Path(assignment_path)
    assignment_bytes = assignment_path.read_bytes()
    assignment, mode = checked_stage_assignment(strict_json(assignment_bytes))
    candidate_mode, fragment_mode = mode == "candidate", mode == "fragment"
    rank_mode = mode == "fragment-rank"
    admission = None
    if rank_mode:
        from geo.usp_learning.association import fragment_rank_baseline as admission
    elif fragment_mode:
        from geo.usp_learning.association import fragment_baseline as admission
    elif candidate_mode:
        from geo.usp_learning.association import candidate_baseline as admission
    # PREP is refused above before inspecting/copying any runtime or making a stage.
    if rank_mode:
        donor_plan = rank_donor_plan(admission)
        baseline = {"files": {}}
    else:
        require(isolation.sha(BASELINE / "profile.json") == BASELINE_PROFILE_SHA, "selector_baseline_parent_profile_drift")
        baseline = isolation.read(BASELINE / "profile.json")
        donor_plan = {name: (isolation.safe_path(BASELINE, name), digest) for name, digest in baseline["files"].items()
                      if name.startswith(("runtime/", "model/")) or name == "inputs/runtime-requirements-resolved.txt"}
    names = (admission.INPUT_NAMES if fragment_mode or rank_mode else
             {"input_batch": "development.json", "schema": "schema-v1.json",
              "family_freeze": "family-freeze.json", "model_receipt": "model-acquisition.json"})
    input_paths = {key: (Path(assignment["artifactRoot"]) if fragment_mode or rank_mode else BASELINE / "inputs") / name
                   for key, name in names.items()}
    for key, name in names.items():
        expected = admission.INPUT_PINS[key] if fragment_mode or rank_mode else baseline["files"]["inputs/" + name]
        require(isolation.sha(input_paths[key]) == expected, "baseline_input_drift")
    if admission is not None:
        artifact_paths = {name: Path(assignment["artifactRoot"]) / name for name in admission.ARTIFACT_PINS}
        artifact_bytes = {name: path.read_bytes() for name, path in artifact_paths.items()}
        admission.checked_payload(assignment, {key: path.read_bytes() for key, path in input_paths.items()}, artifact_bytes)
    else:
        require(assignment["inputBatchSha256"] == baseline["files"]["inputs/development.json"], "selector_baseline_new_inputs_refused")
        schema_path = Path(assignment["selectorSchema"])
        schema_bytes = schema_path.read_bytes()
        checked_schema(schema_bytes)
    checked_batch(isolation.read(input_paths["input_batch"]), assignment["cases"],
                  isolation.read(input_paths["schema"]), isolation.read(input_paths["family_freeze"]))
    receipt = isolation.read(input_paths["model_receipt"])
    require(receipt["model"] == assignment["model"] and receipt["revision"] == assignment["revision"], "selector_model_identity_drift")
    if rank_mode:
        require({name: digest for name, (_, digest) in donor_plan.items() if name.startswith("model/")} ==
                {"model/" + row["file"]: row["sha256"] for row in receipt["files"]}, "rank_model_donor_receipt_drift")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip()
    require(commit == assignment["studentCodeCommit"], "selector_baseline_frozen_code_head_drift")
    require(not subprocess.check_output(["git", "status", "--porcelain"], cwd=REPO, text=True).strip(),
            "selector_baseline_clean_checkout_required")
    source_bytes = {}
    source_paths = admission.SOURCE_PATHS if admission is not None else SOURCE_PATHS
    for relative in source_paths:
        raw = (REPO / relative).read_bytes()
        require(raw.replace(b"\r\n", b"\n") == subprocess.check_output(["git", "show", commit + ":" + relative], cwd=REPO),
                "selector_uncommitted_execution_source:" + relative)
        source_bytes[relative] = raw
    code_pins = checked_source_pins(source_bytes, baseline["files"], assignment.get("runtimeCodeCanonicalLfSha256"),
                                   candidate_mode=candidate_mode, fragment_mode=fragment_mode, rank_mode=rank_mode)
    # Complete the new authority and freeze before the first stage side effect.
    freeze = admission.make_freeze(assignment, assignment_bytes, code_pins) if rank_mode else None
    require(shutil.disk_usage(BASELINE.parent).free >= 15 * 1024**3, "selector_staging_disk_headroom")
    root = BASELINE.parent / (mode + "-baseline-" + uuid.uuid4().hex)
    root.mkdir()
    for directory in (*isolation.READONLY, "outputs", "scratch", "state", "receipts"):
        (root / directory).mkdir()
    files, copied = {}, {"fileCount": 0, "bytes": 0}

    def copy(source, relative, expected):
        require(not source.is_symlink() and not source.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT,
                "selector_copy_reparse_refused")
        target = isolation.safe_path(root, relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        digest, size = hashlib.sha256(), 0
        with source.open("rb") as src, target.open("xb") as dst:
            while block := src.read(8 * 1024**2):
                dst.write(block); digest.update(block); size += len(block)
        require(digest.hexdigest() == expected, "selector_copy_pin_drift:" + relative)
        files[relative] = digest.hexdigest()
        copied["fileCount"] += 1; copied["bytes"] += size

    print(json.dumps({"stage": str(root), "copyingAcceptedRuntimeAndModel": True}), flush=True)
    for relative, (source_path, digest) in donor_plan.items():
        copy(source_path, relative, digest)
    for relative in (source_paths if admission is not None else CODE):
        copy(REPO / relative, "code/" + relative, code_pins[relative])
    for key, name in names.items():
        expected = admission.INPUT_PINS[key] if fragment_mode or rank_mode else baseline["files"]["inputs/" + name]
        copy(input_paths[key], "inputs/" + name, expected)
    if admission is not None:
        copy(assignment_path, "inputs/" + mode + "-assignment.json", hashlib.sha256(assignment_bytes).hexdigest())
        for name, path in artifact_paths.items():
            copy(path, "inputs/" + name, admission.ARTIFACT_PINS[name])
        if not rank_mode:
            freeze = admission.make_freeze(assignment, assignment_bytes, code_pins)
        admission.checked_run_inputs(freeze, root / "inputs")
    else:
        copy(assignment_path, "inputs/selector-assignment.json", hashlib.sha256(assignment_bytes).hexdigest())
        copy(schema_path, "inputs/selector-schema-v1.json", hashlib.sha256(schema_bytes).hexdigest())
        with (root / "inputs/selector-prompt.txt").open("xb") as stream:
            stream.write(SYSTEM_PROMPT.encode("utf-8"))
        files["inputs/selector-prompt.txt"] = PROMPT_SHA
        auxiliary = {name: files["inputs/" + name] for name in ("selector-assignment.json", "selector-schema-v1.json", "selector-prompt.txt")}
        freeze = {"version": FREEZE_VERSION, "settings": SETTINGS, "promptVersion": PROMPT_VERSION,
              "systemPromptSha256": PROMPT_SHA, "selectorSchemaCanonicalLfSha256": SCHEMA_SHA, "lexicalPolicy": POLICY,
              "model": receipt["model"], "modelRevision": receipt["revision"], "sourceCommit": commit,
              "baselineProfileSha256": BASELINE_PROFILE_SHA, "cases": assignment["cases"],
              "inputSha256": {key: files["inputs/" + name] for key, name in names.items()}, "auxiliaryInputSha256": auxiliary,
              "fitPerformed": False, "evaluationAllowed": False, "canonicalAssociationQualified": False,
              "expectedClaimsSha256": isolation.read(BASELINE / "inputs/run-freeze.json")["expectedClaimsSha256"],
              "teacherTargetsInPrompt": False, "promotionAuthorized": False}
        checked_run_inputs(freeze, root / "inputs")
    isolation.write(root / "inputs/run-freeze.json", freeze)
    files["inputs/run-freeze.json"] = isolation.sha(root / "inputs/run-freeze.json")
    profile = {"schemaVersion": "usp-qwen-containment-v1", "root": str(root), "python": "runtime/python.exe",
               "packageRoots": ["runtime/packages"], "jobMemoryBytes": SETTINGS["maxPeakProcessRssBytes"],
               "timeoutSeconds": SETTINGS["maxRunSeconds"], "files": files}
    isolation.write(root / "profile.json", profile)
    command = [str(PYTHON_ROOT / "python.exe"), "-B", "-I", "-S", str(REPO / "scripts/usp/learning/association/association_student.py"), "run"]
    for key, name in names.items():
        command.extend(["--" + key.replace("_", "-"), str(root / "inputs" / name)])
    command.extend(["--run-freeze", str(root / "inputs/run-freeze.json"), "--output-dir", str(root / "outputs/baseline"),
                    "--containment-profile", str(root / "profile.json"), "--containment-sha256", isolation.sha(root / "profile.json")])
    stage_record = {"root": str(root), "command": command, "profileSha256": isolation.sha(root / "profile.json"),
        "copied": copied, "sourcePhysicalSha256": code_pins,
        "relocation": "Fresh pinned baseline runtime/model/input copy; targets/expectations excluded. Representation frozen separately."}
    if admission is None:
        stage_record["sourceExpectations"] = isolation.read(BASELINE / "stage.json")["sourceExpectations"]
    isolation.write(root / "stage.json", stage_record)
    print(json.dumps({"stage": str(root), "profileSha256": isolation.sha(root / "profile.json"), "copied": copied}), flush=True)
    return root


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assignment", type=Path, required=True)
    stage(parser.parse_args().assignment)
