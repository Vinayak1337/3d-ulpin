"""Retained authority originals: positions bind decoded fields, never geometry or rights."""
import base64
import hashlib
import sqlite3
from pathlib import Path

import pytest

from geo.native_gis import (
    _gpkg, _gpkg_position, _shapefile, decode_native_record, normalize_native,
)
from geo.validation import InputError

ROOT = Path("E:/BhuAayam-data/datasets/map-formats/tweed-shire-council")
INPUTS = [
    ("shapefile_zip", "TSC_Buildings_OD_8831041243266425049.zip", "Building_N", _shapefile),
    ("gpkg", "TSC_Buildings_OD_-1703359794462598529.gpkg", "OBJECTID", _gpkg),
]


@pytest.mark.parametrize("format_name,name,id_field,parser", INPUTS)
def test_real_records_decode_to_readers_own_values(format_name, name, id_field, parser):
    raw = (ROOT / name).read_bytes()
    before = hashlib.sha256(raw).hexdigest()
    parsed = parser(raw, None, None)
    normalized = normalize_native({"format": format_name, "base64": base64.b64encode(raw).decode(),
                                   "mapping": {"kind": "building", "idField": id_field}})
    assert len(parsed["features"]) == len(normalized["features"]) == 88
    positions = []
    for index in (0, 87):
        feature = normalized["features"][index]
        reference = feature["sourceReference"]["nativeRecord"]
        positions.append(reference["position"])
        result = decode_native_record({"format": format_name, "base64": base64.b64encode(raw).decode(),
                                       "nativeRecord": reference})
        assert result["status"] == "available"
        assert result["fields"] == parsed["features"][index]["attributes"]
        assert result["sourceKey"] == feature["sourceKey"]
        assert result["sourceSha256"] == before
        assert result["decodedRecord"] == reference
    assert positions[0] < positions[1]
    assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == before


@pytest.mark.parametrize("format_name,name,id_field,parser", INPUTS)
def test_position_and_reference_refusals_have_codes(format_name, name, id_field, parser):
    raw = (ROOT / name).read_bytes()
    parsed = parser(raw, None, None)
    reference = {**parsed["features"][0]["nativeRecord"], "idField": id_field}
    request = {"format": format_name, "base64": base64.b64encode(raw).decode()}
    result = decode_native_record({**request, "nativeRecord": {**reference, "position": 99999}})
    assert result["code"] == "PACKET_PLAN_NATIVE_POSITION_UNAVAILABLE"
    result = decode_native_record({**request, "nativeRecord": {**reference, "encoding": "changed"}})
    assert result["code"] == "PACKET_PLAN_NATIVE_REFERENCE_MISMATCH"
    with pytest.raises(InputError):
        decode_native_record(request)


def test_table_without_rowid_or_integer_primary_key_stays_blocked():
    with sqlite3.connect(":memory:") as connection:
        connection.execute("CREATE TABLE control (id TEXT PRIMARY KEY) WITHOUT ROWID")
        columns = connection.execute("PRAGMA table_info(control)").fetchall()
        with pytest.raises(InputError, match="no accessible rowid or single integer primary key"):
            _gpkg_position(connection, "control", columns)


def test_rowid_shadowing_does_not_select_an_attribute_as_a_position():
    with sqlite3.connect(":memory:") as connection:
        connection.execute("CREATE TABLE control (rowid TEXT, _rowid_ TEXT)")
        columns = connection.execute("PRAGMA table_info(control)").fetchall()
        assert _gpkg_position(connection, "control", columns) == ("oid", "rowid")
