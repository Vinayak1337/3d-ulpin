"""In-process existing backend readers on real NYC originals; no API or storage operation."""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest


def inspect_real_vectors() -> list[dict[str, object]]:
    from geo.gis_inspection import inspect_gis

    root = Path("E:/BhuAayam-data/task-data/nyc-zcta-10013-context/layers")
    results = []
    for name in ("buildings-original.geojson", "roadbed.geojson"):
        raw = (root / name).read_bytes()
        result = inspect_gis({"base64": base64.b64encode(raw).decode("ascii")})
        quarantine = result.get("quarantine", {})
        results.append({
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
            "format": result["format"],
            "features": result["featureCount"],
            "fields": len(result["fields"]),
            "rejected": quarantine.get("rejected", 0),
            "accepted": quarantine.get("accepted", result["featureCount"]),
            "sourceCrs": result["sourceCrs"],
        })
    return results


def run_native_unit_checks() -> dict[str, object]:
    names = ["test_native_archive", "test_document_archive_dispatch", "test_native_workbook_xml",
             "test_native_pdf_bounds"]
    suite = unittest.defaultTestLoader.loadTestsFromNames(names)
    result = unittest.TextTestRunner().run(suite)
    return {"tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
            "successful": result.wasSuccessful(), "modules": names}


def main() -> None:
    tempfile.tempdir = "E:/BhuAayam-data/task-data/lv0"
    sys.path[:0] = [str(Path("services/geo").resolve()), str(Path("services/geo/tests").resolve())]
    vectors = inspect_real_vectors()
    tests = run_native_unit_checks()
    output = {"realVectors": vectors, "nativeUnits": tests, "runtimeStarted": False,
              "databaseAccess": False, "providerCalls": 0,
              "qualification": "Native in-process checks, not API/DB persistence or frontend intake proof"}
    Path("docs/evidence/gf5/lv0/native.json").write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    if not tests["successful"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
