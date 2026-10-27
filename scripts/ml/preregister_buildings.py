"""Create (never overwrite) the frozen building preregistration and baseline card."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
EVIDENCE = REPO / "docs/evidence/gf-ai/building"


def digest(path, git_text=False):
    data = path.read_bytes()
    return hashlib.sha256(data.replace(b"\r\n", b"\n") if git_text else data).hexdigest()


def save(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as f:
        json.dump(value, f, indent=2)
        f.write("\n")


def main():
    split_path = EVIDENCE / "split/split.json"
    split = json.loads(split_path.read_bytes())
    model = next(x for x in json.loads((REPO / "services/geo/ml-models.json").read_bytes())["models"] if x["task"] == "building")
    source_cards = Path("E:/BhuAayam-data/ml/source-cards")
    training = {"documented_finetune_dataset": "merve/satellite-building-segmentation", "documented_base_model": "Roboflow/rf-detr-seg-medium", "base_training": "COCO 2017 instance segmentation, according to the base model card", "dataset_card": {"source": "https://huggingface.co/datasets/merve/satellite-building-segmentation", "origin": "keremberke/satellite-building-segmentation / Roboflow Universe buildings-instance-segmentation v1", "train_images": 6764, "validation_images": 1934, "test_images": 967, "licence_claim": "CC BY 4.0", "geographic_source_families": "undocumented"}, "ramp_overlap_ruled_out": False, "reason": "The model names its finetune dataset, but neither card publishes a complete original imagery/chip/source-family inventory. No independent byte/geographic comparison was performed; COCO base provenance does not establish finetune independence from RAMP.", "source_card_pins": [{"path": (source_cards / file).as_posix(), "sha256": digest(source_cards / file)} for file in ("satellite-buildings-README.md", "dataset-README.md", "base-README.md")]}
    holdout = split["splits"]["holdout"]
    building = {"status": "frozen", "task": "building_mask", "geography": "India/Karnataka", "truth": {"publisher": "DevGlobal / TaQadam / B.O.T", "dataset": "RAMP Karnataka v1.0", "doi": "10.34911/rdnt.5y2w17", "licence": "CC-BY-NC-4.0", "review": "One annotator, second-person QC, additional DevGlobal Tier 1 QC", "definition": "Rooftop outlines, not surveyed ground footprints, ownership or physical property identities", "independent_of_our_team": True, "local_relabelling": False, "ignore_policy": "Full source raster, no invented ignore regions", "use": "test_only"}, "split_sha256": digest(split_path, git_text=True), "repository_hash_encoding": "UTF-8 bytes with CRLF normalized to LF, matching Git text blobs", "holdout": {k: holdout[k] for k in ("cluster_ids", "cluster_ids_sha256", "chip_ids_sha256", "chips", "empty_chips", "publisher_features")}, "id_list_hash_encoding": "Sorted publisher ids, UTF-8, one id per LF line including final LF", "grid": split["grid"], "seed": split["seed"], "allocation": {"requested_fractions": {"holdout": .20, "dev": .15, "train": .65}, "actual_fractions": {k: v["chips"] / sum(x["chips"] for x in split["splits"].values()) for k, v in split["splits"].items()}, "dev_deviation_reason": "All 20 cells containing the 24 previously evaluated chips must stay DEV-only; their 1434 chips already exceed the nominal 15% target. Leakage prevention takes precedence over target fraction; no seed search, holdout performance or labels influenced cell assignments."}, "baseline": {"id": model["id"], "sha256": model["sha256"], "profile_version": model["profileVersion"]}, "metrics": {"per_building_precision_recall": "One-to-one maximum-cardinality mask IoU >= 0.5, total IoU tie-break; actual production polygon candidates rasterized at source resolution vs one publisher feature per instance; denominators = predicted / publisher buildings. Zero-pixel source features retained as unmatched; count reported.", "mean_iou_of_matches": "Sum IoU / count of matched pairs; null when denominator is zero", "false_buildings_on_empty_chips": "Count, per-empty-chip rate, affected-chip count, denominator all publisher-empty chips", "boundary_f1_2px": "Micro pooled union foreground boundaries, Euclidean tolerance 2 source pixels, border_value=0 erosion; boundary hits and prediction/truth boundary-pixel denominators. Includes false boundaries on empty chips; undefined ratios stay null.", "abstention": "Failed inputs reported separately; empty predictions are scored rather than abstentions"}, "thresholds": {"precision_min": .75, "recall_min": .70, "match_iou_min": .5}, "inference": model["preprocessing"], "holdout_policy": {"maximum_attempts": 2, "slots": ["installed_baseline", "final_candidate"], "failed_or_interrupted_attempt_consumes_slot": True, "log": "docs/evidence/gf-ai/building/holdout-runs.jsonl", "reserve_before_model_load": True, "preregistration_and_split_must_match_committed_HEAD": True, "no_threshold_or_checkpoint_selection_on_holdout": True, "this_task_runs_holdout": False}, "installed_checkpoint_training_data": training, "limitations": split["limitations"]}
    save(REPO / "docs/evidence/gf-ai/preregistration.json", {"schema": "gf-ai-preregistration/1", "building_mask": building, "plan_rooms": {"status": "pending", "holdout_runs_allowed": False}, "storeys": {"status": "pending", "holdout_runs_allowed": False}})
    save(EVIDENCE / "data/baseline-model-card.json", {"schema": "vision-model-card/1", "id": model["id"], "source": model["source"], "revision": "05b80dce9a57701724ad6a0fc052827c8b724257", "licence": model["license"], "onnx_sha256": model["sha256"], "safetensors_sha256": model["sourceArtifacts"][0]["sha256"], "preprocessing_profile": model["profileVersion"], "training_data": training, "evaluation": {"dev": "pending_one_full_frozen_DEV_run", "holdout": "not_run_B1"}, "known_failure_modes": ["Small or obscured roofs missed", "Touching roofs merged by overlap union", "False positives on empty/vegetation chips", "Chip-edge cuts and partial labels", "Source-family pretraining overlap unknown"], "operational_launch_clearance": "RAMP CC BY-NC / upstream imagery terms need owner clearance; roofprint outputs remain review candidates"})
    print("Created frozen building preregistration; commit before any holdout call")


if __name__ == "__main__":
    main()
