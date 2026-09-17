"""Acquire public geometry without credentials; never infer owners or inhabitants.

Run in the project's existing geo image with /work bound to the acquisition folder.
Raw Google CSV rows remain available separately from application-format derivatives.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import os
import shutil
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from shapely import wkt
from shapely.geometry import Point, Polygon, box, mapping, shape
from shapely.ops import transform
from shapely.prepared import prep
from pyproj import Transformer

ROOT = Path(os.environ.get("ULPIN_ACQUISITION_DIR", "/work"))
DOWNLOADS = ROOT / "downloads"
OUTPUT = ROOT / "data"
USER_AGENT = "3DULPIN-AcademicDemo/1.0 (bounded public geometry research)"


def now():
    return datetime.now(timezone.utc).isoformat()


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url, destination, cap=8_500_000_000):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        print(f"PRESERVE existing {destination.name}: {destination.stat().st_size} bytes", flush=True)
        return
    temporary = destination.with_name(destination.name + ".partial")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as target:
        total = int(response.headers.get("Content-Length", 0))
        if total > cap:
            raise RuntimeError(f"Download exceeds explicit size cap: {total} bytes")
        written = 0
        next_report = 0
        started = time.monotonic()
        while chunk := response.read(4 * 1024 * 1024):
            written += len(chunk)
            if written > cap:
                raise RuntimeError("Download exceeded size cap")
            target.write(chunk)
            if written >= next_report:
                print(f"DOWNLOAD {destination.name}: {written / 1e6:.1f}/{total / 1e6:.1f} MB, {time.monotonic()-started:.1f}s", flush=True)
                next_report = written + 100_000_000
        if total and written != total:
            raise RuntimeError("Incomplete response; partial download is not accepted")
    temporary.replace(destination)
    save(destination.with_name(destination.name + ".provenance.json"), {
        "url": url, "downloadedAt": now(), "bytes": written, "sha256": digest(destination)
    })


def plan():
    candidates = load(DOWNLOADS / "delhi-nominatim.json")
    summaries = [{k: candidate.get(k) for k in ("osm_type", "osm_id", "type", "name", "display_name", "boundingbox")} for candidate in candidates]
    print("DELHI CANDIDATES", json.dumps(summaries, ensure_ascii=False), flush=True)
    candidate = next((row for row in candidates if row.get("geojson", {}).get("type") in ("Polygon", "MultiPolygon") and row.get("name") == "Delhi"), None)
    if not candidate:
        raise RuntimeError("No unambiguous Delhi polygon; do not substitute a search bounding box")
    boundary = shape(candidate["geojson"])
    if not boundary.is_valid:
        raise RuntimeError("Delhi source boundary invalid; explicit repair required")
    intersecting = [tile for tile in load(DOWNLOADS / "google-v3-tiles.geojson")["features"] if shape(tile["geometry"]).intersects(boundary)]
    thresholds = list(csv.DictReader((DOWNLOADS / "google-v3-score-thresholds.csv").open(encoding="utf-8")))
    centre = load(DOWNLOADS / "uttam-nagar-nominatim.json")[0]
    if centre.get("name") != "Uttam Nagar":
        raise RuntimeError("Unexpected neighbourhood resolution")
    report = {
        "createdAt": now(), "provider": "Google Research Open Buildings V3", "inferenceMonth": "2023-05",
        "sourcePage": "https://sites.research.google/gr/open-buildings/", "googleLicenseChoice": "CC-BY-4.0",
        "boundary": {"source": "OpenStreetMap via Nominatim", "osmType": candidate["osm_type"], "osmId": candidate["osm_id"], "name": candidate["display_name"], "bounds": list(boundary.bounds), "license": "ODbL-1.0", "authority": "Community administrative boundary; not cadastral evidence"},
        "uttamNagar": {"source": "OpenStreetMap via Nominatim", "osmId": centre["osm_id"], "longitude": float(centre["lon"]), "latitude": float(centre["lat"]), "name": centre["display_name"], "note": "Place node, not an official block boundary"},
        "tiles": [{**tile["properties"], "threshold": next((r for r in thresholds if r.get("s2_token") == tile["properties"]["tile_id"]), None)} for tile in intersecting],
        "estimatedDownloadMB": sum(tile["properties"]["size_mb"] for tile in intersecting),
        "limits": ["Footprints are model predictions, not surveyed legal parcels", "No building heights, floorplans, residents, addresses or ownership supplied", "Download date is not imagery capture date"]
    }
    save(OUTPUT / "delhi-boundary-osm.geojson", {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": candidate["geojson"], "properties": report["boundary"]}]})
    save(ROOT / "source-plan.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


def fetch_tiles():
    for tile in load(ROOT / "source-plan.json")["tiles"]:
        download(tile["tile_url"], DOWNLOADS / f"{tile['tile_id']}_buildings.csv.gz")


def extract_delhi():
    plan_data = load(ROOT / "source-plan.json")
    boundary = shape(load(OUTPUT / "delhi-boundary-osm.geojson")["features"][0]["geometry"])
    prepared = prep(boundary)
    west, south, east, north = boundary.bounds
    centre = plan_data["uttamNagar"]
    # A broad local cache supports explicit later selection of a street block.
    local_box = box(centre["longitude"]-.012, centre["latitude"]-.012, centre["longitude"]+.012, centre["latitude"]+.012)
    counts = {"scannedRows": 0, "delhiRows": 0, "localRows": 0}
    local_features = []
    target_path = OUTPUT / "delhi-google-open-buildings-v3.csv.gz"
    if target_path.exists():
        raise RuntimeError("Delhi extract already exists; preserving it. Use a new acquisition directory to repeat.")
    with gzip.open(target_path, "wt", encoding="utf-8", newline="") as out:
        for tile in plan_data["tiles"]:
            tile_path = DOWNLOADS / f"{tile['tile_id']}_buildings.csv.gz"
            with gzip.open(tile_path, "rt", encoding="utf-8", newline="") as source:
                header_line = source.readline()
                fields = next(csv.reader([header_line]))
                if fields[:2] != ["latitude", "longitude"]:
                    raise RuntimeError("Unexpected Google CSV coordinate column order")
                if counts["scannedRows"] == 0:
                    out.write(header_line)
                for line_number, line in enumerate(source, 2):
                    counts["scannedRows"] += 1
                    # Coordinates are the first two unquoted numeric fields in
                    # the verified provider schema. Avoid parsing millions of
                    # irrelevant WKT strings, but preserve selected rows verbatim.
                    latitude, longitude, _ = line.split(",", 2)
                    lon, lat = float(longitude), float(latitude)
                    if west <= lon <= east and south <= lat <= north and prepared.covers(Point(lon, lat)):
                        out.write(line)  # Retain exact source field values, WKT and row text.
                        counts["delhiRows"] += 1
                        if local_box.covers(Point(lon, lat)):
                            values = next(csv.reader([line]))
                            row = dict(zip(fields, values))
                            geometry = wkt.loads(row["geometry"])
                            local_features.append({"type": "Feature", "geometry": mapping(geometry), "properties": {
                                "source_id": f"gob-v3-{tile['tile_id']}-{line_number}",
                                "full_plus_code": row["full_plus_code"], "confidence": float(row["confidence"]),
                                "google_area_m2": float(row["area_in_meters"]), "google_wkt": row["geometry"],
                                "google_tile": tile["tile_id"], "google_csv_row": line_number,
                                "name": f"Google footprint {row['full_plus_code']}",
                                "source_notice": "Google V3 model detection, May 2023 inference; no measured height or legal parcel evidence",
                            }})
                            counts["localRows"] += 1
                    if counts["scannedRows"] % 500000 == 0:
                        print("EXTRACT", json.dumps(counts), flush=True)
    save(OUTPUT / "uttam-nagar-neighbourhood-google-v3.geojson", {
        "type": "FeatureCollection", "selection": {"bounds": list(local_box.bounds), "method": "Centroid-in-window cache; not an administrative boundary", "source": plan_data["sourcePage"]}, "features": local_features
    })
    save(ROOT / "delhi-extract-report.json", {**counts, "finishedAt": now(), "selectionRule": "Google polygon centroid inside OpenStreetMap Delhi boundary, all source confidence values retained", "boundary": plan_data["boundary"], "extract": {"file": target_path.name, "bytes": target_path.stat().st_size, "sha256": digest(target_path)}, "tiles": plan_data["tiles"]})
    print("EXTRACT COMPLETE", json.dumps(counts), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("plan", "download", "extract"))
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    {"plan": plan, "download": fetch_tiles, "extract": extract_delhi}[args.stage]()
