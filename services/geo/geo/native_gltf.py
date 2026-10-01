"""Bounded glTF 2.0 source inspection, intended for an isolated worker only.

No dependency resolver, renderer, global transform, analytical geometry or
property identity. JSON declarations remain distinct from specification defaults.
The public CLI supervises import, read, projection and streaming serialization.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import math
import struct
import time

MAX_INPUT_BYTES = 16 * 1024**2
MAX_BUFFER_BYTES = 16 * 1024**2
MAX_OUTPUT_BYTES = 16 * 1024**2
MAX_NODES = 10_000
MAX_POSITIONS = 100_000
MAX_INDICES = 300_000
MAX_DEPTH = 64
MAX_JSON_VALUES = 500_000
MAX_SECONDS = 45


class GltfError(ValueError):
    def __init__(self, code, pointer, message, status="malformed"):
        super().__init__(message)
        self.code, self.pointer, self.status = code, pointer, status

    def as_dict(self):
        return {"code": self.code, "pointer": self.pointer,
                "status": self.status, "message": str(self)}


def _fail(code, pointer, message, status="malformed"):
    raise GltfError(code, pointer, message, status)


def _pointer(parent, key):
    return parent + "/" + str(key).replace("~", "~0").replace("/", "~1")


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


class _Budget:
    def __init__(self):
        self.deadline = time.monotonic() + MAX_SECONDS
        self.positions = self.indices = 0

    def check(self):
        if time.monotonic() > self.deadline:
            _fail("TIME_LIMIT", "", "Inspection deadline exceeded.", "limit")


def _integer(value, pointer, minimum=0, maximum=MAX_INPUT_BYTES):
    if type(value) is not int or not minimum <= value <= maximum:
        _fail("INTEGER_RANGE", pointer, "Integer is absent, invalid or outside the profile.")
    return value


def _object(value, pointer):
    if not isinstance(value, dict):
        _fail("OBJECT", pointer, "Expected an object declaration.")
    return value


def _array(value, pointer, maximum=MAX_NODES):
    if not isinstance(value, list):
        _fail("ARRAY", pointer, "Expected an array declaration.")
    if len(value) > maximum:
        _fail("ARRAY_LIMIT", pointer, "Array exceeds the inspection profile.", "limit")
    return value


def _reference(value, collection, pointer):
    return _integer(value, pointer, 0, len(collection) - 1)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _fail("DUPLICATE_KEY", "", "Duplicate JSON keys cannot identify a source value.")
        result[key] = value
    return result


def _json(raw, budget):
    # Depth is checked before json.loads allocates a recursive object tree.
    depth, in_string, escaped = 0, False, False
    for index, byte in enumerate(raw):
        if index % 4096 == 0:
            budget.check()
        if in_string:
            if escaped:
                escaped = False
            elif byte == 92:
                escaped = True
            elif byte == 34:
                in_string = False
        elif byte == 34:
            in_string = True
        elif byte in (91, 123):
            depth += 1
            if depth > MAX_DEPTH:
                _fail("DEPTH_LIMIT", "", "JSON nesting exceeds 64.", "limit")
        elif byte in (93, 125):
            depth -= 1
    def reject_constant(_):
        _fail("NONFINITE", "", "Nonfinite JSON numbers are refused.")
    try:
        document = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs,
                              parse_constant=reject_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as error:
        if isinstance(error, GltfError):
            raise
        _fail("JSON", "", "Invalid UTF-8 JSON source.")
    stack, count, extensions = [(document, "")], 0, []
    while stack:
        value, pointer = stack.pop()
        count += 1
        if count % 1024 == 0:
            budget.check()
        if count > MAX_JSON_VALUES:
            _fail("VALUE_LIMIT", pointer, "JSON value count exceeds the profile.", "limit")
        if isinstance(value, dict):
            if "extensions" in value:
                for name in _object(value["extensions"], pointer + "/extensions"):
                    extensions.append({"name": name, "pointer": _pointer(pointer + "/extensions", name),
                                       "status": "unsupported", "executed": False})
            stack.extend((v, _pointer(pointer, k)) for k, v in value.items())
        elif isinstance(value, list):
            stack.extend((v, _pointer(pointer, i)) for i, v in enumerate(value))
        elif type(value) in (int, float):
            try:
                finite = math.isfinite(value)
            except OverflowError:
                finite = False
            if not finite:
                _fail("NONFINITE", pointer, "Nonfinite or unrepresentable JSON numbers are refused.")
        elif isinstance(value, str):
            try:
                value.encode("utf-8")
            except UnicodeError:
                _fail("UNICODE", pointer, "Unpaired Unicode surrogates are refused.")
    return _object(document, ""), sorted(extensions, key=lambda e: e["pointer"])


def _container(raw):
    if not raw.startswith(b"glTF"):
        return raw, None, [], {"kind": "gltf_json", "byteOffset": 0, "byteLength": len(raw)}
    if len(raw) < 20:
        _fail("GLB_HEADER", "", "Truncated GLB header.")
    magic, version, length = struct.unpack_from("<4sII", raw)
    if version != 2 or length != len(raw):
        _fail("GLB_HEADER", "", "GLB must have version 2 and an exact original length.")
    chunks, json_raw, binary = [], None, None
    offset = 12
    while offset < len(raw):
        if len(chunks) >= 64 or offset + 8 > len(raw):
            _fail("GLB_CHUNKS", "", "Invalid or excessive GLB chunks.")
        size, kind = struct.unpack_from("<II", raw, offset)
        start, end = offset + 8, offset + 8 + size
        if size % 4 or end > len(raw):
            _fail("GLB_CHUNK_LENGTH", "", "Unaligned or out-of-bounds GLB chunk.")
        block = memoryview(raw)[start:end]
        chunks.append({"ordinal": len(chunks), "type": kind, "byteOffset": start,
                       "byteLength": size, "sha256": _sha(block),
                       "status": "declared" if kind in (0x4E4F534A, 0x004E4942) else "unsupported"})
        if len(chunks) == 1 and kind != 0x4E4F534A:
            _fail("GLB_JSON", "", "The first GLB chunk must be JSON.")
        if kind == 0x4E4F534A:
            if json_raw is not None:
                _fail("GLB_JSON", "", "Multiple JSON chunks are refused.")
            json_raw = bytes(block)
        elif kind == 0x004E4942:
            if binary is not None or len(chunks) != 2:
                _fail("GLB_BIN", "", "BIN must occur once as the second chunk.")
            binary = (block, start)
        offset = end
    return json_raw, binary, chunks, {"kind": "glb_json_chunk", **chunks[0]}


def _declarations(document, name):
    result = _array(document.get(name, []), "/" + name)
    for index, value in enumerate(result):
        _object(value, f"/{name}/{index}")
    return result


def _buffers(declared, binary):
    sizes = [_integer(value.get("byteLength"), f"/buffers/{index}/byteLength", 1, MAX_BUFFER_BYTES)
             for index, value in enumerate(declared)]
    if sum(sizes) > MAX_BUFFER_BYTES:
        _fail("BUFFER_LIMIT", "/buffers", "Aggregate declared buffers exceed 16 MiB.", "limit")
    result = []
    for index, (value, size) in enumerate(zip(declared, sizes)):
        pointer = f"/buffers/{index}"
        data, origin = None, {"pointer": pointer}
        if "uri" not in value:
            if index != 0 or binary is None:
                origin.update(kind="missing", status="needs_input")
            else:
                block, start = binary
                if not size <= len(block) <= size + 3 or any(block[size:]):
                    _fail("GLB_BUFFER_LENGTH", pointer, "BIN size or zero padding disagrees with its buffer.")
                data = block[:size]
                origin.update(kind="glb_bin", status="available", originalByteOffset=start)
        else:
            uri = value["uri"]
            if not isinstance(uri, str):
                _fail("URI", pointer + "/uri", "Buffer URI must be a string.")
            if uri.startswith("data:"):
                prefix, separator, encoded = uri.partition(",")
                if prefix not in ("data:application/octet-stream;base64", "data:application/gltf-buffer;base64") or not separator:
                    origin.update(kind="embedded_uri", status="unsupported", reason="DATA_URI_PROFILE")
                else:
                    # Exact canonical length bounds expansion before decoding.
                    if len(encoded) != 4 * ((size + 2) // 3):
                        _fail("BUFFER_LENGTH", pointer, "Embedded base64 length disagrees with byteLength.")
                    try:
                        data = base64.b64decode(encoded, validate=True)
                    except (ValueError, binascii.Error):
                        _fail("BASE64", pointer + "/uri", "Invalid embedded base64 buffer.")
                    if len(data) != size or base64.b64encode(data).decode("ascii") != encoded:
                        _fail("BUFFER_LENGTH", pointer, "Noncanonical or inconsistent embedded buffer.")
                    origin.update(kind="embedded_base64", status="available", uriPointer=pointer + "/uri",
                                  base64CharacterOffset=len(prefix) + 1, encodedCharacters=len(encoded),
                                  originalByteOffset=None)
            else:
                origin.update(kind="external_uri", status="needs_input", uri=uri,
                              reason="EXTERNAL_BUFFER_NOT_RESOLVED")
        origin.update(byteLength=size, sha256=_sha(data) if data is not None else None, fetched=False)
        if value.get("extensions"):
            origin.update(status="unsupported", reason="BUFFER_EXTENSION")
            data = None
        result.append((data, origin))
    if binary is not None and (not declared or "uri" in declared[0]):
        _fail("UNREFERENCED_BIN", "/buffers", "GLB BIN has no matching first buffer declaration.")
    return result


def _layout(accessors, views, buffers):
    for index, view in enumerate(views):
        pointer = f"/bufferViews/{index}"
        b = _reference(view.get("buffer"), buffers, pointer + "/buffer")
        start = _integer(view.get("byteOffset", 0), pointer + "/byteOffset")
        size = _integer(view.get("byteLength"), pointer + "/byteLength", 1)
        if start + size > buffers[b][1]["byteLength"]:
            _fail("VIEW_BOUNDS", pointer, "Buffer view exceeds declared buffer bytes.")
        if "byteStride" in view:
            stride = _integer(view["byteStride"], pointer + "/byteStride", 4, 252)
            if stride % 4:
                _fail("STRIDE", pointer, "Vertex byteStride must be a multiple of four.")
    for index, accessor in enumerate(accessors):
        pointer = f"/accessors/{index}"
        _integer(accessor.get("count"), pointer + "/count", 1, MAX_INDICES)
        _integer(accessor.get("byteOffset", 0), pointer + "/byteOffset")
        if accessor.get("componentType") not in (5120, 5121, 5122, 5123, 5125, 5126):
            _fail("COMPONENT_TYPE", pointer, "Unknown accessor component type.")
        if accessor.get("type") not in ("SCALAR", "VEC2", "VEC3", "VEC4", "MAT2", "MAT3", "MAT4"):
            _fail("ACCESSOR_TYPE", pointer, "Unknown accessor shape.")
        if "normalized" in accessor and type(accessor["normalized"]) is not bool:
            _fail("NORMALIZED", pointer, "normalized must be a boolean.")
        if "bufferView" in accessor:
            _reference(accessor["bufferView"], views, pointer + "/bufferView")


def _accessor(index, role, accessors, views, buffers, budget):
    accessor = accessors[index]
    pointer = f"/accessors/{index}"
    count = accessor["count"]
    if role == "POSITION":
        budget.positions += count
        if budget.positions > MAX_POSITIONS:
            _fail("POSITION_LIMIT", pointer, "Projected positions exceed 100,000.", "limit")
        shape, components, formats = "VEC3", 3, {5126: ("f", 4)}
    else:
        budget.indices += count
        if budget.indices > MAX_INDICES:
            _fail("INDEX_LIMIT", pointer, "Projected indices exceed 300,000.", "limit")
        shape, components, formats = "SCALAR", 1, {5121: ("B", 1), 5123: ("H", 2), 5125: ("I", 4)}
    locator = {"accessorPointer": pointer, "declaration": accessor}
    reason = None
    if "sparse" in accessor:
        reason = "SPARSE_ACCESSOR"
    elif accessor.get("extensions"):
        reason = "ACCESSOR_EXTENSION"
    elif accessor["componentType"] not in formats or accessor["type"] != shape or accessor.get("normalized", False):
        reason = "ACCESSOR_PROFILE"
    elif "bufferView" not in accessor:
        reason = "IMPLICIT_ACCESSOR_VALUES"
    if reason:
        return {"status": "unsupported", "reason": reason, "locator": locator}
    view_index = accessor["bufferView"]
    view = views[view_index]
    buffer_index = view["buffer"]
    data, origin = buffers[buffer_index]
    fmt, component_bytes = formats[accessor["componentType"]]
    element_bytes = component_bytes * components
    relative = accessor.get("byteOffset", 0)
    stride = view.get("byteStride", element_bytes)
    start = view.get("byteOffset", 0) + relative
    span = (count - 1) * stride + element_bytes
    if relative % component_bytes or start % component_bytes or stride < element_bytes or stride % component_bytes:
        _fail("ACCESSOR_ALIGNMENT", pointer, "Misaligned or undersized accessor stride.")
    if role == "POSITION" and (relative % 4 or start % 4):
        _fail("VERTEX_ALIGNMENT", pointer, "Vertex positions must be four-byte aligned.")
    if role == "indices" and "byteStride" in view:
        _fail("INDEX_STRIDE", pointer, "Index buffer views cannot declare byteStride.")
    if relative + span > view["byteLength"]:
        _fail("ACCESSOR_BOUNDS", pointer, "Accessor exceeds its buffer view.")
    locator.update(bufferViewPointer=f"/bufferViews/{view_index}", bufferPointer=f"/buffers/{buffer_index}",
                   bufferSha256=origin["sha256"], decodedByteOffset=start, byteSpan=span,
                   elementByteLength=element_bytes, byteStride=stride, count=count,
                   originalByteOffset=(origin["originalByteOffset"] + start
                                       if origin.get("originalByteOffset") is not None else None),
                   bufferOrigin=origin)
    if view.get("extensions"):
        return {"status": "unsupported", "reason": "BUFFER_VIEW_EXTENSION", "locator": locator}
    if data is None:
        return {"status": origin["status"], "reason": origin.get("reason", "MISSING_BUFFER"), "locator": locator}
    codec = struct.Struct("<" + fmt * components)
    values = []
    for item in range(count):
        if item % 1024 == 0:
            budget.check()
        value = codec.unpack_from(data, start + item * stride)
        if any(isinstance(v, float) and not math.isfinite(v) for v in value):
            _fail("NONFINITE_BUFFER", pointer, "Accessor contains nonfinite floating-point data.")
        values.append(list(value) if components > 1 else value[0])
    locator["referencedSpanSha256"] = _sha(memoryview(data)[start:start + span])
    return {"status": "available", "values": values, "locator": locator}


def _nodes(document, meshes, scenes, requested, budget):
    nodes = _declarations(document, "nodes")
    parents = [None] * len(nodes)
    result = []
    for index, node in enumerate(nodes):
        pointer = f"/nodes/{index}"
        children = _array(node.get("children", []), pointer + "/children")
        for j, child in enumerate(children):
            _reference(child, nodes, f"{pointer}/children/{j}")
            if parents[child] is not None:
                _fail("NODE_PARENT", pointer + "/children", "A node has multiple or duplicate parents.")
            parents[child] = index
        if "mesh" in node:
            _reference(node["mesh"], meshes, pointer + "/mesh")
        for field, collection in (("skin", "skins"), ("camera", "cameras")):
            if field in node:
                _reference(node[field], document.get(collection, []), pointer + "/" + field)
        if "matrix" in node and any(key in node for key in ("translation", "rotation", "scale")):
            _fail("NODE_TRANSFORM", pointer, "Matrix and TRS declarations cannot coexist.")
        for field, size in (("matrix", 16), ("translation", 3), ("rotation", 4), ("scale", 3)):
            if field in node:
                values = _array(node[field], pointer + "/" + field, size)
                if len(values) != size or any(type(v) not in (int, float) for v in values):
                    _fail("NODE_TRANSFORM", pointer + "/" + field, "Invalid local transform declaration.")
                if field == "rotation" and not math.isclose(sum(v*v for v in values), 1.0, abs_tol=1e-5):
                    _fail("NODE_ROTATION", pointer + "/rotation", "Rotation quaternion is not normalized.")
        result.append({"sourceNodeIndex": index, "pointer": pointer, "declaration": node,
                       "transform": {"declarations": {k: node[k] for k in ("matrix", "translation", "rotation", "scale") if k in node},
                                     "interpretation": "local_column_major_matrix_or_TRS; no composition applied",
                                     "specificationDefaults": ({k: v for k, v in (("translation", [0, 0, 0]),
                                                               ("rotation", [0, 0, 0, 1]), ("scale", [1, 1, 1])) if k not in node}
                                                               if "matrix" not in node else {})}})
    colors = [0] * len(nodes)
    # Traverse roots first so previously visited descendants cannot hide an
    # overdeep chain whose source node indices happen to run in reverse order.
    roots_first = [i for i, parent in enumerate(parents) if parent is None]
    roots_first.extend(i for i, parent in enumerate(parents) if parent is not None)
    for root in roots_first:
        stack = [(root, False, 1)]
        while stack:
            index, leaving, depth = stack.pop()
            budget.check()
            if leaving:
                colors[index] = 2
                continue
            if colors[index] == 1:
                _fail("NODE_CYCLE", f"/nodes/{index}", "Node hierarchy contains a cycle.")
            if colors[index] == 2:
                continue
            if depth > MAX_DEPTH:
                _fail("NODE_DEPTH", f"/nodes/{index}", "Node hierarchy exceeds 64.", "limit")
            colors[index] = 1
            stack.append((index, True, depth))
            stack.extend((child, False, depth + 1) for child in reversed(nodes[index].get("children", [])))
    for index, scene in enumerate(scenes):
        roots = _array(scene.get("nodes", []), f"/scenes/{index}/nodes")
        for j, root in enumerate(roots):
            _reference(root, nodes, f"/scenes/{index}/nodes/{j}")
            if parents[root] is not None:
                _fail("SCENE_ROOTS", f"/scenes/{index}", "Scene node is not a hierarchy root.")
        if len(set(roots)) != len(roots):
            _fail("SCENE_ROOTS", f"/scenes/{index}", "Duplicate scene roots.")
    if "scene" in document:
        _reference(document["scene"], scenes, "/scene")
    selected = requested if requested is not None else document.get("scene")
    if selected is not None:
        _reference(selected, scenes, "/selectedScene")
    return result, {"index": selected, "origin": "caller" if requested is not None else "source" if "scene" in document else "absent",
                    "pointer": f"/scenes/{selected}" if selected is not None else None,
                    "roots": scenes[selected].get("nodes", []) if selected is not None else None}


def _resource_references(document, accessors, views, nodes):
    """Validate known core references without decoding or executing resources."""
    collections = {field: document.get(field, []) for field in
                   ("images", "textures", "samplers", "skins", "cameras", "animations", "materials")}
    for i, image in enumerate(collections["images"]):
        if "bufferView" in image:
            _reference(image["bufferView"], views, f"/images/{i}/bufferView")
        if "uri" in image and not isinstance(image["uri"], str):
            _fail("URI", f"/images/{i}/uri", "Image URI must be a string.")
    for i, texture in enumerate(collections["textures"]):
        for field, collection in (("source", "images"), ("sampler", "samplers")):
            if field in texture:
                _reference(texture[field], collections[collection], f"/textures/{i}/{field}")
    for i, material in enumerate(collections["materials"]):
        p = f"/materials/{i}"
        entries = [(material, p, ("normalTexture", "occlusionTexture", "emissiveTexture"))]
        if "pbrMetallicRoughness" in material:
            entries.append((_object(material["pbrMetallicRoughness"], p + "/pbrMetallicRoughness"),
                            p + "/pbrMetallicRoughness", ("baseColorTexture", "metallicRoughnessTexture")))
        for parent, pointer, fields in entries:
            for field in fields:
                if field in parent:
                    info = _object(parent[field], pointer + "/" + field)
                    _reference(info.get("index"), collections["textures"], pointer + "/" + field + "/index")
    for i, skin in enumerate(collections["skins"]):
        p = f"/skins/{i}"
        if "inverseBindMatrices" in skin:
            _reference(skin["inverseBindMatrices"], accessors, p + "/inverseBindMatrices")
        if "skeleton" in skin:
            _reference(skin["skeleton"], nodes, p + "/skeleton")
        for j, joint in enumerate(_array(skin.get("joints"), p + "/joints")):
            _reference(joint, nodes, f"{p}/joints/{j}")
    for i, animation in enumerate(collections["animations"]):
        p = f"/animations/{i}"
        samplers = _array(animation.get("samplers"), p + "/samplers")
        for j, sampler in enumerate(samplers):
            _object(sampler, f"{p}/samplers/{j}")
            for field in ("input", "output"):
                _reference(sampler.get(field), accessors, f"{p}/samplers/{j}/{field}")
        for j, channel in enumerate(_array(animation.get("channels"), p + "/channels")):
            _object(channel, f"{p}/channels/{j}")
            _reference(channel.get("sampler"), samplers, f"{p}/channels/{j}/sampler")
            target = _object(channel.get("target"), f"{p}/channels/{j}/target")
            if "node" in target:
                _reference(target["node"], nodes, f"{p}/channels/{j}/target/node")


def inspect_gltf(raw: bytes, *, selected_scene=None):
    """Inspect immutable bytes inside an externally supervised process."""
    if not raw or len(raw) > MAX_INPUT_BYTES:
        _fail("INPUT_LIMIT", "", "Original must be nonempty and at most 16 MiB.", "limit")
    budget = _Budget()
    json_raw, binary, chunks, json_locator = _container(raw)
    document, extensions = _json(json_raw, budget)
    asset = _object(document.get("asset"), "/asset")
    if asset.get("version") != "2.0" or ("minVersion" in asset and asset["minVersion"] != "2.0"):
        _fail("VERSION", "/asset", "Only glTF 2.0 is supported.", "unsupported")
    required = _array(document.get("extensionsRequired", []), "/extensionsRequired")
    used = _array(document.get("extensionsUsed", []), "/extensionsUsed")
    if any(not isinstance(v, str) for v in required + used) or len(set(required)) != len(required) or len(set(used)) != len(used):
        _fail("EXTENSIONS", "/extensionsRequired", "Extension declarations must be unique strings.")
    if any(v not in used for v in required):
        _fail("EXTENSIONS", "/extensionsRequired", "Required extensions must also occur in extensionsUsed.")
    declared_buffers = _declarations(document, "buffers")
    buffers = _buffers(declared_buffers, binary)
    views, accessors = _declarations(document, "bufferViews"), _declarations(document, "accessors")
    _layout(accessors, views, buffers)
    meshes, scenes = _declarations(document, "meshes"), _declarations(document, "scenes")
    materials = _declarations(document, "materials")
    for field in ("images", "textures", "samplers", "skins", "cameras", "animations"):
        _declarations(document, field)
    nodes, selected = _nodes(document, meshes, scenes, selected_scene, budget)
    _resource_references(document, accessors, views, nodes)
    primitives, primitive_count = [], 0
    for mesh_index, mesh in enumerate(meshes):
        pointer = f"/meshes/{mesh_index}"
        for primitive_index, primitive in enumerate(_array(mesh.get("primitives"), pointer + "/primitives")):
            primitive_count += 1
            if primitive_count > MAX_NODES:
                _fail("PRIMITIVE_LIMIT", pointer, "Primitive count exceeds 10,000.", "limit")
            p = f"{pointer}/primitives/{primitive_index}"
            _object(primitive, p)
            attributes = _object(primitive.get("attributes"), p + "/attributes")
            for key, value in attributes.items():
                _reference(value, accessors, _pointer(p + "/attributes", key))
            if "indices" in primitive:
                _reference(primitive["indices"], accessors, p + "/indices")
            if "material" in primitive:
                _reference(primitive["material"], materials, p + "/material")
            mode = _integer(primitive.get("mode", 4), p + "/mode", 0, 6)
            result = {"sourceMeshIndex": mesh_index, "sourcePrimitiveIndex": primitive_index,
                      "pointer": p, "declaration": primitive,
                      "mode": {"value": mode, "origin": "source" if "mode" in primitive else "specification_default"},
                      "status": "unsupported", "projection": None}
            if required:
                result["reason"] = "UNSUPPORTED_REQUIRED_EXTENSIONS"
            elif mesh.get("extensions") or primitive.get("extensions"):
                result["reason"] = "MESH_OR_PRIMITIVE_EXTENSION"
            elif "targets" in primitive or "weights" in mesh:
                result["reason"] = "MORPH_GEOMETRY"
            elif "POSITION" not in attributes:
                result.update(status="needs_input", reason="POSITION_ABSENT")
            else:
                position = _accessor(attributes["POSITION"], "POSITION", accessors, views, buffers, budget)
                indices = (_accessor(primitive["indices"], "indices", accessors, views, buffers, budget)
                           if "indices" in primitive else {"status": "absent", "values": None,
                                                           "semantics": "source vertex order; indices are not synthesized"})
                result["projection"] = {"POSITION": position, "indices": indices}
                if position["status"] == "available" and indices["status"] in ("available", "absent"):
                    if indices["status"] == "available" and any(v >= len(position["values"]) for v in indices["values"]):
                        _fail("INDEX_RANGE", p + "/indices", "Index refers beyond the POSITION accessor.")
                    count = len(indices["values"]) if indices["status"] == "available" else len(position["values"])
                    if ((mode == 1 and count % 2) or (mode == 4 and count % 3) or
                            (mode in (2, 3) and count < 2) or (mode in (5, 6) and count < 3)):
                        _fail("TOPOLOGY_COUNT", p, "Element count disagrees with primitive topology.")
                    result["status"] = "available_local_projection"
                else:
                    result["status"] = "needs_input" if "needs_input" in (position["status"], indices["status"]) else "unsupported"
            primitives.append(result)
    inventory = {}
    for field in ("materials", "textures", "images", "samplers", "skins", "cameras", "animations"):
        inventory[field] = [{"pointer": f"/{field}/{i}", "declaration": item, "executed": False,
                             "status": "declaration_only"} for i, item in enumerate(document.get(field, []))]
    for entry in inventory["images"]:
        image = entry["declaration"]
        uri = image.get("uri")
        entry["contentStatus"] = "unsupported_not_decoded"
        entry["dependency"] = {"kind": "external_uri" if uri is not None and not uri.startswith("data:") else
                                       "embedded_uri" if uri is not None else "buffer_view" if "bufferView" in image else "absent",
                               "status": "needs_input" if uri is not None and not uri.startswith("data:") else "unsupported",
                               "fetched": False}
    for entry in inventory["textures"]:
        entry["contentStatus"] = "unsupported_not_rendered"
    partial = (bool(required or extensions or document.get("skins") or document.get("animations")) or
               bool(inventory["images"] or inventory["textures"]) or
               selected["index"] is None or any(p["status"] != "available_local_projection" for p in primitives) or
               any(b[1]["status"] != "available" for b in buffers) or any(c["status"] == "unsupported" for c in chunks))
    projected_positions = sum(len(p["projection"]["POSITION"].get("values", [])) for p in primitives if p["projection"])
    projected_indices = sum(len(p["projection"]["indices"].get("values") or []) for p in primitives if p["projection"])
    available_primitives = sum(p["status"] == "available_local_projection" for p in primitives)
    return {"schemaVersion": "gltf-local-inspection/1", "status": "inspected_partial" if partial else "inspected_local",
            "geometryProjectionStatus": "available" if available_primitives == len(primitives) and primitives else
                                        "partial" if available_primitives else "unavailable",
            "sourceSha256": _sha(raw), "sourceBytes": len(raw), "representation": "context_mesh",
            "asset": {"pointer": "/asset", "declaration": asset}, "jsonLocator": json_locator, "chunks": chunks,
            "selectedScene": selected, "scenes": [{"pointer": f"/scenes/{i}", "declaration": v} for i, v in enumerate(scenes)],
            "nodes": nodes, "meshes": [{"pointer": f"/meshes/{i}", "declaration": v} for i, v in enumerate(meshes)],
            "buffers": [v[1] for v in buffers], "bufferViews": views, "accessors": accessors,
            "primitives": primitives, "extensions": {"required": required, "used": used, "inventory": extensions},
            "resources": inventory, "counts": {"nodes": len(nodes), "primitives": len(primitives),
                                                "projectedPositions": projected_positions, "projectedIndices": projected_indices},
            "qualification": {"profile": "local_source_inspection_only", "globalPlacement": "unknown",
                              "analyticalGeometry": False, "measurements": False, "propertyIdentity": False,
                              "registryAdmission": False, "rendering": False,
                              "localFrame": {"axes": "right_handed_Y_up", "linearUnit": "metre",
                                             "origin": "glTF_2.0_specification_semantics; no surveyed frame claim"},
                              "coordinates": "source_accessor_values; node transforms are declarations only",
                              "uninspected": "other attributes, materials, textures, cameras, skins and animations are declarations only"}}


def write_inspection(result, handle):
    """Stream JSON with a byte limit; no full encoded output allocation."""
    total, digest = 0, hashlib.sha256()
    for fragment in json.JSONEncoder(ensure_ascii=False, allow_nan=False, separators=(",", ":")).iterencode(result):
        block = fragment.encode("utf-8")
        total += len(block)
        if total > MAX_OUTPUT_BYTES:
            _fail("OUTPUT_LIMIT", "", "Serialized inspection exceeds 16 MiB.", "limit")
        handle.write(block)
        digest.update(block)
    return {"bytes": total, "sha256": digest.hexdigest()}


def _worker(source, output, expected_sha, selected_scene):
    try:
        with open(source, "rb") as handle:
            raw = handle.read(MAX_INPUT_BYTES + 1)
        if _sha(raw) != expected_sha:
            _fail("SOURCE_HASH", "", "Worker snapshot disagrees with original hash.")
        result = inspect_gltf(raw, selected_scene=selected_scene)
        with open(output, "xb") as handle:
            artifact = write_inspection(result, handle)
        print(json.dumps({"status": result["status"], "sourceSha256": result["sourceSha256"],
                          "counts": result["counts"], "artifact": artifact}))
        return 0
    except GltfError as error:
        print(json.dumps({"error": error.as_dict()}))
        return 2
