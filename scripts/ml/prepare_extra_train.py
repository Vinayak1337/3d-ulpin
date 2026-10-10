"""Prepare capped TRAIN-only COCO shards from extra RAMP regions already acquired with a complete manifest.

With --per-region every listed region gives that many chips, and a region that has fewer gives all of them
while the first listed region fills the shortfall. With --cap the regions are taken in the given order until the
cap is reached. Either way a region that must be cut keeps the chip ids whose SHA-256 is lowest: a rule on ids
alone, never on images, labels or predictions. Originals are reused in place after every pin is verified against
the acquisition manifest; every publisher feature and every empty chip of a kept chip is retained. No model is
loaded here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Any

from building_io import EVIDENCE, REPO, read_json, sha, write_json
from prepare_ramp import export, id_hash, region_items, reject_transfer_training, save_new

NEVER_TRAIN = {
    "karnataka_india": "DEV and holdout clusters live in this region; its TRAIN split is already frozen",
    "sylhet_bangladesh": "kept untouched for a later transfer test",
}
README_CLAIM = re.compile(r"contains ([\d,]+) tiles and ([\d,]+) individual buildings")
README_DOI = re.compile(r"https://doi\.org/(\S+)")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("E:/BhuAayam-data/datasets/ramp"))
    parser.add_argument("--regions", nargs="+", required=True, help="Publisher regions, in priority order")
    share = parser.add_mutually_exclusive_group(required=True)
    share.add_argument("--per-region", type=int, help="Chips from each region; the first fills a shortfall")
    share.add_argument("--cap", type=int, help="Most extra chips kept, regions taken in order")
    parser.add_argument("--shard-pattern", required=True, help="New directory per region; {region} is replaced")
    parser.add_argument("--summary", type=Path, required=True, help="New compact receipt for the repository")
    args = parser.parse_args()
    if (args.per_region or args.cap) < 1 or "{region}" not in args.shard_pattern:
        parser.error("A positive chip count and a shard pattern containing {region} are required")
    return args


def refuse_closed_region(region: str) -> None:
    if region in NEVER_TRAIN:
        raise ValueError(f"{region} is never extra training data: {NEVER_TRAIN[region]}")
    reject_transfer_training(region)


def closed_chip_lists() -> dict[str, list[str]]:
    """Chip ids no extra training chip may share: Karnataka DEV/holdout and every frozen transfer set."""
    split = read_json(EVIDENCE / "split/split.json")["splits"]
    closed = {"karnataka_" + role: split[role]["chip_ids"] for role in ("dev", "holdout")}
    preregistration = read_json(REPO / "docs/evidence/gf-ai/preregistration.json")
    for key, entry in preregistration.items():
        if not key.startswith("building_mask_transfer"):
            continue
        chip_ids = json.loads(Path(entry["holdout"]["chip_ids_path"]).read_bytes())
        if id_hash(chip_ids) != entry["holdout"]["chip_ids_sha256"]:
            raise ValueError(f"Frozen transfer chip list drift: {key}")
        closed[entry["region"]] = chip_ids
    return closed


def keep_lowest_hashes(chip_ids: list[str], limit: int) -> set[str]:
    """The cap rule: sort the ids, keep those whose SHA-256 is lowest."""
    ranked = sorted(sorted(chip_ids), key=lambda chip_id: hashlib.sha256(chip_id.encode()).hexdigest())
    return set(ranked[:limit])


def region_limits(sizes: dict[str, int], per_region: int | None, cap: int | None) -> dict[str, int]:
    """Chips each region may keep: an equal share with the first region filling shortfalls, or in order to a cap."""
    if per_region is None:
        limits: dict[str, int] = {}
        for region, size in sizes.items():
            limits[region] = min(size, cap - sum(limits.values()))
        return limits
    limits = {region: min(size, per_region) for region, size in sizes.items()}
    first = next(iter(sizes))
    shortfall = per_region * len(sizes) - sum(limits.values())
    limits[first] = min(sizes[first], limits[first] + shortfall)
    return limits


def counts(items: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "chips": len(items),
        "publisher_features": sum(item["publisher_features"] for item in items),
        "empty_chips": sum(item["empty"] for item in items),
    }


def exclusion_proof(kept: list[dict[str, Any]], closed: dict[str, list[str]]) -> dict[str, Any]:
    kept_ids = {item["id"] for item in kept}
    kept_clusters = {item["cluster_id"] for item in kept}
    split = read_json(EVIDENCE / "split/split.json")["splits"]
    closed_clusters = set(split["dev"]["cluster_ids"]) | set(split["holdout"]["cluster_ids"])
    lists = {
        name: {"chips": len(ids), "chip_ids_sha256": id_hash(ids), "shared_with_kept": len(kept_ids & set(ids))}
        for name, ids in closed.items()
    }
    shared_clusters = len(kept_clusters & closed_clusters)
    if shared_clusters or any(record["shared_with_kept"] for record in lists.values()):
        raise ValueError("A kept chip belongs to a closed list or a Karnataka DEV/holdout cluster")
    return {
        "method": "Set intersection of publisher chip ids; cluster ids for the Karnataka DEV/holdout cells",
        "kept_chip_ids_sha256": id_hash(kept_ids),
        "closed_lists": lists,
        "karnataka_dev_holdout_clusters_shared_with_kept": shared_clusters,
    }


def source_card(root: Path, region: str, items: list[dict[str, Any]], manifest_sha256: str) -> dict[str, Any]:
    readme = root / "originals" / ("ramp_" + region) / "README.md"
    text = readme.read_text(encoding="utf-8")
    claim = README_CLAIM.search(text)
    doi = README_DOI.search(text)
    pins = [pin for item in items for pin in (item["source_image"], item["source_label"])]
    acquired = sorted(pin["acquired_at"] for pin in pins)
    return {
        "region": region,
        "issuer": pins[0]["issuer"],
        "attribution": pins[0]["attribution"],
        "publisher_url": pins[0]["url"].rsplit("/", 2)[0] + "/",
        "doi": doi.group(1) if doi else None,
        "licence": pins[0]["licence"],
        "use": "test_only",
        "allocation": "TRAIN_only",
        "acquired_at": {"first": acquired[0], "last": acquired[-1]},
        "originals": str(readme.parent),
        "originals_reused_in_place": True,
        "manifest": str(root / "manifest.json"),
        "manifest_sha256": manifest_sha256,
        "original_files_verified_by_size_and_sha256": len(pins),
        "readme_sha256": sha(readme),
        "readme_tiles_claim": int(claim.group(1).replace(",", "")) if claim else None,
        "readme_buildings_claim": int(claim.group(2).replace(",", "")) if claim else None,
        "observed": counts(items),
        "count_discrepancy_policy": "Publisher README totals are recorded beside the observed originals; "
        "the observed features are kept as they are, never padded, relabelled or repaired",
    }


def write_shard(target: Path, kept: list[dict[str, Any]], card: dict[str, Any]) -> dict[str, Any]:
    target.mkdir(parents=True, exist_ok=False)
    save_new(target / "source-card.json", card)
    save_new(target / "source-index.json", {"items": kept})
    save_new(target / "chip-ids.json", sorted(item["id"] for item in kept))
    result = export(kept, target / "coco", "train")
    result.update(region=card["region"], role="extra_train", source_hashes_verified=True, model_calls=0)
    result["source_index_sha256"] = sha(target / "source-index.json")
    result["chip_ids_sha256"] = id_hash(item["id"] for item in kept)
    save_new(target / "export-result.json", result)
    return {"data_root": str(target), "train_root": str(target / "coco/train"), **result}


def prepare_region(
    args: argparse.Namespace, region: str, items: list[dict[str, Any]], limit: int, manifest_sha256: str
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    kept_ids = keep_lowest_hashes([item["id"] for item in items], limit)
    kept = [item for item in items if item["id"] in kept_ids]
    card = source_card(args.root, region, items, manifest_sha256)
    record = {**card, "kept": counts(kept), "cut_by_cap": len(items) - len(kept), "shard": None}
    if kept:
        name = region.removesuffix("_bangladesh").replace("_", "-")
        record["shard"] = write_shard(Path(args.shard_pattern.format(region=name)), kept, card)
    return record, kept


def main() -> None:
    args = parse_arguments()
    root = args.root.resolve()
    args.root = root
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_bytes())
    if manifest["download"]["failures"] or manifest["download"]["completed_files"] != len(manifest["files"]):
        raise ValueError("Acquisition manifest is incomplete; acquire fresh instead of reusing it")
    manifest_sha256 = sha(manifest_path)
    closed = closed_chip_lists()
    for region in args.regions:
        refuse_closed_region(region)
    items = {region: region_items(root, region, manifest) for region in args.regions}
    sizes = {region: len(chips) for region, chips in items.items()}
    limits = region_limits(sizes, args.per_region, args.cap)
    regions = []
    kept_all: list[dict[str, Any]] = []
    for region in args.regions:
        record, kept = prepare_region(args, region, items[region], limits[region], manifest_sha256)
        regions.append(record)
        kept_all.extend(kept)
        print(json.dumps({"region": region, "kept": record["kept"], "cut_by_cap": record["cut_by_cap"]}), flush=True)
    summary = {
        "schema": "building-extra-train-preparation/1",
        "cap": args.cap or args.per_region * len(args.regions),
        "per_region": args.per_region,
        "cap_rule": (
            "An equal share per region, the first region filling a shortfall; "
            if args.per_region
            else "Regions in the listed order; "
        )
        + "a cut region keeps the chip ids whose SHA-256 is lowest",
        "region_order": args.regions,
        "region_limits": limits,
        "kept_total": counts(kept_all),
        "regions": regions,
        "exclusion": exclusion_proof(kept_all, closed),
        "chip_sizes": sorted({(item["width"], item["height"]) for item in kept_all}),
        "tiling": "One source tile per kept chip when no edge exceeds 512 (B3 tiling: tiles <=512, stride 384)",
        "model_calls": 0,
    }
    if any(max(size) > 512 for size in summary["chip_sizes"]):
        raise ValueError("A kept chip exceeds one 512-pixel source tile; explicit tiling required")
    args.summary.parent.mkdir(parents=True, exist_ok=True)
    write_json(args.summary, summary)
    print(json.dumps(summary["kept_total"]), flush=True)


if __name__ == "__main__":
    main()
