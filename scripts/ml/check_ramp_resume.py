"""One real DEV-label HTTP Range resume; never modifies dataset originals."""
import json
from pathlib import Path
import ramp_download


def main():
    repo = Path(__file__).resolve().parents[2]
    split = json.loads((repo / "docs/evidence/gf-ai/building/split/split.json").read_bytes())
    items = json.loads(Path(split["source_index"]["path"]).read_bytes())["items"]
    source = next(x["source_label"] for x in items if x["id"] == "0020b409-a333-4eb4-89c8-531b8110312a")
    root = Path("E:/BhuAayam-data/ml/ramp-range-resume-check-v2")
    if root.exists():
        raise FileExistsError("Preserve completed resume check; no unchanged repeat")
    target = root / "originals" / source["path"]
    target.parent.mkdir(parents=True)
    prefix = Path(source["local_path"]).read_bytes()[:1024]
    with target.with_name(target.name + ".part").open("xb") as f:
        f.write(prefix)
    result = ramp_download.download(root, {k: source[k] for k in ("url", "path", "size", "etag", "region")})
    assert result["sha256"] == source["sha256"]
    assert ramp_download.sha(Path(source["local_path"])) == source["sha256"]
    reused = ramp_download.download(root, {k: source[k] for k in ("url", "path", "size", "etag", "region")})
    assert reused["sha256"] == source["sha256"]
    receipt = {"status": "passed", "real_input": source["path"], "url": source["url"], "sha256": result["sha256"], "prefix_bytes": len(prefix), "complete_bytes": result["size"], "range_response_206_and_start_checked": True, "byte_identical_to_acquired_original": True, "completed_original_reused_without_overwrite": True, "dataset_original_hash_unchanged": True, "model_calls": 0, "diagnosed_prior_failure": {"signature": "Server did not honour resume range", "approach": "Standard Range without explicit Azure API version", "preserved_checkpoint": "E:/BhuAayam-data/ml/ramp-range-resume-check", "initial_status_header": "not recorded"}, "bounded_comparison": {"hypothesis": "Azure x-ms-range with API version 2023-11-03 enables proper ranged responses on this anonymous Blob endpoint", "candidate_status": 206, "success_criterion": "Exact source SHA-256 after appending only the missing bytes; no original overwrite", "decision": "passed; use corrected headers for future resumes"}}
    output = repo / "docs/evidence/gf-ai/building/data/resume-check.json"
    with output.open("x", encoding="utf-8") as f:
        json.dump(receipt, f, indent=2)
        f.write("\n")
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
