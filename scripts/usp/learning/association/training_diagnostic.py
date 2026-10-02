"""Stage STUDENT-07 once, or compare its retained raw output on the host."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import uuid

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(Path(__file__).resolve().parent), str(REPO / "services/geo")]
from stage_adapter import CODE, COORDINATOR, PYTHON_ROOT, accepted_fit, accepted_outputs, isolation, require
from geo.usp_learning.association.training_generation import VERSION, QUALIFICATION, canonical_sha, checked_batch
from geo.usp_learning.association.student import SETTINGS
from geo.usp_learning.association.validation import strict_json, schema_check, validate_output, project_raw

ASSIGNMENT = COORDINATOR / "docs/evidence/usp/ml-distillation/student-07.training-generation.assignment.json"
ASSIGNMENT_SHA = "1db41c509fc91f42d5e15c90229ca82c93b0224c66185ee56444bfe4445aaf61"
DIAGNOSTIC_CODE = (*CODE, "services/geo/geo/usp_learning/association/training_generation.py")


def selected_records(assignment, contract, family):
    path = Path(assignment["trainingDataset"])
    require(isolation.sha(path) == assignment["teacherV2Sha256"], "teacher dataset pin changed")
    rows = [strict_json(line) for line in path.read_text(encoding="utf-8").splitlines()]
    selected = []
    for case in assignment["cases"]:
        matches = [row for row in rows if row["input"]["exampleId"] == case["exampleId"]]
        require(len(matches) == 1, "training diagnostic selection not unique")
        row = matches[0]
        require(canonical_sha(row["output"]) == case["teacherOutputCanonicalJsonSha256"]
                and len(row["output"]["claims"]) == case["expectedClaims"], "provisional target pin changed")
        validate_output(row["output"], row["input"], contract, family, ("train",))
        selected.append(row)
    batch = {"version": VERSION, "split": "train", "examples": [row["input"] for row in selected]}
    checked_batch(batch, assignment, contract, family)
    return batch, selected


def stage():
    require(isolation.sha(ASSIGNMENT) == ASSIGNMENT_SHA, "diagnostic assignment changed")
    assignment = isolation.read(ASSIGNMENT)
    fit_root = Path(assignment["acceptedFitRoot"])
    require(isolation.sha(fit_root / "profile.json") == assignment["acceptedFitProfileSha256"], "fit profile changed")
    proof = accepted_fit(fit_root)
    require(proof["adapterManifestSha256"] == assignment["fitManifestSha256"]
            and proof["fitResultSha256"] == assignment["fitResultSha256"]
            and isolation.sha(fit_root / "inputs/assignment.json") == assignment["fitAssignmentSha256"]
            and isolation.sha(fit_root / "outputs/fit/adapter/adapter_model.safetensors") == assignment["adapterSafetensorsSha256"],
            "accepted fit identity changed")
    profile, freeze = isolation.read(fit_root / "profile.json"), isolation.read(fit_root / "inputs/run-freeze.json")
    batch, _ = selected_records(assignment, isolation.read(fit_root / "inputs/schema-v1.json"),
                                isolation.read(fit_root / "inputs/family-freeze.json"))
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip()
    for relative in (*DIAGNOSTIC_CODE, "scripts/usp/learning/association/training_diagnostic.py"):
        raw = (REPO / relative).read_bytes()
        require(raw.replace(b"\r\n", b"\n") == subprocess.check_output(["git", "show", commit + ":" + relative], cwd=REPO),
                "uncommitted execution source: " + relative)
        if relative.endswith(("student.py", "resources.py", "model_isolation.py", "appcontainer_audit.py")):
            require(hashlib.sha256(raw).hexdigest() == profile["files"]["code/" + relative], "protected source changed")
    require(shutil.disk_usage(fit_root.parent).free >= 15 * 1024**3, "insufficient private staging disk")
    root = fit_root.parent / ("training-generation-" + uuid.uuid4().hex)
    root.mkdir()
    for name in (*isolation.READONLY, "outputs", "scratch", "state", "receipts"):
        (root / name).mkdir()
    files, copied = {}, {"fileCount": 0, "bytes": 0}

    def copy(source, relative, expected):
        require(not source.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT, "source reparse refused")
        destination = isolation.safe_path(root, relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        digest, size = hashlib.sha256(), 0
        with source.open("rb") as src, destination.open("xb") as dst:
            while block := src.read(8 * 1024**2):
                dst.write(block); digest.update(block); size += len(block)
        require(digest.hexdigest() == expected, "copy pin changed: " + relative)
        files[relative] = digest.hexdigest()
        copied["fileCount"] += 1; copied["bytes"] += size

    def write(relative, value):
        isolation.write(root / relative, value)
        files[relative] = isolation.sha(root / relative)

    print(json.dumps({"stage": str(root), "copyingAcceptedRuntimeAndModel": True}), flush=True)
    for relative, digest in profile["files"].items():
        if relative.startswith(("runtime/", "model/")):
            copy(isolation.safe_path(fit_root, relative), relative, digest)
    for relative in DIAGNOSTIC_CODE:
        copy(REPO / relative, "code/" + relative, isolation.sha(REPO / relative))
    inputs = {"schema": "schema-v1.json", "family_freeze": "family-freeze.json", "model_receipt": "model-acquisition.json",
              "assignment": "assignment.json", "input_batch": "training-inputs.json", "adapter_manifest": "adapter-manifest.json",
              "fit_proof": "fit-proof.json"}
    for name in ("schema-v1.json", "family-freeze.json", "model-acquisition.json", "assignment.json", "runtime-requirements-resolved.txt"):
        copy(fit_root / "inputs" / name, "inputs/" + name, profile["files"]["inputs/" + name])
    copy(ASSIGNMENT, "inputs/diagnostic-assignment.json", ASSIGNMENT_SHA)
    copy(fit_root / "outputs/fit/adapter-manifest.json", "inputs/adapter-manifest.json", proof["adapterManifestSha256"])
    for name, digest in isolation.read(fit_root / "outputs/fit/adapter-manifest.json")["files"].items():
        copy(fit_root / "outputs/fit/adapter" / name, "inputs/adapter/" + name, digest)
    write("inputs/fit-proof.json", proof)
    write("inputs/training-inputs.json", batch)
    # Preserve accepted fit policies, replace only this new inference run's identity/inputs/scope.
    freeze.pop("expectedClaimsSha256", None)
    freeze.update(version="association-training-generation-freeze/1", action="reload", sourceCommit=commit,
                  coordinatorHead=subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=COORDINATOR, text=True).strip(),
                  trainingDiagnostic=assignment, diagnosticAssignmentSha256=ASSIGNMENT_SHA,
                  inputSha256={key: files["inputs/" + name] for key, name in inputs.items()},
                  developmentInputsPresent=False, teacherTargetsPresent=False, split="train", qualification=QUALIFICATION)
    write("inputs/run-freeze.json", freeze)
    isolation.write(root / "profile.json", {"schemaVersion": "usp-qwen-containment-v1", "root": str(root),
        "python": "runtime/python.exe", "packageRoots": ["runtime/packages"], "jobMemoryBytes": 6 * 1024**3,
        "timeoutSeconds": 600, "files": files})
    command = [str(PYTHON_ROOT / "python.exe"), "-B", "-I", "-S", str(REPO / "scripts/usp/learning/association/association_adapter.py"), "reload"]
    for key, name in inputs.items():
        command.extend(["--" + key.replace("_", "-"), str(root / "inputs" / name)])
    command.extend(["--adapter-dir", str(root / "inputs/adapter"), "--run-freeze", str(root / "inputs/run-freeze.json"),
        "--output-dir", str(root / "outputs/reload"), "--containment-profile", str(root / "profile.json"),
        "--containment-sha256", isolation.sha(root / "profile.json")])
    isolation.write(root / "stage.json", {"root": str(root), "action": "reload", "task": "STUDENT-07", "split": "train",
        "command": command, "profileSha256": isolation.sha(root / "profile.json"), "copied": copied,
        "fitRoot": str(fit_root), "targetsStaged": False, "developmentStaged": False})
    print(json.dumps({"stage": str(root), "profileSha256": isolation.sha(root / "profile.json"), "copied": copied}), flush=True)


def compare(root):
    guard, accepted = accepted_outputs(root, "reload")
    completion = isolation.read(root / "outputs/reload/completion.json")
    require(completion["supervisor"] == guard and completion["qualification"] == "source_native_development_only"
            and completion["runFreezeSha256"] == isolation.sha(root / "inputs/run-freeze.json")
            and completion["rawOutputsSha256"] == isolation.sha(root / "outputs/reload/raw-outputs.json")
            and completion["resultSha256"] == isolation.sha(root / "outputs/reload/result.json"), "completion proof changed")
    freeze = isolation.read(root / "inputs/run-freeze.json")
    require(isolation.sha(root / "inputs/diagnostic-assignment.json") == ASSIGNMENT_SHA == freeze["diagnosticAssignmentSha256"], "diagnostic pin changed")
    assignment = isolation.read(root / "inputs/diagnostic-assignment.json")
    require(assignment == freeze["trainingDiagnostic"], "diagnostic assignment mismatch")
    contract, family = isolation.read(root / "inputs/schema-v1.json"), isolation.read(root / "inputs/family-freeze.json")
    batch, targets = selected_records(assignment, contract, family)
    require(batch == isolation.read(root / "inputs/training-inputs.json"), "diagnostic input drift")
    raw, result = isolation.read(root / "outputs/reload/raw-outputs.json"), isolation.read(root / "outputs/reload/result.json")
    require(result["version"] == VERSION and result["split"] == "train" and not result["developmentOpened"]
            and not result["evaluationOpened"] and not result["fitPerformedInThisProcess"] and not result["teacherTargetsInPrompt"]
            and result["settings"] == SETTINGS and result["adapterReload"]["savedTensorsExact"]
            and result["adapterReload"]["tensorCount"] == 96 and len(raw) == len(result["results"]) == 2, "diagnostic result scope changed")
    details = []
    signature = lambda claim: tuple(claim[key] for key in ("role", "state", "literal", "unit"))
    for predicted, projection, target, case in zip(raw, result["results"], targets, assignment["cases"]):
        example, expected = target["input"], target["output"]
        require(predicted["exampleId"] == projection["exampleId"] == case["exampleId"]
                and predicted["promptSha256"] == case["promptSha256"] and predicted["inputTokens"] == case["promptTokens"], "prompt/result ordering changed")
        checked = project_raw(predicted["rawText"], example, contract, family, ("train",))
        require(projection == {"exampleId": case["exampleId"], **checked}, "host validation differs from child")
        syntax, schema, error, value = False, False, None, None
        try:
            value = strict_json(predicted["rawText"]); syntax = True
            schema_check(value, contract["$defs"]["output"], contract); schema = True
        except (ValueError, TypeError, RecursionError) as exc:
            error = str(exc)
        accepted_claims = checked["acceptedProjection"]["claims"]
        truth, actual = Counter(map(signature, expected["claims"])), Counter(map(signature, accepted_claims))
        citations = [c for key in ("claims", "conflicts", "abstentions") for item in value[key] for c in item["citations"]] if schema else []
        evidence = {f["key"]:f["text"] for f in example["evidence"]}
        exact = sum(c["key"] in evidence and c["quote"] in evidence[c["key"]] for c in citations)
        valid = checked["modelOutputValid"]
        details.append({"exampleId": case["exampleId"], "familyId": case["familyId"], "syntaxValid": syntax, "schemaValid": schema,
            "syntaxSchemaError": error, "modelOutputValid": valid, "validationErrors": checked["errors"],
            "expectedClaims": sum(truth.values()), "acceptedClaims": sum(actual.values()),
            "correctAcceptedClaims": sum((truth & actual).values()), "extraAcceptedClaims": sum((actual - truth).values()),
            "missingExpectedClaims": [dict(zip(("role", "state", "literal", "unit"), claim)) for claim in (truth - actual).elements()],
            "exactClaimObjects": sum((Counter(map(canonical_sha, expected["claims"])) & Counter(map(canonical_sha, accepted_claims))).values()),
            "extractableCitations": len(citations), "exactExtractableCitations": exact,
            "citationDenominator": "schema-valid raw output only; rejected malformed output contributes no citations",
            "unknownNullClaimsPreserved": all(actual[signature(c)] >= truth[signature(c)] for c in expected["claims"] if c["state"] == "unknown")
                if any(c["state"] == "unknown" for c in expected["claims"]) else None,
            "printed13rdPreserved": any(c["literal"] == "13rd" for c in accepted_claims) if case["expectedClaims"] == 6 else None,
            "conflictsExact": valid and Counter(map(canonical_sha, value["conflicts"])) == Counter(map(canonical_sha, expected["conflicts"])),
            "abstentionsExact": valid and Counter(map(canonical_sha, value["abstentions"])) == Counter(map(canonical_sha, expected["abstentions"])),
            "canonicalAbstention": valid and any(a["code"] == "no_canonical_targets" for a in value["abstentions"]),
            "emptyCanonicalLinks": valid and value["canonicalLinks"] == [], "rawMetadata": {k:v for k,v in predicted.items() if k != "rawText"}})
    counts = {key:sum(row[key] for row in details) for key in ("syntaxValid", "schemaValid", "modelOutputValid", "expectedClaims",
        "acceptedClaims", "correctAcceptedClaims", "extraAcceptedClaims", "exactClaimObjects", "extractableCitations", "exactExtractableCitations")}
    gpu = result["runtime"]
    require(gpu["maxCudaAllocatedBytes"] <= 6 * 1024**3 and gpu["maxCudaReservedBytes"] <= 6 * 1024**3
            and gpu["minimumSampledFreeCudaBytes"] >= 1536 * 1024**2, "diagnostic CUDA bound failed")
    summary = {"task": "STUDENT-07", "split": "train", "examples": 2, "families": 2, "qualification": QUALIFICATION,
        "counts": counts, "details": details, "acceptedPrecision": counts["correctAcceptedClaims"] / counts["acceptedClaims"] if counts["acceptedClaims"] else None,
        "coverage": counts["correctAcceptedClaims"] / counts["expectedClaims"], "runtime": gpu,
        "jobPeakBytes": guard["observation"]["peakJobMemoryBytes"], "rssPeakBytes": guard["observation"]["peakProcessRssBytes"],
        "guardSha256": accepted["guardSha256"], "adapterReload": result["adapterReload"], "resourcesAndCleanupPassed": True,
        "legacyCompletionQualification": completion["qualification"], "legacyQualificationAuthoritative": False,
        "authoritativeScope": "trainingDiagnostic in run-freeze.json and train-only result.json; no development run",
        "developmentOpened": False, "evaluationOpened": False, "newFit": False, "promoted": False}
    isolation.write(root / "training-diagnostic-summary.json", summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("stage", "compare"))
    parser.add_argument("--root", type=Path)
    args = parser.parse_args()
    if args.action == "stage":
        require(args.root is None, "stage requires a fresh generated root")
        stage()
    else:
        require(args.root is not None, "comparison root required")
        compare(args.root.resolve())
