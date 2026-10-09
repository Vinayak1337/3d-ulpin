"""Correct a contact sheet from saved DEV counts, with ZERO new model calls.

Predicted pixel masks were not saved for every chip; this postprocess therefore
shows source imagery, truth contours and saved prediction counts (not invented
prediction contours). The original sheet and evaluation result are preserved.
"""
import argparse
import json
from pathlib import Path
from collections import defaultdict

import eval_buildings as evaluate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    import numpy as np
    from pycocotools import mask as mask_api
    output = evaluate.EVIDENCE / args.run_id
    result = json.loads((output / "result.json").read_bytes())
    if result["split"] != "dev":
        raise ValueError("Postprocess is DEV-only; no holdout access")
    coco_dir = Path("E:/BhuAayam-data/datasets/ramp/coco/dev")
    coco = json.loads((coco_dir / "_annotations.coco.json").read_bytes())
    if evaluate.sha(coco_dir / "_annotations.coco.json") != result["coco_sha256"]:
        raise ValueError("Saved DEV annotation pin changed")
    rows = [json.loads(x) for x in (output / "chip-results.jsonl").read_text(encoding="utf-8").splitlines()]
    selected = evaluate.select_contact_rows([(x, None, None) for x in rows])
    by_id = {x["source_id"]: x for x in coco["images"]}
    annotations = defaultdict(list)
    for annotation in coco["annotations"]:
        annotations[annotation["image_id"]].append(annotation)
    previews = []
    for row, _, _ in selected:
        image = by_id[row["chip_id"]]
        masks = []
        for annotation in annotations[image["id"]]:
            rle = annotation["segmentation"]
            masks.append(mask_api.decode(mask_api.frPyObjects(rle, *rle["size"])).astype(bool))
        truth = np.logical_or.reduce(masks) if masks else np.zeros((image["height"], image["width"]), bool)
        previews.append((row, truth, None))
    target = output / "best-worst-corrected.png"
    if target.exists():
        raise FileExistsError("Preserve prior corrected artifact")
    evaluate.contact_sheet(previews, coco_dir, target)
    receipt = {"status": "passed", "reason": "Initial contact-sheet ranking treated undefined F1 on correct empty chips as -1, incorrectly selecting them as worst. Exclude undefined scores; do not change metrics or rerun inference.", "evaluation_result_sha256": evaluate.repo_sha(output / "result.json"), "contact_sheet": target.name, "contact_sheet_sha256": evaluate.sha(target), "prediction_geometry": "Not retained for these six chips; show truth contours and saved prediction counts only", "original_contact_sheet_preserved": True, "selected_chip_ids": [x[0]["chip_id"] for x in previews], "native_model_calls": 0, "holdout_calls": 0}
    with (output / "contact-sheet-correction.json").open("x", encoding="utf-8") as f:
        json.dump(receipt, f, indent=2)
        f.write("\n")
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
