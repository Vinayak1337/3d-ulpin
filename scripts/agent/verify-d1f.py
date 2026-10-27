"""Read-only restart integrity and measured dictionary coverage for the D1f development pack."""
from __future__ import annotations

import argparse
import csv
import importlib.util
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
TASK_ROOT = Path("E:/BhuAayam-data/task-data/d1f")
DATA_ROOT = Path("E:/BhuAayam-data/datasets/open-property-foreign/dev/d1f")
MANIFEST = ROOT / "fixtures/usp/D8-open-property-foreign/manifest.json"
REPORT = ROOT / "docs/evidence/gf-agent/d1f/families.json"
Row = dict[str, Any]


def load_module(path: Path, name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def recorded_pins(value: Any) -> list[Row]:
    if isinstance(value, list):
        return [pin for item in value for pin in recorded_pins(item)]
    if not isinstance(value, dict):
        return []
    result = []
    if "sha256" in value and "bytes" in value and ("externalPath" in value or "path" in value):
        result.append(value)
    return result + [pin for item in value.values() for pin in recorded_pins(item)]


def checked_pin(pin: Row, acquisition: Any) -> Path:
    path = Path(pin.get("externalPath", pin.get("path")))
    assert any(path.resolve().is_relative_to(root.resolve()) for root in (TASK_ROOT, DATA_ROOT))
    assert not any(part.startswith(".env") for part in path.parts)
    assert path.stat().st_size == pin["bytes"], f"D1F_RESTART_SIZE_CHANGED: {path}"
    assert acquisition.digest(path) == pin["sha256"], f"D1F_RESTART_HASH_CHANGED: {path}"
    return path


def restart_integrity(acquisition: Any) -> Row:
    receipts = [*sorted((TASK_ROOT / "acquisitions").glob("*.json")),
                *sorted(TASK_ROOT.glob("discovery-v*.json")), TASK_ROOT / "discovery-disposition-final-v1.json"]
    recorded: set[Path] = set()
    for receipt in receipts:
        for pin in recorded_pins(json.loads(receipt.read_bytes())):
            recorded.add(checked_pin(pin, acquisition))
    files = [*sorted((TASK_ROOT / "provisional").glob("*")), *sorted(DATA_ROOT.rglob("*"))]
    unrecorded = [{"path": path.as_posix(), "bytes": path.stat().st_size}
                  for path in files if path.is_file() and path not in recorded]
    assert not unrecorded, f"D1F_RESTART_UNRECORDED_FILE: {json.dumps(unrecorded)}"
    return {"recordedFiles": len(recorded), "hashOrSizeMismatches": 0, "partialOrUnrecordedFiles": unrecorded}


def verify_prefix(asset: Row, acquisition: Any) -> None:
    pin = asset["profileInput"]
    checked_pin(pin, acquisition)
    assert pin["sourceSha256"] == asset["original"]["sha256"]
    with Path(asset["original"]["externalPath"]).open("rb") as stream:
        lines = acquisition.RecordedLines(stream)
        reader = csv.reader(lines)
        next(reader)
        for _ in range(pin["rows"]):
            next(reader)
        assert b"".join(lines.lines) == Path(pin["externalPath"]).read_bytes()
    source = TASK_ROOT / "executed-code" / f"{pin['scriptSha256']}.py"
    assert acquisition.digest(source) == pin["scriptSha256"]


def file_coverage(asset: Row, acquisition: Any) -> Row:
    original = checked_pin(asset["original"], acquisition)
    dictionary = checked_pin(asset["dictionary"], acquisition)
    metadata = json.loads(dictionary.read_bytes())
    screened = acquisition.screen(original, metadata)
    assert screened["rows"] == asset["sourceSchema"]["dataRows"]
    assert screened["columns"] == asset["sourceSchema"]["columnCount"]
    verify_prefix(asset, acquisition)
    columns = acquisition.native_columns(metadata)
    definitions = sum(bool((column.get("description") or "").strip()) for column in columns)
    geometry = [column for column in columns if column["dataTypeName"] in ("polygon", "multipolygon")]
    dataset_scope = len(geometry) == 1 and not (geometry[0].get("description") or "").strip()
    licence = metadata.get("license")
    assert asset["permission"]["licence"] == (licence["name"] if licence else "not stated")
    reference = asset["reference"]
    if "publisherDeclaredCrs" in reference:
        publisher_crs = metadata["metadata"]["custom_fields"]["Spatial"]["Coordinate System"]
        assert reference["publisherDeclaredCrs"] == publisher_crs
    return {
        "file": asset["id"], "issuer": asset["issuer"], "url": asset["origin"]["url"],
        "licenceAsPublished": licence, "permissionState": asset["permission"]["state"],
        "rows": screened["rows"], "columns": screened["columns"],
        "original": asset["original"], "dictionaryAcquired": True,
        "dictionary": {**asset["dictionary"], "documentedColumns": definitions,
                       "datasetScopeGeometryDescriptions": int(dataset_scope and bool(metadata.get("description")))},
    }


def family_coverage(manifest: Row, acquisition: Any) -> list[Row]:
    families = []
    for family in manifest["families"]:
        assert family["split"] == "dev" and family["id"] != "opf-d01"
        assets = [asset for asset in manifest["assets"] if asset["family"] == family["id"]]
        assert len(assets) == family["fileCount"]
        files = [file_coverage(asset, acquisition) for asset in assets]
        families.append({
            "family": family["id"], "issuer": family["publisher"], "geography": family["geography"],
            "fileCount": len(files), "rows": sum(file["rows"] for file in files),
            "columns": sum(file["columns"] for file in files),
            "documentedColumns": sum(file["dictionary"]["documentedColumns"] for file in files), "files": files,
        })
    assert sum(family["fileCount"] for family in families) == len(manifest["assets"])
    return families


def verify_indian_development() -> None:
    # Reuse only development checks. The historical main() opens private evaluator data and must not run here.
    verifier = load_module(ROOT / "fixtures/usp/D8-messy-india/verify-d1c.py", "d1c_development_verifier")
    manifest = verifier.load(ROOT / "fixtures/usp/D8-messy-india/manifest.json")
    verifier.verify_development(manifest)
    verifier.verify_derivatives(manifest)
    verifier.verify_catalogue()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--record", action="store_true", help="Exclusively create the measured family report")
    parser.add_argument("--indian-development", action="store_true", help="Also run development-only D8 checks")
    args = parser.parse_args()
    acquisition = load_module(Path(__file__).with_name("acquire-d1f.py"), "d1f_acquisition")
    integrity = restart_integrity(acquisition)
    manifest = json.loads(MANIFEST.read_bytes())
    assert manifest["purpose"] == "test_only" and not manifest["heldout"]
    report = {
        "manifest": MANIFEST.relative_to(ROOT).as_posix(), "manifestSha256": acquisition.digest(MANIFEST),
        "countScope": "Column instances per retained native file, not distinct targets or independent templates.",
        "dictionaryScope": "Non-empty publisher column descriptions only; dataset-level geometry text is separate.",
        "restartIntegrity": integrity, "families": family_coverage(manifest, acquisition),
    }
    if args.indian_development:
        verify_indian_development()
    if args.record:
        acquisition.save_new(REPORT, report)
    else:
        assert json.loads(REPORT.read_bytes()) == report, "D1F_MEASURED_REPORT_CHANGED"
    print(json.dumps({"families": len(report["families"]), "files": len(manifest["assets"]),
                      "documentedColumns": sum(family["documentedColumns"] for family in report["families"]),
                      "restartIntegrity": integrity, "indianDevelopmentChecked": args.indian_development,
                      "heldOutFilesOpened": 0}))


if __name__ == "__main__":
    main()
