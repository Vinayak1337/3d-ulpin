"""Read only dataset metadata and ZIP directories; do not acquire or convert originals."""
import hashlib
import json
import os
import time
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path("E:/BhuAayam-data/datasets")
EXCLUDED = {"heldout", "holdout", "evaluator", "provisional", "acquisitions"}
FORMATS = {".zip", ".gpkg", ".shp", ".kml", ".kmz", ".geojson"}


def archive_inventory(path: Path) -> dict[str, Any]:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    with zipfile.ZipFile(path) as archive:
        members = []
        for entry in archive.infolist():
            member = {"member": entry.filename, "bytes": entry.file_size}
            if entry.filename.endswith(".geojson") and entry.file_size <= 16 * 1024 * 1024:
                document = json.loads(archive.read(entry))
                member["features"] = len(document.get("features", []))
            members.append(member)
    assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
    return {"sha256": digest, "originalHashUnchanged": True, "members": members,
            "shapefileMembers": [item for item in members if item["member"].lower().endswith(".shp")]}


def scan() -> tuple[dict[str, int], list[dict[str, Any]]]:
    counts = {extension: 0 for extension in sorted(FORMATS)}
    selected = []
    for folder, directories, files in os.walk(ROOT):
        directories[:] = [name for name in directories if name.lower() not in EXCLUDED]
        for name in files:
            path = Path(folder) / name
            extension = path.suffix.lower()
            if extension not in FORMATS:
                continue
            counts[extension] += 1
            size = path.stat().st_size
            if extension == ".geojson" and size <= 16 * 1024 * 1024:
                continue
            entry = {"path": path.as_posix(), "bytes": size}
            if extension == ".zip":
                entry.update(archive_inventory(path))
            selected.append(entry)
    return counts, selected


def main() -> None:
    started = time.monotonic()
    counts, selected = scan()
    print(json.dumps({"task": "CA7", "root": ROOT.as_posix(), "excludedDirectories": sorted(EXCLUDED),
                      "seconds": round(time.monotonic() - started, 3), "extensionCounts": counts,
                      "binaryAndOversizedOriginals": selected,
                      "scope": "No .env opened; ordinary GeoJSON files counted by metadata only; "
                               "ZIP directory and bounded GeoJSON members read, no extraction or conversion."}))


if __name__ == "__main__":
    main()
