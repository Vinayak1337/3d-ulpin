"""Prepare immutable source-only CPU retrieval controls; never stage/run a model."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "services/geo"))
from geo.usp_learning.association import fragment_selection as codec
from geo.usp_learning.association.validation import require, strict_json

ASSIGNMENT_SHA = "bf3b2d7223de54fecdaf6fe6213a47da3bda29a6e863d2712bc5eee5f01c4bd4"
PARENT_SHA = "7510a7040afb7bec2bba9422eb5e14bbf0664c927bd0c2b24989c1af6dc7674c"
PARENT_CASE = "teacher-haryana-floor02"
PRIVATE_PARENT = Path("E:/BhuAayam-data/task-data/ml-distillation/student")
SOURCE_PATHS = (
    "services/geo/geo/usp_learning/association/fragment_selection.py",
    "services/geo/geo/usp_learning/association/student.py",
    "services/geo/geo/usp_learning/association/candidate_selection.py",
    "services/geo/geo/usp_learning/association/native_candidates.py", "services/geo/geo/native_ifc.py",
    "services/geo/geo/usp_learning/association/selectors.py",
    "services/geo/geo/usp_learning/association/selector_constraints.py",
    "services/geo/geo/usp_learning/association/validation.py", "services/geo/geo/usp_learning/resources.py",
    "services/geo/geo/__init__.py", "services/geo/geo/usp_learning/__init__.py",
    "services/geo/geo/usp_learning/association/__init__.py", "scripts/usp/learning/model_isolation.py",
    "scripts/usp/security/appcontainer_audit.py", "scripts/usp/learning/association/association_student.py",
    "scripts/usp/learning/association/prepare_fragment_selection.py")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read_pinned(path, pin):
    path = Path(path)
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= 4 * 1024**2, "fragment_reference_bound")
    raw = path.read_bytes()
    require(sha(raw) == pin, "fragment_reference_pin_drift:" + path.name)
    return raw


def load_preparation_inputs(assignment_path):
    assignment_raw = read_pinned(assignment_path, ASSIGNMENT_SHA)
    assignment = strict_json(assignment_raw)
    require(assignment["version"] == "student-fragment-selection-preparation-assignment/1"
            and assignment["task"] == "STUDENT-15-FRAGMENT-SELECTION-PREP"
            and assignment["executionAllowance"] == {"cpuCodeAndDataPreparation": True, "modelStage": False,
                "nativeRuntimeOrTokenizer": False, "inference": False, "fit": False, "evaluation": False, "promotion": False},
            "fragment_cpu_preparation_only")
    schema_raw = read_pinned(assignment["contract"]["path"], assignment["contract"]["physicalSha256"])
    schema = codec.checked_schema(schema_raw)
    family_raw = read_pinned(assignment["familyFreeze"]["path"], codec.FAMILY_SHA)
    family = strict_json(family_raw)
    legacy_raw = (REPO / "scripts/usp/learning/association/schema-v1.json").read_bytes()
    require(sha(legacy_raw.replace(b"\r\n", b"\n")) == codec.LEGACY_SCHEMA_SHA, "fragment_legacy_schema_drift")
    legacy = strict_json(legacy_raw)
    require(assignment["systemPrompt"] == codec.SYSTEM_PROMPT and sha(codec.SYSTEM_PROMPT.encode()) == codec.PROMPT_SHA,
            "fragment_prompt_drift")
    parent_raw = read_pinned(assignment["readOnlyTrainInput"]["path"], PARENT_SHA)
    # Read only the retained parent input. Output/teacher target fields are never
    # consulted or handed to construction, prompt, grammar or projection.
    parent_inputs = [strict_json(line)["input"] for line in parent_raw.splitlines()]
    matches = [row for row in parent_inputs if row["exampleId"] == PARENT_CASE]
    require(len(matches) == 1, "fragment_parent_input_not_unique")
    return assignment, schema, legacy, family, matches[0]["evidence"], schema_raw, family_raw, legacy_raw


def cpu_contexts(evidence, schema, legacy, family):
    # Requests exercise transport only, with no supplied expected-ID argument.
    requests = (("cpu-fragment-ocr-label", "Retrieve the typical-floor label text."),
                ("cpu-fragment-unsupported-request", "Retrieve the structural slab thickness."))
    examples, contexts = [], []
    for example_id, request in requests:
        example = {"version": "evidence-association-input/1", "exampleId": example_id,
                   "familyId": evidence[0]["familyId"], "evidence": evidence}
        examples.append(example)
        contexts.append(codec.context(example, request, schema, legacy, family, ("train",)))
    return examples, contexts


def prepare(assignment_path, output):
    assignment, schema, legacy, family, evidence, schema_raw, family_raw, legacy_raw = load_preparation_inputs(assignment_path)
    examples, contexts = cpu_contexts(evidence, schema, legacy, family)
    route = {"version": codec.ROUTE_VERSION, "representation": codec.metadata(),
             "contexts": [{"context": c.snapshot(), "contextSha256": c.input_sha256} for c in contexts]}
    codec.checked_route(route, examples, schema, legacy, family, ("train",))
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip()
    require(not subprocess.check_output(["git", "status", "--porcelain"], cwd=REPO, text=True).strip(), "fragment_clean_code_head_required")
    sources = {}
    for name in SOURCE_PATHS:
        raw = (REPO / name).read_bytes()
        require(raw.replace(b"\r\n", b"\n") == subprocess.check_output(["git", "show", head + ":" + name], cwd=REPO),
                "fragment_executed_source_not_git:" + name)
        sources[name] = {"physicalSha256": sha(raw), "canonicalLfSha256": sha(raw.replace(b"\r\n", b"\n"))}
    output = Path(output).absolute()
    require(output.parent == PRIVATE_PARENT and output.name.startswith("fragment-selection-preparation-"), "fragment_private_output_required")
    output.mkdir(exist_ok=False)
    files = {}

    def write(name, raw):
        with (output / name).open("xb") as stream:
            stream.write(raw)
        files[name] = sha(raw)

    write("fragment-schema-v1.json", schema_raw)
    write("legacy-schema-v1.json", legacy_raw)
    write("family-freeze.json", family_raw)
    write("fragment-prompt.txt", codec.SYSTEM_PROMPT.encode())
    write("source-inputs.json", codec.canonical({"version": "association-fragment-cpu-inputs/1", "examples": examples}).encode())
    write("fragment-route.json", codec.canonical(route).encode())
    for i, context in enumerate(contexts):
        write(f"context-{i}.json", context.context_json.encode())
        write(f"model-input-{i}.json", codec.canonical(context.model_input()).encode())
    # These technical choices are made after source context construction; they
    # are neither model predictions nor teacher/development labels.
    controls = []
    for source, ids in zip(contexts, (("c1",), ())):
        raw = codec.canonical(codec.selection(source, ids))
        projected = codec.project(raw, source, schema, legacy, family, ("train",))
        require(projected["modelOutputValid"], "fragment_cpu_projection_failed")
        controls.append({"exampleId": source.snapshot()["exampleId"], "kind": "technical_hand_selected_ids_not_prediction",
                         "raw": raw, "projection": projected})
    write("technical-controls.json", codec.canonical(controls).encode())
    future = {"executable": False, "sourceCommit": head, "sourceFiles": sources, "representation": codec.metadata(),
        "contextInterface": "context(source_only_example, request, fragment_contract, legacy_contract, frozen_family, allowed_splits)",
        "projectionInterface": "project(raw_id_json, immutable_context, fragment_contract, legacy_contract, frozen_family, allowed_splits)",
        "futureRuntimeHook": "student.run_local(..., fragment_route=source_only_route, fragment_contract=pinned_schema, preserve_preflight=write_once_callback)",
        "remainingAdmission": "No current stager or CLI admits fragment runtime. Coordinator must separately own exact assignment/freeze/source/input/schema/policy admission and shared stager/CLI wiring before one later development baseline. No new loader, guard or generation loop.",
        "inputs": "This train-only technical artifact is not a benchmark. Later source-only requested-subset/empty development inputs and hashes remain to be frozen by coordinator; do not substitute these controls or teacher targets.",
        "modelInputs": "request plus complete unchanged fragments/provenance and neutral current IDs; no target IDs, claim roles or expected outputs added"}
    write("future-interface-inventory.json", codec.canonical(future).encode())
    receipt = {"version": "association-fragment-preparation/1", "task": assignment["task"], "sourceCommit": head,
        "assignmentSha256": ASSIGNMENT_SHA, "parentInput": {"path": assignment["readOnlyTrainInput"]["path"], "physicalSha256": PARENT_SHA,
            "parentExampleId": PARENT_CASE, "evidenceCanonicalSha256": codec.canonical_sha(evidence), "consultedFields": ["input.exampleId as row locator", "input.evidence"]},
        "files": files, "sourceFiles": sources, "representation": codec.metadata(),
        "contexts": [{"exampleId": c.snapshot()["exampleId"], "contextSha256": c.input_sha256,
            "candidateCount": len(c.snapshot()["candidates"]), "split": c.snapshot()["split"]} for c in contexts],
        "cpuControls": [{"exampleId": c["exampleId"], "retrievedCount": c["projection"]["retrievedFragmentCount"],
            "status": c["projection"]["acceptedProjection"]["status"], "kind": c["kind"]} for c in controls],
        "modelStageCreated": False, "nativeRuntimeInitialized": False, "inferencePerformed": False,
        "teacherTargetsConsulted": False, "expectationsConsumed": False, "evaluationOpened": False,
        "qualification": "Pure technical retrieval/provenance journey; not a learned prediction, relevance metric, claim or factual-absence assertion"}
    write("preparation.json", codec.canonical(receipt).encode())
    require(not {"torch", "transformers", "tokenizers", "ifcopenshell", "safetensors", "peft", "numpy"} &
            {n.split(".")[0] for n in sys.modules}, "fragment_native_import_refused")
    print(json.dumps({"root": str(output), "preparationSha256": files["preparation.json"], "contexts": receipt["contexts"],
                      "cpuControls": receipt["cpuControls"], "nativeImports": []}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assignment", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.assignment, args.output)
