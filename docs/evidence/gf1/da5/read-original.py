"""Read bounded publisher bytes only; do not convert, import, fetch or write derivatives."""
from __future__ import annotations

from collections import Counter
import hashlib
import json
from pathlib import Path
import re
from typing import Iterator

from pyproj import CRS

ORIGINAL = Path(
    "E:/BhuAayam-data/datasets/map-formats/niagara-falls/"
    "Niagara_Falls_Condominiums_7254610803234545967.geojson"
)


def value_type(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    raise ValueError("Unexpected non-scalar property value")


def property_facts(features: list[dict]) -> dict:
    names = sorted({name for feature in features for name in feature["properties"]})
    facts = {}
    for name in names:
        values = [feature["properties"].get(name) for feature in features]
        nonempty = [value for value in values if value is not None and value != ""]
        distinct = {json.dumps(value, ensure_ascii=False) for value in nonempty}
        facts[name] = {
            "types": sorted({value_type(value) for value in values}),
            "present": sum(name in feature["properties"] for feature in features),
            "null": values.count(None),
            "emptyString": values.count(""),
            "nonempty": len(nonempty),
            "distinctNonempty": len(distinct),
            "differentNonemptyOnEveryFeature": len(distinct) == len(features) == len(nonempty),
            "sample": values[:3],
        }
    return facts


def positions(coordinates: list) -> Iterator[list]:
    if coordinates and isinstance(coordinates[0], (int, float)):
        yield coordinates
    else:
        for child in coordinates:
            yield from positions(child)


def coordinate_extrema(features: list[dict]) -> dict:
    points = [
        point
        for feature in features
        if feature["geometry"] is not None
        for point in positions(feature["geometry"]["coordinates"])
    ]
    assert points
    return {
        "minX": min(point[0] for point in points),
        "maxX": max(point[0] for point in points),
        "minY": min(point[1] for point in points),
        "maxY": max(point[1] for point in points),
    }


def inspect(path: Path) -> dict:
    raw = path.read_bytes()
    assert len(raw) <= 16 * 1024 ** 2
    text = raw.decode("utf-8")
    data = json.loads(text)
    assert data["type"] == "FeatureCollection"
    features = data["features"]
    assert 0 < len(features) <= 2000
    match = re.search(r'"crs"\s*:\s*', text)
    assert match is not None
    declared, end = json.JSONDecoder().raw_decode(text, match.end())
    assert declared == data["crs"]
    source_crs = CRS.from_user_input(declared["properties"]["name"])
    assert source_crs.is_projected
    geometries = Counter((feature["geometry"] or {}).get("type", "null") for feature in features)
    assert set(geometries) <= {"Polygon", "MultiPolygon", "null"}
    assert geometries["null"] <= 3
    return {
        "path": path.relative_to(Path("E:/BhuAayam-data/datasets/map-formats")).as_posix(),
        "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "type": data["type"],
        "crs": declared,
        "crsMemberLiteral": text[match.start():end],
        "projectedDeclaration": source_crs.is_projected,
        "features": len(features),
        "geometryCounts": {name: geometries[name] for name in ["Polygon", "MultiPolygon", "null"]},
        "properties": property_facts(features),
        "coordinateExtremaAsWritten": coordinate_extrema(features),
    }


def main() -> None:
    facts = inspect(ORIGINAL)
    receipt_path = ORIGINAL.with_name(ORIGINAL.name + ".receipt.json")
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    assert facts["sha256"] == receipt["sha256"]
    assert facts["bytes"] == receipt["bytes"]
    result_path = Path(__file__).with_name("result.json")
    if result_path.exists():
        result = json.loads(result_path.read_text(encoding="utf-8"))
        assert result["assets"][0]["inspection"] == facts
    print(json.dumps(facts, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
