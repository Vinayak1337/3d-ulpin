#!/usr/bin/env python
"""Read selected local PDF pages into review-only candidates and private evidence."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import importlib.metadata
import json
from pathlib import Path
import platform
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "geo"))
import fitz
from geo.vector_plan import DEFAULTS, METHOD, JsonDict, digest, read_page, render_overlay, sha256_file
from compact_evidence import publish


@dataclass(frozen=True)
class RunSetup:
    args: argparse.Namespace
    source: Path
    manifest: JsonDict
    params: JsonDict
    scopes: dict[int, list[list[float]]]
    full_out: Path
    start: float


def selection(value: str, count: int) -> list[int]:
    if value == "all":
        return list(range(1, count + 1))
    pages: set[int] = set()
    for part in value.split(","):
        ends = list(map(int, part.split("-")))
        if len(ends) == 1:
            pages.add(ends[0])
        elif len(ends) == 2 and ends[0] <= ends[1]:
            pages.update(range(ends[0], ends[1] + 1))
        else:
            raise ValueError("pages must be 1-based integers or ascending ranges")
    if not pages or min(pages) < 1 or max(pages) > count:
        raise ValueError(f"pages must be within 1..{count}")
    return sorted(pages)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--pages", default="all", help="1-based comma/range list, e.g. 1,2,4-6; default all")
    parser.add_argument("--out", type=Path, required=True, help="new or empty output directory (never overwritten)")
    parser.add_argument(
        "--region",
        action="append",
        default=[],
        metavar="PAGE:X0,Y0,X1,Y1",
        help="repeatable unrotated PDF-point scope; never creates crop edges",
    )
    parser.add_argument("--snap", type=float, default=DEFAULTS["snapTolerancePdf"], help="PDF-point snapping tolerance")
    parser.add_argument("--panel-title", action="append", help="repeatable exact title literal; default all panels")
    parser.add_argument("--provenance", type=Path, help="JSON keyed by input filename; pin hash and source provenance")
    parser.add_argument("--overlay-max-side", type=int, default=1600)
    parser.add_argument(
        "--full-out",
        type=Path,
        help="new private directory; default E:/BhuAayam-data/task-data/p1-vector-plan/<run-id>/<input>",
    )
    parser.add_argument("--max-opening-m", type=float, default=DEFAULTS["maximumOpeningWidthM"])
    return parser


def validate_outputs(args: argparse.Namespace, parser: argparse.ArgumentParser) -> Path:
    if not 0.001 <= args.snap <= 1 or not 200 <= args.overlay_max_side <= 2400:
        parser.error("snap must be .001..1 point; overlay max side must be 200..2400")
    if args.out.exists() and (not args.out.is_dir() or any(args.out.iterdir())):
        parser.error("output must be a new or empty directory")
    full_out = args.full_out or Path("E:/BhuAayam-data/task-data/p1-vector-plan") / args.out.parent.name / args.out.name
    if full_out.resolve().is_relative_to(ROOT) or full_out.resolve() == args.out.resolve():
        parser.error("full precision must stay outside Git")
    if full_out.exists() and (not full_out.is_dir() or any(full_out.iterdir())):
        parser.error("full precision directory must be new or empty")
    if not 0.1 <= args.max_opening_m <= 2:
        parser.error("maximum opening width must be .1..2 metres")
    return full_out


def source_manifest(source: Path, provenance: Path | None) -> JsonDict:
    original_hash = sha256_file(source)
    manifest = {
        "name": source.name,
        "path": str(source),
        "sha256": original_hash,
        "bytes": source.stat().st_size,
        "issuer": "unknown",
        "originalUrl": None,
        "acquiredAt": None,
        "permission": {"state": "unconfirmed", "reason": "source-specific permission not provided"},
        "geography": "unknown",
        "horizontalCrs": None,
        "purpose": "test_only",
    }
    if provenance:
        declared = json.loads(provenance.read_text(encoding="utf-8"))[source.name]
        if declared["sha256"] != original_hash:
            raise ValueError("provenance hash differs from the immutable input")
        manifest.update(declared)
    return manifest


def region_scopes(values: list[str]) -> dict[int, list[list[float]]]:
    scopes: dict[int, list[list[float]]] = {}
    for value in values:
        number, rectangle = value.split(":", 1)
        bbox = list(map(float, rectangle.split(",")))
        if len(bbox) != 4 or bbox[0] >= bbox[2] or bbox[1] >= bbox[3]:
            raise ValueError("region must have four ascending bbox coordinates")
        scopes.setdefault(int(number), []).append(bbox)
    return scopes


def prepare_run(args: argparse.Namespace, parser: argparse.ArgumentParser) -> RunSetup:
    full_out = validate_outputs(args, parser)
    start = time.perf_counter()
    source = args.pdf.resolve()
    manifest = source_manifest(source, args.provenance)
    params = {**DEFAULTS, "snapTolerancePdf": args.snap, "maximumOpeningWidthM": args.max_opening_m}
    if args.panel_title:
        params["panelTitleSelection"] = args.panel_title
    scopes = region_scopes(args.region)
    args.out.mkdir(parents=True, exist_ok=True)
    return RunSetup(args, source, manifest, params, scopes, full_out, start)


def validate_pages(doc: fitz.Document, setup: RunSetup) -> list[int]:
    if doc.needs_pass:
        raise ValueError("encrypted PDF requires an explicitly decrypted original")
    pages = selection(setup.args.pages, len(doc))
    if any(number not in pages for number in setup.scopes):
        raise ValueError("region page not selected")
    for number, rectangles in setup.scopes.items():
        if doc[number - 1].rotation:
            raise ValueError("explicit region selection currently requires an unrotated page")
        if any(not doc[number - 1].rect.contains(fitz.Rect(rectangle)) for rectangle in rectangles):
            raise ValueError("region exceeds page bounds")
    return pages


def process_pages(setup: RunSetup) -> tuple[list[int], str, dict[str, JsonDict]]:
    results = {}
    with fitz.open(setup.source) as doc:
        pages = validate_pages(doc, setup)
        setup.params["selectedPages"] = pages
        setup.params["scopePdfBboxes"] = setup.scopes
        parameter_hash = digest(setup.params)
        for number in pages:
            page = doc[number - 1]
            result = read_page(page, setup.manifest, parameter_hash, setup.params, setup.scopes.get(number))
            result["overlay"] = render_overlay(
                page, result, setup.args.out / f"page-{number:02d}-overlay.png", setup.args.overlay_max_side
            )
            results[str(number)] = result
    if sha256_file(setup.source) != setup.manifest["sha256"]:
        raise ValueError("input bytes changed during processing; no JSON will be published")
    return pages, parameter_hash, results


def dependency_versions() -> dict[str, str]:
    versions = {name: importlib.metadata.version(name) for name in ["PyMuPDF", "Shapely", "Pillow", "numpy"]}
    versions["Python"] = platform.python_version()
    versions["MuPDF"] = fitz.VersionFitz
    return versions


def code_hashes() -> dict[str, str]:
    paths = [
        Path(__file__).resolve(),
        ROOT / "services/geo/geo/vector_plan.py",
        Path(__file__).with_name("compact_evidence.py"),
    ]
    return {str(path.relative_to(ROOT)): sha256_file(path) for path in paths}


def panel_receipt(panel: JsonDict) -> JsonDict:
    return {
        "panelId": panel["panelId"],
        "floorLabel": panel["floorLabel"],
        "originPdf": panel["originPdf"],
        "scale": {key: value for key, value in panel["scale"].items() if key != "supports"},
        "summary": panel["summary"],
        "omittedFaces": panel["topology"].get("omittedFaces"),
        "openingBridges": len(panel["topology"]["bridges"]),
    }


def room_report(candidate: JsonDict) -> JsonDict:
    output = candidate["output"]
    return {
        "outputRef": candidate["outputRef"],
        "floorLabel": candidate["floorLabel"],
        "panelId": candidate["panelId"],
        "label": output["label"],
        "labelLiterals": output["labelLiterals"],
        "statedDimensions": output["statedDimensions"],
        "bbox": output["citation"]["bbox"],
        **output["consistency"],
    }


def consistency_report(manifest: JsonDict, results: dict[str, JsonDict]) -> JsonDict:
    return {
        "version": "vector-plan-consistency/2",
        "sourceSha256": manifest["sha256"],
        "pages": {
            number: {
                "classification": result["classification"],
                "summary": result["summary"],
                "panels": [panel_receipt(panel) for panel in result["panels"]],
                "unattachedRoomNames": [entry for entry in result["labelAudit"] if entry["status"] != "attached"],
                "rooms": [room_report(candidate) for candidate in result["candidates"]],
            }
            for number, result in results.items()
        },
    }


def page_receipt(result: JsonDict) -> JsonDict:
    scale = result["scale"]
    return {
        "classification": result["classification"],
        **result["summary"],
        "scaleMethod": scale["method"],
        "metresPerPdfPoint": scale["metresPerPdfPoint"],
        "scaleMedianAbsoluteRelativeResidual": scale.get("medianAbsoluteRelativeResidual"),
        "scaleRmsResidualM": scale.get("rmsResidualM"),
        "scaleInliers": scale.get("inlierCount"),
        "panels": [panel_receipt(panel) for panel in result["panels"]],
        "runtimeSeconds": result["runtimeSeconds"],
        "overlay": result["overlay"],
    }


def run_receipt(
    setup: RunSetup, pages: list[int], results: dict[str, JsonDict], code: dict[str, str], versions: dict[str, str]
) -> JsonDict:
    git = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True)
    return {
        "version": "vector-plan-result/2",
        "task": "P1",
        "gate": ["GF-AI:plan_rooms", "GF-T16-prerequisite"],
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "gitSha": git.stdout.strip() if git.returncode == 0 else None,
        "codeSha256": code,
        "dependencies": versions,
        "inputManifest": setup.manifest,
        "inputSha256After": setup.manifest["sha256"],
        "sourceHashUnchanged": True,
        "pages": pages,
        "pageResults": {number: page_receipt(result) for number, result in results.items()},
        "runtimeSeconds": time.perf_counter() - setup.start,
        "apiRouteWired": False,
        "registryWrites": 0,
    }


def main() -> None:
    parser = build_parser()
    setup = prepare_run(parser.parse_args(), parser)
    pages, parameter_hash, results = process_pages(setup)
    versions, code = dependency_versions(), code_hashes()
    candidates = {
        "version": "vector-plan-candidates/2",
        "method": METHOD,
        "state": "candidate",
        "inputManifest": setup.manifest,
        "parameters": setup.params,
        "parameterHash": parameter_hash,
        "dependencies": versions,
        "codeSha256": code,
        "pages": results,
    }
    report = consistency_report(setup.manifest, results)
    receipt = run_receipt(setup, pages, results, code, versions)
    for filename, value in [("candidates.json", candidates), ("consistency.json", report), ("result.json", receipt)]:
        publish(value, setup.args.out / filename, setup.full_out / filename)
    print(
        json.dumps(
            {
                "out": str(setup.args.out),
                "pages": pages,
                "rooms": sum(result["summary"]["roomsFound"] for result in results.values()),
                "classifications": {number: result["classification"]["kind"] for number, result in results.items()},
                "runtimeSeconds": round(receipt["runtimeSeconds"], 3),
            }
        )
    )


if __name__ == "__main__":
    main()
