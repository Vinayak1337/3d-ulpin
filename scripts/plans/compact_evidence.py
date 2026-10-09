"""Compact review derivatives; full precision remains in private task storage."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path

PRECISION = {"pdfCoordinatesDecimalPlaces": 2, "metricCoordinatesDecimalPlaces": 3,
             "otherNumbersMaximumDecimalPlaces": 9,
             "note": "Rounded review derivative; use SHA-pinned full precision for computation."}


def compact(value, key="", coordinate_decimals=None):
    """Only coordinate trees use 0.01 pt/1 mm; ratios/residuals keep precision."""
    lowered = key.lower()
    if key == "polygonMetres":
        coordinate_decimals = 3
    elif key in {"polygonPdf", "buildingOutlinePdf", "wallMaskPdf"}:
        coordinate_decimals = 2
    elif any(word in lowered for word in ["bbox", "bboxes"]) or key in {"originPdf", "anchorPdf", "endpointsPdf", "pageSizePdf", "scopePdfBboxes", "clipPdf"}:
        coordinate_decimals = 2
    if isinstance(value, dict):
        return {k: compact(v, k, coordinate_decimals) for k, v in value.items()}
    if isinstance(value, list):
        return [compact(v, key, coordinate_decimals) for v in value]
    if isinstance(value, float):
        result = round(value, coordinate_decimals if coordinate_decimals is not None else 9)
        return 0.0 if result == 0 else result
    return value


def encode(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def store_full_precision(value, private_path):
    raw = encode(value)
    private_path.parent.mkdir(parents=True, exist_ok=True)
    with private_path.open("xb") as stream:
        stream.write(raw)
    return {"path": str(private_path.resolve()), "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}


def publish(value, public_path, private_path):
    ref = store_full_precision(value, private_path)
    derivative = {**compact(value), "precision": PRECISION, "fullPrecisionRef": ref}
    public_path.write_bytes(encode(derivative))
    return ref


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path, help="existing task evidence to compact in this branch")
    parser.add_argument("--full-out", required=True, type=Path, help="new private directory; never overwrite")
    args = parser.parse_args()
    if args.full_out.exists() and any(args.full_out.iterdir()):
        parser.error("private directory must be new or empty")
    for name in ["candidates.json", "consistency.json", "result.json"]:
        path = args.run / name
        value = json.loads(path.read_text(encoding="utf-8"))
        if "fullPrecisionRef" in value:
            parser.error("already compacted; refuse to replace lineage")
        ref = publish(value, path, args.full_out / name)
        print(json.dumps({"file": str(path), "compactBytes": path.stat().st_size, "fullPrecisionRef": ref}))
