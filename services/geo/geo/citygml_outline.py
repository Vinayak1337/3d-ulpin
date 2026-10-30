"""CG1: each CityGML Building's own footprint or GroundSurface, never roof edges or composed parts.

Positions remain source x,y,z. Z is never converted or measured; an AdV vertical name is recorded only as stated.
A stated EPSG system or a sourced AdV equivalent places the layer. The literal reader supplies inheritance and locators.
"""
from __future__ import annotations

import json
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, TextIO

from .adv_crs import SOURCE_NAME, stated_adv
from .cityjson_outline import LAYER, _placement as reference_placement, stated_epsg
from .native_citygml import DEFAULT_LIMITS, GML, CityGMLError, extract
from .validation import InputError

OUTLINE_READER = "citygml-ground-outline/1"
_COMPOUND = re.compile(r"urn:ogc:def:crs,crs:EPSG:[0-9.]*:([1-9][0-9]{0,8}),crs:EPSG:[0-9.]*:([1-9][0-9]{0,8})")
_WRAPPERS = {"MultiSurface", "CompositeSurface", "surfaceMember", "surfaceMembers"}
ENVELOPE_CONFLICT = ("is under a feature that states more than one envelope, so its outline has no stated system "
                     "or dimension; its outlines stay unplaced")


@dataclass
class Projection:
    elements: list[dict]
    children: dict[int, list[int]]
    coordinates: dict[int, dict]
    envelope_conflicts: set[int]
    building_namespace: str

    @classmethod
    def from_reading(cls, reading: dict) -> Projection:
        children = {node["ordinal"]: [] for node in reading["elements"]}
        for node in reading["elements"]:
            if node["parent"] is not None:
                children[node["parent"]].append(node["ordinal"])
        conflicts = {element for finding in reading["findings"] if finding["code"] == "ENVELOPE_CONFLICT"
                     for element in finding["elements"]}
        building_namespace = f"http://www.opengis.net/citygml/building/{reading['source']['citygmlVersion']}"
        return cls(reading["elements"], children, {row["element"]: row for row in reading["coordinates"]},
                   conflicts, building_namespace)

    def named(self, element: int, namespace: str, local: str) -> bool:
        node = self.elements[element]
        return node["namespace"] == namespace and node["localName"] == local

    def below(self, element: int, namespace: str, local: str) -> list[int]:
        return [child for child in self.children[element] if self.named(child, namespace, local)]

    def under_envelope_conflict(self, row: dict, field: str) -> bool:
        """The reader stopped inheritance at a feature with more than one envelope; say so, not "no system"."""
        if row["referenceDeclarations"][field]["effectiveDeclaration"] is not None:
            return False
        element = row["element"]
        while element is not None:
            if element in self.envelope_conflicts:
                return True
            element = self.elements[element]["parent"]
        return False


def _placement(literal: str | None, horizontal: Callable[[int], str | None]) -> tuple[str | None, str | None, str]:
    compound = _COMPOUND.fullmatch(literal or "")
    adv = stated_adv(literal)
    code = stated_epsg(literal)
    if literal is not None and not compound and not adv and code is None:
        return None, None, ("states an srsName form the reader does not know, so its outlines stay unplaced "
                            f"(source srsName: {literal})")
    single = code is not None and literal.startswith("urn:ogc:def:crs,")
    stated = literal
    if compound:
        stated = f"EPSG:{compound[1]}"
    elif adv:
        stated = f"EPSG:{adv[0].epsg}"
    frame = {"referenceSystemState": "absent" if literal is None else "declared", "referenceSystem": stated}
    crs, basis, words = reference_placement(frame, horizontal)
    if (compound or adv) and crs:
        basis = f"{crs}, the horizontal part of the {literal} the file states"
        if adv:
            basis += f", by the AdV list ({SOURCE_NAME})"
            if adv[2]:
                basis += (f"; {adv[1]} (EPSG:{adv[2].epsg}) is the stated vertical reference only; "
                          "heights are not converted or measured")
    if single and crs:
        basis = (f"{basis or crs}; the file states a compound-style URN with one component ({literal}); "
                 "no vertical reference is stated")
    if words and literal is not None:
        words = f"{words} (source srsName: {literal})"
    return crs, basis, words


def _outline_declarations(projection: Projection, building: dict) -> tuple[list[int], str, str | None]:
    footprints = [row["element"] for row in building["lodDeclarations"] if row["name"] == "lod0FootPrint"
                  and projection.elements[row["element"]]["parent"] == building["element"]]
    if footprints:
        return footprints, "lod0_footprint", "0"
    grounds = []
    for row in building["lodDeclarations"]:
        parent = projection.elements[row["element"]]["parent"]
        if (projection.named(parent, projection.building_namespace, "GroundSurface")
                and re.fullmatch(r"lod[0-4]MultiSurface", row["name"])):
            grounds.append(row)
    if not grounds:
        return [], "ground_surface", None
    lod = grounds[0]["lodLiteral"]
    return [row["element"] for row in grounds if row["lodLiteral"] == lod], "ground_surface", lod


def _inline(node: dict) -> None:
    if any(attr["name"].endswith("}href") for attr in node["attributes"]):
        raise InputError("has an outline reference that is not expanded; its outlines stay unplaced")


def _polygons(projection: Projection, element: int) -> list[int]:
    """Only inline surface containers are traversed; links and unsupported geometries never vanish silently."""
    node = projection.elements[element]
    _inline(node)
    if projection.named(element, GML, "Polygon"):
        return [element]
    declaration = (node["namespace"] == projection.building_namespace
                   and re.fullmatch(r"lod(?:0FootPrint|[0-4]MultiSurface)", node["localName"]))
    if not declaration and not (node["namespace"] == GML and node["localName"] in _WRAPPERS):
        raise InputError("has an unsupported outline surface; its outlines stay unplaced")
    polygons = []
    for child in projection.children[element]:
        polygons.extend(_polygons(projection, child))
    return polygons


def _ring(projection: Projection, element: int) -> tuple[list[list[float]], list[dict]]:
    linear = _single(projection.below(element, GML, "LinearRing"), "outline ring")
    _inline(projection.elements[element])
    _inline(projection.elements[linear])
    coordinates = [projection.coordinates.get(child) for child in projection.children[linear]]
    if not coordinates or any(row is None or row["kind"] not in ("pos", "posList") for row in coordinates):
        raise InputError("has an unsupported outline coordinate encoding; its outlines stay unplaced")
    if len(coordinates) > 1 and any(row["kind"] != "pos" for row in coordinates):
        raise InputError("has mixed outline coordinate encodings; its outlines stay unplaced")
    if len({row["tupleDimension"] for row in coordinates}) != 1:
        raise InputError("has mixed outline coordinate dimensions; its outlines stay unplaced")
    positions = []
    for row in coordinates:
        dimension = row["tupleDimension"]
        if row["state"] != "available" or dimension not in (2, 3):
            if projection.under_envelope_conflict(row, "srsDimension"):
                raise InputError(ENVELOPE_CONFLICT)
            raise InputError("has outline coordinates without usable stated dimensions; its outlines stay unplaced")
        values = list(row["values"].numbers())
        positions.extend([values[index:index + dimension] for index in range(0, len(values), dimension)])
    if len(positions) < 4 or positions[0] != positions[-1]:
        raise InputError("has an incomplete or unclosed outline ring; its outlines stay unplaced")
    return positions, coordinates


def _single(elements: list[int], kind: str) -> int:
    if len(elements) != 1:
        raise InputError(f"has no single inline {kind}; its outlines stay unplaced")
    return elements[0]


def _polygon(projection: Projection, element: int) -> tuple[list, list[dict]]:
    exterior = _single(projection.below(element, GML, "exterior"), "polygon exterior")
    rings, coordinates = [], []
    for boundary in [exterior, *projection.below(element, GML, "interior")]:
        positions, rows = _ring(projection, boundary)
        rings.append(positions)
        coordinates.extend(rows)
    return rings, coordinates


def _feature(projection: Projection, building: dict, horizontal: Callable) -> tuple[dict, dict, str, list[str]]:
    declarations, basis, lod = _outline_declarations(projection, building)
    polygons = [polygon for declaration in declarations for polygon in _polygons(projection, declaration)]
    if not polygons:
        raise InputError("has no LoD0 footprint or GroundSurface of its own; outlines of its parts are not composed")
    rings, systems, bases = [], set(), set()
    for polygon in polygons:
        coordinates, rows = _polygon(projection, polygon)
        rings.append(coordinates)
        for row in rows:
            declaration = row["referenceDeclarations"]["srsName"]["effectiveDeclaration"]
            literal = declaration["value"] if declaration is not None else None
            crs, crs_basis, words = _placement(literal, horizontal)
            if crs is None:
                raise InputError(ENVELOPE_CONFLICT if projection.under_envelope_conflict(row, "srsName") else words)
            systems.add(crs)
            if crs_basis:
                bases.add(crs_basis)
    if len(systems) != 1:
        raise InputError("states different horizontal systems within one outline; its outlines stay unplaced")
    properties = {"outlineBasis": basis, "lod": lod,
                  "geometryLocators": [{"element": element, **projection.elements[element]["locator"]}
                                       for element in polygons]}
    if building["idState"] == "supplied":
        properties["gml:id"] = building["id"]
    geometry = {"type": "Polygon", "coordinates": rings[0]}
    if len(rings) > 1:
        geometry = {"type": "MultiPolygon", "coordinates": rings}
    return properties, geometry, systems.pop(), sorted(bases)


def _rows(reading: dict, horizontal: Callable, spool: TextIO) -> tuple[list[tuple], str | None, list[str]]:
    projection = Projection.from_reading(reading)
    rows, systems, bases = [], set(), set()
    for building in reading["buildings"]:
        if building["type"] != "Building":
            continue
        try:
            properties, geometry, crs, words = _feature(projection, building, horizontal)
            row = [building["element"], properties, geometry, None]
            spool.write(json.dumps(row, allow_nan=False, separators=(",", ":")) + "\n")
            systems.add(crs)
            bases.update(words)
        except InputError as error:
            row = (building["element"], None, None, str(error))
            rows.append(row)
            spool.write(json.dumps(row) + "\n")
    if len(systems) > 1:
        raise InputError("states different horizontal systems across buildings; its outlines stay unplaced")
    return rows, next(iter(systems), None), sorted(bases)


def _no_outlines(reading: dict, rows: list[tuple], horizontal: Callable) -> str:
    projection = Projection.from_reading(reading)
    for coordinate in reading["coordinates"]:
        if coordinate["buildingElement"] is None or projection.under_envelope_conflict(coordinate, "srsName"):
            continue
        declaration = coordinate["referenceDeclarations"]["srsName"]["effectiveDeclaration"]
        _, _, words = _placement(declaration["value"] if declaration else None, horizontal)
        if words:
            return words
    reasons = sorted({row[3] for row in rows if row[3]})
    return "holds no Building outline that can be placed" + (": " + "; ".join(reasons) if reasons else "")


def convert_citygml_file(path: Path, source_sha256: str, open_layer: Callable,
                         horizontal: Callable[[int], str | None]) -> list[dict]:
    stopped = {"layer": LAYER, "ordinal": 0, "state": "not_converted"}
    if path.stat().st_size > DEFAULT_LIMITS.input_bytes:
        return [{**stopped, "reason": f"exceeds the CityGML input byte limit ({DEFAULT_LIMITS.input_bytes} bytes)"}]
    # All systems must agree before opening a layer. Spool complete buildings
    # in the supervisor's temp directory, never beside an immutable original.
    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as spool:
        try:
            reading = extract(path.read_bytes())
            rows, crs, bases = _rows(reading, horizontal, spool)
        except CityGMLError as error:
            return [{**stopped, "reason": f"was not read by the CityGML reader ({error.code})"}]
        except InputError as error:
            return [{**stopped, "reason": str(error)}]
        if crs is None:
            return [{**stopped, "reason": _no_outlines(reading, rows, horizontal)}]
        del reading
        crs_basis = {"crsBasis": "; ".join(bases)} if bases else {}
        header = {"readerVersion": OUTLINE_READER, "originalSha256": source_sha256, "format": "citygml",
                  "layer": LAYER, "positionKind": "element_ordinal", "crs": crs, **crs_basis,
                  "converterLayout": {"method": "converter:" + OUTLINE_READER.replace("/", "@"),
                                      "sourceClasses": ["Building"], "kind": "building",
                                      "identifierField": "gml:id", "nameField": None}}
        return _write_layer(spool, header, crs, crs_basis, stopped, open_layer)


def _write_layer(spool: TextIO, header: dict, crs: str, crs_basis: dict,
                 stopped: dict, open_layer: Callable) -> list[dict]:
    derivative = open_layer(header, crs)
    try:
        spool.seek(0)
        for line in spool:
            element, properties, geometry, reason = json.loads(line)
            if properties is None:
                derivative.refuse(element, reason)
            else:
                derivative.feature(element, properties, geometry)
        result = derivative.close()
    except InputError as error:
        derivative.abandon()
        return [{**stopped, "reason": str(error)}]
    except BaseException:
        derivative.abandon()
        raise
    return [{**stopped, "state": "converted", "crs": crs, "crsSource": "stated", **crs_basis, **result}]
