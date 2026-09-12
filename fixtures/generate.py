"""Generate labelled, original synthetic input files, never computed model results.

Run with the geometry development environment: python fixtures/generate.py
The manifests' expected values are independently reasoned test oracles.
"""

import csv
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas

ROOT = Path(__file__).resolve().parent


def rectangle(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def feature(alias, name, kind, footprint, level="", **hints):
    item = {"alias": alias, "name": name, "kind": kind, "footprint": footprint, **hints}
    if level:
        item["levelLabel"] = level
    return item


def font(size):
    for candidate in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default(size=size)


def make_plan(folder, title, features, bounds, controls):
    width, height, padding = 1400, 900, 100
    minx, miny, maxx, maxy = bounds
    scale = min((width - 2 * padding) / (maxx - minx), (height - 2 * padding - 150) / (maxy - miny))
    image = Image.new("RGB", (width, height), "#f9f7f2")
    draw = ImageDraw.Draw(image)

    def point(p):
        return (round(padding + (p[0] - minx) * scale), round(height - padding - (p[1] - miny) * scale))

    draw.text((padding, 30), f"{title} | SYNTHETIC DEMO ONLY", font=font(28), fill="#182d34")
    draw.text((padding, 75), "Local metres. Generated teaching inputs; not surveyed or official property evidence.", font=font(18), fill="#4c5a60")
    for x in range(int(minx), int(maxx) + 1):
        draw.line([point([x, miny]), point([x, maxy])], fill="#e5e5dc", width=1)
    for y in range(int(miny), int(maxy) + 1):
        draw.line([point([minx, y]), point([maxx, y])], fill="#e5e5dc", width=1)
    colors = {"parcel": "#eae9de", "building": "#eef3ef", "unit": "#cbdce1", "common": "#e7d8bc"}
    for item in features:
        if item["kind"] == "basement" or item.get("levelLabel") == "Level 1":
            continue
        points = [point(p) for p in item["footprint"]]
        draw.polygon(points, fill=colors[item["kind"]], outline="#526b72", width=3)
        xs, ys = zip(*points)
        if item["kind"] in ("unit", "common"):
            draw.text(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2), item["alias"], font=font(22), fill="#132d37", anchor="mm")
    calibration_points = []
    for identity, x, y in controls:
        px, py = point([x, y])
        draw.ellipse((px - 8, py - 8, px + 8, py + 8), fill="#bd3c30", outline="white", width=2)
        draw.text((px + 12, py + 10), f"{identity} ({x}, {y}) m", font=font(16), fill="#9c241f")
        calibration_points.append({"id": identity, "imagePoint": [px, py], "worldPoint": [x, y]})
    draw.text((padding, height - 47), "Ground-floor outlines shown. Upper spaces share their named lower footprint; levels are supplied separately.", font=font(16), fill="#4c5a60")
    image.save(folder / "plan.png", optimize=True)
    canvas = Canvas(str(folder / "plan.pdf"), pagesize=(width, height), invariant=1)
    canvas.setTitle(f"{title} — synthetic demo plan")
    canvas.setAuthor("3D ULPIN synthetic fixture generator")
    canvas.drawImage(ImageReader(image), 0, 0, width, height)
    canvas.showPage()
    canvas.save()
    return {"imageWidth": width, "imageHeight": height, "pdfPage": 1, "controls": calibration_points}


def write_case(dataset, name, frame_id, benchmark, features, r1, r2, bounds, controls, expected):
    folder = ROOT / dataset
    folder.mkdir(parents=True, exist_ok=True)
    reference = {"id": frame_id, "horizontalUnit": "m", "verticalUnit": "m", "benchmark": benchmark}
    (folder / "spatial.json").write_text(json.dumps({"profile": "parcel-local-json-v1", "synthetic": True, "notice": "Generated demo inputs. Not real survey or official identity evidence.", "frame": reference, "features": features}, indent=2) + "\n")
    for filename, rows in (("levels-r1.csv", r1), ("levels-r2.csv", r2)):
        with (folder / filename).open("w", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(["alias", "lower", "upper", "unit", "benchmark", "method"])
            for alias, lower, upper in rows:
                writer.writerow([alias, lower, upper, "m", benchmark, "synthetic teaching measurement"])
    with (folder / "controls.csv").open("w", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["id", "x", "y", "unit", "benchmark"])
        for identity, x, y in controls:
            writer.writerow([identity, x, y, "m", benchmark])
    calibration = make_plan(folder, name, features, bounds, controls)
    file_profiles = [("spatial.json", "parcel-local-json-v1", True), ("levels-r1.csv", "levels-csv-v1", True), ("levels-r2.csv", "levels-csv-v1", False), ("controls.csv", "control-csv-v1", True), ("plan.png", "plan-png-v1", True), ("plan.pdf", "plan-pdf-v1", True)]
    manifest = {"dataset": dataset, "name": name, "description": "Synthetic property-space teaching inputs; no official location, survey or ownership assertion.", "synthetic": True, "frame": reference, "files": [{"name": name, "profile": profile, "initial": initial} for name, profile, initial in file_profiles], "planCalibration": calibration, "expected": expected}
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def main():
    left, right = rectangle(2, 2, 6, 10), rectangle(8, 2, 12, 10)
    c001 = [feature("P-A", "Western parcel context", "parcel", rectangle(0, 0, 14, 12)), feature("P-B", "Eastern parcel context", "parcel", rectangle(14, 0, 28, 12)), feature("B01", "Building context envelope", "building", rectangle(2, 2, 12, 10)), feature("U01", "Ground west apartment", "unit", left, "Ground"), feature("U02", "Ground east apartment", "unit", right, "Ground"), feature("U03", "Upper west apartment", "unit", left, "Level 1", draftLower=2.8), feature("U04", "Upper east apartment", "unit", right, "Level 1", draftLower=3.0), feature("COMMON-0", "Ground shared circulation", "common", rectangle(6, 2, 8, 10), "Ground"), feature("COMMON-1", "Upper shared circulation", "common", rectangle(6, 2, 8, 10), "Level 1"), feature("BSM-01", "Shared basement", "basement", rectangle(2, 2, 12, 10), "Basement")]
    r1 = [("U01", 0, 3), ("U02", 0, 3), ("U03", "", 6), ("U04", "", 6), ("COMMON-0", 0, 3), ("COMMON-1", 3, 6), ("BSM-01", -3, 0)]
    write_case("c001", "C-001 · Courtyard apartments", "LOCAL-C001", "BM-DEMO-A", c001, r1, [("U03", 3, 6), ("U04", 3, 6)], (-1, -1, 29, 13), [("CP-A", 2, 2), ("CP-B", 12, 10)], {"unitCount": 7, "areas": {"U01": 32, "U02": 32, "U03": 32, "U04": 32, "COMMON-0": 16, "COMMON-1": 16, "BSM-01": 80}, "draftVolumes": {"U01": 96, "U03": 102.4, "BSM-01": 240}, "draftOverlapVolume": 6.4, "correctedOverlapVolume": 0, "overlapAliases": ["U01", "U03"], "r1UnverifiedLower": ["U03", "U04"], "derivation": "Apartment 4 × 8 =32 m²; U03 overlap32 × (3−2.8)=6.4 m³. Basement10 × 8 × 3=240 m³."})
    elbow = [[0, 0], [8, 0], [8, 4], [4, 4], [4, 8], [0, 8]]
    common = [[4, 4], [8, 4], [8, 10], [0, 10], [0, 8], [4, 8]]
    c002 = [feature("SITE-X", "Workshop site", "parcel", rectangle(-2, -2, 14, 12)), feature("BLDG-X", "Workshop context", "building", rectangle(0, 0, 12, 10)), feature("ELBOW-A", "Lower L-shaped studio", "unit", elbow, "Ground"), feature("ELBOW-B", "Upper L-shaped studio", "unit", elbow, "Level 1", draftLower=2.2), feature("TRI-C", "Triangular ground studio", "unit", [[8, 4], [12, 4], [12, 10]], "Ground"), feature("WALK-X", "Ground circulation", "common", common, "Ground"), feature("CELLAR-X", "Workshop basement", "basement", rectangle(0, 0, 12, 10), "Basement")]
    r1 = [("ELBOW-A", 0, 2.5), ("ELBOW-B", "", 5), ("TRI-C", 0, 2.5), ("WALK-X", 0, 2.5), ("CELLAR-X", -2.5, 0)]
    write_case("c002", "C-002 · Workshop studios", "LOCAL-C002", "BM-DEMO-B", c002, r1, [("ELBOW-B", 2.5, 5)], (-3, -3, 15, 13), [("CTRL-X", 0, 0), ("CTRL-Y", 12, 10)], {"unitCount": 5, "areas": {"ELBOW-A": 48, "ELBOW-B": 48, "TRI-C": 12, "WALK-X": 32, "CELLAR-X": 120}, "draftVolumes": {"ELBOW-A": 120, "ELBOW-B": 134.4, "TRI-C": 30, "WALK-X": 80, "CELLAR-X": 300}, "draftOverlapVolume": 14.4, "correctedOverlapVolume": 0, "overlapAliases": ["ELBOW-A", "ELBOW-B"], "r1UnverifiedLower": ["ELBOW-B"], "derivation": "L-shape8 × 8−4 × 4=48 m²; overlap48 × (2.5−2.2)=14.4 m³. Triangle4 × 6÷2=12 m². Circulation4 × 6+4 × 2=32 m²."})


if __name__ == "__main__":
    main()
