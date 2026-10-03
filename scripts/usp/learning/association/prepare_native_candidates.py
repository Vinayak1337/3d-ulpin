"""CPU-only admission and immutable candidate artifacts; no expectations or model stage."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import uuid

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "services/geo"))
from geo.usp_learning.association import native_candidates as native, candidate_selection as candidate
from geo.usp_learning.association.selectors import canonical, canonical_sha
from geo.usp_learning.association.validation import require, strict_json

OUTPUT_PARENT = Path("E:/BhuAayam-data/task-data/ml-distillation/student")


def inputs(assignment_path, assignment_sha256):
    assignment = strict_json(native.read_pinned(assignment_path, assignment_sha256, 1024**2))
    require(assignment.get("version") == "student-native-candidate-preparation-assignment/1"
            and assignment.get("task") == "STUDENT-12-NATIVE-CANDIDATES-PREP"
            and assignment.get("executionAllowance") == {"cpuPreparation": True, "stageModelRun": False,
                "inference": False, "fit": False, "freshModelPhases": 0, "modelAcquisition": False,
                "evaluation": False, "promotion": False}, "separate_native_candidate_preparation_required")
    acceptance = assignment["previousAcceptance"]
    native.read_pinned(acceptance["path"], acceptance["physicalSha256"], 1024**2)
    loaded = []
    for name in ("scripts/usp/learning/association/schema-v1.json", "docs/evidence/usp/ml-distillation/family-freeze.json"):
        raw = (REPO / name).read_bytes()
        require(hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest() == assignment["protectedCanonicalLfSha256"][name],
                "candidate_protected_contract_drift")
        loaded.append(strict_json(raw))
    contract, family = loaded
    batch_ref = assignment["inputBatch"]
    batch = strict_json(native.read_pinned(batch_ref["path"], batch_ref["physicalSha256"], 1024**2))
    require(batch["version"] == "association-development/1" and len(batch["examples"]) == 2,
            "candidate_preparation_batch_scope")
    authority = native.load_authority(assignment, family)
    schema = candidate.checked_schema((Path(__file__).parent / "candidate-schema-v1.json").read_bytes())
    return assignment, batch, contract, family, authority, schema


def prepare(assignment_path, assignment_sha256):
    started = time.perf_counter()
    assignment, batch, contract, family, authority, schema = inputs(assignment_path, assignment_sha256)
    contexts = [candidate.context(example, authority, contract, family) for example in batch["examples"]]
    # These optional prefix subsets are technical controls, never model outputs or targets.
    controls = []
    for source in contexts:
        ids = [c["id"] for c in source.candidate_set()["candidates"]]
        for label, selected in (("empty", []), ("subset", ids[:1])):
            raw = canonical(candidate.selection(source, selected))
            result = candidate.project(raw, source, schema, contract, family)
            require(result["modelOutputValid"], "candidate_technical_projection_failed")
            controls.append({"exampleId": source.example()["exampleId"], "technicalControl": label,
                             "notModelOutputOrLearningLabel": True, "rawSelection": raw, "projection": result})
    root = OUTPUT_PARENT / ("native-candidates-preparation-" + uuid.uuid4().hex)
    root.mkdir(exist_ok=False)
    files = {}

    def write(name, raw):
        with (root / name).open("xb") as stream:
            stream.write(raw)
        files[name] = hashlib.sha256(raw).hexdigest()

    route = {"version": "association-candidate-runtime/1", "representation": candidate.metadata(), "contexts": []}
    for index, source in enumerate(contexts):
        snapshot = source.private_view()
        encoded = canonical(snapshot).encode()
        write(f"context-{index}.json", encoded)
        write(f"model-input-{index}.json", canonical(source.model_input()).encode())
        route["contexts"].append({"snapshot": snapshot, "snapshotSha256": hashlib.sha256(encoded).hexdigest()})
    write("candidate-route.json", canonical(route).encode())
    write("candidate-schema-v1.json", (Path(__file__).parent / "candidate-schema-v1.json").read_bytes())
    write("candidate-prompt.txt", candidate.SYSTEM_PROMPT.encode())
    write("technical-projections.json", canonical(controls).encode())
    receipt = {"version": "association-native-candidate-preparation/1", "task": assignment["task"],
        "assignmentSha256": assignment_sha256, "gitHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
        "representation": candidate.metadata(), "constructionPolicy": native.POLICY,
        "inputs": {"batch": assignment["inputBatch"], "lineage": assignment["lineage"], "manifest": assignment["nativeManifest"],
                   "sources": assignment["sources"], "readers": assignment["readers"]},
        "contexts": [{"exampleId": c.example()["exampleId"], "inputSha256": c.input_sha256, "candidateSetSha256": c.set_sha256,
                      "candidateCount": len(c.candidate_set()["candidates"]), "unsupported": c.candidate_set()["unsupported"]} for c in contexts],
        "files": files, "elapsedSeconds": time.perf_counter() - started, "expectationsConsumed": False,
        "nativeParserInitialized": False, "modelStageCreated": False, "learnedSelectionMeasured": False,
        "nativeImports": sorted({"torch", "transformers", "tokenizers", "ifcopenshell", "peft", "safetensors"} & set(sys.modules)),
        "qualification": "Deterministic verified source-to-candidate and technical subset/empty projection only; candidate-route is an artifact, not model execution authorization."}
    require(not receipt["nativeImports"], "candidate_unexpected_native_import")
    write("preparation.json", canonical(receipt).encode())
    print(json.dumps({"root": str(root), "files": files, "contexts": receipt["contexts"], "elapsedSeconds": receipt["elapsedSeconds"]}), flush=True)
    return root


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assignment", type=Path, required=True)
    parser.add_argument("--assignment-sha256", required=True)
    args = parser.parse_args()
    prepare(args.assignment, args.assignment_sha256)
