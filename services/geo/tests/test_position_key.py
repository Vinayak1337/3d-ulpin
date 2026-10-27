"""Test-only geometry checks file locators, not operational identities or rights."""
import copy

import pytest

from geo.area import normalize_area
from geo.validation import InputError


def source() -> dict:
    return {"format": "geojson", "data": {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {}, "geometry": {"type": "Point", "coordinates": [77, 28]}},
        {"type": "Feature", "id": "fixture-id-not-selected", "properties": {}, "geometry": {
            "type": "Polygon", "coordinates": [[[77, 28], [77.0001, 28], [77.0001, 28.0001], [77, 28]]]}},
    ]}, "mapping": {"kind": "building", "sourceKeyConversion": "feature_position@1"}}


def test_position_keys_keep_original_order_through_set_asides_without_editing_features():
    data = source()
    original = copy.deepcopy(data)
    result = normalize_area(data)
    assert result["features"][0]["sourceKey"] == "position:2"
    assert result["features"][0]["sourceFeatureIndex"] == 1
    assert result["features"][0]["height"]["state"] == "unknown"
    assert result["disposition"]["rejections"][0]["sourceKey"] == "position:1"
    assert data == original
    data["sourcePositions"] = [12, 19]
    result = normalize_area(data)
    assert result["features"][0]["sourceKey"] == "position:19"
    assert result["disposition"]["rejections"][0]["sourceKey"] == "position:12"


@pytest.mark.parametrize("positions", [[], [0, 1], [-1, 2], [True, 2], [1.5, 2],
                                      [1, 9007199254740992], [1], [1, 1], [2, 1]])
def test_position_keys_refuse_unpaired_or_invalid_proved_positions(positions):
    data = source()
    data["sourcePositions"] = positions
    with pytest.raises(InputError, match="original ordered feature locators"):
        normalize_area(data)
