#!/usr/bin/env python
"""Lean offline contract, literal-accounting, frames and immutable-input checks."""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/geo"))
import fitz
from shapely import affinity
from shapely.geometry import Point, Polygon, box, shape
from geo.vector_plan import (
    METHOD,
    JsonDict,
    consistency,
    digest,
    group_room_labels,
    in_scope,
    sha256_file,
    stated_scale,
    summarize,
    text_lines,
)
from compact_evidence import compact

REQUIRED = {
    "task",
    "taskVersion",
    "sourceParts",
    "inputManifest",
    "methodNameAndVersion",
    "parameterHash",
    "outputRef",
    "confidenceOrError",
    "coverage",
    "limitations",
    "state",
}
DERIVATIVE_FIELDS = {"fullPrecisionRef", "precision", "derivativeWriterSha256"}


@dataclass(frozen=True)
class PageCheck:
    number: str
    page: JsonDict
    panels: dict[str, JsonDict]
    payload: JsonDict
    derivative: JsonDict
    report: JsonDict


def check_geometry(geometry: JsonDict) -> Polygon:
    polygon = shape(geometry)
    assert polygon.is_valid and polygon.area > 0, "invalid/nonpositive polygon"
    for index, ring in enumerate(geometry["coordinates"]):
        assert ring[0] == ring[-1], "ring not closed"
        signed_area = sum(start[0] * end[1] - end[0] * start[1] for start, end in zip(ring, ring[1:])) / 2
        assert (signed_area > 0) == (index == 0), "ring orientation"
    return polygon


def load(directory: Path, name: str) -> tuple[JsonDict, JsonDict]:
    derivative = json.loads((directory / name).read_text(encoding="utf-8"))
    if "fullPrecisionRef" not in derivative:
        return derivative, derivative
    ref = derivative["fullPrecisionRef"]
    raw = Path(ref["path"])
    assert raw.stat().st_size == ref["bytes"] and sha256_file(raw) == ref["sha256"], "full precision lineage"
    full = json.loads(raw.read_text(encoding="utf-8"))
    actual = {key: value for key, value in derivative.items() if key not in DERIVATIVE_FIELDS}
    assert actual == compact(full), "rounded derivative differs from full precision"
    return full, derivative


def locator(text: JsonDict) -> tuple[int, int]:
    return text["locator"]["block"], text["locator"]["line"]


def verify_panel_scale(panel: JsonDict, parameters: JsonDict) -> None:
    fit = panel["scale"]
    crosscheck = fit["statedScaleCrossCheck"]
    citation = panel["scaleCitation"]
    theoretical = stated_scale(citation["literal"]) if citation else None
    assert theoretical == crosscheck["theoreticalMetresPerPdfPoint"]
    difference = crosscheck["relativeDifference"]
    if difference is not None:
        assert math.isclose(difference, crosscheck["fittedMetresPerPdfPoint"] / theoretical - 1, abs_tol=1e-12)
        assert (crosscheck["status"] == "ok") == (abs(difference) <= parameters["panelScaleAgreementTolerance"])
        if crosscheck["status"] == "mismatch":
            assert fit["metresPerPdfPoint"] is None and fit["gap"] == "no_scale"


def verify_panels(context: PageCheck, native: list[JsonDict], native_page: fitz.Page) -> None:
    by_locator = {locator(text): text for text in native}
    source_seqnos = {drawing["seqno"] for drawing in native_page.get_drawings()}
    expected_groups = [
        group
        for panel in context.panels.values()
        for group in group_room_labels([text for text in native if in_scope(text["bbox"], [panel["panelBboxPdf"]])])
    ]
    audit = context.page.get("labelAudit", [])
    assert Counter(locator(group["name"]) for group in expected_groups) == Counter(
        locator(group["name"]) for group in audit
    ), "room name dropped or duplicated"
    assert all(count == 1 for count in Counter(locator(group["name"]) for group in audit).values())
    assert all(
        candidate["panelId"] in context.panels
        and candidate["floorLabel"] == context.panels[candidate["panelId"]]["floorLabel"]
        for candidate in context.page["candidates"]
    )
    for panel in context.panels.values():
        for citation in [panel["titleCitation"], panel["scaleCitation"]]:
            if citation:
                assert citation == by_locator[locator(citation)], "non-source panel title/scale"
        verify_panel_scale(panel, context.payload["parameters"])
        if panel["originPdf"]:
            outline = check_geometry(panel["topology"]["buildingOutlinePdf"])
            assert panel["originPdf"] == [outline.bounds[0], outline.bounds[3]], "not outline lower-left origin"
        for bridge in panel["topology"]["bridges"]:
            assert bridge["state"] == "candidate"
            assert 0 < bridge["widthM"] <= context.payload["parameters"]["maximumOpeningWidthM"]
            assert all(seqno in source_seqnos for seqno in bridge["sourceSeqnos"]), "non-source wall reference"


def verify_native_lines(page: JsonDict, native: list[JsonDict]) -> None:
    audit = page.get("labelAudit", [])
    by_locator = {locator(text): text for text in native}
    exported_lines = [
        *page["unattachedText"],
        *(text for candidate in page["candidates"] for text in candidate["output"]["textLines"]),
        *(group["name"] for group in audit),
        *(group["dimensionLine"] for group in audit if group["dimensionLine"]),
    ]
    for text in exported_lines:
        original = by_locator[locator(text)]
        assert text["literal"] == original["literal"] and text["bbox"] == original["bbox"]
        assert text["spans"] == original["spans"], "non-source literal/span/bbox"


def verify_candidate_contract(candidate: JsonDict, index: int, context: PageCheck) -> None:
    assert REQUIRED <= candidate.keys()
    assert candidate["task"] == "plan_rooms" and candidate["state"] == "candidate"
    assert candidate["methodNameAndVersion"] == candidate["method"] == METHOD
    assert candidate["parameterHash"] == context.payload["parameterHash"]
    assert candidate["inputManifest"] == context.payload["inputManifest"]
    assert candidate["outputRef"] == f"candidates.json#/pages/{context.number}/candidates/{index}"
    value = candidate["output"]
    polygon = check_geometry(value["polygonPdf"])
    assert list(polygon.bounds) == value["citation"]["bbox"] and candidate["sourceParts"] == [value["citation"]]
    assert value["citation"]["sourceSha256"] == context.payload["inputManifest"]["sha256"]
    assert value["citation"]["page"] == int(context.number)
    for group in value.get("labelGroups", []):
        assert polygon.covers(Point(*group["anchorPdf"])), "group anchor outside room"
    if not context.panels:
        assert all(polygon.covers(box(*text["bbox"])) for text in value["textLines"])


def verify_candidate_labels(value: JsonDict, has_panels: bool) -> tuple[bool, bool]:
    named = value["labelState"] != "unknown"
    if not named:
        assert value["label"] == "unknown"
        if len(value["labelLiterals"]) > 1 and has_panels:
            assert value["issue"] == "merged_region"
    else:
        assert len(value["labelLiterals"]) == 1 and value["label"] == value["labelLiterals"][0]["literal"]
    for stated in value["statedDimensions"]:
        assert any(
            text["literal"] == stated["literal"] and text["bbox"] == stated["bbox"] for text in value["textLines"]
        )
        assert all(dimension["metres"] is None or dimension["metres"] > 0 for dimension in stated["dimensions"])
    return named, any(stated["parsed"] for stated in value["statedDimensions"])


def verify_candidate_metric(candidate: JsonDict, context: PageCheck) -> None:
    value = candidate["output"]
    polygon = shape(value["polygonPdf"])
    panel = context.panels.get(value.get("panelId"))
    factor = panel["scale"]["metresPerPdfPoint"] if panel else context.page["scale"]["metresPerPdfPoint"]
    if factor is None:
        assert value["polygonMetres"] is None and value["metricFrame"] is None and "no_scale" in value["gaps"]
        assert value["computedArea"]["unit"] == "pdf_point2"
    else:
        metric = check_geometry(value["polygonMetres"])
        assert value["computedArea"]["unit"] == "m2" and value["metricFrame"]["georeferenced"] is False
        assert math.isclose(metric.area, polygon.area * factor**2, rel_tol=1e-9)
        if panel:
            assert candidate["floorLabel"] == value["floorLabel"] == panel["floorLabel"]
            assert candidate["panelId"] == panel["panelId"] and value["metricFrame"]["originPdf"] == panel["originPdf"]
            transformed = affinity.scale(
                affinity.translate(polygon, xoff=-panel["originPdf"][0], yoff=-panel["originPdf"][1]),
                xfact=factor,
                yfact=-factor,
                origin=(0, 0),
            )
            assert metric.hausdorff_distance(transformed) < 1e-8
    assert math.isclose(value["computedArea"]["value"], polygon.area * (factor**2 if factor else 1), rel_tol=1e-9)
    assert value["computedArea"]["state"] == "candidate"
    actual = consistency(
        polygon, value["statedDimensions"], factor, context.payload["parameters"]["consistencyRelativeTolerance"]
    )
    assert actual == value["consistency"], "area comparison differs"


def verify_candidate(candidate: JsonDict, index: int, context: PageCheck) -> tuple[bool, bool]:
    verify_candidate_contract(candidate, index, context)
    counts = verify_candidate_labels(candidate["output"], bool(context.panels))
    verify_candidate_metric(candidate, context)
    assert (
        context.report["pages"][context.number]["rooms"][index]["status"]
        == candidate["output"]["consistency"]["status"]
    )
    compact_value = context.derivative["pages"][context.number]["candidates"][index]["output"]
    check_geometry(compact_value["polygonPdf"])
    if compact_value["polygonMetres"]:
        check_geometry(compact_value["polygonMetres"])
    return counts


def verify_label_audit(context: PageCheck) -> None:
    page = context.page
    refs = {candidate["outputRef"]: candidate for candidate in page["candidates"]}
    for group in page.get("labelAudit", []):
        if group["status"] == "attached":
            candidate = refs[group["candidateRef"]]
            assert sum(locator(text) == locator(group["name"]) for text in candidate["output"]["textLines"]) == 1
            assert (
                sum(
                    shape(item["output"]["polygonPdf"]).covers(Point(*group["anchorPdf"]))
                    for item in page["candidates"]
                    if item["panelId"] == group["panelId"]
                )
                == 1
            )
        else:
            assert group["reason"] and group["candidateRef"] is None
    if context.panels:
        assert page["summary"] == {
            **summarize(page["candidates"], page.get("labelAudit", [])),
            "unattachedTextLines": len(page["unattachedText"]),
        }


def verify_page(directory: Path, context: PageCheck, native_page: fitz.Page, receipt: JsonDict) -> tuple[int, int, int]:
    native = text_lines(native_page)
    if context.panels:
        verify_panels(context, native, native_page)
    verify_native_lines(context.page, native)
    if context.page["classification"]["kind"] != "vector_plan" or "no_matching_layer_profile" in context.page["gaps"]:
        assert not context.page["candidates"] and not context.panels
        assert context.page["scale"]["metresPerPdfPoint"] is None
    labels = dimensions = 0
    for index, candidate in enumerate(context.page["candidates"]):
        named, parsed = verify_candidate(candidate, index, context)
        labels += named
        dimensions += parsed
    verify_label_audit(context)
    rooms = len(context.page["candidates"])
    assert receipt["pageResults"][context.number]["roomsFound"] == rooms == context.page["summary"]["roomsFound"]
    overlay = context.page["overlay"]
    assert (directory / overlay["file"]).stat().st_size == overlay["bytes"]
    return rooms, labels, dimensions


def verify_input(payload: JsonDict, receipt: JsonDict, report: JsonDict) -> None:
    assert payload["version"] in {"vector-plan-candidates/1", "vector-plan-candidates/2"}
    assert payload["method"] == METHOD and payload["state"] == "candidate"
    assert payload["parameterHash"] == digest(payload["parameters"])
    assert receipt["sourceHashUnchanged"] and receipt["registryWrites"] == 0 and not receipt["apiRouteWired"]
    assert sha256_file(Path(payload["inputManifest"]["path"])) == receipt["inputSha256After"]
    assert receipt["inputSha256After"] == payload["inputManifest"]["sha256"] == report["sourceSha256"]


def verify(directory: Path) -> JsonDict:
    payload, derivative = load(directory, "candidates.json")
    receipt, _ = load(directory, "result.json")
    report, _ = load(directory, "consistency.json")
    verify_input(payload, receipt, report)
    rooms = labels = dimensions = 0
    with fitz.open(payload["inputManifest"]["path"]) as doc:
        for number, page in payload["pages"].items():
            panels = {panel["panelId"]: panel for panel in page.get("panels", [])}
            context = PageCheck(number, page, panels, payload, derivative, report)
            page_rooms, page_labels, page_dimensions = verify_page(directory, context, doc[int(number) - 1], receipt)
            rooms += page_rooms
            labels += page_labels
            dimensions += page_dimensions
    return {
        "run": str(directory),
        "pages": len(payload["pages"]),
        "roomCandidates": rooms,
        "singleLiteralLabels": labels,
        "parsedDimensionPairs": dimensions,
        "checks": "passed",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runs", nargs="+", type=Path)
    args = parser.parse_args()
    print(json.dumps([verify(run) for run in args.runs], indent=2))


if __name__ == "__main__":
    main()
