"""Acquire one public, pinned baseline outside the restricted inference child."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import urllib.request

MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
REVISION = "7ae557604adf67be50417f59c2c2f167def9a775"
FILES = ("LICENSE", "README.md", "config.json", "generation_config.json", "merges.txt",
         "model.safetensors", "tokenizer.json", "tokenizer_config.json", "vocab.json")


def acquire(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=False)
    api = f"https://huggingface.co/api/models/{MODEL}/revision/{REVISION}?blobs=true"
    with urllib.request.urlopen(api, timeout=60) as response:
        metadata_bytes = response.read(2 * 1024**2)
    metadata = json.loads(metadata_bytes)
    assert metadata["sha"] == REVISION and metadata["cardData"]["license"] == "apache-2.0"
    (destination / "upstream-metadata.json").write_bytes(metadata_bytes)
    entries = {entry["rfilename"]: entry for entry in metadata["siblings"]}
    receipts = []
    for name in FILES:
        expected = entries[name]
        url = f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}"
        path = destination / name
        digest = hashlib.sha256()
        git_digest = hashlib.sha1(f"blob {expected['size']}\0".encode())
        count = 0
        with urllib.request.urlopen(url, timeout=120) as response, path.open("xb") as output:
            while block := response.read(8 * 1024**2):
                output.write(block)
                digest.update(block)
                git_digest.update(block)
                count += len(block)
                if count > expected["size"]:
                    raise RuntimeError("upstream file exceeds pinned metadata size")
        assert count == expected["size"], name
        if "lfs" in expected:
            assert digest.hexdigest() == expected["lfs"]["sha256"], name
        else:
            assert git_digest.hexdigest() == expected["blobId"], name
        receipts.append({"file": name, "bytes": count, "sha256": digest.hexdigest(), "url": url,
                         "upstreamBlobId": expected["blobId"], "upstreamVerified": True})
        print(json.dumps({"downloaded": name, "bytes": count, "sha256": digest.hexdigest()}), flush=True)
    for name in ("config.json", "tokenizer_config.json"):
        assert not json.loads((destination / name).read_bytes()).get("auto_map"), "remote model code refused"
    receipt = {"model": MODEL, "revision": REVISION, "license": "apache-2.0", "acquiredAt": datetime.now(timezone.utc).isoformat(),
               "reason": "Small causal instruction model can emit cited structured JSON; retired yes/no reranker is unsuitable.",
               "files": receipts, "metadataSha256": hashlib.sha256(metadata_bytes).hexdigest(),
               "remoteCodeDownloaded": False, "pickleWeightsDownloaded": False,
               "qualification": "public development baseline; model quality and production launch not qualified"}
    with (destination / "acquisition.json").open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(receipt, stream, indent=2, sort_keys=True)
        stream.write("\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    acquire(parser.parse_args().destination)
