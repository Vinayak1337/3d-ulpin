"""Read immutable real bytes and compare retained integer tokens with the normalizer's keys."""
import base64
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "services" / "geo"))
from geo.area import normalize_area  # noqa: E402
from geo.gis_inspection import _IntegerToken, inspect_gis  # noqa: E402

SOURCE = Path("E:/BhuAayam-data/datasets/map-formats/niagara-falls/"
              "Niagara_Falls_Condominiums_7254610803234545967.geojson")


def inspect(raw: bytes) -> dict[str, Any]:
    return inspect_gis({"base64": base64.b64encode(raw).decode("ascii")})


def synthetic_controls(raw: bytes) -> dict[str, Any]:
    controls = {}
    for token in ["7", "7.0", "7e0", "-0", '"7"', "9007199254740991", "-9007199254740991"]:
        control = {"type": "FeatureCollection", "features": [
            {**json.loads(raw)["features"][0], "properties": {"key": "TOKEN"}},
        ]}
        control.pop("crs", None)
        control["features"][0]["geometry"] = {
            "type": "Polygon", "coordinates": [[[77, 28], [77.0001, 28],
                                                  [77.0001, 28.0001], [77, 28.0001], [77, 28]]],
        }
        literal = json.dumps(control).replace('"TOKEN"', token).encode()
        checked = inspect(literal)["fields"][0]
        converted = normalize_area({"format": "geojson", "data": json.loads(literal),
                                    "mapping": {"kind": "parcel", "idField": "key"}})
        key = converted["features"][0]["sourceKey"]
        if checked["integerIdEligible"]:
            assert key == token
        controls[token] = {"integerIdEligible": checked["integerIdEligible"], "normalizerKey": key}
    return controls


def main() -> None:
    raw = SOURCE.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    source = json.loads(raw, parse_int=_IntegerToken)
    tokens = [feature["properties"]["OBJECTID"].token for feature in source["features"]]
    result = inspect(raw)
    field = next(field for field in result["fields"] if field["name"] == "OBJECTID")
    assert field["integerIdEligible"] is True
    normalized = normalize_area({"format": "geojson", "data": json.loads(raw),
                                 "mapping": {"kind": "parcel", "idField": "OBJECTID"}})
    assert len(tokens) == 155
    assert tokens == [feature["sourceKey"] for feature in normalized["features"]]
    controls = synthetic_controls(raw)
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == digest
    print(json.dumps({"task": "GN1", "sha256": digest, "source": str(SOURCE),
                      "all155SourceKeysEqualRawTokens": True, "count": len(tokens),
                      "integerIdEligible": True, "originalUnchanged": True, "controls": controls}))


if __name__ == "__main__":
    main()
