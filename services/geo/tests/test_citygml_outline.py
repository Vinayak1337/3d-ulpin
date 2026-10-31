"""CG1: public OGC test_only inputs and tiny XML controls, never registry truth."""
import hashlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from geo.adv_crs import ADV_CRS, SOURCE_URL
from geo.area import normalize_area
from geo.citygml_outline import _placement
from geo.native_citygml import DEFAULT_LIMITS, extract
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


def test_version_one_namespace_sample_keeps_the_same_outline(tmp_path: Path) -> None:
    if not GOOD.is_file():
        pytest.skip("Retained OGC test_only sample is absent")
    raw = GOOD.read_bytes()
    path = tmp_path / "version-one.gml"
    path.write_bytes(raw.replace(b'citygml/2.0', b'citygml/1.0')
                     .replace(b'citygml/building/2.0', b'citygml/building/1.0')
                     .replace(b'citygml/relief/2.0', b'citygml/relief/1.0'))
    one, two = extract(path.read_bytes()), extract(raw)
    assert one["source"]["citygmlVersion"] == "1.0"
    for field in ("elements", "buildingsAndParts", "coordinateDeclarations", "decodedCoordinateValues"):
        assert one["counts"][field] == two["counts"][field]
    layer_one = convert(path, tmp_path / "one")
    layer_two = convert(GOOD, tmp_path / "two")
    assert written(layer_one)[0] == written(layer_two)[0]


def test_converter_layout_names_the_source_class_and_identifier_without_an_officer(tmp_path: Path) -> None:
    layer = convert(control(tmp_path), tmp_path / "out")
    assert layer["converterLayout"] == {
        "method": "converter:citygml-ground-outline@1", "sourceClasses": ["Building"],
        "kind": "building", "identifierField": "gml:id", "nameField": None,
    }
    collection, sidecar = written(layer)
    assert collection["features"][0]["properties"]["gml:id"] == "xml-control"
    assert sidecar[0]["converterLayout"] == layer["converterLayout"]
    assert "officer" not in json.dumps(layer["converterLayout"])


def test_outline_input_bound_names_the_same_default_limit(tmp_path: Path) -> None:
    path = tmp_path / "over-limit.gml"
    with path.open("wb") as stream:
        stream.truncate(DEFAULT_LIMITS.input_bytes + 1)
    layer = convert(path, tmp_path / "out")
    assert layer["state"] == "not_converted"
    assert f"input byte limit ({DEFAULT_LIMITS.input_bytes} bytes)" in layer["reason"]


def test_real_berlin_places_by_the_sourced_adv_horizontal_system(tmp_path: Path) -> None:
    path = Path("E:/BhuAayam-data/datasets/practice-kit-20261024/berlin-senstadt/"
                "LoD2_33_392_5820_1_BE.gml")
    if not path.is_file():
        pytest.skip("Berlin test_only practice-kit tile is absent")
    assert hashlib.sha256(path.read_bytes()).hexdigest() == (
        "515aa294b686fbdbebff8ea9946198fc06adda8d922173ec316a7288f64ab0b5")
    layer = convert(path, tmp_path / "out")
    assert layer["state"] == "converted" and layer["crs"] == "EPSG:25833"
    literal = "urn:adv:crs:ETRS89_UTM33*DE_DHHN2016_NH"
    assert layer["crsBasis"].startswith(f"EPSG:25833, the horizontal part of the {literal} the file states")
    assert "by the AdV list" in layer["crsBasis"]
    assert "DE_DHHN2016_NH (EPSG:7837) is the stated vertical reference only" in layer["crsBasis"]
    collection, sidecar = written(layer)
    assert sidecar[0]["crsBasis"] == layer["crsBasis"]
    assert collection["features"] and layer["features"] > 0


def test_adv_table_is_bounded_to_the_cited_source_rows() -> None:
    assert {name: (row.epsg, row.kind) for name, row in ADV_CRS.items()} == {
        "ETRS89_UTM32": (25832, "horizontal"),
        "ETRS89_UTM33": (25833, "horizontal"),
        "DE_DHHN2016_NH": (7837, "vertical"),
    }
    assert all(row.source_url == SOURCE_URL for row in ADV_CRS.values())
    assert SOURCE_URL.startswith("https://www.adv-online.de/")


@pytest.mark.parametrize("name,code", [("ETRS89_UTM32", 25832), ("ETRS89_UTM33", 25833)])
@pytest.mark.parametrize("suffix", ["", "*DE_DHHN2016_NH"])
def test_adv_names_place_only_by_the_sourced_horizontal_code(name: str, code: int, suffix: str) -> None:
    calls = []

    def horizontal(value: int) -> str:
        calls.append(value)
        return f"EPSG:{value}"

    literal = f"urn:adv:crs:{name}{suffix}"
    crs, basis, words = _placement(literal, horizontal)
    assert crs == f"EPSG:{code}" and words == "" and calls == [code]
    assert basis.startswith(f"EPSG:{code}, the horizontal part of the {literal} the file states, by the AdV list")
    assert "Produkt- und Qualitätsstandard für 3D-Gebäudemodelle" in basis
    assert "2.6" in basis and "2025-03-26" in basis and "https://" not in basis
    if suffix:
        assert "DE_DHHN2016_NH (EPSG:7837) is the stated vertical reference only" in basis
        assert "heights are not converted or measured" in basis
    else:
        assert "stated vertical reference" not in basis


@pytest.mark.parametrize("literal", [
    "urn:adv:crs:ETRS89_UTM99",
    "urn:adv:crs:ETRS89_UTM99*DE_DHHN2016_NH",
    "urn:adv:crs:ETRS89_UTM33*UNKNOWN",
    "urn:adv:crs:ETRS89_UTM33*DE_DHHN92_NH",
    "urn:adv:crs:ETRS89_UTM33*ETRS89_UTM32",
    "urn:adv:crs:ETRS89_UTM33*DE_DHHN2016_NH*EXTRA",
    "urn:adv:crs:ETRS89_UTM33*",
    "urn:adv:crs:DE_DHHN2016_NH",
    "urn:adv:crs:ETRS89_UTM33 ",
])
def test_unknown_or_malformed_adv_names_stay_unplaced_with_the_literal(literal: str) -> None:
    def horizontal(value: int) -> str:
        pytest.fail(f"Must not resolve an unknown AdV name as EPSG:{value}")

    crs, basis, words = _placement(literal, horizontal)
    assert crs is None and basis is None
    assert words == ("states an srsName form the reader does not know, so its outlines stay unplaced "
                     f"(source srsName: {literal})")


def test_epsg_compound_keeps_its_existing_horizontal_basis() -> None:
    literal = "urn:ogc:def:crs,crs:EPSG::25832,crs:EPSG::5783"
    assert _placement(literal, lambda code: f"EPSG:{code}") == (
        "EPSG:25832", f"EPSG:25832, the horizontal part of the {literal} the file states", "")


@pytest.mark.parametrize("literal,crs", [
    ("urn:ogc:def:crs,crs:EPSG::25832", "EPSG:25832"),
    ("urn:ogc:def:crs,crs:EPSG:9.9.1:25832", "EPSG:25832"),
    ("urn:ogc:def:crs,crs:EPSG::7415", "EPSG:28992"),
    ("urn:ogc:def:crs,crs:EPSG::25832,crs:EPSG::5783", "EPSG:25832"),
    ("urn:adv:crs:ETRS89_UTM33*DE_DHHN2016_NH", "EPSG:25833"),
])
def test_stated_crs_forms_draw_the_control_without_changing_positions(tmp_path: Path, literal: str, crs: str) -> None:
    layer = convert(control(tmp_path, f'srsName="{literal}"'), tmp_path / "out")
    assert (layer["state"], layer["crs"], layer["features"]) == ("converted", crs, 1)
    collection, sidecar = written(layer)
    assert collection["features"][0]["geometry"]["coordinates"][0] == [
        [0, 0, 7], [2, 0, 7], [2, 2, 7], [0, 0, 7]]
    assert sidecar[0]["crsBasis"] == layer["crsBasis"]
    if literal.startswith("urn:ogc:def:crs,") and literal.count(",crs:") == 1:
        assert "compound-style URN with one component" in layer["crsBasis"]
        assert "no vertical reference is stated" in layer["crsBasis"]
        assert literal in layer["crsBasis"]
        if literal.endswith(":7415"):
            assert "EPSG:28992, the horizontal part of the EPSG:7415" in layer["crsBasis"]
    normalized = normalize_area({"format": "geojson", "data": collection,
                                 "mapping": {"kind": "building", "idField": "gml:id"}})
    [feature] = normalized["features"]
    assert feature["sourceHeights"]["unit"] is None and feature["sourceHeights"]["reference"] is None
    assert feature["height"]["state"] == "unknown" and feature["height"]["value"] is None


@pytest.mark.parametrize("literal", [
    "urn:ogc:def:crs,crs:EPSG::25832,crs:EPSG::5783,crs:EPSG::7837",
    "urn:ogc:def:crs,crs:OGC::25832",
    "urn:ogc:def:crs,crs:EPSG::25832 trailing",
    "urn:ogc:def:crs,crs:EPSG::25832,crs:OGC::5783",
    "urn:ogc:def:crs,crs:EPSG:.:25832",
    "urn:ogc:def:crs,crs:EPSG:9..1:25832",
    "urn:ogc:def:crs,crs:EPSG::25832\n",
])
def test_unrecognized_compound_forms_stay_unplaced_with_honest_words(tmp_path: Path, literal: str) -> None:
    crs, basis, words = _placement(literal, lambda code: pytest.fail(f"Must not resolve EPSG:{code}"))
    assert crs is None and basis is None
    assert words == ("states an srsName form the reader does not know, so its outlines stay unplaced "
                     f"(source srsName: {literal})")
    if "\n" not in literal:
        layer = convert(control(tmp_path, f'srsName="{literal}"'), tmp_path / "out")
        assert layer["state"] == "not_converted" and layer["reason"] == words
        assert not list((tmp_path / "out").iterdir())


@pytest.mark.parametrize("code", [5783, 4979, 4978])
def test_single_component_must_resolve_to_a_two_dimensional_horizontal_system(tmp_path: Path, code: int) -> None:
    literal = f"urn:ogc:def:crs,crs:EPSG::{code}"
    layer = convert(control(tmp_path, f'srsName="{literal}"'), tmp_path / "out")
    assert layer["state"] == "not_converted"
    assert layer["reason"] == (f"states EPSG:{code}, which has no two-dimensional horizontal system the reader knows, "
                               f"so its outlines stay unplaced (source srsName: {literal})")
    assert not list((tmp_path / "out").iterdir())


def test_adv_placement_leaves_coordinates_and_height_measurement_unchanged(tmp_path: Path) -> None:
    literal = "urn:adv:crs:ETRS89_UTM33*DE_DHHN2016_NH"
    layer = convert(control(tmp_path, f'srsName="{literal}"'), tmp_path / "out")
    assert layer["state"] == "converted" and layer["crs"] == "EPSG:25833"
    collection, _ = written(layer)
    assert collection["features"][0]["geometry"]["coordinates"][0] == [
        [0, 0, 7], [2, 0, 7], [2, 2, 7], [0, 0, 7]]
    normalized = normalize_area({"format": "geojson", "data": collection,
                                 "mapping": {"kind": "building", "idField": "gml:id"}})
    [feature] = normalized["features"]
    assert feature["sourceHeights"]["reference"] is None
    assert feature["height"]["state"] == "unknown" and feature["height"]["value"] is None


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
