"""Lean split/source/COCO verification; no inference and no holdout model access."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
EVIDENCE = REPO / "docs/evidence/gf-ai/building"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def id_hash(ids):
    return hashlib.sha256(("\n".join(sorted(ids)) + "\n").encode()).hexdigest()


def main():
    import numpy as np
    from PIL import Image
    from pycocotools import mask as mask_api
    from pyproj import Transformer, Geod
    import rasterio
    from rasterio.features import rasterize
    split = json.loads((EVIDENCE / "split/split.json").read_bytes())
    index_path = Path(split["source_index"]["path"])
    assert sha(index_path) == split["source_index"]["sha256"]
    items = json.loads(index_path.read_bytes())["items"]
    ids, clusters = {}, {}
    for role, subset in split["splits"].items():
        assert id_hash(subset["chip_ids"]) == subset["chip_ids_sha256"]
        assert id_hash(subset["cluster_ids"]) == subset["cluster_ids_sha256"]
        assert len(subset["chip_ids"]) == subset["chips"]
        assert subset["empty_chips"] > 0
        for chip in subset["chip_ids"]:
            assert chip not in ids
            ids[chip] = role
        for cluster in subset["cluster_ids"]:
            assert cluster not in clusters
            clusters[cluster] = role
    assert len(ids) == 6288 == len(items)
    assert all(ids[x["id"]] == clusters[x["cluster_id"]] == x["split"] for x in items)
    assert all(ids[x] == "dev" for x in split["prior_observed"]["chip_ids"])
    project = Transformer.from_crs("EPSG:4326", "EPSG:6933", always_xy=True)
    for item in items:
        x, y = project.transform(*item["centroid"])
        assert item["cluster_id"] == f"6933:{int(np.floor(x / 1000))}:{int(np.floor(y / 1000))}"
    geo = json.loads((EVIDENCE / "split/cluster-map.geojson").read_bytes())
    assert {x["id"]: x["properties"]["split"] for x in geo["features"]} == clusters
    dev = [x for x in items if x["split"] == "dev"]
    good = next(x for x in dev if x["id"] == "0020b409-a333-4eb4-89c8-531b8110312a")
    difficult = next(x for x in dev if x["empty"])
    coco_dir = Path(split["source_index"]["path"]).parent / "dev"
    coco = json.loads((coco_dir / "_annotations.coco.json").read_bytes())
    checks = []
    for item in (good, difficult):
        image_path = Path(item["source_image"]["local_path"])
        label_path = Path(item["source_label"]["local_path"])
        # Hash AFTER processing: originals still have publisher acquisition pins.
        assert sha(image_path) == item["source_image"]["sha256"]
        assert sha(label_path) == item["source_label"]["sha256"]
        published = json.loads(label_path.read_bytes())["features"]
        image = next(x for x in coco["images"] if x["source_id"] == item["id"])
        annotations = [x for x in coco["annotations"] if x["image_id"] == image["id"]]
        assert len(annotations) == len(published)
        with rasterio.open(image_path) as ds:
            source_rgb = ds.read().transpose(1, 2, 0)
            assert np.array_equal(source_rgb, np.asarray(Image.open(coco_dir / image["file_name"])))
            for annotation, feature in zip(annotations, published):
                rle = annotation["segmentation"]
                decoded = mask_api.decode(mask_api.frPyObjects(rle, *rle["size"]))
                expected = rasterize([(feature["geometry"], 1)], out_shape=decoded.shape, transform=ds.transform, dtype="uint8")
                assert np.array_equal(decoded, expected)
            geod = Geod(ellps="WGS84")
            p0, px, py = [ds.transform * p for p in ((128, 128), (129, 128), (128, 129))]
            spacing = [geod.inv(*p0, *p)[2] for p in (px, py)]
        checks.append({"chip_id": item["id"], "role": "difficult_publisher_empty" if item["empty"] else "good_positive", "publisher_instances": len(annotations), "original_image_hash_unchanged": True, "original_label_hash_unchanged": True, "rgb_pixels_equal": True, "source_feature_to_coco_mask_equal": True, "source_pixel_spacing_geodesic_m": spacing})
    result = {"status": "passed", "chips": len(ids), "clusters": len(clusters), "whole_cluster_separation": True, "all_centroids_recompute_to_grid": True, "prior_observed_dev_only": True, "empty_chips_in_all_splits": True, "source_features_in_downloaded_karnataka": sum(x["publisher_features"] for x in items), "documentation_claim_features": 51335, "documentation_feature_count_discrepancy": "Downloaded original GeoJSONs contain 50666 features, not the README/PDF's 51335; no correction or synthetic padding. Evaluation denominators use actual originals.", "real_inputs": checks, "model_calls": 0, "holdout_model_calls": 0}
    output = EVIDENCE / "data/verification.json"
    if output.exists():
        assert json.loads(output.read_bytes()) == result, "Prior verification receipt differs; preserve it and diagnose"
    else:
        with output.open("x", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
            f.write("\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
