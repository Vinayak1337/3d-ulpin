#!/usr/bin/env python3
"""A5 demo stage: Tower 3 and Magnolia outcomes and the storey_count candidate files.

Reads the demo truth records (a demo split, not the sealed holdout), the retained page stores and the
rule outputs. Writes candidates/<building>.json and the "demo" section of result.json. A candidate is
never a registry value: nothing here touches the database or the demo runtime, and the canonical
sourceIds are copied from the existing K2 evidence files only so a later reviewer can attach them.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import score

JsonDict = dict[str, Any]
K2_EVIDENCE = score.REPO / "docs/evidence/gf-backend/k2"
DEMO = {"haryana-2831-tower3": "tower3-canonical.json", "bihar-magnolia": "magnolia-canonical.json"}
STOREY_FIELDS = ("floorExpression", "storeyCount")
MAX_LABELS = 12
MAX_PROPOSALS = 32
LINE_WINDOW = 200
TASK = "storey_count"
TASK_VERSION = "storey-rules@1"


def canonical_sources(name: str) -> tuple[str, dict[str, str]]:
    """The building id and the sourceId of each source sha already registered for it."""
    text = (K2_EVIDENCE / name).read_text(encoding="utf-8")
    pairs = re.findall(r'"sourceId": "([^"]+)",\s*"sourceSha256": "([a-f0-9]{64})"', text)
    return json.loads(text)["buildingId"], {sha: source for source, sha in pairs}


def region_citation(item: JsonDict, source_id: str) -> JsonDict:
    left, top, right, bottom = item["locator"]["bbox"]
    locator = {"kind": "region", "page": item["locator"]["page"], "x": left, "y": top,
               "width": max(right - left, 0.01), "height": max(bottom - top, 0.01), "unit": "pt"}
    return {"sourceId": source_id, "sourceSha256": item["sourceSha256"], "locator": locator}


def alternative(value: Any, field: str, items: list[JsonDict], sources: dict[str, str]) -> JsonDict:
    seen: set[str] = set()
    citations = []
    for item in items:
        citation = region_citation(item, sources[item["sourceSha256"]])
        key = json.dumps(citation, sort_keys=True)
        if key not in seen:
            seen.add(key)
            citations.append(citation)
    return {"value": value, "field": field, "citations": citations, "method": items[0]["method"],
            "quotes": sorted({item["quote"] for item in items}), "verifier": {"status": "quote_at_locator"}}


def group_by_value(items: list[JsonDict]) -> dict[str, list[JsonDict]]:
    groups: dict[str, list[JsonDict]] = {}
    for item in items:
        groups.setdefault(str(item["value"]), []).append(item)
    return groups


def storey_alternatives(items: list[JsonDict], sources: dict[str, str]) -> tuple[list[JsonDict], list[JsonDict]]:
    """Distinct printed values of the strongest field kind; the weaker kind is kept as other statements."""
    present = [field for field in STOREY_FIELDS if any(item["field"] == field for item in items)]
    if not present:
        return [], []
    main = [item for item in items if item["field"] == present[0]]
    other = [item for item in items if item["field"] in STOREY_FIELDS and item["field"] != present[0]]
    alternatives = [alternative(value, present[0], group, sources) for value, group in group_by_value(main).items()]
    return alternatives, [alternative(v, g[0]["field"], g, sources) for v, g in group_by_value(other).items()]


def storey_state(alternatives: list[JsonDict]) -> str:
    return {0: "abstained", 1: "candidate"}.get(len(alternatives), "conflicting")


def page_frame(source_path: str, page: int) -> JsonDict:
    import fitz

    with fitz.open(source_path) as document:
        shown = document[page - 1]
        return {"kind": "pdf_display_page_top_left_points", "rotation": shown.rotation,
                "width": shown.rect.width, "height": shown.rect.height}


def line_window(text: str, span: list[int]) -> tuple[str, list[int]]:
    start = max(0, span[0] - LINE_WINDOW)
    return text[start:span[1] + LINE_WINDOW], [span[0] - start, span[1] - start]


def proposal(number: int, item: JsonDict, store: JsonDict) -> JsonDict:
    page = item["locator"]["page"]
    frame = page_frame(store["source"]["path"], page)
    left, top, right, bottom = item["locator"]["bbox"]
    box = [max(left, 0.0), max(top, 0.0), min(right, frame["width"]), min(bottom, frame["height"])]
    lines = store["pages"][str(page)]["lines"]
    line = next(entry["text"] for entry in lines if entry["id"] == item["locator"]["lineId"])
    line_quote, span = line_window(line, item["locator"]["textSpan"])
    return {"proposalId": f"p{number}", "fieldRole": item["field"], "quote": item["quote"], "lineQuote": line_quote,
            "quoteCharacterSpan": span, "status": "needs_review",
            "reasons": [f"{item['method']} matched {item['field']} {item['value']}; quote verified at the locator"],
            "locator": {"page": page, "frame": frame, "box": box, "selectedRegion": None,
                        "declaredPrecision": "retained text line box"},
            "declaredMethod": item["method"], "declaredObservation": None}


def distinct_items(items: list[JsonDict]) -> list[JsonDict]:
    """One item per (line, field, value), at most as many as one packet may hold."""
    seen: dict[tuple, JsonDict] = {}
    for item in items:
        seen.setdefault((item["locator"]["lineId"], item["field"], str(item["value"])), item)
    return list(seen.values())[:MAX_PROPOSALS]


def storey_conflicts(chosen: list[JsonDict], proposals: list[JsonDict], main_field: str | None) -> list[JsonDict]:
    first_of_value: dict[str, str] = {}
    for item, entry in zip(chosen, proposals):
        if item["field"] == main_field:
            first_of_value.setdefault(str(item["value"]), entry["proposalId"])
    if len(first_of_value) < 2:
        return []
    return [{"proposalIds": list(first_of_value.values()), "state": "unresolved",
             "reason": "different storey values are stated in the same document"}]


def packet_for(items: list[JsonDict], store: JsonDict, main_field: str | None) -> JsonDict:
    chosen = distinct_items(items)
    proposals = [proposal(number, item, store) for number, item in enumerate(chosen, 1)]
    conflicts = storey_conflicts(chosen, proposals, main_field)
    origin = {"sha256": store["source"]["sha256"], "bytes": store["source"]["bytes"]}
    return {"declaredOrigin": origin, "proposals": proposals, "rejected": [], "conflicts": conflicts,
            "unknowns": ["floor count meaning (G+N versus N floors) is not expanded",
                         "building association inside a multi-tower sheet is not verified"]}


def candidate_ref(sha: str, state: str, value: str | None) -> JsonDict:
    return {"candidateId": f"a5:{TASK_VERSION}:{sha[:12]}:{value or 'none'}", "task": TASK,
            "taskVersion": TASK_VERSION, "inputManifest": f"sha256:{sha}", "outputRef": None, "state": state}


def label_alternatives(items: list[JsonDict], sources: dict[str, str]) -> list[JsonDict]:
    groups = group_by_value([item for item in items if item["field"] == "floorLabel"])
    return [alternative(value, "floorLabel", group, sources) for value, group in list(groups.items())[:MAX_LABELS]]


def unit_alternatives(items: list[JsonDict], sources: dict[str, str]) -> list[JsonDict]:
    groups = group_by_value([item for item in items if item["field"] == "unitCount"])
    return [alternative(value, "unitCount", group, sources) for value, group in groups.items()]


def candidate_file(record: JsonDict, items: list[JsonDict], stores: dict[str, JsonDict], name: str) -> JsonDict:
    building_id, sources = canonical_sources(name)
    cited = [item for item in items if item["sourceSha256"] in sources]
    storeys, other = storey_alternatives(cited, sources)
    state = storey_state(storeys)
    value = storeys[0]["value"] if state == "candidate" else None
    primary = next(iter(sources))
    return {
        "schemaVersion": "storey-count-candidate/1", "kind": "storey_count", "state": state,
        "method": score.STOREY_METHOD, "route": "baseline",
        "building": {"label": record["buildingLiteral"], "projectSourceId": record["projectSourceId"],
                     "canonicalBuildingId": building_id, "write": "none; reference for the reviewer only"},
        "candidates": [candidate_ref(primary, "abstained" if state == "abstained" else "candidate", value)],
        "storeyCount": {"value": value, "state": state, "alternatives": storeys},
        "unitCounts": unit_alternatives(cited, sources), "labels": label_alternatives(cited, sources),
        "otherStatements": other,
        "outsideCanonicalSources": sorted({item["sourceSha256"] for item in items} - set(sources)),
        "packet": packet_for([i for i in cited if i["sourceSha256"] == primary], stores[primary],
                             storeys[0]["field"] if storeys else None),
    }


def expected_statements(record: JsonDict) -> JsonDict:
    statements = record.get("documentStatements", [])
    return {"floorExpressions": sorted({s["value"] for s in statements if s["kind"] == "floor_expression"}),
            "unitCounts": sorted({int(s["value"]) for s in statements if s["kind"] == "tower_unit_count"}),
            "registryFloorLiteral": record["registry"]["floorExpression"]["value"]}


def outcome(record: JsonDict, candidate: JsonDict, agent_status: JsonDict) -> JsonDict:
    expected = expected_statements(record)
    found = {score.squash(str(entry["value"])) for entry in candidate["storeyCount"]["alternatives"]}
    wanted = {score.squash(value) for value in expected["floorExpressions"]}
    registry = expected["registryFloorLiteral"]
    units = {int(entry["value"]) for entry in candidate["unitCounts"]}
    return {"building": record["buildingLiteral"], "state": candidate["state"], "system": "baseline",
            "agent": agent_status, "storeyValuesFound": sorted(found),
            "expectedDocumentSides": expected["floorExpressions"],
            "missedSides": sorted(wanted - found), "registryFloorLiteral": registry,
            "registryLiteralFound": score.squash(registry) in found if registry else None,
            "expectedUnitCounts": expected["unitCounts"], "unitCountsFound": sorted(units),
            "expectedUnitCountMissed": sorted(set(expected["unitCounts"]) - units),
            "labelAlternatives": len(candidate["labels"]),
            "citedAlternatives": len(candidate["storeyCount"]["alternatives"]),
            "unitCountCitations": sum(len(entry["citations"]) for entry in candidate["unitCounts"])}


def require_baseline_route() -> None:
    routes = score.load_json(score.HERE / "dev-choice.json")["routes"]
    if any(entry["route"] != "baseline" for entry in routes.values()):
        raise SystemExit("the dev choice names the agent for a field; its verified items are needed first")


def demo_stage(args: argparse.Namespace) -> int:
    by_source = score.items_by_source(args.items)
    records = {stem: score.load_json(score.TRUTH / "demo" / f"{stem}.json") for stem in DEMO}
    shas = {sha for record in records.values() for sha in score.extraction_shas(record)}
    stores = score.load_stores(args.pages, shas)
    require_baseline_route()
    _, status = score.verified_agent_items(stores, args.agent)
    args.out.mkdir(parents=True, exist_ok=True)
    outcomes = {}
    for stem, canonical in DEMO.items():
        record = records[stem]
        items = [item for sha in score.extraction_shas(record) for item in by_source.get(sha, [])]
        candidate = candidate_file(record, items, stores, canonical)
        (args.out / f"{stem}.json").write_text(json.dumps(candidate, indent=1) + "\n", encoding="utf-8")
        outcomes[stem] = outcome(record, candidate, status)
    result = score.load_json(score.HERE / "result.json")
    result["demo"] = outcomes
    (score.HERE / "result.json").write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps(outcomes, indent=1))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pages", type=Path, required=True)
    parser.add_argument("--items", type=Path, required=True)
    parser.add_argument("--agent", type=Path)
    parser.add_argument("--out", type=Path, default=score.HERE / "candidates")
    return demo_stage(parser.parse_args())


if __name__ == "__main__":
    sys.exit(main())
