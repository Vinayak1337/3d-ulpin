#!/usr/bin/env python
"""Read explicitly selected local PDF pages into review-only candidates."""
from __future__ import annotations

import argparse
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
from geo.vector_plan import DEFAULTS, METHOD, digest, read_page, render_overlay, sha256_file
from compact_evidence import publish


def selection(value, count):
    if value == "all":
        return list(range(1, count + 1))
    pages = set()
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--pages", default="all", help="1-based comma/range list, e.g. 1,2,4-6; default all")
    parser.add_argument("--out", type=Path, required=True, help="new or empty output directory (never overwritten)")
    parser.add_argument("--region", action="append", default=[], metavar="PAGE:X0,Y0,X1,Y1", help="repeatable unrotated PDF-point scope; never creates crop edges")
    parser.add_argument("--snap", type=float, default=DEFAULTS["snapTolerancePdf"], help="PDF-point snapping grid/tolerance")
    parser.add_argument("--panel-title", action="append", help="repeatable exact floor-plan title literal; default all detected panels")
    parser.add_argument("--provenance", type=Path, help="JSON keyed by input filename; pin sha256 and source provenance")
    parser.add_argument("--overlay-max-side", type=int, default=1600)
    parser.add_argument("--full-out", type=Path, help="new private full-precision directory; default E:/BhuAayam-data/task-data/p1-vector-plan/<run-id>/<input>")
    parser.add_argument("--max-opening-m", type=float, default=DEFAULTS["maximumOpeningWidthM"])
    args = parser.parse_args()
    if not .001 <= args.snap <= 1 or not 200 <= args.overlay_max_side <= 2400:
        parser.error("snap must be .001..1 point; overlay max side must be 200..2400")
    if args.out.exists() and (not args.out.is_dir() or any(args.out.iterdir())):
        parser.error("output must be a new or empty directory")
    full_out = args.full_out or Path("E:/BhuAayam-data/task-data/p1-vector-plan") / args.out.parent.name / args.out.name
    if full_out.resolve().is_relative_to(ROOT) or full_out.resolve() == args.out.resolve():
        parser.error("full precision must stay outside Git")
    if full_out.exists() and (not full_out.is_dir() or any(full_out.iterdir())):
        parser.error("full precision directory must be new or empty")
    if not .1 <= args.max_opening_m <= 2:
        parser.error("maximum opening width must be .1..2 metres")
    start = time.perf_counter()
    source = args.pdf.resolve()
    original_hash = sha256_file(source)
    manifest = {"name": source.name, "path": str(source), "sha256": original_hash, "bytes": source.stat().st_size,
                "issuer": "unknown", "originalUrl": None, "acquiredAt": None,
                "permission": {"state": "unconfirmed", "reason": "source-specific permission not provided"},
                "geography": "unknown", "horizontalCrs": None, "purpose": "test_only"}
    if args.provenance:
        declared = json.loads(args.provenance.read_text(encoding="utf-8"))[source.name]
        if declared["sha256"] != original_hash:
            raise ValueError("provenance hash differs from the immutable input")
        manifest.update(declared)
    params = {**DEFAULTS, "snapTolerancePdf": args.snap, "maximumOpeningWidthM": args.max_opening_m}
    if args.panel_title:
        params["panelTitleSelection"] = args.panel_title
    scopes = {}
    for value in args.region:
        number, rect = value.split(":", 1)
        bbox = list(map(float, rect.split(",")))
        if len(bbox) != 4 or bbox[0] >= bbox[2] or bbox[1] >= bbox[3]:
            raise ValueError("region must have four ascending bbox coordinates")
        scopes.setdefault(int(number), []).append(bbox)
    args.out.mkdir(parents=True, exist_ok=True)
    with fitz.open(source) as doc:
        if doc.needs_pass:
            raise ValueError("encrypted PDF requires an explicitly decrypted original")
        pages = selection(args.pages, len(doc))
        if any(p not in pages for p in scopes):
            raise ValueError("region page not selected")
        for p, rects in scopes.items():
            if doc[p - 1].rotation:
                raise ValueError("explicit region selection currently requires an unrotated page")
            if any(not doc[p - 1].rect.contains(fitz.Rect(r)) for r in rects):
                raise ValueError("region exceeds page bounds")
        params["selectedPages"] = pages
        params["scopePdfBboxes"] = scopes
        parameter_hash = digest(params)
        page_results = {}
        for number in pages:
            page = doc[number - 1]
            result = read_page(page, manifest, parameter_hash, params, scopes.get(number))
            result["overlay"] = render_overlay(page, result, args.out / f"page-{number:02d}-overlay.png", args.overlay_max_side)
            page_results[str(number)] = result
    unchanged = sha256_file(source) == original_hash
    if not unchanged:
        raise ValueError("input bytes changed during processing; no JSON will be published")
    versions = {name: importlib.metadata.version(name) for name in ["PyMuPDF", "Shapely", "Pillow", "numpy"]}
    versions["Python"] = platform.python_version()
    versions["MuPDF"] = fitz.VersionFitz
    code = {str(p.relative_to(ROOT)): sha256_file(p) for p in [Path(__file__).resolve(), ROOT / "services/geo/geo/vector_plan.py", Path(__file__).with_name("compact_evidence.py")]}
    candidates = {"version": "vector-plan-candidates/2", "method": METHOD, "state": "candidate",
                  "inputManifest": manifest, "parameters": params, "parameterHash": parameter_hash,
                  "dependencies": versions, "codeSha256": code, "pages": page_results}
    consistency = {"version": "vector-plan-consistency/2", "sourceSha256": original_hash,
                   "pages": {p: {"classification": r["classification"], "summary": r["summary"],
                                 "panels": [{"panelId": panel["panelId"], "floorLabel": panel["floorLabel"],
                                    "originPdf": panel["originPdf"], "scale": {k: v for k, v in panel["scale"].items() if k != "supports"},
                                    "summary": panel["summary"], "omittedFaces": panel["topology"].get("omittedFaces"),
                                    "openingBridges": len(panel["topology"]["bridges"])} for panel in r["panels"]],
                                 "unattachedRoomNames": [a for a in r["labelAudit"] if a["status"] != "attached"],
                                 "rooms": [{"outputRef": c["outputRef"], "floorLabel": c["floorLabel"], "panelId": c["panelId"],
                                            "label": c["output"]["label"], "labelLiterals": c["output"]["labelLiterals"],
                                            "statedDimensions": c["output"]["statedDimensions"], "bbox": c["output"]["citation"]["bbox"],
                                            **c["output"]["consistency"]} for c in r["candidates"]]} for p, r in page_results.items()}}
    git = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True)
    receipt = {"version": "vector-plan-result/2", "task": "P1", "gate": ["GF-AI:plan_rooms", "GF-T16-prerequisite"],
               "createdAt": datetime.now(timezone.utc).isoformat(), "gitSha": git.stdout.strip() if git.returncode == 0 else None,
               "codeSha256": code, "dependencies": versions, "inputManifest": manifest,
               "inputSha256After": original_hash, "sourceHashUnchanged": unchanged, "pages": pages,
               "pageResults": {p: {"classification": r["classification"], **r["summary"], "scaleMethod": r["scale"]["method"],
                                   "metresPerPdfPoint": r["scale"]["metresPerPdfPoint"],
                                   "scaleMedianAbsoluteRelativeResidual": r["scale"].get("medianAbsoluteRelativeResidual"),
                                   "scaleRmsResidualM": r["scale"].get("rmsResidualM"), "scaleInliers": r["scale"].get("inlierCount"),
                                   "panels": [{"panelId": panel["panelId"], "floorLabel": panel["floorLabel"], "summary": panel["summary"],
                                               "originPdf": panel["originPdf"], "scale": {k: v for k, v in panel["scale"].items() if k != "supports"},
                                               "omittedFaces": panel["topology"].get("omittedFaces"), "openingBridges": len(panel["topology"]["bridges"])} for panel in r["panels"]],
                                   "runtimeSeconds": r["runtimeSeconds"], "overlay": r["overlay"]} for p, r in page_results.items()},
               "runtimeSeconds": time.perf_counter() - start, "apiRouteWired": False, "registryWrites": 0}
    for filename, value in [("candidates.json", candidates), ("consistency.json", consistency), ("result.json", receipt)]:
        publish(value, args.out / filename, full_out / filename)
    print(json.dumps({"out": str(args.out), "pages": pages, "rooms": sum(r["summary"]["roomsFound"] for r in page_results.values()),
                      "classifications": {p: r["classification"]["kind"] for p, r in page_results.items()},
                      "runtimeSeconds": round(receipt["runtimeSeconds"], 3)}))


if __name__ == "__main__":
    main()
