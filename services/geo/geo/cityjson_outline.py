"""B3D1. Building ground outlines read from the accepted CityJSON reader's projection, as one GeoJSON layer.

A Building's outline is its own LoD0 footprint, or else the GroundSurface faces of its first supported geometry
that has any. Positions are the reader's decoded vertices, unchanged: x and y draw the outline and z stays in each
position, so the area reader keeps it beside the outline as a source height with no stated unit or reference.
Parts are never composed into a building. Only an EPSG code the file states places the layer; a missing, null,
local or unknown system leaves it unplaced, in words. No code, geometry or identifier is guessed.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Callable

from .native_cityjson import MAX_INPUT_BYTES, CityJSONError, read_cityjson
from .validation import InputError

OUTLINE_READER = "cityjson-ground-outline/1"
LAYER = "building ground outlines"
_EPSG_FORMS = (re.compile(r"https?://www\.opengis\.net/def/crs/EPSG/[0-9.]+/([1-9][0-9]{0,8})"),
               re.compile(r"urn:ogc:def:crs:EPSG:[0-9.]*:([1-9][0-9]{0,8})"),
               re.compile(r"urn:ogc:def:crs,crs:EPSG:(?:[0-9]+(?:\.[0-9]+)*)?:([1-9][0-9]{0,8})"),
               re.compile(r"EPSG:([1-9][0-9]{0,8})"))
_UNPLACED = "so its outlines stay unplaced"


def stated_epsg(literal) -> int | None:
    """The EPSG code a reference system literal states in one of its standard forms, else None."""
    if not isinstance(literal, str):
        return None
    for form in _EPSG_FORMS:
        match = form.fullmatch(literal)
        if match:
            return int(match.group(1))
    return None


def _placement(frame: dict, horizontal: Callable[[int], str | None]) -> tuple[str | None, str | None, str]:
    """The layer's horizontal EPSG system and the words on where it comes from, or None and why it stays unplaced."""
    state = frame["referenceSystemState"]
    if state == "absent":
        return None, None, f"states no coordinate reference system, {_UNPLACED}"
    if state == "null":
        return None, None, f"states its coordinate reference system as null, {_UNPLACED}"
    code = stated_epsg(frame["referenceSystem"])
    if code is None:
        return None, None, f"states a coordinate reference system that is not an EPSG code, {_UNPLACED}"
    crs = horizontal(code)
    if crs is None:
        return None, None, (f"states EPSG:{code}, which has no two-dimensional horizontal system the reader knows, "
                            f"{_UNPLACED}")
    basis = None if crs == f"EPSG:{code}" else f"{crs}, the horizontal part of the EPSG:{code} the file states"
    return crs, basis, ""


def _at(document, pointer: str):
    """RFC 6901 lookup of a pointer the reader itself produced."""
    value = document
    for token in pointer.split("/")[1:]:
        key = token.replace("~1", "/").replace("~0", "~")
        value = value[int(key)] if isinstance(value, list) else value[key]
    return value


def _ground(document, face: dict) -> bool:
    pointer = face.get("semanticSurfacePointer")
    return pointer is not None and _at(document, pointer).get("type") == "GroundSurface"


def _outline_faces(document, item: dict) -> tuple[dict, str, list[dict]] | None:
    """The geometry, basis and faces of a Building's own outline, or None when it has none."""
    supported = [geometry for geometry in item["geometries"] if geometry["status"] == "supported"]
    for geometry in supported:
        if geometry["type"] == "MultiSurface" and geometry.get("lod") == "0":
            return geometry, "lod0_footprint", geometry["surfaces"]
    for geometry in supported:
        faces = [face for face in geometry["surfaces"] if _ground(document, face)]
        if faces:
            return geometry, "ground_surface", faces
    return None


def _polygon(document, faces: list[dict], vertices: list) -> dict:
    """Each face is one polygon: its first ring the outline, the rest its holes, each ring closed."""
    polygons = []
    for face in faces:
        rings = []
        for pointer in face["ringPointers"]:
            positions = [vertices[index] for index in _at(document, pointer)]
            rings.append(positions + positions[:1])
        polygons.append(rings)
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}
    return {"type": "MultiPolygon", "coordinates": polygons}


def _features(reading: dict) -> list[tuple[str, dict | None, dict | None]]:
    """Each Building in source order: its pointer, then its properties and outline, or None and None."""
    if "features" in reading:
        return [row for feature in reading["features"]
                for row in _features({**feature, "sourceDocument": reading["sourceDocument"]})]
    document, vertices = reading["sourceDocument"], reading["decodedVertices"]
    rows = []
    for item in reading["objects"]:
        if item["type"] != "Building":
            continue
        found = _outline_faces(document, item)
        if found is None:
            rows.append((item["pointer"], None, None))
            continue
        geometry, basis, faces = found
        properties = {"cityObjectId": item["id"], "cityObjectType": item["type"], "outlineBasis": basis,
                      "lod": geometry.get("lod"), "geometryPointer": geometry["pointer"]}
        rows.append((item["pointer"], properties, _polygon(document, faces, vertices)))
    return rows


def convert_cityjson_file(path: Path, source_sha256: str, open_layer: Callable[[dict, str], object],
                          horizontal: Callable[[int], str | None]) -> list[dict]:
    """The one outline layer of a CityJSON original on scratch disk, converted or stopped with words.

    `open_layer(header, crs)` opens the derivative writer; `horizontal(code)` names the two-dimensional horizontal
    EPSG system of a stated code, or None."""
    stopped = {"layer": LAYER, "ordinal": 0, "state": "not_converted"}
    if path.stat().st_size > MAX_INPUT_BYTES:
        return [{**stopped, "reason": "is larger than the 8 MiB the CityJSON reader takes"}]
    try:
        reading = read_cityjson(path.read_bytes())
    except CityJSONError as error:
        return [{**stopped, "reason": f"was not read by the CityJSON reader ({error.code})"}]
    crs, basis, words = _placement(reading["frame"], horizontal)
    if crs is None:
        return [{**stopped, "reason": words}]
    rows = _features(reading)
    if not any(properties for _, properties, _ in rows):
        return [{**stopped, "reason": "holds no Building with a LoD0 footprint or GroundSurface of its own"}]
    header = {"readerVersion": OUTLINE_READER, "originalSha256": source_sha256, "format": "cityjson",
              "layer": LAYER, "positionKind": "cityobject_pointer", "crs": crs,
              **({"crsBasis": basis} if basis else {}),
              "converterLayout": {"method": "converter:" + OUTLINE_READER.replace("/", "@"),
                                  "sourceClasses": ["Building"], "kind": "building",
                                  "identifierField": "cityObjectId", "nameField": None}}
    derivative = open_layer(header, crs)
    try:
        for pointer, properties, geometry in rows:
            if properties is None:
                derivative.refuse(pointer, "has no LoD0 footprint or GroundSurface of its own; "
                                           "outlines of its parts are not composed")
            else:
                derivative.feature(pointer, properties, geometry)
    except InputError as error:
        derivative.abandon()
        return [{**stopped, "reason": str(error)}]
    except BaseException:
        derivative.abandon()
        raise
    return [{**stopped, "state": "converted", "crs": crs, "crsSource": "stated",
             **({"crsBasis": basis} if basis else {}), **derivative.close()}]
