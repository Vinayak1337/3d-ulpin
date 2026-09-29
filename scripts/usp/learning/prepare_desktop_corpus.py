#!/usr/bin/env python3
"""Curate the bounded desktop V5 field corpus from unchanged issuer responses."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path

from geo.usp_learning.corpus import input_proof, load_examples, wire_compatible_rows, wire_observation


HERE = Path("desktop-ai06a")
ARC = "arcgis-layer-json"


def receipt(root: Path, name: str, url: str, rows: int | None = None) -> dict:
    path = root / name
    value = {
        "file": str(HERE / name).replace("\\", "/") if root.name == HERE.name else name,
        "url": url,
        "bytes": path.stat().st_size,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }
    if rows is not None:
        value["rows"] = rows
    return value


def add_arcgis_source(root: Path, *, slug: str, family: str, split: str, issuer: str,
                      geography: str, dataset_url: str, metadata_url: str, sample_url: str,
                      permission_basis: str, permission_url: str, geometry_crs: str,
                      positive: dict[str, tuple[str, str]], negative: dict[str, str],
                      unknown: dict[str, str], notes: str) -> dict:
    metadata = json.loads((root / f"{slug}-metadata.json").read_text(encoding="utf-8"))
    sample = json.loads((root / f"{slug}-sample.json").read_text(encoding="utf-8"))
    features = sample["features"]
    if sample.get("type") != "FeatureCollection" or len(features) != 5:
        raise ValueError(f"expected five unchanged GeoJSON features: {slug}")
    indexes = {entry["name"]: index for index, entry in enumerate(metadata["fields"])}
    fields = []
    excluded = []

    def field_info(name: str) -> tuple[str, str, dict]:
        if name == "geometry":
            return "geometry", metadata["geometryType"], {"sourceField": "geometry", "geometryTypePointer": "/geometryType"}
        entry = metadata["fields"][indexes[name]]
        return f"properties.{name}", entry["type"], {"sourceField": name, "fieldPointer": f"/fields/{indexes[name]}"}

    for name, (target, definition) in positive.items():
        path, declared, locator = field_info(name)
        fields.append({"path": path, "definition": definition, "target": target,
                       "evidence": metadata_url, "decision": "positive", "declaredType": declared,
                       "observedWire": wire_observation(path, features),
                       "wireCompatibleRows": wire_compatible_rows(target, path, features),
                       "inputEvidence": locator})
    for name, definition in negative.items():
        path, declared, locator = field_info(name)
        fields.append({"path": path, "definition": definition, "target": None,
                       "evidence": metadata_url, "decision": "negative", "declaredType": declared,
                       "observedWire": wire_observation(path, features), "inputEvidence": locator})
    for name, reason in unknown.items():
        path, _, _ = field_info(name)
        excluded.append({"path": path, "decision": "unknown", "reason": reason,
                         "evidence": metadata_url, "observedWire": wire_observation(path, features)})
    return {
        "id": f"{slug}-buildings", "family": family, "split": split, "issuer": issuer,
        "geography": geography, "datasetUrl": dataset_url, "acquiredAt": "2026-09-29",
        "sample": receipt(root, f"{slug}-sample.json", sample_url, 5),
        "metadata": receipt(root, f"{slug}-metadata.json", metadata_url),
        "permission": {"basis": permission_basis, "url": permission_url,
                       "trainingEligible": True, "productionEligible": False, "sarvamDerived": False},
        "geometryCrs": geometry_crs,
        "representation": "Five source GeoJSON polygons, returned with outSR=4326; no property rights inferred",
        "fields": fields, "excludedFields": excluded, "sourceNotes": notes,
        "labelOrigin": "Issuer layer metadata and unchanged five-feature response; no model or provider labels",
        "inputEvidence": {"format": ARC, "titlePointer": "/name"},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--originals-dir", type=Path, required=True)
    parser.add_argument("--input-corpus", type=Path, required=True)
    parser.add_argument("--output-corpus", type=Path, required=True)
    parser.add_argument("--output-proof", type=Path)
    args = parser.parse_args()
    root = args.originals_dir / HERE
    corpus = copy.deepcopy(json.loads(args.input_corpus.read_text(encoding="utf-8")))
    if corpus["schemaVersion"] != "usp-field-mapping-corpus-v4":
        raise ValueError("desktop curation must start from V4")
    corpus["schemaVersion"] = "usp-field-mapping-corpus-v5"
    corpus["scope"] = "offline foreign-source research only; fresh Halifax/Kitchener evaluation unopened until fit freeze"
    corpus["curationNotes"] = (
        "Named NYC rows replace the V4 null-only sample without adding a schema family. "
        "Chesterfield supplies all three positive calibration targets. GNWT is retained in excludedSources "
        "pending layer-specific licence scope; its positive fields cannot qualify coverage. "
        "The entire retained Census county schema moves from training to calibration before any V5 fit, "
        "providing independent non-building identifier/name/polygon controls without invented data. "
        "DC/SF remain observed diagnostics. Halifax polygons have no name property; its separate "
        "related Buildings table is not flattened into this polygon field-mapping input. "
        "Kitchener supplies a separate named-polygon evaluation family, but numeric BUILDINGID "
        "is excluded from literal string source-key positives."
    )
    nyc = next(source for source in corpus["sources"] if source["id"] == "nyc-building-footprints")
    nyc_sample = root / "nyc-named-text-sample.json"
    nyc_features = json.loads(nyc_sample.read_text(encoding="utf-8"))["features"]
    if len(nyc_features) != 5 or not all(isinstance(feature["properties"].get("name"), str) and feature["properties"]["name"] for feature in nyc_features):
        raise ValueError("named NYC source response is incomplete")
    protected_benchmark_id = nyc["sample"]["excludesExistingBenchmarkDoittId"]
    nyc["sample"] = receipt(root, nyc_sample.name,
                            "https://data.cityofnewyork.us/resource/5zhs-2jue.geojson?$where=name%20like%20%27%25A%25%27&$limit=5", 5)
    nyc["sample"]["excludesExistingBenchmarkDoittId"] = protected_benchmark_id
    nyc["sourceNotes"] = "V5 sample selects nonempty publisher names; same NYC schema family, five rows are not five independent examples."
    for field in nyc["fields"] + nyc["excludedFields"]:
        field["observedWire"] = wire_observation(field["path"], nyc_features)
        if field.get("target") is not None:
            field["wireCompatibleRows"] = wire_compatible_rows(field["target"], field["path"], nyc_features)
    next(source for source in corpus["sources"] if source["id"] == "dc-building-footprints-2021")["split"] = "diagnostic"
    next(source for source in corpus["sources"] if source["id"] == "census-tigerweb-counties")["split"] = "calibration"

    chester = "https://services3.arcgis.com/TsynfzBSE6sXfoLq/arcgis/rest/services/Planimetric_ProdA/FeatureServer/0"
    corpus["sources"].append(add_arcgis_source(
        args.originals_dir, slug="chesterfield", family="chesterfield-planimetric-footprints",
        split="calibration", issuer="Chesterfield County, Virginia", geography="Chesterfield County, Virginia, United States",
        dataset_url="https://opengisdata.chesterfield.gov/", metadata_url=chester + "?f=pjson",
        sample_url=chester + "/query?where=StructureType%3D1+AND+BuildingName+IS+NOT+NULL&outFields=%2A&orderByFields=OBJECTID&resultRecordCount=5&outSR=4326&f=geojson",
        permission_basis="County Open GIS terms allow copying, modification and analysis, including commercial use; local offline evaluation only",
        permission_url="https://opengisdata.chesterfield.gov/",
        geometry_crs="Source layer EPSG:3857; unchanged GeoJSON response requested outSR=4326",
        positive={"GlobalID": ("building.sourceKey", "Issuer GlobalID for this footprint feature"),
                  "BuildingName": ("building.name", "Publisher Building Name for this structure"),
                  "geometry": ("building.geometry", "Polygon footprint on the BuildingFootprints layer")},
        negative={"BuildingUse": "Building-use classification code", "Status": "Feature status code",
                  "Source": "Collection source code", "Shape__Area": "Polygon area measure"},
        unknown={"CamaBuildingID": "CAMA cross-system building reference; stability and one-to-one footprint identity not established",
                 "BuildingPermitNum": "Permit number may cover work or more than one feature, not a footprint source key",
                 "OBJECTID": "Service row OID stability across extracts not established"},
        notes="Five of five sampled StructureType=1 polygons have nonempty names and distinct GlobalID strings; no full-population accuracy claim."))
    gnwt = "https://www.apps.geomatics.gov.nt.ca/arcgis/rest/services/GNWT_Operational/ATLAS_Public/FeatureServer/8"
    gnwt_source = add_arcgis_source(
        root, slug="gnwt", family="gnwt-atlas-building-footprints", split="calibration",
        issuer="Government of Northwest Territories, Land Management and Administration",
        geography="Northwest Territories, Canada", dataset_url="https://www.geomatics.gov.nt.ca/en/commissioner-lands-administration-atlas-website",
        metadata_url=gnwt + "?f=pjson",
        sample_url=gnwt + "/query?where=NAME%20IS%20NOT%20NULL%20AND%20NAME%20%3C%3E%20%27%27&outFields=*&orderByFields=OBJECTID&resultRecordCount=5&outSR=4326&f=geojson",
        permission_basis="Government of Northwest Territories ATLAS open-data catalogue lists OGL-NWT; attribute GNWT; local offline research only; separate old bulk-export agreement was not retrieved",
        permission_url="https://open.canada.ca/data/en/dataset/9e17b0bc-8ad5-07ad-601e-700183763829",
        geometry_crs="Source layer EPSG:3857; unchanged GeoJSON response requested outSR=4326; approximate outlines, not legal surveys",
        positive={"GlobalID": ("building.sourceKey", "Issuer GlobalID for the footprint feature"),
                  "NAME": ("building.name", "Publisher Building Name on the footprint feature"),
                  "geometry": ("building.geometry", "Polygon outline on ATLAS Building Footprints")},
        negative={"Max_Height": "Reported maximum height, not a field name or identifier",
                  "last_edited_date": "Edit timestamp, not a building name"},
        unknown={"OBJECTID": "Service row OID stability across extracts not established"},
        notes="Five of five queried named polygons have distinct GlobalID strings. Names and outlines do not establish property rights or surveyed locations.")
    gnwt_source["permission"]["trainingEligible"] = False
    gnwt_source["permission"]["basis"] = (
        "Official ATLAS catalogue explicitly lists Open Government Licence Northwest Territories and unrestricted access; "
        "the referenced OGL permits lawful reuse with attribution. This is positive licence evidence, not a finding of absent rights. "
        "The catalogue describes the ATLAS website as a whole, while the earlier separate ATLAS_License_Agreement.pdf "
        "was not retrieved. Layer-specific applicability and any additional bulk-export terms remain unresolved."
    )
    gnwt_source["exclusionReason"] = "Unresolved layer-specific permission scope; no fit, calibration, evaluation or encoder input from this source."
    gnwt_source["split"] = "excluded"
    corpus["excludedSources"] = [gnwt_source]
    halifax = "https://services2.arcgis.com/11XBiaBYA9Ep0yNJ/ArcGIS/rest/services/Buildings/FeatureServer/0"
    corpus["sources"].append(add_arcgis_source(
        args.originals_dir, slug="halifax", family="halifax-building-polygons", split="evaluation",
        issuer="Halifax Regional Municipality", geography="Halifax, Nova Scotia, Canada",
        dataset_url="https://data-hrm.hub.arcgis.com/datasets/HRM::buildings-2",
        metadata_url=halifax + "?f=pjson",
        sample_url=halifax + "/query?where=FCODE%3D%27BLDG%27+AND+BLPOLY_ID+IS+NOT+NULL&outFields=%2A&orderByFields=OBJECTID&resultRecordCount=5&outSR=4326&f=geojson",
        permission_basis="Halifax Buildings open data; Halifax Open Government Licence; local offline evaluation only",
        permission_url="https://data-hrm.hub.arcgis.com/pages/open-data-licence",
        geometry_crs="Source layer EPSG:3857; unchanged GeoJSON response requested outSR=4326; FCODE=BLDG selects footprint class",
        positive={"GLOBALID": ("building.sourceKey", "Issuer GlobalID for this polygon feature"),
                  "geometry": ("building.geometry", "FCODE=BLDG building polygon footprint")},
        negative={"FCODE": "Polygon feature class, not a building name", "SOURCE": "Polygon capture source code",
                  "SACC": "Spatial accuracy class code", "Shape__Area": "Polygon area measure"},
        unknown={"BLPOLY_ID": "Polygon identifier may also be a usable source reference; not chosen as the single canonical key here",
                 "BL_ID": "Related building table identifier can cover multiple polygons; not the polygon source key",
                 "OBJECTID": "Service row OID stability across extracts not established"},
        notes="The polygon layer has no BL_NAME field. Building names live in related Buildings table; no name label or inferred join is created for this field-profile evaluation."))
    kitchener = "https://services1.arcgis.com/qAo1OsXi67t7XgmS/arcgis/rest/services/Building_Outlines/FeatureServer/0"
    corpus["sources"].append(add_arcgis_source(
        root, slug="kitchener", family="kitchener-building-outlines", split="evaluation",
        issuer="City of Kitchener", geography="Kitchener, Ontario, Canada",
        dataset_url="https://app2.kitchener.ca/appdocs/GISImages/GIS_Web_External/GIS_Metadata_Open_Data/Building_Outlines.html",
        metadata_url=kitchener + "?f=pjson",
        sample_url=kitchener + "/query?where=BUILDING%20IS%20NOT%20NULL%20AND%20BUILDING%20%3C%3E%20%27%27&outFields=*&orderByFields=OBJECTID&resultRecordCount=5&outSR=4326&f=geojson",
        permission_basis="City of Kitchener Open Government Licence permits analysis/adaptation; local offline evaluation only",
        permission_url="https://www.kitchener.ca/council-and-city-administration/data-and-maps/open-data-licence/",
        geometry_crs="Source layer EPSG:26917; unchanged GeoJSON response requested outSR=4326; source accuracy about +/-1 m, not a survey",
        positive={"BUILDING": ("building.name", "Publisher display field naming this building"),
                  "geometry": ("building.geometry", "Polygon at building base in Building_Outlines")},
        negative={"CATEGORY": "Building category classification, not its name",
                  "SUBCATEGORY": "Building subtype classification, not its name",
                  "LOCATION": "Location description, not the publisher building-name field"},
        unknown={"BUILDINGID": "Publisher numeric building ID; literal string source-key operation does not coerce numbers",
                 "OBJECTID": "Service row OID stability across extracts not established"},
        notes="Five named polygons; numeric BUILDINGID stays unknown for the literal string key target."))
    supporting = {
        "chesterfield-buildings": ["chesterfield.html"],
        "halifax-buildings": ["halifax.html", "halifax-licence-item.json"],
        "kitchener-buildings": ["kitchener.html", "kitchener-definitions.html"],
        "gnwt-buildings": ["gnwt-catalogue.json", "gnwt-license.html", "gnwt-service.json"],
    }
    rights_root = root / "rights-review"
    receipts = json.loads((rights_root / "acquisition.json").read_text(encoding="utf-8"))
    receipts += json.loads((rights_root / "acquisition-followup.json").read_text(encoding="utf-8"))
    receipts.append(json.loads((rights_root / "gnwt-license-receipt.json").read_text(encoding="utf-8")))
    by_name = {Path(item["file"]).name: item for item in receipts}
    for source in corpus["sources"] + corpus["excludedSources"]:
        source["supportingEvidence"] = []
        for name in supporting.get(source["id"], []):
            retained = by_name[name]
            support = receipt(args.originals_dir, f"desktop-ai06a/rights-review/{name}", retained["url"])
            if support["sha256"] != retained["sha256"] or support["bytes"] != retained["bytes"]:
                raise ValueError(f"rights evidence changed: {name}")
            support["acquiredAt"] = retained["acquiredAt"]
            source["supportingEvidence"].append(support)
    kitchener_source = next(item for item in corpus["sources"] if item["id"] == "kitchener-buildings")
    for field in kitchener_source["fields"]:
        if field["path"] == "properties.BUILDING":
            field["evidence"] = kitchener_source["datasetUrl"] + "#Building_Outlines"
            field["definition"] = "Issuer data dictionary, BUILDING row: Last known building name"
    for field in kitchener_source["excludedFields"]:
        if field["path"] == "properties.BUILDINGID":
            field["reason"] = "Issuer documents a permanent unique numeric building ID; unsupported by literal_identifier@1, which does not coerce JSON numbers."
            field["evidence"] = kitchener_source["datasetUrl"] + "#Building_Outlines"
    args.output_corpus.write_text(json.dumps(corpus, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    if args.output_proof:
        _, examples = load_examples(args.output_corpus, args.originals_dir)
        proof = input_proof(args.output_corpus, examples)
        with args.output_proof.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(proof, indent=2, sort_keys=True) + "\n")
    print(args.output_corpus)


if __name__ == "__main__":
    main()
