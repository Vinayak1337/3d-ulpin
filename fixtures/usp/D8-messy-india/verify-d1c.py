"""Read-only D1c/D1d integrity checks. Output counts only; never print evaluator fields or values."""
from __future__ import annotations

import csv
import gzip
import hashlib
import importlib.util
import io
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
PACK = Path(__file__).resolve().parent
BASE = "f5539916"
CHECKPOINT = "2432f8e4"
Row = dict[str, Any]


def load(path: Path) -> Row:
    return json.loads(path.read_bytes())


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def previous(path: Path, commit: str = BASE) -> Row:
    relative = path.relative_to(ROOT).as_posix()
    return json.loads(subprocess.check_output(["git", "show", commit + ":" + relative], cwd=ROOT))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def pinned(pin: Row, key: str = "externalPath") -> bytes:
    path = Path(pin[key])
    require(not path.name.startswith(".env"), "Credential path forbidden")
    raw = path.read_bytes()
    require(digest(raw) == pin["sha256"], "Pinned bytes changed")
    if "bytes" in pin:
        require(len(raw) == pin["bytes"], "Pinned size changed")
    return raw


def module(path: Path, name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    require(spec is not None and spec.loader is not None, "Owned reader unavailable")
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def verify_history(manifest: Row, heldout: Row, private: Row) -> None:
    old = previous(PACK / "manifest.json", CHECKPOINT)
    old_closed = previous(PACK / "heldout.json")
    for key in ("assets", "families"):
        require(manifest[key][:len(old[key])] == old[key], "Historical development metadata changed")
        require(heldout[key] == old_closed[key], "Historical evaluator metadata changed")
    require(manifest["heldout"] == old["heldout"], "Historical blind summary changed")
    require(digest((PACK / "heldout.json").read_bytes()) == manifest["freeze"]["sha256"], "Blind seal mismatch")
    all_assets = manifest["assets"] + heldout["assets"] + private["assets"]
    require(len({asset["id"] for asset in all_assets}) == len(all_assets), "Duplicate asset ID")
    blind_hashes = {asset["original"]["sha256"] for asset in heldout["assets"] + private["assets"]}
    require(not ({asset["original"]["sha256"] for asset in manifest["assets"]} & blind_hashes), "Split byte overlap")
    counts = {"development": len(manifest["assets"]), "heldout": len(heldout["assets"]) + len(private["assets"]),
              "total": len(all_assets), "families": len(manifest["families"]) + len(heldout["families"])
              + len(private["families"])}
    require(manifest["fileCounts"] == counts, "Whole-pack counts mismatch")
    pin = heldout["familySets"]["a3"]["frozenManifest"]
    require(json.loads(pinned(pin)) == old_closed, "A3 snapshot changed")


def verify_tnhb(asset: Row, raw: bytes) -> None:
    rows = json.loads(raw)["responseObject"]
    fields = list(rows[0])
    schema = asset["sourceSchema"]
    fingerprint = digest(json.dumps(fields, ensure_ascii=True, separators=(",", ":")).encode())
    require(fingerprint == schema["layoutFingerprint"], "Ordered-key fingerprint mismatch")
    require(len(rows) == schema["dataRows"] and len(fields) == schema["columnCount"], "Native layout mismatch")
    require(all(list(row) == fields for row in rows), "Unexpected row schema")
    require(all(row["createdBy"] in (None, "Admin", "SPOTNHB")
                and row["lastModifiedBy"] is None for row in rows), "Unverified audit identity present")
    require(not any(re.search(r"email|phone|mobile|owner|allottee|customer|person", field, re.IGNORECASE)
                    for field in fields), "Personal column admitted")


def verify_workbook(raw: bytes, asset: Row) -> None:
    namespace = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        core = ET.fromstring(archive.read("docProps/core.xml"))
        authors = [element.text for element in core.iter()
                   if element.tag.split("}")[-1] in ("creator", "lastModifiedBy") and element.text]
        require(authors == ["igisgw"], "Workbook personal attribution changed")
        strings = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        values = ["".join(element.itertext()) for element in strings]
        risk = re.compile(r"[\w.%-]+@[\w.-]+\.[a-z]{2,}|\b[6-9]\d{9}\b|\b(?:Shri|Smt|Mr|Mrs)\.?\s", re.IGNORECASE)
        require(not any(risk.search(value) for value in values), "Workbook contact/identity risk")
        require(values[:5] == ["name", "address", "class", "longitude", "latitude"], "Native workbook fields changed")
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        rows = [row for row in sheet.findall("s:sheetData/s:row", namespace)
                if any(cell.find("s:v", namespace) is not None for cell in row)]
        require(len(rows) - 1 == asset["sourceSchema"]["dataRows"], "Workbook row count changed")
        require(asset["sourceSchema"]["columnCount"] == 5, "Workbook column count changed")


def verify_footprints(asset: Row) -> None:
    count = 0
    forbidden = re.compile(r"name|owner|contact|phone|email|aadhaar|pan$|allottee|bidder", re.IGNORECASE)
    with gzip.open(Path(asset["original"]["externalPath"]), "rb") as handle:
        for line in handle:
            row = json.loads(line)
            require(list(row) == ["type", "properties", "geometry"], "Native GeoJSONL layout changed")
            require(row["type"] == "Feature" and row["geometry"]["type"] in ("Polygon", "MultiPolygon"),
                    "Native footprint geometry absent")
            require(not any(forbidden.search(key) for key in row["properties"]), "Footprint identity field")
            require(all(value is None or isinstance(value, (int, float)) for value in row["properties"].values()),
                    "Footprint nonnumeric identity risk")
            count += 1
    require(count == asset["sourceSchema"]["dataRows"], "Footprint row count changed")


def verify_development(manifest: Row) -> None:
    selected = [asset for asset in manifest["assets"] if asset["family"] in ("mi-d22", "mi-d23", "mi-d24")]
    require(len(selected) == 5, "D1d source count mismatch")
    for asset in selected:
        raw = pinned(asset["original"])
        if asset.get("developmentCopy"):
            require(len(raw) <= 1_000_000, "Oversize development copy")
            require((ROOT / asset["developmentCopy"]).read_bytes() == raw, "Copy not byte-identical")
        schema = asset["sourceSchema"]
        require(schema["canonicalTargets"] is None and schema["evaluationEligible"] is False, "Dev label added")
        require(asset["purpose"] == "test_only", "Development overqualified")
        if asset["family"] == "mi-d22":
            verify_tnhb(asset, raw)
        elif asset["family"] == "mi-d23":
            verify_workbook(raw, asset)
        else:
            verify_footprints(asset)


def verify_prefix(pin: Row, original: Row) -> None:
    raw = pinned(pin)
    require((ROOT / pin["developmentCopy"]).read_bytes() == raw, "Prefix copy changed")
    with gzip.open(Path(original["externalPath"]), "rb") as handle:
        expected = b"".join(handle.readline() for _ in range(pin["rows"]))
    require(raw == expected and raw.endswith(b"\n") and pin["rowBoundary"] is True, "Prefix not byte-exact")


def verify_derivatives(manifest: Row) -> None:
    reader = module(ROOT / "scripts/agent/flatten-json-table.py", "d1d_flatten")
    index = load(PACK / manifest["derivativeIndex"])
    require(len(index["derivatives"]) == 3 and index["version"] == reader.VERSION, "Derivative index changed")
    for derivative in index["derivatives"]:
        source = Path(derivative["sourcePath"]).read_bytes()
        require(digest(source) == derivative["sourceSha256"], "Derivative source changed")
        rows = reader.read_rows(source, derivative.get("rowArrayPointer", ""), derivative.get("jsonl", False))
        expected, headers = reader.csv_bytes(rows)
        raw = pinned(derivative)
        require(expected == raw, "Derivative not deterministic")
        require((ROOT / derivative["developmentCopy"]).read_bytes() == raw, "Derivative copy changed")
        require(len(rows) == derivative["rows"] and len(headers) == derivative["columns"], "Derivative layout changed")
        require(next(csv.reader(io.StringIO(raw.decode("utf-8")))) == headers, "Header order changed")
        original = next(asset["original"] for asset in manifest["assets"]
                        if asset["original"]["sha256"] == derivative["originalSha256"])
        if derivative.get("prefix"):
            verify_prefix(derivative["prefix"], original)


def verify_split(private: Row, manifest: Row) -> None:
    split = load(Path(private["splitAssignment"]["externalPath"]))
    split_hash = digest(pinned(private["splitAssignment"]))
    require(split_hash == manifest["d1d"]["splitAssignmentSha256"], "Split pin mismatch")
    rows = split["orderedPublishers"]
    require(rows[0]["assignment"] == "dev", "Fixed development publisher moved")
    hashes = [row["sha256"] for row in rows[1:]]
    require(hashes == sorted(hashes) and len(set(hashes)) == len(hashes), "Publisher hash sort invalid")
    expected = "heldout"
    assignments = {}
    for index, row in enumerate(rows):
        require(row["sha256"] == digest(row["publisherId"].encode()), "Publisher ID hash invalid")
        undocumented = index > 0 and not row["publisherDocumentationAvailable"]
        chosen = "dev" if index == 0 or (expected == "heldout" and undocumented) else expected
        require(row["assignment"] == chosen, "Publisher alternation invalid")
        if index and chosen == expected:
            expected = "dev" if expected == "heldout" else "heldout"
        assignments[row["publisherId"]] = chosen
    require(all(assignments[asset["publisherId"]] == "heldout" for asset in private["assets"]), "Blind split invalid")
    require(sum(value == "dev" for value in assignments.values()) == 3, "Development publisher count mismatch")


def verify_freeze(heldout: Row, private: Row, manifest: Row) -> Row:
    receipt = load(ROOT / "docs/evidence/gf-agent/d1c/heldout-truth-freeze.json")
    require(heldout["familySets"]["d1c"]["familyIds"] == [family["id"] for family in private["families"]],
            "Blind aliases mismatch")
    require(all(re.fullmatch(r"h[1-9]\d*", row["family"]) for row in receipt["families"]), "Public alias invalid")
    require(digest(Path(receipt["path"]).read_bytes()) == receipt["sha256"], "Truth hash changed")
    require(receipt["bridgeSha256"] == private["truthBridge"]["sha256"], "Bridge receipt changed")
    pinned(private["truthBridge"])
    source_hash = digest(pinned(private["evaluatorSources"]))
    require(receipt["evaluatorSourcesSha256"] == source_hash, "Source list pin mismatch")
    for key in ("files", "columns", "scorable", "positiveTargets"):
        require(receipt[key] == manifest["d1d"]["heldout" + key[0].upper() + key[1:]], "Public blind count mismatch")
    require(receipt["evaluationBeforeFreeze"] is False, "Premature evaluation")
    require(all(receipt[key] == 0 for key in ("teacherCalls", "trainingWrites", "memoryWrites")), "Blind side effect")
    old = previous(ROOT / "docs/evidence/gf-agent/d1c/heldout-truth-freeze.json", CHECKPOINT)
    require(Path(old["path"]).read_bytes() == b"", "Original empty checkpoint overwritten")
    command = [sys.executable, "-B", str(ROOT / "scripts/agent/freeze-a3-truth.py"), "--family-set", "d1c", "--check"]
    result = subprocess.run(command, cwd=ROOT, capture_output=True, check=False)
    require(result.returncode == 0, "Blind freeze not reproducible")
    return receipt


def verify_catalogue() -> None:
    path = ROOT / "docs/api/datasets.json"
    current = load(path)
    old = previous(path, CHECKPOINT)
    require(all(current[key] == old[key] for key in old if key != "retainedExternalSources"),
            "Unrelated catalogue sections changed")
    old_entries = old["retainedExternalSources"]
    entries = current["retainedExternalSources"]
    require(len(entries) == len(old_entries), "Source catalogue history removed or added")
    changed = {"d1-messy-india-development-20261010", "d1-messy-india-heldout-20261010"}
    for before, after in zip(old_entries, entries):
        require(before.get("id") == after.get("id"), "Catalogue identity or order changed")
        if after.get("id") not in changed:
            require(before == after, "Unrelated catalogue source changed")
            continue
        require(after["manifestSha256"] == digest((ROOT / after["manifest"]).read_bytes()), "Catalogue pin stale")
        require(after["runtimeVerified"] is False and after["apiInstallation"] == "not-installed", "Runtime overclaim")


def main() -> None:
    manifest = load(PACK / "manifest.json")
    heldout = load(PACK / "heldout.json")
    private = json.loads(pinned(heldout["familySets"]["d1c"]["evaluatorManifest"]))
    verify_history(manifest, heldout, private)
    verify_development(manifest)
    verify_derivatives(manifest)
    verify_split(private, manifest)
    receipt = verify_freeze(heldout, private, manifest)
    verify_catalogue()
    print(json.dumps({"integrityChecks": "passed", "developmentFamilies": 3, "developmentFiles": 5,
                      "heldoutFamilies": len(receipt["families"]), "heldoutFiles": receipt["files"],
                      "heldoutColumns": receipt["columns"], "heldoutScorable": receipt["scorable"],
                      "heldoutPositiveTargets": receipt["positiveTargets"],
                      "positiveCountsByTarget": receipt["positiveCountsByTarget"], "taskThresholdsMet": False}))


if __name__ == "__main__":
    main()
