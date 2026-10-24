"""Compact review derivatives; full precision remains in private task storage."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

PRECISION = {
    "pdfCoordinatesDecimalPlaces": 2,
    "metricCoordinatesDecimalPlaces": 3,
    "otherNumbersMaximumDecimalPlaces": 9,
    "note": "Rounded review derivative; use SHA-pinned full precision for computation.",
}


def compact(value: Any, key: str = "", coordinate_decimals: int | None = None) -> Any:
    """Only coordinate trees use 0.01 pt/1 mm; ratios/residuals keep precision."""
    lowered = key.lower()
    if key in {"polygonMetres", "drawnBboxLengthsM"}:
        coordinate_decimals = 3
    elif key in {"polygonPdf", "buildingOutlinePdf", "wallMaskPdf"}:
        coordinate_decimals = 2
    elif "bbox" in lowered or key in {
        "originPdf",
        "anchorPdf",
        "endpointsPdf",
        "pageSizePdf",
        "scopePdfBboxes",
        "clipPdf",
    }:
        coordinate_decimals = 2
    if isinstance(value, dict):
        return {name: compact(item, name, coordinate_decimals) for name, item in value.items()}
    if isinstance(value, list):
        return [compact(item, key, coordinate_decimals) for item in value]
    if isinstance(value, float):
        result = round(value, coordinate_decimals if coordinate_decimals is not None else 9)
        return 0.0 if result == 0 else result
    return value


def encode(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def store_full_precision(value: Any, private_path: Path) -> dict[str, Any]:
    if private_path.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError("full precision must stay outside Git")
    raw = encode(value)
    private_path.parent.mkdir(parents=True, exist_ok=True)
    with private_path.open("xb") as stream:
        stream.write(raw)
    return {
        "path": str(private_path.resolve()),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
    }


def derivative(value: Any, ref: dict[str, Any]) -> dict[str, Any]:
    return {
        **compact(value),
        "precision": PRECISION,
        "fullPrecisionRef": ref,
        "derivativeWriterSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    }


def publish(value: Any, public_path: Path, private_path: Path) -> dict[str, Any]:
    ref = store_full_precision(value, private_path)
    public_path.write_bytes(encode(derivative(value, ref)))
    return ref


def refresh(path: Path, value: dict[str, Any], parser: argparse.ArgumentParser) -> dict[str, Any]:
    ref = value["fullPrecisionRef"]
    raw = Path(ref["path"]).read_bytes()
    if hashlib.sha256(raw).hexdigest() != ref["sha256"] or len(raw) != ref["bytes"]:
        parser.error("full precision integrity differs")
    path.write_bytes(encode(derivative(json.loads(raw), ref)))
    return ref


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path, help="existing task evidence to compact in this branch")
    parser.add_argument("--full-out", type=Path, help="new private directory; never overwrite")
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="rebuild compact derivative from immutable fullPrecisionRef, without changing private bytes",
    )
    args = parser.parse_args()
    if not args.refresh and not args.full_out:
        parser.error("--full-out required for first compaction")
    if args.full_out and args.full_out.exists() and any(args.full_out.iterdir()):
        parser.error("private directory must be new or empty")
    for name in ["candidates.json", "consistency.json", "result.json"]:
        path = args.run / name
        value = json.loads(path.read_text(encoding="utf-8"))
        if args.refresh:
            ref = refresh(path, value, parser)
        else:
            if "fullPrecisionRef" in value:
                parser.error("already compacted; refuse to replace lineage")
            ref = publish(value, path, args.full_out / name)
        print(json.dumps({"file": str(path), "compactBytes": path.stat().st_size, "fullPrecisionRef": ref}))


if __name__ == "__main__":
    main()
