#!/usr/bin/env python3
"""Independent format/integrity checks for the frozen DATA-02 authored pack.

This validates fixture packaging, never production ingestion or policy behaviour.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import shutil
import struct
import tempfile
import zipfile
from fractions import Fraction
from pathlib import Path

from PIL import Image
from pypdf import PdfReader
import pypdfium2

ROOT = Path(__file__).resolve().parent / "v1"
FORMATS = {".json", ".geojson", ".jsonl", ".csv", ".txt", ".pdf", ".jpeg",
           ".tif", ".shp", ".shx", ".dbf", ".las", ".ifc", ".zip"}
OUTCOMES = {"complete", "fill_display", "ask", "park", "reject_for_3d"}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def verify_verhoeff(number: str) -> bool:
    # Independent check path: validate the complete number, including its check digit.
    multiplication = (
        (0,1,2,3,4,5,6,7,8,9),(1,2,3,4,0,6,7,8,9,5),
        (2,3,4,0,1,7,8,9,5,6),(3,4,0,1,2,8,9,5,6,7),
        (4,0,1,2,3,9,5,6,7,8),(5,9,8,7,6,0,4,3,2,1),
        (6,5,9,8,7,1,0,4,3,2),(7,6,5,9,8,2,1,0,4,3),
        (8,7,6,5,9,3,2,1,0,4),(9,8,7,6,5,4,3,2,1,0))
    permutation = (
        (0,1,2,3,4,5,6,7,8,9),(1,5,7,6,2,8,3,0,9,4),
        (5,8,0,3,7,9,6,1,4,2),(8,9,1,6,0,4,3,5,2,7),
        (9,4,5,3,1,2,6,8,7,0),(4,2,8,6,5,7,3,9,0,1),
        (2,7,9,3,8,0,6,4,1,5),(7,0,4,6,9,1,3,2,5,8))
    state = 0
    for index, char in enumerate(reversed(number)):
        state = multiplication[state][permutation[index % 8][int(char)]]
    return state == 0


def check_shapefile(directory: Path, stem: str = "points") -> dict:
    shp = (directory / (stem + ".shp")).read_bytes()
    shx = (directory / (stem + ".shx")).read_bytes()
    dbf = (directory / (stem + ".dbf")).read_bytes()
    require(not (directory / (stem + ".prj")).exists(), "missing-prj case acquired a .prj")
    require(len(shp) >= 100 and len(shx) >= 100, "short shapefile")
    require(struct.unpack_from(">I", shp, 0)[0] == 9994, "bad .shp magic")
    require(struct.unpack_from("<II", shp, 28) == (1000, 1), "bad .shp version/type")
    require(struct.unpack_from(">I", shp, 24)[0] * 2 == len(shp), "bad .shp length")
    require(struct.unpack_from(">I", shx, 24)[0] * 2 == len(shx), "bad .shx length")
    count = (len(shx) - 100) // 8
    require(count == 2 and len(shx) == 100 + 8 * count, "bad .shx records")
    points = []
    for index in range(count):
        offset, length = struct.unpack_from(">II", shx, 100 + index * 8)
        record_number, record_length = struct.unpack_from(">II", shp, offset * 2)
        require(record_number == index + 1 and length == record_length == 10, "bad .shx offset")
        kind, x, y = struct.unpack_from("<Idd", shp, offset * 2 + 8)
        require(kind == 1, "non-point .shp record")
        points.append((x, y))
    bounds = struct.unpack_from("<4d", shp, 36)
    require(bounds == (min(x for x, _ in points), min(y for _, y in points),
                       max(x for x, _ in points), max(y for _, y in points)), "wrong .shp bounds")
    require(dbf[0] == 3 and struct.unpack_from("<I", dbf, 4)[0] == count, "bad .dbf count")
    require(struct.unpack_from("<HH", dbf, 8) == (65, 11), "bad .dbf layout")
    require(dbf[64] == 13 and dbf[-1] == 26, "bad .dbf delimiters")
    return {"records": count, "bounds": bounds}


def check_las(path: Path) -> dict:
    data = path.read_bytes()
    require(data[:4] == b"LASF" and data[24:26] == bytes((1, 2)), "bad LAS signature/version")
    header_size, offset, vlr_count = struct.unpack_from("<HII", data, 94)
    point_format, record_size, point_count = struct.unpack_from("<BHI", data, 104)
    require((header_size, offset, vlr_count, point_format, record_size, point_count)
            == (227, 227, 0, 0, 20, 3), "LAS structure/count/CRS VLR mismatch")
    require(len(data) == offset + record_size * point_count, "LAS body size")
    scales = struct.unpack_from("<3d", data, 131)
    offsets = struct.unpack_from("<3d", data, 155)
    points = [tuple(raw * scale + off for raw, scale, off in
                    zip(struct.unpack_from("<3i", data, offset + index * record_size), scales, offsets))
              for index in range(point_count)]
    stored = struct.unpack_from("<6d", data, 179)
    actual = (max(p[0] for p in points), min(p[0] for p in points),
              max(p[1] for p in points), min(p[1] for p in points),
              max(p[2] for p in points), min(p[2] for p in points))
    require(all(abs(a - b) < 1e-9 for a, b in zip(stored, actual)), "LAS extents disagree")
    return {"points": point_count, "crs_vlrs": vlr_count}


def check_ifc(path: Path) -> dict:
    data = path.read_text(encoding="ascii")
    require(data.startswith("ISO-10303-21;\nHEADER;") and data.rstrip().endswith("END-ISO-10303-21;"),
            "bad STEP wrapper")
    require("FILE_SCHEMA(('IFC4'));" in data and "ENDSEC;\nDATA;" in data, "not IFC4 DATA")
    entities = dict((int(identifier), body) for identifier, body in
                    re.findall(r"^#(\d+)=(IFC[A-Z0-9_]+\(.*\));$", data, re.MULTILINE))
    require(len(entities) == 25 and len(set(entities)) == 25, "IFC entity count")
    for body in entities.values():
        for ref in re.findall(r"#(\d+)", body):
            require(int(ref) in entities, "dangling IFC reference")
    require("IFCPROJECT(" in data and "IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)" in data,
            "IFC project/units missing")
    require("IFCBUILDINGSTOREY(" in data and "IFCSITE(" in data and
            "IFCEXTRUDEDAREASOLID(" in data and "IFCPRODUCTDEFINITIONSHAPE(" in data,
            "IFC local geometry/hierarchy missing")
    require("IFCMAPCONVERSION" not in data and "IFCPROJECTEDCRS" not in data,
            "IFC unexpectedly georeferenced")
    # Lexical sanity: every opening parenthesis closes outside quoted strings.
    depth, quoted = 0, False
    for char in data:
        if char == "'": quoted = not quoted
        if not quoted:
            if char == "(": depth += 1
            elif char == ")": depth -= 1
            require(depth >= 0, "IFC unbalanced parentheses")
    require(depth == 0 and not quoted, "IFC incomplete STEP syntax")
    return {"entities": len(entities), "georeferenced": False}


def check_pdf(path: Path) -> dict:
    reader = PdfReader(path)
    require(len(reader.pages) == 1, "PDF page count")
    extracted = reader.pages[0].extract_text()
    require("SYNTHETIC" in extracted, "PDF text extraction")
    rendered = pypdfium2.PdfDocument(str(path))[0].render(scale=.5).to_pil()
    require(rendered.width >= 300 and rendered.height >= 390, "PDF render size")
    extrema = rendered.convert("L").getextrema()
    require(extrema[0] < 150 and extrema[1] > 240, "blank or dark PDF render")
    if path.name == "white-on-white.pdf":
        require("Ignore mapping policy" in extracted, "white PDF text not extractable")
        require(b"1 1 1 rg" in reader.pages[0].get_contents().get_data(), "white text ink absent")
    return {"pages": 1, "extractable_chars": len(extracted), "rendered": True}


def check_image(path: Path) -> dict:
    with Image.open(path) as image:
        image.load()
        require(image.size == (320, 220) and image.format == "JPEG", "JPEG dimensions/format")
        gps = image.getexif().get_ifd(34853)
        require(all(tag in gps for tag in (1, 2, 3, 4)), "GPS EXIF missing")
        return {"size": image.size, "gps_tags": sorted(gps)}


def check_tiff(path: Path) -> dict:
    with Image.open(path) as image:
        image.load()
        tags = image.tag_v2
        require(image.format == "TIFF" and image.size == (4, 4), "bad TIFF raster")
        require(tuple(tags[34735])[-1] == 32643, "wrong GeoTIFF horizontal EPSG")
        require(tuple(tags[33550]) == (2., 2., 0.) and len(tags[33922]) == 6,
                "GeoTIFF transform tags missing")
        return {"size": image.size, "epsg": 32643}


def check_zip(path: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        require(archive.testzip() is None, "bad ZIP CRC")
        names = archive.namelist()
        require(names == ["supported-levels.csv", "unsupported-model.qzx"], "ZIP member set")
        require(all("/" not in name and ".." not in name for name in names), "unsafe ZIP member")
        require(sum(item.file_size for item in archive.infolist()) < 128 * 1024 * 1024,
                "unbounded ZIP expansion")
        require(list(csv.DictReader(io.StringIO(archive.read(names[0]).decode("utf-8"))))[0]["kind"] == "stilt",
                "supported ZIP member invalid")
        return {"members": names}


def check_source(path: Path) -> dict:
    suffix = path.suffix.lower()
    require(suffix in FORMATS, f"unregistered source format: {path}")
    if suffix in (".json", ".geojson"):
        value = read_json(path)
        if suffix == ".geojson":
            require(value.get("type") == "FeatureCollection" and value.get("features"), "bad GeoJSON")
            for feature in value["features"]:
                require(feature.get("type") == "Feature" and feature.get("geometry", {}).get("coordinates"),
                        "bad GeoJSON feature")
        return {"json_parsed": True}
    if suffix == ".jsonl":
        lines = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
        require(lines, "empty JSONL")
        return {"jsonl_rows": len(lines)}
    if suffix == ".csv":
        content = path.read_text(encoding="utf-8")
        delimiter = ";" if path.name == "heldout-b.csv" else ","
        reader = csv.reader(io.StringIO(content), delimiter=delimiter)
        rows = list(reader)
        require(len(rows) >= 2 and len(rows[0]) >= 2, "empty CSV")
        require(all(len(row) == len(rows[0]) for row in rows[1:]), "ragged CSV")
        return {"csv_rows": len(rows) - 1, "columns": len(rows[0])}
    if suffix == ".txt":
        require(bool(path.read_text(encoding="utf-8").strip()), "empty UTF-8 text")
        return {"utf8": True}
    if suffix == ".pdf": return check_pdf(path)
    if suffix == ".jpeg": return check_image(path)
    if suffix == ".tif": return check_tiff(path)
    if suffix == ".las": return check_las(path)
    if suffix == ".ifc": return check_ifc(path)
    if suffix == ".zip": return check_zip(path)
    if suffix in (".shp", ".shx", ".dbf"):
        return check_shapefile(path.parent)
    raise AssertionError(f"unreachable source format {path}")


def check_semantics(case: str, directory: Path, expectation: dict) -> list[str]:
    checks = []
    if case == "crs-utm43-as44":
        data = list(csv.DictReader((directory / "points-and-synthetic-controls.csv").open(encoding="utf-8")))
        require(len(data) == 3 and len({row["id"] for row in data}) == 3, "synthetic UTM controls")
        require(read_json(directory / "source-metadata.json")["declared_crs"] == "EPSG:32644", "UTM mislabel")
        require(expectation["crs_status"] == "crs_unverified" and expectation["publication"] == "blocked",
                "UTM oracle changed")
        for row in data:
            approximate_shift = 6 * 111320 * __import__("math").cos(__import__("math").radians(float(row["synthetic_control_lat"])))
            require(approximate_shift > expectation["synthetic_control_residual_lower_bound_m"],
                    "wrong-zone residual bound")
        checks.append("three labelled synthetic UTM controls and blocked wrong-zone declaration")
    elif case == "crs-kalianpur-as-wgs84":
        data = list(csv.DictReader((directory / "native-geodetic-and-synthetic-controls.csv").open(encoding="utf-8")))
        require(len(data) == 3, "datum controls")
        for row in data:
            lat = float(row["native_lat_deg"])
            dx = (float(row["synthetic_wgs84_control_lon"]) - float(row["native_lon_deg"])) * 111320 * __import__("math").cos(__import__("math").radians(lat))
            dy = (float(row["synthetic_wgs84_control_lat"]) - lat) * 111320
            require((dx * dx + dy * dy) ** .5 > expectation["synthetic_control_residual_lower_bound_m"],
                    "identity transform no longer rejected")
        checks.append("synthetic identity-transform residual bound")
    elif case == "crs-axis-order":
        actual = read_json(directory / "actually-swapped.geojson")["features"][0]["geometry"]["coordinates"]
        conflict = read_json(directory / "indian-bounds-declaration-conflict.geojson")["features"][0]
        lon, lat = conflict["geometry"]["coordinates"]
        require(actual == [lat, lon] and not (68 <= actual[0] <= 98 and 6 <= actual[1] <= 38),
                "axis swap must leave India")
        require(68 <= lon <= 98 and 6 <= lat <= 38 and conflict["properties"]["declared_axis_order"] == "latitude,longitude",
                "in-India declaration conflict absent")
        checks.append("impossible swapped-in-India claim resolved by declaration conflict")
    elif case == "crs-missing-prj":
        require(expectation["crs_status"] == "crs_unverified", "unknown CRS oracle")
        checks.append("missing .prj retained unknown")
    elif case == "indian-messy-csv":
        data = list(csv.DictReader((directory / "literal-records.csv").open(encoding="utf-8")))
        require(len(data) == 8 and data[0]["खसरा क्रमांक"] == "१२३/४क" and data[2]["खसरा क्रमांक"] == "0007/02",
                "literal identifier loss")
        require(Fraction(125) * Fraction(83612736, 100000000) == Fraction(10451592, 100000), "gaj conversion")
        require(expectation["regional_unit_outcome"].startswith("needs_input"), "regional unit oracle")
        checks.append("literal preservation and exact square-yard conversion")
    elif case == "agent-injection":
        content = (directory / "hostile-csv.csv").read_text(encoding="utf-8")
        require("\u202e" in content and chr(0xE0000 + ord("P")) in content,
                "bidi/tag source missing")
        require("https://invalid.example/" in read_json(directory / "ocr-output.json")["ocr_text"],
                "OCR link source missing")
        require(len(expectation["channels"]) == 8 and expectation["record_commits"] == 0,
                "injection oracle")
        checks.append("all eight untrusted instruction channels")
    elif case == "privacy-synthetic-deed":
        number = expectation["aadhaar_literal"]
        require(len(number) == 12 and number.isdecimal() and verify_verhoeff(number), "dummy Aadhaar check digit")
        require(" ".join(number[i:i+4] for i in (0,4,8)) in PdfReader(directory / "synthetic-deed.pdf").pages[0].extract_text(),
                "deed identifier text")
        require(expectation["recorded_title"] == "not_assessed" and expectation["gps_as_control"] is False,
                "deed privacy boundary")
        checks.append("Verhoeff and GPS leakage probe")
    elif case == "cross-site-metro":
        features = read_json(directory / "corridor-and-sites.geojson")["features"]
        line = features[2]["geometry"]["coordinates"]
        boundary = features[0]["geometry"]["coordinates"][0][1][0]
        require(line[0][0] < boundary < line[1][0], "metro line does not cross two sites")
        require(expectation["common_site_created"] is False and expectation["depth"] == "unknown",
                "corridor oracle boundary")
        checks.append("cross-site line and unknown depth")
    elif case == "tenure-cooperative":
        source = read_json(directory / "society-record.json")
        require(source["land_uds_declaration"] is None and expectation["unit_uds"] == "not_applicable",
                "society UDS wrongly inferred")
        checks.append("society occupancy separate from land UDS")
    elif case == "tenure-per-deed-uds":
        source = read_json(directory / "per-deed-source.json")
        total = sum((Fraction(row["numerator"], row["denominator"]) for row in source["deeds"]), Fraction())
        partial = sum((Fraction(value) for value in source["partial_995_control"]["fractions"]), Fraction())
        require(total == 1 and partial == Fraction(199,200), "UDS independent rational sum")
        require(expectation["complete_995"]["outcome"] == "scoped_arithmetic_review_finding" and
                expectation["partial_995"]["outcome"] == "not_assessed_incomplete_population",
                "complete/partial UDS collapsed")
        require(expectation["one_unit_limited_common"]["cardinality_valid"], "one-unit limited common")
        checks.append("exact 1 and 199/200 fractions; complete versus partial")
    elif case == "topology-adverse-clean-pairs":
        source = read_json(directory / "pairs.json")
        actual_ids = [pair["pair"] for pair in source["pairs"]]
        expected_ids = [pair["id"] for pair in expectation["pairs"]]
        require(actual_ids == expected_ids and len(actual_ids) == 7, "topology pair coverage")
        require(all(pair["clean_twin"] for pair in source["pairs"]), "missing clean twin")
        adverse, twin = source["pairs"][0]["adverse"], source["pairs"][0]["clean_twin"]
        def overlap(first, second):
            area = max(0,min(first["xy"][2],second["xy"][2])-max(first["xy"][0],second["xy"][0])) * max(0,min(first["xy"][3],second["xy"][3])-max(first["xy"][1],second["xy"][1]))
            height = max(0,min(first["z"][1],second["z"][1])-max(first["z"][0],second["z"][0]))
            return area, area * height
        require(overlap(adverse["a"],adverse["b"]) == (10,20) and overlap(twin["a"],twin["b"]) == (0,0),
                "overlap arithmetic")
        shell = source["shell_with_hole"]
        outer, hole = shell["outer_xy"], shell["hole_xy"]
        area = (outer[2]-outer[0])*(outer[3]-outer[1])-(hole[2]-hole[0])*(hole[3]-hole[1])
        require(area == 96 and expectation["clean_twin_positive_findings"] == 0,
                "hole arithmetic / clean twin")
        checks.append("seven adverse/clean pairs; 10 m2, 20 m3, zero contact, 96 m2 shell")
    elif case == "roof-and-chajja-negatives":
        source = read_json(directory / "roof-source.json")
        require(source["observed_roof_z_m"] == source["planned_roof_z_m"] and
                source["chajja"]["plinth_footprint"] is None and not expectation["extra_level_flag"],
                "roof/chajja negative")
        checks.append("mumty/tank/parapet negative and chajja abstention")
    elif case == "sloped-site":
        source = read_json(directory / "section-and-road.json")
        terrain = source["terrain_points_local_m"]
        require(source["road_entry"]["label"] == "Ground" and terrain[1]["z"]-terrain[0]["z"] == 6.0,
                "sloped-site arithmetic")
        checks.append("Ground label at uphill road entry")
    elif case == "stilt-mezzanine-levels":
        data = list(csv.DictReader((directory / "level-schedule.csv").open(encoding="utf-8")))
        require([row["level_kind"] for row in data] == expectation["level_kinds"] and
                all(not row["elevation_m"] for row in data), "level order/unknown elevation")
        checks.append("stilt/mezzanine source labels, no invented elevation")
    elif case == "lift-core-480":
        source = read_json(directory / "one-core.json")
        require(len(source["beneficiaries"]) == 480 and len(set(source["beneficiaries"])) == 480,
                "lift beneficiary total")
        require(expectation["page_lengths"] == [100,100,100,100,80] and
                expectation["distinct_geometry_ids"] == 1, "lift paging oracle")
        checks.append("480 distinct beneficiaries, one core, five bounded pages")
    elif case == "mixed-gap-batch":
        decisions = expectation["decisions"]
        pairs = [(item["object"],item["task"]) for item in decisions]
        require(len(pairs) == len(set(pairs)) == 16, "mixed decision coverage")
        require(all(item["outcome"] in OUTCOMES for item in decisions), "unknown sufficiency outcome")
        questions = expectation["questions"]
        ids = {item["id"] for item in questions}
        require(len(ids) == expectation["open_question_count"] <= expectation["max_open_questions"] <= 5,
                "question budget")
        require(all(item["question"] is None or item["question"] in ids for item in decisions),
                "orphan question")
        require(all("Not sure" in item["choices"] and "all" in item["class"].lower() or
                    item["id"] == "Q-LOCAL-FRAME" and "Not sure" in item["choices"]
                    for item in questions), "question not class level")
        require(expectation["originals_deleted"] == 0 and expectation["unqualified_global_placement"],
                "mixed batch invented placement")
        checks.append("16 task decisions, four class questions, no never-fill breach")
    elif case == "agent-heldout-and-protocol":
        require(len(expectation["heldout_layouts"]) == 3 and
                len(read_json(directory / "invalid-provider-literals.json")["mapping_plan_candidates"]) == 4,
                "agent layout/literal coverage")
        require(expectation["invalid_provider_literals"].startswith("all four rejected"), "agent literal oracle")
        checks.append("three held-out layouts and four literal-rejection classes")
    else:
        raise AssertionError(f"unvalidated case {case}")
    return checks


def validate_pack(root: Path = ROOT) -> dict:
    catalogue = read_json(root / "catalogue.json")
    entries = catalogue["cases"]
    require(catalogue["schema_version"] == "usp-adversarial-catalogue/1" and
            catalogue["case_count"] == len(entries) == 17, "catalogue count/version")
    require(len({entry["case_id"] for entry in entries}) == len(entries), "duplicate case IDs")
    require({path.name for path in root.iterdir() if path.is_dir()} == {entry["case_id"] for entry in entries},
            "unlisted case directory")
    result = {"schema_version":"usp-adversarial-validation/1", "case_count":len(entries),
              "source_count":0, "cases":[], "source_hashes":{}, "format_counts":{},
              "scope":"fixture packaging/format/arithmetic only; no production evaluation"}
    for entry in entries:
        case = entry["case_id"]
        directory = root / case
        oracle = read_json(directory / "oracle.json")
        require(oracle["schema_version"] == "usp-adversarial-oracle/1" and
                oracle["case_id"] == case and oracle["fixture_version"] == "v1", "oracle identity")
        require(oracle["author"]["product"] == "Codex" and oracle["authored_at"] == "2026-09-25",
                "oracle provenance")
        require(oracle["classification"] == "test_only" and oracle["preconditions"] and
                oracle["expected"] and oracle["maps_to"]["requirements"] and oracle["maps_to"]["tests"],
                "oracle metadata")
        require(oracle["maps_to"]["requirements"] == entry["requirements"] and
                oracle["maps_to"]["tests"] == entry["tests"], "catalogue mapping mismatch")
        paths = [item["path"] for item in oracle["files"]]
        actual = [path.relative_to(directory).as_posix() for path in directory.rglob("*")
                  if path.is_file() and path.name != "oracle.json"]
        require(sorted(paths) == sorted(actual) and len(paths) == len(set(paths)), "oracle source inventory")
        for item in oracle["files"]:
            path = directory / item["path"]
            data = path.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            require(digest == item["sha256"] and len(data) == item["bytes"],
                    f"source hash or byte size mismatch: {case}/{item['path']}")
            parsed = check_source(path)
            result["source_hashes"][f"{case}/{item['path']}"] = digest
            result["source_count"] += 1
            suffix = path.suffix.lower()
            result["format_counts"][suffix] = result["format_counts"].get(suffix,0) + 1
            require(bool(parsed), "format reader returned no result")
        semantic = check_semantics(case,directory,oracle["expected"])
        result["cases"].append({"case_id":case,"source_count":len(paths),"semantic_checks":semantic,
                                "oracle_sha256":hashlib.sha256((directory / "oracle.json").read_bytes()).hexdigest()})
    return result


def mutation_checks() -> list[str]:
    outcomes = []
    with tempfile.TemporaryDirectory(prefix="ulpin-data02-mutations-") as temporary:
        destination = Path(temporary) / "v1"
        shutil.copytree(ROOT,destination)
        source = destination / "agent-injection/hostile-csv.csv"
        data = bytearray(source.read_bytes())
        data[0] ^= 1
        source.write_bytes(data)
        try: validate_pack(destination)
        except AssertionError as exc:
            require("source hash" in str(exc), "source mutation failed for wrong reason")
            outcomes.append("mutated source byte rejected by SHA-256")
        else: raise AssertionError("mutated source was accepted")
    with tempfile.TemporaryDirectory(prefix="ulpin-data02-mutations-") as temporary:
        destination = Path(temporary) / "v1"
        shutil.copytree(ROOT,destination)
        path = destination / "mixed-gap-batch/oracle.json"
        value = read_json(path)
        value["expected"]["max_open_questions"] = 3
        path.write_text(json.dumps(value,ensure_ascii=False),encoding="utf-8")
        try: validate_pack(destination)
        except AssertionError as exc:
            require("question budget" in str(exc), "oracle mutation failed for wrong reason")
            outcomes.append("inconsistent question-budget oracle rejected")
        else: raise AssertionError("inconsistent oracle was accepted")
    with tempfile.TemporaryDirectory(prefix="ulpin-data02-mutations-") as temporary:
        path = Path(temporary) / "broken.las"
        data = bytearray((ROOT / "mixed-gap-batch/point-cloud-no-crs.las").read_bytes())
        struct.pack_into("<I",data,107,4)
        path.write_bytes(data)
        try: check_las(path)
        except AssertionError as exc:
            require("LAS structure" in str(exc), "LAS mutation failed for wrong reason")
            outcomes.append("LAS header/body mismatch rejected")
        else: raise AssertionError("bad LAS was accepted")
    number = read_json(ROOT / "privacy-synthetic-deed/oracle.json")["expected"]["aadhaar_literal"]
    changed = number[:-1] + str((int(number[-1])+1)%10)
    require(verify_verhoeff(number) and not verify_verhoeff(changed), "Verhoeff mutation")
    outcomes.append("invalid Aadhaar check digit rejected")
    return outcomes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test",action="store_true",help="also reject copied negative mutations")
    args = parser.parse_args()
    result = validate_pack()
    result["mutation_checks"] = mutation_checks() if args.self_test else []
    print(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2))


if __name__ == "__main__":
    main()
