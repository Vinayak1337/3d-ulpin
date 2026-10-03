"""Compile the exact retained ten training parents into an immutable CPU bundle."""
from __future__ import annotations

import argparse
import builtins
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

NATIVE = {"torch", "transformers", "tokenizers", "peft", "accelerate", "safetensors", "numpy", "ifcopenshell"}
if __name__ == "__main__":
    original_import = builtins.__import__

    def cpu_import(name, *args, **kwargs):
        if name.split(".")[0] in NATIVE:
            raise RuntimeError("rank_cpu_native_import_refused:" + name)
        return original_import(name, *args, **kwargs)

    builtins.__import__ = cpu_import

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "services/geo"))
from geo.usp_learning.association import fragment_rank as rank, fragment_support_v2 as authority
from geo.usp_learning.association.validation import require, strict_json

ASSIGNMENT_SHA = "92d93efe814ea11eba2d0fda9322d5e98e04afa0339169f2153b6b18c6d5631f"
PRIVATE_PARENT = Path("E:/BhuAayam-data/task-data/ml-distillation/student")
OWNED_SOURCES = ("services/geo/geo/usp_learning/association/fragment_rank.py",
    "scripts/usp/learning/association/prepare_fragment_rank.py", "scripts/usp/learning/association/test_fragment_rank.py")
INPUT_PINS = {**authority.SUPPORT_PINS, authority.DATA_NAME: authority.DATA_SHA,
    "fragment-schema-v1.json": authority.codec.SCHEMA_SHA,
    "schema-v1.json": authority.COMMON_PINS["schema"], "family-freeze.json": authority.codec.FAMILY_SHA}
TRAIN_FAMILIES = ("in-haryana-rera-2831", "in-bihar-magnolia-residency")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return authority.codec.canonical(value).encode()


def read_pinned(reference):
    path = Path(reference["path"])
    require(path.is_file() and not path.is_symlink() and path.stat().st_size == reference["bytes"]
            and 0 < reference["bytes"] <= 2 * 1024**2, "rank_input_size_or_path")
    raw = path.read_bytes()
    require(sha(raw) == reference["physicalSha256"], "rank_input_pin_drift:" + path.name)
    return raw


def load_inputs(assignment_path):
    raw = read_pinned({"path": str(assignment_path), "bytes": 12095, "physicalSha256": ASSIGNMENT_SHA})
    assignment = strict_json(raw)
    require(assignment["task"] == "STUDENT-25-FRAGMENT-RANK-CPU"
            and assignment["executionAllowance"] == {"cpuCodeAndDataPreparation": True, "evaluation": False,
                "fit": False, "inference": False, "loadModel": False, "modelStage": False,
                "nativeImports": False, "promotion": False, "tokenizer": False}, "rank_cpu_assignment_required")
    refs = assignment["trainOnlyAuthorities"]
    require(set(refs) == set(INPUT_PINS)
            and all(refs[name]["physicalSha256"] == digest for name, digest in INPUT_PINS.items()), "rank_authorities_drift")
    return assignment, raw, {name: read_pinned(refs[name]) for name in INPUT_PINS}


def compile_training(values):
    """Complete pinned target admission happens before any negative is derived."""
    require(set(values) == set(INPUT_PINS) and all(type(values[k]) is bytes and sha(values[k]) == digest
            for k, digest in INPUT_PINS.items()), "rank_training_input_drift")
    data = values[authority.DATA_NAME]
    schema = authority.codec.checked_schema(values["fragment-schema-v1.json"])
    contract, family = (strict_json(values[name]) for name in ("schema-v1.json", "family-freeze.json"))
    authority.checked_support_files({name: values[name] for name in authority.SUPPORT_PINS}, data)
    admitted, admission = authority.checked_teacher(data, schema, contract, family)
    originals = [row["fragmentTrainingRow"] for row in admitted]
    require({row["context"]["familyId"] for row in originals} == set(TRAIN_FAMILIES), "rank_train_families_drift")
    scoring, pairs, parents, variant_groups = [], [], [], {}
    for parent_index, (line, row) in enumerate(zip(data.splitlines(), originals, strict=True)):
        context, target, supervision = row["context"], row["output"], row["supervision"]
        candidates = context["candidates"]
        # Preserve the entire supervision object outside scoring inputs, including
        # source limitations, conflict/uncertainty history and parent pointers.
        lineage = {"parentIndex": parent_index, "exampleId": context["exampleId"], "familyId": context["familyId"],
            "split": context["split"], "rawParentRowSha256": sha(line), "canonicalParentRowSha256": sha(encoded(row)),
            "contextSha256": sha(encoded(context)), "requestUtf8Sha256": sha(context["request"].encode()),
            "originalInputSha256": sha(encoded(row["input"])), "targetSha256": sha(encoded(target)),
            "supervisionSha256": sha(encoded(supervision)), "target": target, "supervision": supervision,
            "candidateCount": len(candidates), "selectedCount": len(target["selected"])}
        parents.append(lineage)
        parent_pairs = []
        for candidate_index, candidate in enumerate(candidates):
            source = rank.scoring_input(context, candidate["id"], schema, contract, family)
            scoring.append(strict_json(source.input_json))
            label = int(candidate["id"] in target["selected"])
            pair = {"version": "association-fragment-rank-training-pair/1", "parentIndex": parent_index,
                "candidateIndex": candidate_index, "parentExampleId": context["exampleId"],
                "familyId": context["familyId"], "split": "train", "focusCandidateId": candidate["id"],
                "scoringInputSha256": source.sha256, "policySha256": rank.metadata()["policySha256"],
                "contextSha256": lineage["contextSha256"], "requestUtf8Sha256": lineage["requestUtf8Sha256"],
                "rawParentRowSha256": sha(line), "canonicalParentRowSha256": lineage["canonicalParentRowSha256"],
                "parentLineageSha256": sha(encoded(lineage)), "originalTargetSha256": lineage["targetSha256"],
                "candidateSha256": sha(encoded(candidate)), "fragmentSha256": sha(encoded(candidate["fragment"])),
                "label": label, "targetText": str(label), "weight": {"numerator": 1, "denominator": 10 * len(candidates)},
                "supervisionState": supervision["state"], "reviewState": supervision["reviewState"],
                "sarvamDerived": supervision["sarvamDerived"]}
            pairs.append(pair)
            parent_pairs.append(pair)
        if "pairId" in supervision:
            variant_groups.setdefault(supervision["pairId"], []).append((context, parent_pairs))
    contrasts = []
    for pair_id, variants in variant_groups.items():
        require(len(variants) == 2, "rank_variant_pair_incomplete")
        (left, left_pairs), (right, right_pairs) = variants
        require(left["candidates"] == right["candidates"] and left["request"] != right["request"], "rank_variant_source_drift")
        contrasts.append({"pairId": pair_id, "parents": [left["exampleId"], right["exampleId"]],
            "unchangedCandidatesSha256": sha(encoded(left["candidates"])),
            "oppositeLabels": [{"candidateId": a["focusCandidateId"], "fragmentSha256": a["fragmentSha256"],
                "labels": [a["label"], b["label"]]} for a, b in zip(left_pairs, right_pairs, strict=True) if a["label"] != b["label"]]})
    counts = {"parents": len(parents), "pairs": len(pairs), "positive": sum(p["label"] for p in pairs),
        "negative": sum(p["label"] == 0 for p in pairs), "emptyParents": sum(p["selectedCount"] == 0 for p in parents),
        "families": len({p["familyId"] for p in parents})}
    require(counts == {"parents": 10, "pairs": 57, "positive": 12, "negative": 45, "emptyParents": 3, "families": 2},
            "rank_pair_counts_drift")
    lineage = {"version": "association-fragment-rank-lineage/1", "parents": parents,
        "sameCandidateDifferentRequest": contrasts, "admission": admission,
        "qualification": "deterministic projection of complete provisional synthetic selected sets; no new source truth, official absence or independent labels; 57 related pairs from 10 parents in 2 train families"}
    return {"scoring-inputs.jsonl": b"".join(encoded(row) + b"\n" for row in scoring),
        "train-fragment-rank-v1.jsonl": b"".join(encoded(row) + b"\n" for row in pairs),
        "lineage.json": encoded(lineage) + b"\n", "counts.json": encoded(counts) + b"\n",
        "policy.json": encoded(rank.metadata()) + b"\n", "system-prompt.txt": rank.SYSTEM_PROMPT.encode()}


def prepare(assignment_path, output):
    assignment, assignment_raw, values = load_inputs(assignment_path)
    bundle = compile_training(values)  # No publication exists if any admission fails.
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip()
    require(not subprocess.check_output(["git", "status", "--porcelain"], cwd=REPO, text=True).strip(), "rank_clean_code_head_required")
    subprocess.run(["git", "merge-base", "--is-ancestor", assignment["executionHead"], head], cwd=REPO, check=True)
    changed = subprocess.check_output(["git", "diff", "--name-only", assignment["executionHead"], head], cwd=REPO, text=True).splitlines()
    require(set(changed) == set(OWNED_SOURCES), "rank_owned_code_scope_required")
    protected = strict_json(read_pinned(assignment["protectedExecutionSourcePins"]))["sources"]
    require(set(protected) == set(authority.SOURCE_PATHS), "rank_protected_source_set_drift")
    sources = {}
    for name in (*authority.SOURCE_PATHS, *OWNED_SOURCES):
        raw = (REPO / name).read_bytes()
        canonical = raw.replace(b"\r\n", b"\n")
        require(canonical == subprocess.check_output(["git", "show", head + ":" + name], cwd=REPO), "rank_source_git_drift")
        if name in protected:
            require(sha(raw) == protected[name]["physicalSha256"], "rank_protected_source_changed")
        sources[name] = {"physicalSha256": sha(raw), "canonicalLfSha256": sha(canonical)}
    require(not NATIVE & {name.split(".")[0] for name in sys.modules}, "rank_native_import_refused")
    output = Path(output).absolute()
    require(output.parent == PRIVATE_PARENT and re.fullmatch(r"fragment-rank-cpu-v1-[0-9a-f]{32}", output.name),
            "rank_fresh_private_uuid_required")
    # Everything is admitted before mkdir. A failed write retains its partial
    # directory without a publication receipt; no retry overwrites its bytes.
    output.mkdir(exist_ok=False)
    (output / "inputs").mkdir()
    files = {}
    for name, raw in {"assignment.json": assignment_raw, **{"inputs/" + k: v for k, v in values.items()}, **bundle}.items():
        with (output / name).open("xb") as stream:
            stream.write(raw)
        files[name] = {"sha256": sha(raw), "bytes": len(raw)}
    receipt = {"version": "association-fragment-rank-cpu-publication/1", "task": assignment["task"],
        "assignmentSha256": ASSIGNMENT_SHA, "assignmentBase": assignment["executionHead"], "sourceCommit": head,
        "files": files, "sources": sources, "counts": strict_json(bundle["counts.json"]),
        "policySha256": rank.metadata()["policySha256"], "nativeExecutable": False,
        "nativeImports": [], "fitOrInferencePerformed": False, "developmentOrEvaluationOpened": False,
        "teacherMetadataInScoringInputs": False, "nativeTokenScoreLossProof": "unrun; separate frozen assignment required",
        "objective": rank.POLICY["objective"], "qualification": strict_json(bundle["lineage.json"])["qualification"],
        "argv": sys.orig_argv, "cwd": str(Path.cwd())}
    receipt_raw = encoded(receipt) + b"\n"
    with (output / "publication.json").open("xb") as stream:
        stream.write(receipt_raw)
    print(json.dumps({"root": str(output), "publicationSha256": sha(receipt_raw),
        "counts": receipt["counts"], "policySha256": receipt["policySha256"], "nativeExecutable": False}), flush=True)
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assignment", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    prepare(args.assignment, args.output)
