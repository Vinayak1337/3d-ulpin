"""CG1: public OGC test_only inputs and tiny XML controls, never registry truth."""
import hashlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from geo.area import normalize_area
from geo.native_citygml import extract
from geo.native_gis import convert_native_file

ORIGINALS = Path("E:/BhuAayam-data/task-data/desktop-citygml-native/originals")
GOOD = ORIGINALS / "Building_and_garage_LOD2-EPSG25832.gml"
LOCAL = ORIGINALS / "Building_LOD1-LocalEngineeringCRS.gml"
GML_ID = "GML_7b1a5a6f-ddad-4c3d-a507-3eb9ee0a8e68"


def convert(path: Path, folder: Path) -> dict:
    folder.mkdir()
    raw = path.read_bytes()
    [layer] = convert_native_file(path, "citygml", folder, hashlib.sha256(raw).hexdigest())
    assert path.read_bytes() == raw
    return layer


def written(layer: dict) -> tuple[dict, list[dict]]:
    collection = json.loads(Path(layer["geojson"]["path"]).read_bytes())
    sidecar = [json.loads(line) for line in Path(layer["sidecar"]["path"]).read_text("utf-8").splitlines()]
    return collection, sidecar


def control(tmp_path: Path, geometry_system: str = "", building_envelope: str = "") -> Path:
    path = tmp_path / "control.gml"
    path.write_text(f'''<CityModel xmlns="http://www.opengis.net/citygml/2.0"
        xmlns:gml="http://www.opengis.net/gml" xmlns:bldg="http://www.opengis.net/citygml/building/2.0">
      <gml:boundedBy><gml:Envelope srsName="EPSG:25832" srsDimension="3"/></gml:boundedBy>
      <cityObjectMember><bldg:Building gml:id="xml-control">
        {building_envelope}
        <bldg:lod0FootPrint><gml:MultiSurface {geometry_system}><gml:surfaceMember><gml:Polygon>
          <gml:exterior><gml:LinearRing><gml:posList>0 0 7 2 0 7 2 2 7 0 0 7</gml:posList>
          </gml:LinearRing></gml:exterior>
        </gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod0FootPrint>
      </bldg:Building></cityObjectMember>
    </CityModel>''', encoding="utf-8")
    return path


def test_real_lod2_writes_one_building_outline_not_the_garage_part(tmp_path: Path) -> None:
    layer = convert(GOOD, tmp_path / "out")
    assert [layer[key] for key in ("state", "crs", "features", "notWritten")] == ["converted", "EPSG:25832", 1, 0]
    assert "horizontal part" in layer["crsBasis"] and "5783" in layer["crsBasis"]
    collection, sidecar = written(layer)
    [feature] = collection["features"]
    reading = extract(GOOD.read_bytes())
    building = reading["buildings"][0]
    polygon = next(node for node in reading["elements"] if node["localName"] == "Polygon")
    assert feature["properties"] == {
        "gml:id": GML_ID, "outlineBasis": "ground_surface", "lod": "2",
        "geometryLocators": [{"element": polygon["ordinal"], **polygon["locator"]}],
    }
    assert feature["geometry"] == {"type": "Polygon", "coordinates": [[
        [458875.0, 5438350.0, 112.0], [458875.0, 5438355.0, 112.0],
        [458885.0, 5438355.0, 112.0], [458885.0, 5438350.0, 112.0], [458875.0, 5438350.0, 112.0],
    ]]}
    assert sidecar[0]["readerVersion"] == "citygml-ground-outline/1"
    assert sidecar[0]["format"] == "citygml"
    assert sidecar[1:] == [{"feature": 0, "position": building["element"]}]
    normalized = normalize_area({"format": "geojson", "data": collection,
                                 "mapping": {"kind": "building", "idField": "gml:id"}})
    [placed] = normalized["features"]
    assert placed["sourceKey"] == GML_ID
    assert placed["sourceHeights"]["unit"] is None and placed["sourceHeights"]["reference"] is None
    assert placed["height"]["state"] == "unknown" and placed["height"]["value"] is None


def test_real_local_system_stays_unplaced_in_words(tmp_path: Path) -> None:
    layer = convert(LOCAL, tmp_path / "out")
    assert layer["state"] == "not_converted"
    assert "#local-CRS-1" in layer["reason"] and "stay unplaced" in layer["reason"]
    assert not list((tmp_path / "out").iterdir())


def test_nearest_building_envelope_overrides_the_city_model_envelope(tmp_path: Path) -> None:
    envelope = '<gml:boundedBy><gml:Envelope srsName="EPSG:28992" srsDimension="3"/></gml:boundedBy>'
    path = control(tmp_path, building_envelope=envelope)
    reading = extract(path.read_bytes())
    coordinate = next(row for row in reading["coordinates"] if row["kind"] == "posList")
    reference = coordinate["referenceDeclarations"]["srsName"]
    assert reference["nearestAncestorDeclaration"] is None
    assert reference["effectiveDeclaration"]["value"] == "EPSG:28992"
    assert coordinate["tupleDimension"] == 3
    layer = convert(path, tmp_path / "out")
    assert layer["crs"] == "EPSG:28992"
    collection, _ = written(layer)
    assert collection["features"][0]["properties"]["outlineBasis"] == "lod0_footprint"
    assert collection["features"][0]["geometry"]["coordinates"][0][0] == [0, 0, 7]


def test_geometry_own_system_wins_over_the_envelope(tmp_path: Path) -> None:
    path = control(tmp_path, 'srsName="EPSG:28992"')
    layer = convert(path, tmp_path / "out")
    assert layer["crs"] == "EPSG:28992"
    assert written(layer)[0]["features"][0]["properties"]["lod"] == "0"


@pytest.mark.parametrize("system", [None, "#local-control", "EPSG:999999"])
def test_unusable_system_never_guesses_or_falls_back_to_envelope(tmp_path: Path, system: str | None) -> None:
    path = control(tmp_path, f'srsName="{system}"' if system else "")
    if system is None:
        path.write_text(path.read_text("utf-8").replace(' srsName="EPSG:25832"', ''), encoding="utf-8")
    layer = convert(path, tmp_path / "out")
    assert layer["state"] == "not_converted" and "stay unplaced" in layer["reason"]


def test_dimension_is_inherited_only_when_stated_and_geometry_dimension_wins(tmp_path: Path) -> None:
    path = control(tmp_path, 'srsName="EPSG:28992" srsDimension="2"')
    raw = path.read_text("utf-8").replace("0 0 7 2 0 7 2 2 7 0 0 7", "0 0 2 0 2 2 0 0")
    path.write_text(raw, encoding="utf-8")
    layer = convert(path, tmp_path / "own")
    assert written(layer)[0]["features"][0]["geometry"]["coordinates"][0][0] == [0, 0]
    path.write_text(raw.replace(' srsDimension="2"', '').replace(' srsDimension="3"', ''), encoding="utf-8")
    layer = convert(path, tmp_path / "absent")
    assert layer["state"] == "not_converted" and "dimensions" in layer["reason"]


def test_two_envelopes_on_one_building_leave_it_unplaced_and_its_sibling_placed(tmp_path: Path) -> None:
    first = '<gml:boundedBy><gml:Envelope srsName="EPSG:25832" srsDimension="3"/></gml:boundedBy>'
    second = '<gml:boundedBy><gml:Envelope srsName="EPSG:28992" srsDimension="3"/></gml:boundedBy>'
    path = control(tmp_path, building_envelope=first + second)
    raw = path.read_text("utf-8")
    member = raw[raw.index("<cityObjectMember>"):raw.index("</cityObjectMember>") + len("</cityObjectMember>")]
    sibling = member.replace('gml:id="xml-control"', 'gml:id="sibling"').replace(first + second, first)
    path.write_text(raw.replace("</CityModel>", sibling + "</CityModel>"), encoding="utf-8")
    reading = extract(path.read_bytes())
    conflicted, placed = (building["element"] for building in reading["buildings"])
    assert [f["elements"] for f in reading["findings"] if f["code"] == "ENVELOPE_CONFLICT"] == [[conflicted]]
    layer = convert(path, tmp_path / "out")
    assert [layer[key] for key in ("state", "crs", "features", "notWritten")] == ["converted", "EPSG:25832", 1, 1]
    collection, sidecar = written(layer)
    assert [feature["properties"]["gml:id"] for feature in collection["features"]] == ["sibling"]
    [refused] = [row for row in sidecar[1:] if row["feature"] is None]
    assert refused["position"] == conflicted
    assert "more than one envelope" in refused["reason"] and "stay unplaced" in refused["reason"]
    assert {"feature": 0, "position": placed} in sidecar[1:]


def test_two_envelopes_on_the_only_building_say_so_in_words(tmp_path: Path) -> None:
    envelope = '<gml:boundedBy><gml:Envelope srsName="EPSG:25832" srsDimension="3"/></gml:boundedBy>'
    path = control(tmp_path, 'srsDimension="3"', building_envelope=envelope + envelope.replace("25832", "28992"))
    layer = convert(path, tmp_path / "out")
    assert layer["state"] == "not_converted"
    assert "more than one envelope" in layer["reason"] and "stay unplaced" in layer["reason"]


def test_roof_edge_and_building_parts_are_never_used_as_building_footprints(tmp_path: Path) -> None:
    path = control(tmp_path)
    raw = path.read_text("utf-8").replace("lod0FootPrint", "lod0RoofEdge")
    part = raw[raw.index("<bldg:lod0RoofEdge>"):raw.index("</bldg:lod0RoofEdge>") + len("</bldg:lod0RoofEdge>")]
    part = part.replace("lod0RoofEdge", "lod0FootPrint")
    raw = raw.replace("</bldg:Building>", '<bldg:consistsOfBuildingPart><bldg:BuildingPart>' + part
                      + '</bldg:BuildingPart></bldg:consistsOfBuildingPart></bldg:Building>')
    path.write_text(raw, encoding="utf-8")
    layer = convert(path, tmp_path / "out")
    assert layer["state"] == "not_converted" and "no Building" in layer["reason"]
