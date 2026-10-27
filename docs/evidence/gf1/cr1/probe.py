"""Read immutable originals; compare complete results with the branch's pinned baseline."""
from __future__ import annotations

import base64
import hashlib
import json
import subprocess
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "services/geo"))
BASE = "8d234b153b122007d827e88d6197916487a65895"
DA5 = Path("E:/BhuAayam-data/datasets/map-formats/niagara-falls/"
           "Niagara_Falls_Condominiums_7254610803234545967.geojson")
NYC = Path("E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson")


def baseline(path: str, name: str) -> types.ModuleType:
    source = subprocess.check_output(["git", "show", f"{BASE}:{path}"], cwd=ROOT).decode("utf-8")
    module = types.ModuleType(f"geo.cr1_baseline_{name}")
    module.__package__ = "geo"
    sys.modules[module.__name__] = module
    if name == "inspection":
        source = source.replace("from .area import ", "from .cr1_baseline_area import ")
    exec(compile(source, path, "exec"), module.__dict__)
    return module


def payload(source: dict, id_field: str, kind: str) -> dict:
    return {"format": "geojson", "data": source, "mapping": {"kind": kind, "idField": id_field}}


def refusal(work) -> str:
    from geo.validation import InputError
    try:
        work()
    except InputError as error:
        return str(error)
    raise AssertionError("Expected refusal")


def digest(value: dict) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def main() -> None:
    from geo.area import normalize_area
    old_area = baseline("services/geo/geo/area.py", "area")
    old_inspection = baseline("services/geo/geo/gis_inspection.py", "inspection")
    raw = DA5.read_bytes()
    source = json.loads(raw)
    request = payload(source, "OBJECTID", "parcel")
    inspection = {"base64": base64.b64encode(raw).decode("ascii")}
    undeclared = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": "control", "properties": {},
         "geometry": {"type": "Point", "coordinates": [500000, 3100000]}}]}
    no_crs = {"format": "geojson", "data": undeclared, "mapping": {"kind": "utility"}}
    nyc_request = payload(json.loads(NYC.read_bytes()), "doitt_id", "building")
    old = old_area.normalize_area(nyc_request)
    current = normalize_area(nyc_request)
    control = {"format": "geojson", "data": {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": "control", "properties": {}, "geometry": {"type": "Polygon",
         "coordinates": [[[77, 28], [77.0001, 28], [77.0001, 28.0001], [77, 28.0001], [77, 28]]]}}]},
        "mapping": {"kind": "building"}}
    before_control = old_area.normalize_area(control)
    after_control = normalize_area(control)
    result = {"baseCommit": BASE, "path": str(DA5), "bytes": len(raw),
              "sha256": hashlib.sha256(raw).hexdigest(), "declaration": source["crs"],
              "normalizerRefusal": refusal(lambda: old_area.normalize_area(request)),
              "inspectionRefusal": refusal(lambda: old_inspection.inspect_gis(inspection)),
              "undeclaredOutsideDegrees": {
                  "input": "Synthetic Point [500000, 3100000], no crs; pure functions only",
                  "check": "_geometry.position geographic bounds, fatal InputError, not quarantine",
                  "normalizerWords": refusal(lambda: old_area.normalize_area(no_crs)),
                  "inspectionWords": refusal(lambda: old_inspection.inspect_gis({
                      "base64": base64.b64encode(json.dumps(undeclared).encode()).decode()})),
                  "actionable": "Reports bounds but not missing declaration; clarify only this failure."},
              "undeclaredWholeOutput": {"input": "Synthetic bounded polygon; no declaration",
                                        "before": digest(before_control), "after": digest(after_control),
                                        "identical": before_control == after_control},
              "nycWholeOutput": {"path": str(NYC), "features": len(old["features"]),
                                 "canonical": "UTF-8, sorted keys, compact separators, ensure_ascii=False",
                                 "before": digest(old), "after": digest(current), "identical": old == current}}
    print(json.dumps(result))
    assert old == current
    assert before_control == after_control


if __name__ == "__main__":
    main()
