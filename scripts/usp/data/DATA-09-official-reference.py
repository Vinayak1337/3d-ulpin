#!/usr/bin/env python3
"""Bounded acquisition and source-byte checks for the DATA-09 official reference window.

The GMDA service is an official authority endpoint. Its responses stay outside Git
until redistribution permission is documented. This script never fabricates features.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import shutil
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parents[3]
PACK = HERE / "fixtures/usp/D4/reference-area-gurugram-59-63a"
PRIVATE = Path("/Users/vinayak/.codex/task-data/ulpin-data-09")
LGD = HERE / "fixtures/usp/D4/gf0-structured-codes-v1/lgd-districts.csv"
RERA = "https://haryanarera.gov.in/view_project/project_preview_open/2831"
GMDA = "https://onemapdepts.gmda.gov.in/server/rest/services/Toilet2/MapServer"
MAX_BYTES = 2_000_000


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def fetch(url: str, destination: Path) -> dict:
    if destination.exists():
        raise FileExistsError(f"Original already retained: {destination}")
    request = urllib.request.Request(url, headers={"User-Agent": "DATA-09-official-source-check/1"})
    with urllib.request.urlopen(request, timeout=25) as response:
        content_type = response.headers.get("Content-Type", "").split(";")[0]
        data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError(f"Source exceeds {MAX_BYTES} byte bound: {url}")
        if response.status != 200:
            raise ValueError(f"HTTP {response.status}: {url}")
        result = {"url": url, "httpStatus": response.status, "contentType": content_type,
                  "bytes": len(data), "sha256": digest(data),
                  "acquiredAt": datetime.now(timezone.utc).isoformat(),
                  "privateFile": destination.name}
    destination.write_bytes(data)
    return result


def query(layer: int, params: dict) -> str:
    return f"{GMDA}/{layer}/query?" + urllib.parse.urlencode(params)


def sector_url() -> str:
    return query(18, {"where": "Name IN ('59','63 A')", "outFields": "FID,Name,Area",
                      "returnGeometry": "true", "outSR": "32643", "f": "json"})


def source_features(path: Path) -> list[dict]:
    value = json.loads(path.read_bytes())
    if value.get("error") or value.get("exceededTransferLimit"):
        raise ValueError(f"GIS error or truncated response: {path.name}")
    if value.get("spatialReference", {}).get("wkid") != 32643:
        raise ValueError(f"Unexpected official GIS response CRS: {path.name}")
    return value["features"]


def window_from_sectors(features: list[dict]) -> dict:
    by_name = {feature["attributes"]["Name"]: feature for feature in features}
    if set(by_name) != {"59", "63 A"} or len(features) != 2:
        raise ValueError("Official sector query did not return exactly 59 and 63 A")
    def vertices(feature: dict) -> set[tuple[float, float]]:
        return {tuple(point) for ring in feature["geometry"]["rings"] for point in ring}
    shared = vertices(by_name["59"]) & vertices(by_name["63 A"])
    if len(shared) != 1:
        raise ValueError(f"Expected one shared source vertex, got {len(shared)}")
    x, y = next(iter(shared))
    return {"horizontalCrs": "EPSG:32643", "centreSource": "single identical vertex in official sector 59 and 63 A polygons",
            "centre": [x, y], "bbox": [x - 500, y - 500, x + 500, y + 500],
            "areaKm2": 1, "role": "analysis window only; not a site or plot boundary"}


def area_url(layer: int, bbox: list[float], fields: str) -> str:
    return query(layer, {"where": "1=1", "geometry": ",".join(str(x) for x in bbox),
                         "geometryType": "esriGeometryEnvelope", "inSR": "32643",
                         "spatialRel": "esriSpatialRelIntersects", "outFields": fields,
                         "returnGeometry": "true", "outSR": "32643", "f": "json"})


def acquire(private: Path) -> dict:
    private.mkdir(parents=True, exist_ok=True)
    original_names = ["rera-2831.html", "gmda-sectors-59-63a.json", "gmda-roads.json", "gmda-parks.json"]
    if any((private / name).exists() for name in original_names + ["acquisition-receipt.json"]):
        raise FileExistsError("DATA-09 originals or receipt exist; acquisition never overwrites them")
    records = {}
    records["rera"] = fetch(RERA, private / original_names[0])
    records["sectors"] = fetch(sector_url(), private / original_names[1])
    window = window_from_sectors(source_features(private / original_names[1]))
    records["roads"] = fetch(area_url(7, window["bbox"], "FID,Road_ID,Rd_Name,Type"),
                            private / original_names[2])
    records["parks"] = fetch(area_url(8, window["bbox"], "FID,Park_Code,Area"),
                            private / original_names[3])
    receipt = {"schemaVersion": "data-09-acquisition/1", "authority": {
        "rera": "Haryana Real Estate Regulatory Authority", "gis": "Gurugram Metropolitan Development Authority"},
        "privateRoot": str(private), "window": window, "records": records,
        "policy": "Official-source originals retained privately; no public accessibility-to-redistribution inference"}
    (private / "acquisition-receipt.json").write_bytes(canonical(receipt))
    return receipt


def check(private: Path) -> dict:
    receipt = json.loads((private / "acquisition-receipt.json").read_bytes())
    for record in receipt["records"].values():
        data = (private / record["privateFile"]).read_bytes()
        if digest(data) != record["sha256"] or len(data) != record["bytes"]:
            raise AssertionError(f"Original byte pin mismatch: {record['privateFile']}")
    page = (private / receipt["records"]["rera"]["privateFile"]).read_text(errors="replace")
    for literal in ("4S THE AURRUM", "VILLAGE ULLAHWAS", "BEHRAMPUR", "SECTOR 59", "63A GURUGRAM"):
        if literal not in page.upper():
            raise AssertionError(f"Source-stated project location literal absent: {literal}")
    sectors = source_features(private / receipt["records"]["sectors"]["privateFile"])
    window = window_from_sectors(sectors)
    if window != receipt["window"]:
        raise AssertionError("Analysis window no longer derives from pinned sector vertices")
    roads = source_features(private / receipt["records"]["roads"]["privateFile"])
    parks = source_features(private / receipt["records"]["parks"]["privateFile"])
    for name, geometry_type in (("sectors", "esriGeometryPolygon"),
                                ("roads", "esriGeometryPolyline"), ("parks", "esriGeometryPolygon")):
        response = json.loads((private / receipt["records"][name]["privateFile"]).read_bytes())
        if response.get("geometryType") != geometry_type:
            raise AssertionError(f"Official {name} geometry type changed")
    for name, features, key in (("roads", roads, "paths"), ("parks", parks, "rings")):
        for feature in features:
            if not feature.get("attributes", {}).get("FID") or not feature.get("geometry", {}).get(key):
                raise AssertionError(f"Official {name} feature missing ID or geometry")
    for name, features, key, minimum in (("sectors", sectors, "rings", 4),
                                         ("roads", roads, "paths", 2),
                                         ("parks", parks, "rings", 4)):
        for feature in features:
            for part in feature["geometry"][key]:
                if len(part) < minimum or (key == "rings" and part[0] != part[-1]):
                    raise AssertionError(f"Official {name} geometry not a closed ring or usable path")
                if any(len(point) < 2 or not all(isinstance(value, (int, float)) and math.isfinite(value)
                                                   for value in point[:2]) for point in part):
                    raise AssertionError(f"Official {name} geometry has invalid coordinates")
    with LGD.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        rows = [row for row in reader if row.get("district_name_english", "").strip().lower() == "gurugram"]
    if len(rows) != 1:
        # Column aliases are source-specific. Report them instead of silently guessing.
        with LGD.open(encoding="utf-8-sig", newline="") as stream:
            columns = csv.reader(stream).__next__()
        raise AssertionError(f"LGD Gurugram row count {len(rows)}; columns {columns}")
    result = {"schemaVersion": "data-09-source-check/1", "window": window,
            "sectorNames": sorted(f["attributes"]["Name"] for f in sectors),
            "sectorIds": sorted(f["attributes"]["FID"] for f in sectors),
            "roadCount": len(roads), "roadIds": sorted(f["attributes"]["FID"] for f in roads),
            "parkCount": len(parks), "lgdGurugramRow": rows[0],
            "originalHashes": {name: row["sha256"] for name, row in receipt["records"].items()},
            "limitations": ["GMDA redistribution/reuse terms unconfirmed", "Tower 3 has no source-located point or parcel geometry",
                            "The analysis window is a context clip, not an official site boundary"]}
    if PACK.exists():
        manifest = json.loads((PACK / "manifest.json").read_bytes())
        declared = {item["id"]: item for item in manifest["assets"]}
        if manifest["schemaVersion"] != "usp-data-pack/1" or manifest["packId"] != "D4":
            raise AssertionError("Canonical D4 pack contract identity changed")
        for name in ("sectors", "roads", "parks", "rera"):
            expected_id = {"sectors": "gmda-sector-boundaries", "roads": "gmda-road-centrelines",
                           "parks": "gmda-parks-query", "rera": "haryana-rera-2831-location"}[name]
            if declared[expected_id]["provenance"]["original"]["sha256"] != receipt["records"][name]["sha256"]:
                raise AssertionError(f"Pack original pin mismatch: {name}")
            if declared[expected_id]["permission"]["state"] != "unconfirmed":
                raise AssertionError(f"Unreviewed authority permission promoted: {name}")
        available = {item["id"]: item for item in manifest["assets"] if item["content"]["state"] == "available"}
        for name, item in available.items():
            data = (PACK / item["content"]["path"]).read_bytes()
            if digest(data) != item["content"]["sha256"] or len(data) != item["content"]["bytes"]:
                raise AssertionError(f"Pack subset hash or size mismatch: {name}")
        with (PACK / "lgd-gurugram.csv").open(encoding="utf-8", newline="") as stream:
            subset_rows = list(csv.DictReader(stream))
        if subset_rows != rows:
            raise AssertionError("Administrative extract differs from official source row")
        observed = json.loads((PACK / "source-observations.json").read_bytes())
        if observed["lgdGurugramRow"] != rows[0] or observed["sourceCounts"] != {
                "sectors": len(sectors), "roads": len(roads), "parks": len(parks)}:
            raise AssertionError("Source-derived observation summary differs from original bytes")
        result["packCheck"] = "passed: canonical manifest, original pins, available byte pins and exact LGD row"
    return result


def build_pack(private: Path) -> dict:
    """Write only small source-derived administrative bytes and pack metadata."""
    if PACK.exists():
        raise FileExistsError(f"Pack exists; refusing to overwrite {PACK}")
    observation = check(private)
    receipt = json.loads((private / "acquisition-receipt.json").read_bytes())
    PACK.mkdir(parents=True)
    columns = list(observation["lgdGurugramRow"])
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerow(observation["lgdGurugramRow"])
    subset = buffer.getvalue().encode("utf-8")
    (PACK / "lgd-gurugram.csv").write_bytes(subset)
    (PACK / "source-observations.json").write_bytes(canonical({
        "schemaVersion": "data-09-source-observations/1",
        "lgdGurugramRow": observation["lgdGurugramRow"],
        "originalHashes": observation["originalHashes"],
        "sourceCounts": {"sectors": len(observation["sectorIds"]),
                         "roads": observation["roadCount"], "parks": observation["parkCount"]},
        "status": "literal and count observations from official bytes; no source geometry, site location or runtime oracle"}))
    evidence = "docs/evidence/usp/finale/GF-DATA/DATA-09/attempt-1/source-check.json"
    acquisition = "docs/evidence/usp/finale/GF-DATA/DATA-09/attempt-1/acquisition-ledger.json"
    passed = lambda ref: {"status": "passed", "evidenceRef": ref}
    not_run = {"status": "not_run"}
    privacy = {"state": "unconfirmed", "reason": "No source-specific ML training permission observed"}
    def reference(crs=None, unit=None):
        return {"horizontalCrs": crs, "verticalReference": None,
                "horizontalUnit": unit, "verticalUnit": None, "sourceDate": None}
    def provenance(name, family, native_ids, crs, coverage, missing):
        source = receipt["records"][name]
        return {"schemaVersion": "usp-pack-provenance/1", "sourceFamily": family,
                "sourceRelease": None, "resourceId": None, "nativeIds": native_ids,
                "acquiredAt": source["acquiredAt"],
                "original": {"sha256": source["sha256"], "bytes": source["bytes"]},
                "parser": {"name": "Python json/HTML source-byte check", "version": None},
                "heightType": None, "benchmark": None, "coverage": coverage,
                "licenceFamily": None, "trainingPermission": privacy, "purpose": "test_only",
                "privacy": "Source original remains outside Git; RERA HTML may contain personal details" if name == "rera" else None,
                "subsetLineage": [], "missingCapabilities": missing,
                "stages": {"discovered": passed(acquisition), "acquired": passed(acquisition),
                           "inspected": passed(evidence), "qualified": not_run, "tested": not_run},
                "qualificationScope": None}
    def private_asset(name, ident, family, media, kind, crs, unit, native, coverage, missing):
        source = receipt["records"][name]
        return {"id": ident, "mediaType": media, "classification": kind,
                "origin": {"kind": "external", "url": source["url"]},
                "sourceVersion": None, "attribution": family,
                "permission": {"state": "unconfirmed", "reason": "Authority endpoint is public; redistribution and scene reuse terms unverified"},
                "reference": reference(crs, unit),
                "content": {"state": "unavailable", "reason": "Original hash-pinned outside Git pending reuse qualification"},
                "dependencies": [], "verification": {"catalogue_checked": passed(acquisition),
                    "bytes_preserved": not_run, "parsed": not_run, "rendered": not_run, "workflow_verified": not_run},
                "provenance": provenance(name, family, native, crs, coverage, missing)}
    assets = [
        private_asset("sectors", "gmda-sector-boundaries", "Gurugram Metropolitan Development Authority",
                      "application/json", "observed", "EPSG:32643", "metre", ["FID:165", "FID:166"],
                      "Official sector 59 and 63 A source polygons; 1 km² analysis window uses their shared vertex",
                      ["redistribution_permission", "survey_accuracy", "site_polygon"]),
        private_asset("roads", "gmda-road-centrelines", "Gurugram Metropolitan Development Authority",
                      "application/json", "observed", "EPSG:32643", "metre",
                      [f"FID:{item}" for item in observation["roadIds"]],
                      "Two official road features intersect the analysis window", ["redistribution_permission", "legal_road_width"]),
        private_asset("parks", "gmda-parks-query", "Gurugram Metropolitan Development Authority",
                      "application/json", "unknown", "EPSG:32643", "metre", [],
                      "Zero park features intersect the window", ["park_coverage", "redistribution_permission"]),
        private_asset("rera", "haryana-rera-2831-location", "Haryana Real Estate Regulatory Authority",
                      "text/html", "planned", None, None, ["project:2831"],
                      "Official address states Ullahwas and Behrampur, sectors 59 and 63A; no tower coordinate",
                      ["tower_3_position", "site_polygon", "redistribution_permission"]),
    ]
    lgd_bytes = LGD.read_bytes()
    lgd_provenance = {"schemaVersion": "usp-pack-provenance/1", "sourceFamily": "Ministry of Panchayati Raj LGD districts",
        "sourceRelease": None, "resourceId": "37231365-78ba-44d5-ac22-3deec40b9197", "nativeIds": ["district_code:62"],
        "acquiredAt": "2026-09-25T00:17:42.756870Z", "original": {"sha256": digest(lgd_bytes), "bytes": len(lgd_bytes)},
        "parser": {"name": "Python csv.DictReader", "version": None}, "heightType": None, "benchmark": None,
        "coverage": "One exact Gurugram district row derived from previously acquired LGD CSV; administrative label only",
        "licenceFamily": "GODL-India portal-wide notice; resource-specific licence field unverified",
        "trainingPermission": privacy, "purpose": "test_only", "privacy": None,
        "subsetLineage": [{"sourceSha256": digest(lgd_bytes), "operation": "Exact one-row Gurugram CSV extraction preserving source literal fields", "evidenceRef": evidence}],
        "missingCapabilities": ["district_polygon", "parcel_geometry", "site_location"],
        "stages": {"discovered": passed("docs/evidence/usp/finale/GF-DATA/DATA-01/acquisition.json"),
                   "acquired": passed("docs/evidence/usp/finale/GF-DATA/DATA-01/acquisition.json"),
                   "inspected": passed(evidence), "qualified": passed(evidence), "tested": passed(evidence)},
        "qualificationScope": "Literal official district code/name parser check only"}
    assets.append({"id": "lgd-gurugram.csv", "mediaType": "text/csv", "classification": "observed",
        "origin": {"kind": "external", "url": "https://www.data.gov.in/resource/local-government-directory-lgd-districts"},
        "sourceVersion": None, "attribution": "Ministry of Panchayati Raj LGD via data.gov.in",
        "permission": {"state": "documented", "reference": "https://data.gov.in/; GODL-India portal published-content notice",
                       "permittedUses": ["research", "demo", "redistribution"]},
        "reference": reference(), "content": {"state": "available", "path": "lgd-gurugram.csv",
                                            "sha256": digest(subset), "bytes": len(subset)},
        "dependencies": [], "verification": {"catalogue_checked": passed(acquisition), "bytes_preserved": passed(evidence),
            "parsed": passed(evidence), "rendered": not_run, "workflow_verified": not_run},
        "provenance": lgd_provenance})
    expected = (PACK / "source-observations.json").read_bytes()
    assets.append({"id": "source-observations.json", "mediaType": "application/json", "classification": "unknown",
        "origin": {"kind": "authored", "generatorRef": "DATA-09 deterministic observations from official source bytes"},
        "sourceVersion": "1", "attribution": "DATA-09 source-byte inspection",
        "permission": {"state": "documented", "reference": "Project-authored inspection metadata",
                       "permittedUses": ["research", "demo", "redistribution"]},
        "reference": reference(), "content": {"state": "available", "path": "source-observations.json",
                                            "sha256": digest(expected), "bytes": len(expected)},
        "dependencies": ["gmda-sector-boundaries", "gmda-road-centrelines", "lgd-gurugram.csv"],
        "verification": {"catalogue_checked": {"status": "not_applicable", "reason": "Derived check metadata"},
                         "bytes_preserved": passed(evidence), "parsed": passed(evidence),
                         "rendered": not_run, "workflow_verified": not_run}})
    manifest = {"schemaVersion": "usp-data-pack/1", "packId": "D4", "version": 1,
        "profile": "reference-area-gurugram-59-63a", "description": "Official Gurugram source checks for a 1 km² context window; GMDA scene reuse unqualified",
        "assets": assets, "expectedPath": "source-observations.json",
        "expectedCapabilities": ["official_administrative_label", "official_source_window_inspection"],
        "missingCapabilities": ["permitted_context_geometry", "terrain", "landuse", "water", "trees",
                                "context_buildings", "hero_building_placement", "underground_depth"]}
    (PACK / "manifest.json").write_bytes(canonical(manifest))
    return {"pack": str(PACK), "assetCount": len(assets), "sourceDerivedCsvSha256": digest(subset),
            "manifestSha256": digest((PACK / "manifest.json").read_bytes())}


def self_test(private: Path) -> dict:
    outcomes = []
    with tempfile.TemporaryDirectory(prefix="data09-hash-mutation-") as temporary:
        copy = Path(temporary) / "private"
        shutil.copytree(private, copy)
        path = copy / "gmda-roads.json"
        raw = bytearray(path.read_bytes())
        raw[-2] ^= 1
        path.write_bytes(raw)
        try:
            check(copy)
        except AssertionError as exc:
            if "Original byte pin mismatch: gmda-roads.json" not in str(exc):
                raise
            outcomes.append("changed official response byte rejected by SHA-256")
        else:
            raise AssertionError("Mutated official response was accepted")
    with tempfile.TemporaryDirectory(prefix="data09-shape-mutation-") as temporary:
        copy = Path(temporary) / "private"
        shutil.copytree(private, copy)
        path = copy / "gmda-roads.json"
        altered = json.loads(path.read_bytes())
        altered["features"][0]["geometry"]["paths"] = []
        new_bytes = canonical(altered)
        path.write_bytes(new_bytes)
        receipt_path = copy / "acquisition-receipt.json"
        receipt = json.loads(receipt_path.read_bytes())
        receipt["records"]["roads"].update({"sha256": digest(new_bytes), "bytes": len(new_bytes)})
        receipt_path.write_bytes(canonical(receipt))
        try:
            check(copy)
        except AssertionError as exc:
            if "Official roads feature missing ID or geometry" not in str(exc):
                raise
            outcomes.append("empty official road path rejected even with matching temporary hash")
        else:
            raise AssertionError("Empty road geometry was accepted")
    return {"mutationChecks": outcomes, "sourceOriginalsChanged": False}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["acquire", "check", "build-pack", "self-test"])
    parser.add_argument("--private-root", type=Path, default=PRIVATE)
    args = parser.parse_args()
    value = (acquire(args.private_root) if args.mode == "acquire" else
             build_pack(args.private_root) if args.mode == "build-pack" else
             self_test(args.private_root) if args.mode == "self-test" else check(args.private_root))
    print(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
