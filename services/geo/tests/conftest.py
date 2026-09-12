import hashlib
import json
from pathlib import Path
import uuid

import pytest

from geo.inspection import inspect_bytes

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"


def fixture_input(dataset="c001", corrected=False):
    folder = FIXTURES / dataset
    spatial = inspect_bytes("parcel-local-json-v1", (folder / "spatial.json").read_bytes())
    rows = inspect_bytes("levels-csv-v1", (folder / "levels-r1.csv").read_bytes())["levels"]
    levels = {row["alias"]: {**row, "sourceId": "levels-r1-source"} for row in rows}
    if corrected:
        for row in inspect_bytes("levels-csv-v1", (folder / "levels-r2.csv").read_bytes())["levels"]:
            levels[row["alias"]] = {**row, "sourceId": "levels-r2-source"}
    units, context = [], []
    for feature in spatial["features"]:
        if feature["kind"] in ("parcel", "building"):
            context.append({key: feature[key] for key in ("alias", "name", "kind", "footprint")})
            continue
        row = levels[feature["alias"]]
        unit = {key: feature[key] for key in ("alias", "name", "kind", "footprint", "levelLabel")}
        unit.update(id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{dataset}/{feature['alias']}")), revision=2 if corrected else 1, bindings={"footprint": {"sourceId": "spatial-source", "locator": f"feature {feature['alias']}"}})
        for component in ("lower", "upper"):
            unit[component] = row[component] if row[component] is not None else feature.get(f"draft{component.title()}")
            unit[f"{component}Verified"] = row[component] is not None
            if row[component] is not None:
                unit["bindings"][component] = {"sourceId": row["sourceId"], "locator": row["locator"]}
        units.append(unit)
    data = {"frame": spatial["frame"], "units": units, "context": context}
    data["inputFingerprint"] = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
    return data


@pytest.fixture
def draft():
    return fixture_input()
