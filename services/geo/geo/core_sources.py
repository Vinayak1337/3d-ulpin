"""Source/evidence referential semantics from the common generated contract."""
from .core_contract import bundled_schema, fail, index_records, parse_core, ref_key, require_revision, structural_key, version_key
from .core_identity import validate_core_identity_graph


def unique(values, kind):
    if len(set(values)) != len(values):
        fail("DUPLICATE_REFERENCE", "Duplicate " + kind + " association")


def validate_core_source_catalog(value, identity_value):
    catalog = parse_core("source-catalog", value)
    identity = validate_core_identity_graph(identity_value)
    policy = bundled_schema("source-catalog")[0]["x-ulpin-evidence-policy"]
    entities = {ref_key(e["ref"]) for e in identity["entities"]}
    relations = {r["id"]: r for r in identity["relations"]}
    datasets = index_records(catalog["datasets"], "dataset")
    assets = index_records(catalog["assets"], "asset")
    sources = index_records(catalog["sources"], "source")
    parts = index_records(catalog["parts"], "source part")
    links = index_records(catalog["links"], "evidence link")
    history = {}
    for entry in catalog.get("linkHistory", []):
        current = links.get(ref_key(entry["ref"]))
        key = version_key(entry)
        if current is None:
            fail("MISSING_REFERENCE", "Evidence history needs a current association record")
        if entry["revision"] >= current["revision"]:
            fail("HISTORY_REVISION", "Evidence history must precede the current revision")
        if key in history:
            fail("DUPLICATE_RECORD", "Duplicate evidence history revision")
        history[key] = entry
    blobs, parents = {}, {}
    for asset in catalog["assets"]:
        if asset["kind"] == "original" and asset["retention"]["policy"] != "preserve_original":
            fail("ORIGINAL_RETENTION", "Original receipts are not disposable derivatives")
        if asset["storage"]["state"] == "registered":
            if asset["sha256"] is None or asset["bytes"] is None:
                fail("ASSET_METADATA", "Registered asset metadata requires checksum and bytes")
            key = ref_key(asset["storage"]["blobRef"])
            metadata = asset["sha256"], asset["bytes"], asset["mediaType"]
            if key in blobs and blobs[key] != metadata:
                fail("BLOB_METADATA", "One blob has conflicting metadata")
            blobs[key] = metadata
        unique([version_key(link) for link in asset["parentAssets"]], "asset parent")
        parents[ref_key(asset["ref"])] = [ref_key(require_revision(assets, link, "asset parent")["ref"]) for link in asset["parentAssets"]]
    complete = set()
    for root in assets:
        pending, active = [(root, False)], set()
        while pending:
            key, leave = pending.pop()
            if leave:
                active.remove(key); complete.add(key)
                continue
            if key in complete:
                continue
            if key in active:
                fail("ASSET_CYCLE", "Asset ancestry contains a cycle")
            active.add(key)
            pending.append((key, True))
            pending.extend((parent, False) for parent in parents.get(key, []))
    ordinals = []
    for source in catalog["sources"]:
        if source["dataset"] is not None:
            require_revision(datasets, source["dataset"], "dataset")
        for asset in source["assets"]:
            require_revision(assets, asset, "source asset")
        unique([version_key(link) for link in source["assets"]], "source asset")
        unique([ref_key(link) for link in source["workflows"]], "source workflow")
        if source["family"] is not None and source["familyOrdinal"] is not None:
            ordinals.append((ref_key(source["family"]), source["familyOrdinal"]))
    if len(set(ordinals)) != len(ordinals):
        fail("SOURCE_ORDINAL", "A source ordinal refers to multiple immutable receipts")
    for part in catalog["parts"]:
        source = require_revision(sources, part["source"], "source part's source")
        if part["asset"] is not None:
            require_revision(assets, part["asset"], "part asset")
            if version_key(part["asset"]) not in [version_key(link) for link in source["assets"]]:
                fail("PART_ASSET", "Part asset does not belong to its source")
        elif source["assets"] or any(locator["kind"] not in ("model_element", "verbatim") for locator in part["locators"]):
            fail("PART_ASSET", "An exact file part must name its original asset")
        unique([structural_key(locator) for locator in part["locators"]], "source locator")
        for locator in part["locators"]:
            if locator["kind"] in ("rows", "lines") and locator["range"]["end"] < locator["range"]["start"]:
                fail("LOCATOR_RANGE", "Source range is reversed")
            region = locator.get("region") if locator["kind"] in ("page", "image_region") else None
            if region and (region["x"] + region["width"] > 1 + policy["normalizedTolerance"] or region["y"] + region["height"] > 1 + policy["normalizedTolerance"]):
                fail("LOCATOR_REGION", "Source region lies outside the original")
    edge_keys = []
    for link in catalog["links"] + catalog.get("linkHistory", []):
        is_current = links[ref_key(link["ref"])] is link
        if ref_key(link["target"]) not in entities:
            fail("MISSING_TARGET", "Evidence target is missing")
        part = require_revision(parts, link["part"], "evidence part")
        precise = any(locator["kind"] in policy["preciseLocators"] and (locator["kind"] != "json_pointer" or locator["pointer"] != "") for locator in part["locators"])
        if link["purpose"] in policy["exactPurposes"] and not precise:
            fail("LOCATOR_NOT_QUALIFIED", "Locator does not identify a qualified geometry/level part")
        inherited = link["inheritance"]
        if inherited["kind"] == "inherited":
            if link["purpose"] not in policy["inheritedPurposes"]:
                fail("INHERITANCE_PURPOSE", "Inherited documents are not exact unit geometry")
            pinned = inherited["parentLink"]
            if (not is_current or link["state"] == "unlinked") and version_key(pinned) in history:
                parent = history[version_key(pinned)]
            else:
                parent = require_revision(links, pinned, "parent evidence link")
            if parent["inheritance"]["kind"] != "direct" or (link["state"] == "active" and parent["state"] != "active") or version_key(parent["part"]) != version_key(link["part"]):
                fail("INHERITANCE_PARENT", "Inherited evidence needs a current direct association")
            cursor = ref_key(link["target"])
            visited = {cursor}
            for relation_id in inherited["via"]:
                edge = relations.get(relation_id)
                if edge is None or edge["kind"] not in policy["inheritanceRelations"] or ref_key(edge["from"]) != cursor:
                    fail("INHERITANCE_PATH", "Evidence does not follow a qualified containment path")
                cursor = ref_key(edge["to"])
                if cursor in visited:
                    fail("INHERITANCE_PATH", "Evidence inheritance repeats an identity")
                visited.add(cursor)
            if cursor != ref_key(parent["target"]):
                fail("INHERITANCE_PATH", "Evidence path does not reach its parent association")
        if is_current and link["state"] == "active":
            edge_keys.append((ref_key(link["target"]), version_key(link["part"]), link["purpose"], structural_key(inherited)))
    unique(edge_keys, "active evidence link")
    return catalog
