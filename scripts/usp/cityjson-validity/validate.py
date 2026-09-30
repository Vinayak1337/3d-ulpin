"""Offline, pinned cjval/val3dity validation; never a canonical qualification command."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
MAX_INPUT = 8 * 1024 * 1024
MAX_REPORT = 4 * 1024 * 1024
CHECKS = {"json_syntax", "schema", "extensions", "parents_children_consistency",
          "wrong_vertex_index", "semantics_arrays", "textures", "materials"}
PARAMETERS = {"snap_tol": 1e-12, "planarity_d2p_tol": 0.01,
              "planarity_n_tol": 20.0, "overlap_tol": 0.0}


class Refused(ValueError):
    pass


class Unsupported(Refused):
    pass


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def bounded(path: Path, limit: int = MAX_REPORT) -> bytes:
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise Refused(f"Byte limit exceeded: {path.name}")
    return data


def strict_json(data: bytes):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise Refused("Duplicate JSON key")
            result[key] = value
        return result
    def constant(value):
        raise Refused("Nonfinite JSON number")
    return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)


def encode(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, allow_nan=False,
                       sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def save(path: Path, data: bytes):
    with path.open("xb") as stream:
        stream.write(data)


def derivatives(source: dict, selections: list[tuple[str, int]]):
    """Copy supplied header/feature values; selection changes no coordinate or index."""
    if not isinstance(source, dict):
        raise Refused("Source JSON must be an object")
    if source.get("type") == "CityJSON":
        document = copy.deepcopy(source)
        lineage = {"mode": "standalone_copy"}
    else:
        header, feature = source.get("metadata"), source.get("feature")
        if not isinstance(header, dict) or header.get("type") != "CityJSON" \
                or not isinstance(feature, dict) or feature.get("type") != "CityJSONFeature":
            raise Unsupported("Unsupported source envelope; require supplied CityJSON header/feature")
        if header.get("CityObjects") != {} or header.get("vertices") != []:
            raise Unsupported("Nonempty header geometry needs an unsupported merge")
        document = copy.deepcopy(header)
        document["CityObjects"] = copy.deepcopy(feature.get("CityObjects"))
        document["vertices"] = copy.deepcopy(feature.get("vertices"))
        # Appearance/templates may be local to the feature. Never silently lose a collision.
        for field in set(feature) - {"type", "id", "CityObjects", "vertices"}:
            if field in document and document[field] != feature[field]:
                raise Refused("Conflicting header/feature property")
            document[field] = copy.deepcopy(feature[field])
        lineage = {"mode": "supplied_header_feature_merge", "headerPointer": "/metadata",
                   "objectsPointer": "/feature/CityObjects", "verticesPointer": "/feature/vertices",
                   "featureId": feature.get("id"), "featureType": feature["type"]}
    if document.get("version") != "2.0" or not isinstance(document.get("CityObjects"), dict) \
            or not isinstance(document.get("vertices"), list):
        raise Unsupported("Only standalone CityJSON 2.0 is supported")
    # Upstream CLI can fetch extension URLs. This offline adapter excludes that route.
    if document.get("extensions"):
        raise Unsupported("Extension schemas are outside this offline profile")
    if not selections or len(set(selections)) != len(selections) or len(selections) > 16:
        raise Refused("Require 1 to 16 distinct supplied geometry selections")
    selected = copy.deepcopy(document)
    for obj in selected["CityObjects"].values():
        if not isinstance(obj, dict):
            raise Refused("CityObject must be an object")
        obj.pop("geometry", None)
    pins = []
    for object_id, index in selections:
        obj = document["CityObjects"].get(object_id)
        if not isinstance(obj, dict) or type(index) is not int or index < 0:
            raise Refused("Geometry selection does not exist")
        geometries = obj.get("geometry")
        if not isinstance(geometries, list) or index >= len(geometries):
            raise Refused("Geometry selection does not exist")
        geometry = geometries[index]
        if not isinstance(geometry, dict) or geometry.get("type") not in {"MultiSurface", "Solid"}:
            raise Unsupported("Selected geometry profile is unsupported")
        selected["CityObjects"][object_id].setdefault("geometry", []).append(copy.deepcopy(geometry))
        pins.append({"objectId": object_id, "sourceGeometryIndex": index,
                     "selectedGeometryIndex": len(selected["CityObjects"][object_id]["geometry"]) - 1,
                     "type": geometry["type"], "lod": geometry.get("lod"),
                     "geometrySha256": sha(encode(geometry))})
    return document, selected, {**lineage, "selections": pins,
                                "coordinatePolicy": "unchanged encoded vertices and supplied transform"}


def verify_tool(tools_root: Path, pin: dict) -> Path:
    executable = None
    for item in pin["files"]:
        relative = Path(item["path"])
        path = (tools_root / relative).resolve()
        if relative.is_absolute() or not path.is_relative_to(tools_root.resolve()):
            raise Refused("Tool path escaped tooling root")
        if not path.is_file():
            raise FileNotFoundError(item["path"])
        if sha(bounded(path, 100 * 1024 * 1024)) != item["sha256"]:
            raise Refused("Pinned tool bytes differ: " + item["path"])
        if item.get("executable") is True:
            executable = path
    if executable is None:
        raise Refused("Tool executable pin missing")
    return executable


def exact_identity_gate(document: dict):
    """val3dity's strict distance comparison needs positive tolerance for identical points.

    Bound floating decoding error against the source integer grid. Refuse profiles
    where this threshold could coalesce distinct coordinates; never move/round input.
    """
    transform = document.get("transform", {})
    if not isinstance(transform, dict):
        raise Unsupported("Unsupported identity-only tolerance: transform must be an object")
    scale, translate = transform.get("scale"), transform.get("translate")
    if not isinstance(scale, list) or not isinstance(translate, list) or len(scale) != 3 or len(translate) != 3 \
            or any(type(v) not in {int, float} or not math.isfinite(v) for v in scale + translate) \
            or min(scale) <= 0:
        raise Unsupported("Unsupported identity-only tolerance: require supplied positive integer-grid transform")
    maxima = [0.0, 0.0, 0.0]
    for vertex in document["vertices"]:
        if not isinstance(vertex, list) or len(vertex) != 3 or any(type(v) is not int or abs(v) > 2**53 - 1 for v in vertex):
            raise Unsupported("Unsupported identity-only tolerance: require safe encoded integer vertices")
        for axis in range(3):
            decoded = vertex[axis] * scale[axis] + translate[axis]
            if not math.isfinite(decoded):
                raise Refused("Nonfinite decoded coordinate")
            maxima[axis] = max(maxima[axis], abs(decoded), abs(vertex[axis] * scale[axis]), abs(translate[axis]))
    ulps = [math.ulp(value) for value in maxima]
    if any(scale[axis] <= 8 * ulps[axis] + 2 * PARAMETERS["snap_tol"] for axis in range(3)):
        raise Unsupported("Unsupported identity-only tolerance: source grid cannot exclude distinct-point merging")
    return {"snapToleranceSourceUnits": PARAMETERS["snap_tol"], "sourceScale": scale,
            "maximumCoordinateUlp": ulps, "distinctSourceGridPointsCannotCoalesce": True}


def run_process(command: list[str], directory: Path, stem: str, deadline: float,
                report_path: Path | None = None):
    out, err = directory / (stem + ".stdout"), directory / (stem + ".stderr")
    started = time.monotonic()
    result = {"command": command, "exitCode": None, "execution": "error"}
    with out.open("xb") as stdout, err.open("xb") as stderr:
        try:
            process = subprocess.Popen(command, cwd=directory, stdin=subprocess.DEVNULL,
                                       stdout=stdout, stderr=stderr, shell=False,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        except OSError as error:
            result.update(execution="unavailable", reason=type(error).__name__)
        else:
            reason = None
            while process.poll() is None:
                paths = [out, err] + ([report_path] if report_path else [])
                if any(path.exists() and path.stat().st_size > MAX_REPORT for path in paths):
                    reason = "output_limit"
                elif time.monotonic() >= deadline:
                    reason = "timeout"
                if reason:
                    process.kill()  # These pinned tools launch no validation child processes.
                    process.wait()
                    break
                time.sleep(0.025)
            result.update(exitCode=process.returncode, execution=reason or "completed")
    result["elapsedSeconds"] = round(time.monotonic() - started, 6)
    result["outputs"] = [{"file": path.name, "bytes": path.stat().st_size,
                          "sha256": sha(bounded(path, MAX_REPORT + 65536))}
                         for path in [out, err] if path.exists() and path.stat().st_size <= MAX_REPORT + 65536]
    return result


def cjval_result(report: dict, version: str):
    if not isinstance(report, dict) or report.get("type") != "cjval_report" or report.get("cjval_version") != version \
            or type(report.get("valid")) is not bool or type(report.get("has_warnings")) is not bool:
        raise Refused("Incomplete cjval report identity")
    checks = report.get("checks")
    if not isinstance(checks, dict):
        raise Refused("Incomplete cjval checks")
    errors, warnings = checks.get("errors"), checks.get("warnings")
    if not isinstance(errors, dict) or set(errors) != CHECKS \
            or not isinstance(warnings, dict) or set(warnings) != {"extra_root_properties", "duplicate_vertices", "unused_vertices"}:
        raise Refused("Incomplete cjval checks")
    for check in list(errors.values()) + list(warnings.values()):
        if not isinstance(check, dict) or type(check.get("valid")) is not bool or not isinstance(check.get("errors"), list) \
                or check["valid"] == bool(check["errors"]):
            raise Refused("Inconsistent cjval check")
    if report["valid"] != all(check["valid"] for check in errors.values()):
        raise Refused("Inconsistent cjval verdict")
    if report["has_warnings"] != any(not check["valid"] for check in warnings.values()):
        raise Refused("Inconsistent cjval warnings")
    return {"state": "valid" if report["valid"] else "invalid",
            "hasWarnings": report["has_warnings"], "checks": report["checks"]}


def val3dity_result(report: dict, version: str, selections: list[dict]):
    if not isinstance(report, dict) or report.get("type") != "val3dity_report" or report.get("val3dity_version") != version \
            or report.get("input_file_type") != "CityJSON" or type(report.get("validity")) is not bool \
            or report.get("parameters") != PARAMETERS:
        raise Refused("Incomplete val3dity report identity/configuration")
    features, overview = report.get("features"), report.get("primitives_overview")
    if not isinstance(features, list) or not isinstance(overview, list) \
            or not isinstance(report.get("all_errors"), list) or not isinstance(report.get("dataset_errors"), list):
        raise Refused("Incomplete val3dity report coverage")
    if report["dataset_errors"]:
        return {"state": "unsupported", "datasetErrors": report["dataset_errors"]}
    expected = {}
    for pin in selections:
        expected[pin["type"]] = expected.get(pin["type"], 0) + 1
    observed = {}
    for item in overview:
        if not isinstance(item, dict) or item.get("type") in observed or type(item.get("total")) is not int \
                or type(item.get("valid")) is not int or not 0 <= item["valid"] <= item["total"]:
            raise Refused("Inconsistent primitive coverage")
        observed[item["type"]] = item["total"]
    if observed != expected or not features:
        raise Refused("Incomplete selected primitive coverage")
    if any(not isinstance(feature, dict) or type(feature.get("validity")) is not bool or not isinstance(feature.get("errors"), list)
           for feature in features):
        raise Refused("Incomplete feature verdict")
    fully_valid = all(item["valid"] == item["total"] for item in overview) \
        and all(feature["validity"] and not feature["errors"] for feature in features) \
        and not report["all_errors"]
    if report["validity"] != fully_valid:
        raise Refused("Inconsistent val3dity verdict")
    return {"state": "valid" if fully_valid else "invalid", "primitives": overview,
            "features": features, "errorCodes": report["all_errors"]}


def validate(source_path: Path, expected_sha: str, tools_root: Path, output: Path,
             selections: list[tuple[str, int]], timeout: float):
    started = time.monotonic()
    deadline = started + timeout
    if output.exists():
        raise Refused("Output already exists; preserve previous results")
    if output.resolve().is_relative_to(Path(__file__).resolve().parents[3]):
        raise Refused("Tool outputs must stay outside Git")
    output.mkdir(parents=True, exist_ok=False)
    lock_bytes = bounded(ROOT / "tools.json")
    lock = strict_json(lock_bytes)
    receipt = {"schemaVersion": "cityjson-offline-validity/1", "createdAt": datetime.now(timezone.utc).isoformat(),
               "adapterSha256": sha(bounded(Path(__file__))), "toolLockSha256": sha(lock_bytes),
               "timeoutSeconds": timeout, "networkPolicy": "no extensions; embedded schemas; no source uploads",
               "analyticalQualification": "not_assessed", "commands": [], "results": {}}
    configuration = {"profile": "cityjson-2.0-integer-grid/1", "parameters": PARAMETERS,
                     "originalByteLimit": MAX_INPUT, "reportByteLimit": MAX_REPORT, "timeoutSeconds": timeout}
    receipt["configuration"] = {**configuration, "sha256": sha(encode(configuration))}
    try:
        source_bytes = bounded(source_path, MAX_INPUT)
        receipt["source"] = {"path": str(source_path.resolve()), "sha256": sha(source_bytes), "bytes": len(source_bytes)}
        if sha(source_bytes) != expected_sha:
            raise Refused("Source SHA-256 mismatch")
        document, selected, lineage = derivatives(strict_json(source_bytes), selections)
        receipt["lineage"] = lineage
        for name, value in [("document.city.json", document), ("selected.city.json", selected)]:
            data = encode(value)
            save(output / name, data)
            receipt.setdefault("inputs", []).append({"file": name, "sha256": sha(data), "bytes": len(data)})
        for name in ["cjval", "val3dity"]:
            pin = lock["tools"][name]
            try:
                executable = verify_tool(tools_root, pin)
                if time.monotonic() >= deadline:
                    raise TimeoutError("Validation deadline exhausted")
                if name == "cjval":
                    report_path = output / "cjval.stdout"
                    command = [str(executable), "--report", str(output / "document.city.json")]
                    run = run_process(command, output, name, deadline)
                else:
                    receipt["identityToleranceGate"] = exact_identity_gate(selected)
                    report_path = output / "val3dity.json"
                    command = [str(executable), str(output / "selected.city.json"), "--report", str(report_path)]
                    for key, value in PARAMETERS.items():
                        command += ["--" + key, str(value)]
                    run = run_process(command, output, name, deadline, report_path)
                receipt["commands"].append(run)
                if run["execution"] != "completed" or run["exitCode"] != 0:
                    receipt["results"][name] = {"state": "error", "reason": run["execution"], "exitCode": run["exitCode"]}
                    continue
                report_bytes = bounded(report_path)
                report = strict_json(report_bytes)
                parsed = cjval_result(report, pin["version"]) if name == "cjval" \
                    else val3dity_result(report, pin["version"], lineage["selections"])
                receipt["results"][name] = {**parsed, "toolVersion": pin["version"],
                                            "reportFile": report_path.name, "reportSha256": sha(report_bytes)}
            except Unsupported as error:
                receipt["results"][name] = {"state": "unsupported", "reason": str(error)[:500]}
            except FileNotFoundError:
                receipt["results"][name] = {"state": "unavailable", "reason": "pinned_tool_or_report_missing"}
            except (Refused, ValueError, TypeError, KeyError, OSError, TimeoutError, OverflowError) as error:
                receipt["results"][name] = {"state": "error", "reason": str(error)[:500]}
        if sha(bounded(source_path, MAX_INPUT)) != expected_sha:
            raise Refused("Source changed during validation")
    except Unsupported as error:
        receipt["unsupported"] = str(error)[:500]
    except (Refused, ValueError, TypeError, KeyError, OSError, RecursionError, OverflowError) as error:
        receipt["error"] = str(error)[:500]
    receipt["elapsedSeconds"] = round(time.monotonic() - started, 6)
    states = {result["state"] for result in receipt["results"].values()}
    receipt["state"] = "error" if "error" in receipt else "unsupported" if "unsupported" in receipt \
        else next((state for state in ["error", "unavailable", "unsupported", "invalid"] if state in states),
                  "valid" if states == {"valid"} and len(receipt["results"]) == 2 else "error")
    save(output / "receipt.json", encode(receipt))
    return receipt


def selection(value: str):
    try:
        object_id, index = value.rsplit("@", 1)
        return object_id, int(index)
    except ValueError as error:
        raise argparse.ArgumentTypeError("Use SOURCE_OBJECT_ID@GEOMETRY_INDEX") from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--tools-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--select", action="append", required=True, type=selection)
    parser.add_argument("--timeout", type=float, default=120)
    args = parser.parse_args()
    if not 0 < args.timeout <= 120:
        parser.error("Timeout must be in (0,120] seconds")
    try:
        result = validate(args.source.resolve(), args.source_sha256, args.tools_root.resolve(),
                          args.output.resolve(), args.select, args.timeout)
    except Refused as error:
        print(str(error), file=sys.stderr)
        return 2
    print(json.dumps({"state": result["state"], "results": {k: v["state"] for k, v in result["results"].items()},
                      "receipt": str(args.output.resolve() / "receipt.json")}))
    return 0 if result["state"] == "valid" else 2


if __name__ == "__main__":
    sys.exit(main())
