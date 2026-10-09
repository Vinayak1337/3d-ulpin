"""Resumable public RAMP acquisition; immutable originals, paged Azure inventory.

Only creates originals under a NEW owned root. .part files are transfer state,
never labelled originals. Resume validates completed files against journal pins.
One writer per root; checkpoints manifest after each region and every 250 files.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

BASE = "https://radiantearth.blob.core.windows.net/mlhub/"
PREFIX = "repositories/ramp/ramp/"
REGIONS = ["karnataka_india", "dhaka_bangladesh", "sylhet_bangladesh", "chittagong_bangladesh", "barishal_bangladesh", "jashore_bangladesh", "coxs_bazar_bangladesh"]
ATTRIBUTION = "RAMP (Replicable AI for Microplanning), DevGlobal / TaQadam / B.O.T; Maxar Open Data Program imagery; distributed by Radiant Earth MLHub"


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def utc():
    return datetime.now(timezone.utc).isoformat()


def listing(root, region):
    directory = root / "inventory" / region
    directory.mkdir(parents=True, exist_ok=True)
    marker, page, blobs = "", 0, []
    while True:
        params = {"restype": "container", "comp": "list", "prefix": PREFIX + "ramp_" + region + "/", "maxresults": "5000", "marker": marker}
        url = BASE.rstrip("/") + "?" + urllib.parse.urlencode(params)
        target = directory / f"page-{page:03}.xml"
        if target.exists():
            raw = target.read_bytes()
        else:
            raw = urllib.request.urlopen(url, timeout=90).read()
            with target.open("xb") as f:
                f.write(raw)
        xml = ET.fromstring(raw)
        for blob in xml.findall("./Blobs/Blob"):
            name = blob.findtext("Name")
            if not name.startswith(PREFIX) or ".." in name.split("/"):
                raise ValueError("Unsafe publisher path")
            blobs.append({"url": BASE + urllib.parse.quote(name, safe="/"), "path": name[len(PREFIX):], "size": int(blob.findtext("Properties/Content-Length")), "etag": blob.findtext("Properties/Etag"), "region": region})
        marker = xml.findtext("NextMarker") or ""
        if not marker:
            return blobs
        page += 1


def download(root, item):
    path = root / "originals" / item["path"]
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.stat().st_size != item["size"]:
            raise ValueError(f"Original size mismatch; do not overwrite: {path}")
    else:
        part = path.with_name(path.name + ".part")
        start = part.stat().st_size if part.exists() else 0
        if start > item["size"]:
            raise ValueError(f"Oversize transfer state: {part}")
        if start != item["size"]:
            # Anonymous legacy Azure Blob API ignores standard Range unless an
            # explicit modern service version is supplied. Tested x-ms-range.
            headers = {"x-ms-range": f"bytes={start}-", "x-ms-version": "2023-11-03"} if start else {}
            with urllib.request.urlopen(urllib.request.Request(item["url"], headers=headers), timeout=90) as response:
                if start and (response.status != 206 or not response.headers.get("Content-Range", "").startswith(f"bytes {start}-")):
                    raise ValueError(f"Server did not honour resume range: status={response.status}, Content-Range={response.headers.get('Content-Range')!r}")
                with part.open("ab" if start else "wb") as f:
                    while chunk := response.read(1024 * 1024):
                        f.write(chunk)
        if part.stat().st_size != item["size"]:
            raise ValueError("Incomplete transfer; retain .part to resume")
        # Hard-link promotion is atomic and cannot replace an existing original.
        os.link(part, path)
        part.unlink()
    return {**item, "local_path": path.as_posix(), "sha256": sha(path), "acquired_at": utc(), "licence": "CC-BY-NC-4.0", "licence_url": "https://creativecommons.org/licenses/by-nc/4.0/", "attribution": ATTRIBUTION, "issuer": "DevGlobal / Radiant Earth MLHub", "use": "test_only", "allocation": "spatial_split_pending" if item["region"] == "karnataka_india" else "TRAIN_only", "geography": "India/Karnataka" if item["region"] == "karnataka_india" else "Bangladesh/" + item["region"].removesuffix("_bangladesh"), "crs": "per_original_GeoTIFF; inspect_before_export", "vertical_reference": "not_applicable"}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", type=Path, default=Path("E:/BhuAayam-data/datasets/ramp"))
    p.add_argument("--regions", nargs="+", choices=REGIONS, default=REGIONS)
    p.add_argument("--workers", type=int, default=24)
    args = p.parse_args()
    root = args.root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    lock = root / "download.lock"
    # PID written for diagnosis; stale locks are explicitly owner-removable state.
    with lock.open("x") as f:
        f.write(str(os.getpid()))
    journal = root / "download-journal.jsonl"
    completed = {}
    if journal.exists():
        # A process can die during its final journal write. Retain that line,
        # recover only valid records and hash-recover its immutable original
        # through the normal pending path. Never truncate acquisition evidence.
        raw_journal = journal.read_text(encoding="utf-8")
        for number, line in enumerate(raw_journal.splitlines(), 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                print(json.dumps({"event": "torn_journal_line_preserved", "line": number}), flush=True)
                continue
            completed[record["path"]] = record
        if raw_journal and not raw_journal.endswith("\n"):
            with journal.open("a", encoding="utf-8") as f:
                f.write("\n")
    all_inventory = []
    failures = []
    def manifest():
        value = {"schema": "ramp-original-manifest/1", "updated_at": utc(), "source": BASE + PREFIX, "licence": "CC-BY-NC-4.0", "attribution": ATTRIBUTION, "use": "test_only", "files": sorted(completed.values(), key=lambda x: x["path"]), "download": {"pid": os.getpid(), "planned_files_seen": len(all_inventory), "completed_files": len(completed), "completed_bytes": sum(x["size"] for x in completed.values()), "failures": failures, "regions": args.regions}}
        temporary = root / "manifest.tmp"
        temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        temporary.replace(root / "manifest.json")
    try:
        with journal.open("a", encoding="utf-8", buffering=1) as log:
            for region in args.regions:
                inventory = listing(root, region)
                all_inventory.extend(inventory)
                pending = []
                for item in inventory:
                    old = completed.get(item["path"])
                    if old:
                        path = Path(old["local_path"])
                        if path.stat().st_size != old["size"] or sha(path) != old["sha256"]:
                            raise ValueError(f"Previously downloaded original changed: {path}")
                    else:
                        pending.append(item)
                print(json.dumps({"event": "region_start", "region": region, "files": len(inventory), "bytes": sum(x["size"] for x in inventory), "pending": len(pending), "at": utc()}), flush=True)
                with ThreadPoolExecutor(max_workers=args.workers) as executor:
                    futures = {executor.submit(download, root, item): item for item in pending}
                    for future in as_completed(futures):
                        try:
                            result = future.result()
                            completed[result["path"]] = result
                            log.write(json.dumps(result) + "\n")
                        except Exception as error:
                            failures.append({"path": futures[future]["path"], "error": str(error), "at": utc()})
                            print(json.dumps({"event": "failure", **failures[-1]}), flush=True)
                        if (len(completed) + len(failures)) % 250 == 0:
                            manifest()
                            print(json.dumps({"event": "progress", "completed": len(completed), "failures": len(failures), "at": utc()}), flush=True)
                manifest()
                print(json.dumps({"event": "region_complete", "region": region, "completed": len(completed), "at": utc()}), flush=True)
                if failures:
                    raise RuntimeError("Transfer failures retained; resume explicitly, no blind retry")
        print(json.dumps({"event": "complete", "files": len(completed), "bytes": sum(x["size"] for x in completed.values())}), flush=True)
    finally:
        lock.unlink()


if __name__ == "__main__":
    main()
