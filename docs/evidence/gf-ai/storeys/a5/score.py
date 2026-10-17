#!/usr/bin/env python3
"""A5 scoring: storey and unit facts from RERA documents, rules vs agent, against registry literals.

Stages (the order is enforced):
  dev      score both systems on development projects, pick a route per field, write dev-choice.json.
  holdout  after dev-choice.json is committed: run the rule baseline on the sealed projects, once.
  demo     Tower 3 and Magnolia outcomes and the canonical candidate files.

Registry literals score the extraction. D2's PDF transcriptions are candidate observations, never truth.
Repeated category rows are not summed and a blank registry field stays unknown.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[5]
HERE = Path(__file__).resolve().parent
TRUTH = REPO / "docs/evidence/usp/finale/GF-DATA/storey-truth"
sys.path.insert(0, str(REPO / "scripts/usp/learning"))

import storey_quote_verifier as verifier  # noqa: E402

JsonDict = dict[str, Any]
STOREY_METHOD = "deterministic:storey-rules@1"
LABEL_KINDS = {"plan_floor_scope", "basement_scope", "plan_floor_label"}
BASEMENT_TOKEN = re.compile(r"(^|\+)\d*B(\+|$)")


def squash(text: str) -> str:
    return re.sub(r"\s+", "", text).upper()


def label_key(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def load_json(path: Path) -> JsonDict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_records(folder: str) -> list[JsonDict]:
    return [load_json(path) for path in sorted((TRUTH / folder).glob("*.json"))]


def extraction_shas(record: JsonDict) -> list[str]:
    return [source["sha256"] for source in record["sources"] if source["role"] == "extraction_pdf"]


def as_list(value: Any) -> list[str]:
    if value is None:
        return []
    return [squash(str(item)) for item in (value if isinstance(value, list) else [value])]


def unit_literals(registry: JsonDict) -> set[int]:
    found = {int(row["countLiteral"]) for row in registry.get("unitCountsByApartmentType", [])}
    value = registry["unitCount"]["value"]
    return found | ({int(value)} if value is not None else set())


def truth_for(record: JsonDict) -> JsonDict:
    registry = record["registry"]
    expressions = as_list(registry["floorExpression"]["value"])
    unit = registry["unitCount"]["value"]
    observed = [item for item in record.get("documentStatements", []) if item["kind"] in LABEL_KINDS]
    return {
        "building": record["buildingLiteral"], "project": record["projectSourceId"], "expressions": expressions,
        "unitCount": int(unit) if unit is not None else None, "unitLiterals": unit_literals(registry),
        "basementIndicated": any(BASEMENT_TOKEN.search(item) for item in expressions) if expressions else None,
        "basementCountKnown": registry["basementCount"]["value"] is not None,
        "d2Labels": [item["value"] for item in observed],
    }


def empty_facts() -> JsonDict:
    return {"expressions": set(), "units": set(), "basement": False, "labels": set(), "basementCounts": set()}


def facts_from_items(items: list[JsonDict]) -> JsonDict:
    facts = empty_facts()
    for item in items:
        field = item["field"]
        if field in {"floorExpression", "storeyCount"}:
            facts["expressions"].add(squash(str(item["value"] if field == "floorExpression" else item["valueLiteral"])))
        if field == "floorExpression" and BASEMENT_TOKEN.search(squash(str(item["value"]))):
            facts["basement"] = True
        if field == "unitCount":
            facts["units"].add(int(item["value"]))
        if field == "floorLabel":
            facts["labels"].add(str(item["value"]))
            facts["basement"] = facts["basement"] or item.get("labelKind") == "basement"
        if field == "basementCount":
            facts["basementCounts"].add(int(item["value"]))
    return facts


def merge_facts(parts: list[JsonDict]) -> JsonDict:
    merged = empty_facts()
    for part in parts:
        for key in ("expressions", "units", "labels", "basementCounts"):
            merged[key] |= part[key]
        merged["basement"] = merged["basement"] or part["basement"]
    return merged


def ratio(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def expression_metrics(truths: list[JsonDict], facts: dict[str, JsonDict]) -> JsonDict:
    pairs = [(truth["building"], literal) for truth in truths for literal in truth["expressions"]]
    hits = [(name, literal) for name, literal in pairs
            if literal in facts[next(t["project"] for t in truths if t["building"] == name)]["expressions"]]
    projects = {truth["project"] for truth in truths}
    extracted = {project: facts[project]["expressions"] for project in projects}
    allowed = {project: {lit for t in truths if t["project"] == project for lit in t["expressions"]}
               for project in projects}
    correct = sum(len(extracted[project] & allowed[project]) for project in projects)
    total = sum(len(extracted[project]) for project in projects)
    return {"recall": ratio(len(hits), len(pairs)), "recallDenominator": len(pairs), "hits": len(hits),
            "precision": ratio(correct, total), "precisionDenominator": total, "correct": correct,
            "abstainedProjects": sorted(project for project in projects if not extracted[project]),
            "misses": [{"building": name, "literal": literal} for name, literal in pairs
                       if (name, literal) not in hits],
            "wrongExtractions": sorted({f"{project}:{value}" for project in projects
                                        for value in extracted[project] - allowed[project]})}


def unit_metrics(truths: list[JsonDict], facts: dict[str, JsonDict]) -> JsonDict:
    keyed = [truth for truth in truths if truth["unitCount"] is not None]
    hits = [truth["building"] for truth in keyed if truth["unitCount"] in facts[truth["project"]]["units"]]
    projects = {truth["project"] for truth in truths}
    allowed = {project: set().union(*[t["unitLiterals"] for t in truths if t["project"] == project])
               for project in projects}
    correct = sum(len(facts[project]["units"] & allowed[project]) for project in projects)
    total = sum(len(facts[project]["units"]) for project in projects)
    return {"recall": ratio(len(hits), len(keyed)), "recallDenominator": len(keyed), "hits": len(hits),
            "precision": ratio(correct, total), "precisionDenominator": total, "correct": correct,
            "abstainedProjects": sorted(project for project in projects if not facts[project]["units"]),
            "misses": [truth["building"] for truth in keyed if truth["building"] not in hits],
            "excludedRecordsWithBlankRegistryUnitCount": [t["building"] for t in truths if t["unitCount"] is None]}


def basement_metrics(truths: list[JsonDict], facts: dict[str, JsonDict]) -> JsonDict:
    scored = [truth for truth in truths if truth["basementIndicated"] is not None]
    true_positive = sum(1 for t in scored if t["basementIndicated"] and facts[t["project"]]["basement"])
    false_positive = sum(1 for t in scored if not t["basementIndicated"] and facts[t["project"]]["basement"])
    false_negative = sum(1 for t in scored if t["basementIndicated"] and not facts[t["project"]]["basement"])
    return {"truthDefinition": "registry floor expression contains a B token (literal, not a count)",
            "precision": ratio(true_positive, true_positive + false_positive),
            "precisionDenominator": true_positive + false_positive,
            "recall": ratio(true_positive, true_positive + false_negative),
            "recallDenominator": true_positive + false_negative, "recordsScored": len(scored),
            "basementCount": {"registryKnownRecords": sum(t["basementCountKnown"] for t in truths),
                              "state": "unscoreable_registry_blank_for_every_record",
                              "proposedCountsByProject": {p: sorted(f["basementCounts"]) for p, f in facts.items()}}}


def label_metrics(truths: list[JsonDict], facts: dict[str, JsonDict]) -> JsonDict:
    wanted = [(t["building"], label) for t in truths for label in t["d2Labels"]]
    matched = [(name, label) for name, label in wanted
               if any(label_key(found) and label_key(found) in label_key(label)
                      for found in facts[next(t["project"] for t in truths if t["building"] == name)]["labels"])]
    return {"truthKind": "d2_candidate_observation_not_truth", "recall": ratio(len(matched), len(wanted)),
            "recallDenominator": len(wanted), "hits": len(matched), "precision": None,
            "misses": [{"building": name, "label": label} for name, label in wanted if (name, label) not in matched]}


def score_system(truths: list[JsonDict], facts: dict[str, JsonDict]) -> JsonDict:
    return {"floorExpression": expression_metrics(truths, facts), "unitCount": unit_metrics(truths, facts),
            "basementIndicated": basement_metrics(truths, facts), "floorLabels": label_metrics(truths, facts)}


def key_of(metrics: JsonDict | None) -> tuple[float, float]:
    if metrics is None:
        return (-1.0, -1.0)
    return (metrics["precision"] or 0.0, metrics["recall"] or 0.0)


def choose_routes(baseline: JsonDict, agent: JsonDict | None) -> JsonDict:
    """Per field, precision first and then recall; ties and an unavailable agent go to the baseline."""
    routes = {}
    for field in baseline:
        rule, model = key_of(baseline[field]), key_of(agent[field] if agent else None)
        routes[field] = {"route": "agent" if model > rule else "baseline", "baseline": rule,
                         "agent": model if agent else None}
    return routes


def items_by_source(items_dir: Path) -> dict[str, list[JsonDict]]:
    return {path.name.split(".")[0]: load_json(path)["items"] for path in sorted(items_dir.glob("*.storey.json"))}


def project_facts(records: list[JsonDict], by_source: dict[str, list[JsonDict]]) -> dict[str, JsonDict]:
    facts = {}
    for record in records:
        parts = [facts_from_items(by_source.get(sha, [])) for sha in extraction_shas(record)]
        facts[record["projectSourceId"]] = merge_facts(parts)
    return facts


def part_index(store: JsonDict) -> dict[str, tuple[int, JsonDict]]:
    return {line["id"]: (int(page), line) for page, entry in store["pages"].items() for line in entry["lines"]}


def cited_items(store: JsonDict, field: str, value: Any, literal: Any, citations: list[JsonDict], **extra: Any):
    index = part_index(store)
    for citation in citations:
        if citation["partId"] not in index:
            continue
        page, line = index[citation["partId"]]
        locator = {"page": page, "bbox": line["box"], "lineId": line["id"], "textSpan": None}
        yield {"field": field, "value": value, "valueLiteral": literal, "quote": citation["quote"],
               "locator": locator, "sourceSha256": store["source"]["sha256"], "method": "model:sarvam-105b@2026-10-10",
               "state": "candidate", **extra}


def agent_items(store: JsonDict, document: JsonDict) -> list[JsonDict]:
    items: list[JsonDict] = []
    for result in document["results"]:
        output = result.get("output")
        if not output:
            continue
        count = output["storeyCount"]
        if count["value"] is not None:
            items += cited_items(store, "storeyCount", count["value"], count["value"], count["citations"])
        for entry in output["floorExpressions"]:
            items += cited_items(store, "floorExpression", squash(entry["expression"]), entry["expression"],
                                 entry["citations"], scope=entry["scope"])
        items += [item for entry in output["unitCounts"]
                  for item in cited_items(store, "unitCount", entry["value"], entry["value"], entry["citations"])]
        items += [item for entry in output["labels"] for item in cited_items(
            store, "floorLabel", entry["label"], entry["label"], entry["citations"], labelKind=entry["kind"])]
        if output["basementCount"]["value"] is not None:
            basement = output["basementCount"]
            items += cited_items(store, "basementCount", basement["value"], basement["value"], basement["citations"])
    return items


def agent_status(documents: list[JsonDict]) -> JsonDict:
    states = [result["state"] for document in documents for result in document["results"]]
    results = [result for document in documents for result in document["results"]]
    codes = sorted({result["code"] for result in results if result.get("code")})
    if not states or all(state == "teacher_unavailable" for state in states):
        return {"state": "teacher_unavailable", "codes": codes, "batches": len(states)}
    by_state = {state: states.count(state) for state in set(states)}
    return {"state": "available", "codes": codes, "batches": len(states), "byState": by_state}


def verified_agent_items(
    stores: dict[str, JsonDict], agent_dir: Path | None,
) -> tuple[dict[str, list[JsonDict]], JsonDict]:
    by_source: dict[str, list[JsonDict]] = {}
    documents = []
    for sha, store in stores.items():
        path = agent_dir / f"{sha}.agent.json" if agent_dir else None
        if path and path.exists():
            document = load_json(path)
            documents.append(document)
            kept, _ = verifier.filter_verified(store, agent_items(store, document))
            by_source[sha] = kept
    return by_source, agent_status(documents)


def git_value(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, check=True).stdout.strip()


def load_stores(pages_dir: Path, shas: set[str]) -> dict[str, JsonDict]:
    return {sha: verifier.load_page_store(pages_dir / f"{sha}.pages.json")
            for sha in sorted(shas) if (pages_dir / f"{sha}.pages.json").exists()}


def dev_stage(args: argparse.Namespace) -> int:
    records = load_records("dev")
    truths = [truth_for(record) for record in records]
    shas = {sha for record in records for sha in extraction_shas(record)}
    stores = load_stores(args.pages, shas)
    baseline = score_system(truths, project_facts(records, items_by_source(args.items)))
    agent_by_source, status = verified_agent_items(stores, args.agent)
    agent = score_system(truths, project_facts(records, agent_by_source)) if status["state"] == "available" else None
    result = {"schemaVersion": "storey-a5-result/1", "stage": "dev", "split": "development",
              "records": [truth["building"] for truth in truths], "pagesRetained": len(stores), "baseline": baseline,
              "agent": {"status": status, "metrics": agent}, "holdout": {"state": "not_run"}}
    choice = {"schemaVersion": "storey-a5-dev-choice/1", "selectedOn": "development projects only",
              "rule": "precision first, then recall; ties and an unavailable agent go to the baseline",
              "routes": choose_routes(baseline, agent)}
    (HERE / "dev-choice.json").write_text(json.dumps(choice, indent=1) + "\n", encoding="utf-8")
    (HERE / "result.json").write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps(choice["routes"], indent=1))
    return 0


def committed_choice() -> str:
    path = "docs/evidence/gf-ai/storeys/a5/dev-choice.json"
    if git_value("status", "--porcelain", "--", path) or not git_value("log", "-1", "--format=%H", "--", path):
        raise SystemExit("dev-choice.json must be committed and unmodified before the holdout is opened")
    return git_value("log", "-1", "--format=%H", "--", path)


def holdout_stage(args: argparse.Namespace) -> int:
    choice_commit = committed_choice()
    records = load_records("holdout")
    truths = [truth_for(record) for record in records]
    stores = load_stores(args.pages, {sha for record in records for sha in extraction_shas(record)})
    by_source = items_by_source(args.items)
    metrics = score_system(truths, project_facts(records, by_source))
    result = load_json(HERE / "result.json")
    result["holdout"] = {"state": "run_once", "choiceCommit": choice_commit, "system": "baseline",
                         "records": len(truths), "pagesRetained": len(stores), "metrics": metrics,
                         "agent": "withheld_by_rule: holdout documents never go to Sarvam or any provider"}
    (HERE / "result.json").write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({field: [m["precision"], m["recall"]] for field, m in metrics.items()}))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["dev", "holdout"])
    parser.add_argument("--pages", type=Path, required=True, help="directory of retained *.pages.json stores")
    parser.add_argument("--items", type=Path, required=True, help="directory of *.storey.json rule outputs")
    parser.add_argument("--agent", type=Path, help="directory of *.agent.json outputs (development/demo only)")
    args = parser.parse_args()
    return dev_stage(args) if args.stage == "dev" else holdout_stage(args)


if __name__ == "__main__":
    raise SystemExit(main())
