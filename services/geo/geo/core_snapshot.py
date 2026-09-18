"""Source selection and snapshot candidates. Storage activation is not done here."""
from .core_contract import bundled_schema, fail, index_records, parse_core, ref_key, require_revision, version_key
from .core_identity import validate_core_identity_graph
from .core_sources import is_precise_core_locator, unique, validate_core_source_catalog
from .core_frames import validate_core_frame_catalog
from .core_geometry import validate_core_geometry_catalog
from .core_signature import canonical_core_text, core_input_digest
import math


def _pin(value):
    return f"{ref_key(value['ref'])}@{value['revision']}"


def _version(value):
    return {"ref": value["ref"], "revision": value["revision"]}


def _records(values):
    return sorted(values, key=_pin)


def _bag(values):
    return sorted(values, key=lambda value: canonical_core_text(value).encode("utf-16-be"))


def _same_entity(a, b):
    return ref_key(a["entity"]) == ref_key(b["entity"])


def _prepare(value):
    canonical_core_text(value)
    data = parse_core("snapshot-input", value)
    validate_core_identity_graph(data["identity"])
    validate_core_source_catalog(data["sources"], data["identity"])
    validate_core_frame_catalog(data["frames"])
    validate_core_geometry_catalog(data["geometry"], data["identity"], data["sources"], data["frames"])
    worlds, observations, resolutions = [index_records(data[key], key) for key in ("worlds", "observations", "resolutions")]
    entities = index_records(data["identity"]["entities"], "entity")
    representations = index_records(data["geometry"]["representations"], "representation")
    quantities = index_records(data["geometry"]["reportedQuantities"], "reported quantity")
    parts, sources, assets, datasets = [index_records(data["sources"][key], key) for key in ("parts", "sources", "assets", "datasets")]
    frames = index_records(data["frames"]["frames"], "frame")
    index_records(data["compositions"], "composition")
    world = require_revision(worlds, data["context"]["world"], "snapshot world")
    policy = bundled_schema("snapshot-input")[0]["x-ulpin-snapshot-policy"]
    rank = policy["accessRank"]
    ceiling = rank[data["context"]["scope"]["ceiling"]]
    for item in data["sources"]["datasets"] + data["sources"]["assets"] + data["sources"]["sources"] + data["sources"]["parts"] + data["observations"]:
        if rank[item["access"]] > ceiling:
            fail("ACCESS_SCOPE", "Input is outside the declared authorization scope")
    asset_ranks = {}

    def asset_rank(link):
        root = require_revision(assets, link, "source asset")
        stack = [(root, False)]
        while stack:
            asset, leave = stack.pop()
            key = _pin(asset)
            if key in asset_ranks:
                continue
            if leave:
                asset_ranks[key] = max([rank[asset["access"]]] + [asset_ranks[_pin(parent)] for parent in asset["parentAssets"]])
                continue
            stack.append((asset, True))
            stack.extend((require_revision(assets, parent, "asset ancestry"), False) for parent in asset["parentAssets"] if _pin(parent) not in asset_ranks)
        return asset_ranks[_pin(root)]

    for observation in data["observations"]:
        if ref_key(observation["entity"]) not in entities:
            fail("MISSING_TARGET", "Observation entity is absent")
        observation_world = require_revision(worlds, observation["world"], "observation world")
        start, end = observation["validity"]["fromMs"], observation["validity"]["toMs"]
        if start is not None and end is not None and start >= end:
            fail("TIME_RANGE", "Validity must have an increasing half-open interval")
        unique([_pin(link) for link in observation["sourceParts"]], "observation source parts")
        required_rank = 0
        if observation_world["state"] == "observed" and observation["method"] == "synthetic":
            fail("WORLD_CLASSIFICATION", "Synthetic observations cannot be labelled observed")
        for link in observation["sourceParts"]:
            part = require_revision(parts, link, "observation source part")
            source = require_revision(sources, part["source"], "observation source")
            dataset = require_revision(datasets, source["dataset"], "source dataset") if source["dataset"] else None
            required_rank = max([required_rank, rank[part["access"]], rank[source["access"]], rank[dataset["access"]] if dataset else 0] + [asset_rank(asset) for asset in source["assets"]])
            if observation_world["state"] == "observed" and (source["method"] == "synthetic" or dataset and dataset["classification"] in ("planned", "hypothetical", "synthetic")):
                fail("WORLD_CLASSIFICATION", "Source classification contradicts an observed-world claim")
            if observation["payload"]["kind"] in ("geometry", "vertical_interval") and not any(is_precise_core_locator(locator) for locator in part["locators"]):
                fail("LOCATOR_NOT_QUALIFIED", "Geometry/vertical contribution requires an exact source part")
        payload = observation["payload"]
        part_refs = {_pin(link) for link in observation["sourceParts"]}
        if payload["kind"] == "geometry":
            rep = require_revision(representations, payload["representation"], "observed representation")
            if not _same_entity(rep, observation) or rep["role"] != observation["role"]:
                fail("OBSERVATION_ROLE", "Observation must match representation entity and role")
            if any(_pin(link) not in part_refs for link in rep["sourceParts"]):
                fail("OBSERVATION_PROVENANCE", "Observation omitted a geometry contribution source")
            if rep["geometry"]["profile"] == "asset":
                required_rank = max(required_rank, asset_rank(rep["geometry"]["asset"]))
        elif payload["kind"] == "vertical_interval":
            if observation["role"] != "vertical_interval":
                fail("OBSERVATION_ROLE", "Vertical payload has a different semantic role")
            frame = require_revision(frames, payload["frame"], "vertical observation frame")
            interval = payload["interval"]
            if interval is not None:
                if interval["upperMetres"] < interval["lowerMetres"] or not math.isfinite(interval["upperMetres"] - interval["lowerMetres"]):
                    fail("GEOMETRY_INTERVAL", "Vertical bounds are reversed or overflowed")
                if frame["kind"] == "geocentric" or frame["vertical"]["kind"] not in ("benchmark", "datum"):
                    fail("VERTICAL_UNRESOLVED", "Vertical interval requires a named reference")
                if _pin(interval["reference"]) != _pin(frame["vertical"]["reference"]):
                    fail("VERTICAL_MISMATCH", "Vertical observation and frame have different zeros")
        elif payload["kind"] == "reported_quantity":
            quantity = require_revision(quantities, payload["quantity"], "observed quantity")
            if not _same_entity(quantity, observation) or quantity["definition"] != observation["role"]:
                fail("OBSERVATION_ROLE", "Reported observation mismatches its definition/entity")
            if _pin(quantity["sourcePart"]) not in part_refs:
                fail("OBSERVATION_PROVENANCE", "Reported quantity source is missing")
        if rank[observation["access"]] < required_rank:
            fail("ACCESS_DOWNGRADE", "Observation cannot lower its contributing sources' access")
    resolution_keys = []
    for resolution in data["resolutions"]:
        if ref_key(resolution["entity"]) not in entities:
            fail("MISSING_TARGET", "Resolution entity is absent")
        require_revision(worlds, resolution["world"], "resolution world")
        unique([_pin(link) for link in resolution["candidates"]], "resolution candidates")
        for link in resolution["candidates"]:
            observation = require_revision(observations, link, "resolution candidate")
            if not _same_entity(observation, resolution) or _pin(observation["world"]) != _pin(resolution["world"]) or observation["role"] != resolution["role"]:
                fail("RESOLUTION_SCOPE", "Candidates differ in entity, world or semantic role")
        if resolution["selected"] and _pin(resolution["selected"]) not in {_pin(link) for link in resolution["candidates"]}:
            fail("RESOLUTION_SELECTION", "Selected observation is not an exact candidate")
        resolution_keys.append(canonical_core_text([resolution["entity"], resolution["world"], resolution["role"], resolution.get("purpose", "analysis")]))
    unique(resolution_keys, "entity/world/role resolution")
    generated = set()
    for composition in data["compositions"]:
        if ref_key(composition["entity"]) not in entities:
            fail("MISSING_TARGET", "Composition entity is absent")
        require_revision(worlds, composition["world"], "composition world")
        links = [composition["geometry"]] if composition["kind"] == "passthrough" else [composition["footprint"], composition["vertical"]]
        for link in links:
            resolution = require_revision(resolutions, link, "composition resolution")
            if not _same_entity(resolution, composition) or _pin(resolution["world"]) != _pin(composition["world"]):
                fail("COMPOSITION_SCOPE", "Composition resolution has another world or entity")
        if composition["kind"] == "prism":
            footprint = require_revision(resolutions, composition["footprint"], "footprint resolution")
            vertical = require_revision(resolutions, composition["vertical"], "vertical resolution")
            if footprint["role"] not in policy["footprintRoles"] or vertical["role"] != "vertical_interval":
                fail("COMPOSITION_ROLE", "Prism requires qualified footprint and vertical schedule")
            key = ref_key(composition["output"]["ref"])
            if key in representations or key in generated:
                fail("OUTPUT_ID_COLLISION", "Generated geometry cannot replace an existing identity")
            generated.add(key)
    return data, world, observations, resolutions, representations, quantities, policy


def validate_core_snapshot_input(value):
    return _prepare(value)[0]


def _ordered_input(data):
    entities = []
    for entity in _records(data["identity"]["entities"]):
        lifecycle = entity["lifecycle"]
        entities.append({**entity, "identifiers": _bag(entity["identifiers"]), "memberships": _bag(entity["memberships"]),
                         "lifecycle": lifecycle if lifecycle["state"] == "active" else {**lifecycle, "replacedBy": _bag(lifecycle["replacedBy"])}})
    sources = data["sources"]
    ordered_sources = {**sources, "datasets": _records(sources["datasets"]),
                       "assets": [{**a, "parentAssets": _bag(a["parentAssets"])} for a in _records(sources["assets"])],
                       "sources": [{**s, "assets": _bag(s["assets"]), "workflows": _bag(s["workflows"])} for s in _records(sources["sources"])],
                       "parts": _records(sources["parts"]), "links": _records(sources["links"])}
    if "linkHistory" in sources:
        ordered_sources["linkHistory"] = _records(sources["linkHistory"])
    reported = [{**q, "amount": {**q["amount"], "candidates": _bag(q["amount"]["candidates"])} if q["amount"]["state"] == "conflicting" else q["amount"]} for q in _records(data["geometry"]["reportedQuantities"])]
    return {**data, "worlds": _records(data["worlds"]),
            "identity": {"entities": entities, "relations": sorted(data["identity"]["relations"], key=lambda r: r["id"])},
            "sources": ordered_sources, "frames": {"frames": _records(data["frames"]["frames"]), "operations": _records(data["frames"]["operations"])},
            "geometry": {"representations": [{**r, "sourceParts": _bag(r["sourceParts"])} for r in _records(data["geometry"]["representations"])], "reportedQuantities": reported},
            "observations": [{**o, "sourceParts": _bag(o["sourceParts"])} for o in _records(data["observations"])],
            "resolutions": [{**r, "candidates": _bag(r["candidates"])} for r in _records(data["resolutions"])], "compositions": _records(data["compositions"])}


def build_core_snapshot(value):
    data, world, observations, resolutions, representations, quantities, policy = _prepare(value)
    selected, selected_quantities, results = {}, {}, []

    def choose(link):
        resolution = require_revision(resolutions, link, "selected resolution")
        if resolution["selected"] is None:
            return None, "UNRESOLVED_SELECTION", "unknown"
        observation = require_revision(observations, resolution["selected"], "selected observation")
        start, end, time = observation["validity"]["fromMs"], observation["validity"]["toMs"], data["context"]["asOfMs"]
        coverage = "bounded" if time is not None and start is not None and end is not None else "unknown"
        if time is not None and (start is not None and time < start or end is not None and time >= end):
            return None, "OUTSIDE_VALIDITY", coverage
        if observation["payload"]["kind"] == "unavailable":
            return None, observation["payload"]["reasonCode"], coverage
        return observation, None, coverage

    for composition in _records(data["compositions"]):
        if _pin(composition["world"]) != _pin(data["context"]["world"]):
            continue
        base = {"composition": _version(composition), "entity": composition["entity"]}
        def fail_result(reason, coverage="unknown"):
            results.append({**base, "status": "unavailable", "representation": None, "reasonCode": reason, "temporalCoverage": coverage})
        first, reason, coverage = choose(composition["geometry"] if composition["kind"] == "passthrough" else composition["footprint"])
        if first is None:
            fail_result(reason, coverage)
            continue
        if first["payload"]["kind"] != "geometry":
            fail("COMPOSITION_PAYLOAD", "Geometry selection has no geometry payload")
        rep = require_revision(representations, first["payload"]["representation"], "selected geometry")
        output = rep
        if composition["kind"] == "prism":
            second, reason, second_coverage = choose(composition["vertical"])
            if second is None:
                fail_result(reason, second_coverage)
                continue
            vertical = second["payload"]
            if vertical["kind"] != "vertical_interval":
                fail("COMPOSITION_PAYLOAD", "Vertical selection has no interval payload")
            geometry = rep["geometry"]
            shape = geometry["geometry"] if geometry["profile"] == "planar" else geometry["footprint"] if geometry["profile"] == "prism" else None
            if shape is None or shape["type"] not in ("Polygon", "MultiPolygon"):
                fail_result("POLYGON_REQUIRED")
                continue
            if rep["frame"] is None:
                fail_result("FRAME_UNRESOLVED")
                continue
            if _pin(rep["frame"]) != _pin(vertical["frame"]):
                fail_result("FRAME_MISMATCH")
                continue
            if vertical["interval"] is None:
                fail_result("UNKNOWN_VERTICAL_INTERVAL")
                continue
            parts = {_pin(link): link for link in first["sourceParts"] + second["sourceParts"]}
            output = {**composition["output"], "entity": composition["entity"], "frame": rep["frame"], "sourceParts": _records(list(parts.values())),
                      "geometry": {"profile": "prism", "footprint": shape, "interval": vertical["interval"]}}
            coverage = "bounded" if coverage == "bounded" and second_coverage == "bounded" else "unknown"
        selected[ref_key(output["ref"])] = output
        results.append({**base, "status": "available", "representation": _version(output), "reasonCode": None, "temporalCoverage": coverage})
    for resolution in data["resolutions"]:
        if _pin(resolution["world"]) != _pin(data["context"]["world"]):
            continue
        choice, _, _ = choose(_version(resolution))
        if choice is None or choice["payload"]["kind"] != "reported_quantity":
            continue
        quantity = require_revision(quantities, choice["payload"]["quantity"], "selected quantity")
        selected_quantities[ref_key(quantity["ref"])] = quantity
        if quantity["amount"]["state"] == "conflicting":
            for link in quantity["amount"]["candidates"]:
                candidate = require_revision(quantities, link, "selected quantity candidate")
                selected_quantities[ref_key(candidate["ref"])] = candidate
    geometry = validate_core_geometry_catalog({"representations": _records(list(selected.values())), "reportedQuantities": _records(list(selected_quantities.values()))}, data["identity"], data["sources"], data["frames"])
    used = {ref_key(r["entity"]) for r in geometry["representations"] + geometry["reportedQuantities"]}
    entities = _records([e for e in data["identity"]["entities"] if ref_key(e["ref"]) in used])
    input_digest = core_input_digest(_ordered_input(data))
    geometry_digest = core_input_digest({"profile": policy["compilerProfile"], "world": world,
                                         "frames": {"frames": _records(data["frames"]["frames"]), "operations": _records(data["frames"]["operations"])},
                                         "entities": [{"ref": e["ref"], "kind": e["kind"]} for e in entities],
                                         "representations": [{key: value for key, value in r.items() if key != "sourceParts"} for r in geometry["representations"]]})
    manifest = parse_core("snapshot-manifest", {"schemaVersion": "ulpin-core-snapshot/1", "state": "candidate", "context": data["context"],
                                               "signatureVersion": policy["canonicalEncoding"], "inputDigest": input_digest, "geometryDigest": geometry_digest,
                                               "representations": [_version(r) for r in geometry["representations"]], "entities": [_version(e) for e in entities],
                                               "retainedObservations": [_version(o) for o in _records(data["observations"]) if _pin(o["world"]) == _pin(data["context"]["world"])]})
    return {"manifest": manifest, "geometry": geometry, "results": results}


def validate_core_publication_candidate(snapshot_value, publication_value):
    snapshot = parse_core("snapshot-manifest", snapshot_value)
    publication = parse_core("publication-candidate", publication_value)
    if publication["snapshotDigest"] != snapshot["inputDigest"] or publication["geometryDigest"] != snapshot["geometryDigest"]:
        fail("PUBLICATION_SNAPSHOT", "Publication belongs to another immutable snapshot")
    if canonical_core_text(publication["scope"]) != canonical_core_text(snapshot["context"]["scope"]):
        fail("ACCESS_SCOPE", "Publication authorization scope differs")
    unique([a["id"] for a in publication["assets"]], "publication assets")
    assets = {a["id"] for a in publication["assets"]}
    reps = {_pin(r) for r in snapshot["representations"]}
    unique([canonical_core_text([b["assetId"], b["featureId"]]) for b in publication["bindings"]], "asset feature identities")
    for binding in publication["bindings"]:
        if binding["assetId"] not in assets:
            fail("MISSING_REFERENCE", "Publication feature refers to an absent derived asset")
        if _pin(binding["representation"]) not in reps:
            fail("STALE_REFERENCE", "Feature is not an exact selected representation revision")
    return publication
