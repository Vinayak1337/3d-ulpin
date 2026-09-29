#!/usr/bin/env python3
"""Append reviewed V7/V8 training sources and freeze inputs without loading a model."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

from geo.usp_learning.corpus import _checked_file, input_proof, load_examples, sha256_file, wire_compatible_rows, wire_observation


V6_SHA256 = "d36d6c64fb1609e718f393f188249dffa653160f65383f5bb45d7ea7b28a9b16"
V6_PROOF_SHA256 = "1883102720f4a1933c8724c2dbeac9523ba52c0bde8d9069f7ee5172fb40daf6"
V7_SHA256 = "81773eaf350d96778bc59c8f0f61a0d66e66cf335edb1ec167dd2ce1efd718c7"
V7_PROOF_SHA256 = "b801b049abdea3f8c88bab8f5c72ef2916acf026ad5168fe45518e5c73259559"
KEY_PACK_SHA256 = "d908a440ff793e544bf4be6b645a3ce974d67faffba3763f2e854528c2f73785"
DIRECTORY = Path("desktop-ai06a/v7-sources")
# Pin the exact bytes reviewed for issuer identity, reuse terms and field semantics.
REVIEWED_FILES = {
    "cambridge-item.json": "7522007000fb74be993e45c86280ee6c8d0b70a7ec023854670085da94b00e48",
    "cambridge-service.json": "17f5715d08c484dd5b6df1d18b087bce032b452066949331f366e3fc85669489",
    "cambridge-layer.json": "b72a8e54bb2cb06b85541b95cada56426d960cddc6dbbba79c9cae2b5c7547f8",
    "cambridge-issuer.html": "e0e61b4b382d7c112488f86df270571590548a4e17bf06278ed7c348e3cc28a6",
    "cambridge-pddl.html": "d482b3e685c940170cea889e2f8700d2b11484b9dbd6df4c3d781f0c70c9253a",
    "cambridge-sample.json": "c0bb66ec072aeed06215607d134c5e8b15be1bf03ac02b5e4b0575da20e425a2",
    "oregon-item.json": "f6aeb285909dc5cc443da69c82edb3766e3419ce571b598e8564215e311ac68b",
    "oregon-service.json": "1b563442aeffa86076ecc2b4ad4d4d4cdf9141ab8b31238545e5f51b86eee147",
    "oregon-layer.json": "886f20700cc9a74f5fe349c13334c5d4553703b4d1317c4833e1953c10f3f676",
    "oregon-publisher.json": "ec8be946fb1aaa7ac4752232261f0240499cba83f4dee26b71975d3f4a09856e",
    "oregon-sample.json": "e5810ec518eb9bbe9f2a91f4a20727070f8653e30c8b5ff2e9df7952fe3727e4",
    "tweed-item.json": "c2bad50a1df8aca75acd0604ee397470583529789bde5253883c45d6ba62503b",
    "tweed-service.json": "611b302ff41171c6eab50bf6b44c325b6115b7f3019cd5331557ff2e3ff5ba87",
    "tweed-layer.json": "064539d15b61ca2c6ea246f488504f13faee865f0c36a8a8b10e3b7285508793",
    "tweed-publisher.json": "7347cc2a71537614d6647add22aec484189a92bb0ea7a5bdd532eabbd88b6c4e",
    "tweed-sample.json": "963c15784a363e50b282c82057e68397c37ff9279e9d8b48d9f60361f1f9e590",
    "usgs-wbd-service.json": "561a1c58281ff4be21b40f8c522a78ac160b271101a766aca6d50dd0789c699f",
    "usgs-wbd-layer-retry.json": "a4fafc083d8b55229539ddac1376a14d7196335ee6dfd4bc2ac02e62b44d09d7",
    "usgs-wbd-sample-by-id.json": "fe96830d0e10564c013a20ba93a26b769878b9326d02124134c23d91b640784a",
}


def retained(root: Path, name: str) -> dict:
    path = root / DIRECTORY / name
    acquisition = path.with_name(name + ".receipt.json")
    receipt = json.loads(acquisition.read_text(encoding="utf-8"))
    if (receipt.get("status") != 200 or "error" in receipt or receipt["file"] != name
            or receipt["sha256"] != REVIEWED_FILES[name]
            or path.stat().st_size != receipt["bytes"] or sha256_file(path) != receipt["sha256"]):
        raise ValueError(f"reviewed V7 source changed or acquisition failed: {name}")
    return {"file": (DIRECTORY / name).as_posix(),
            **{key: receipt[key] for key in ("url", "finalUrl", "acquiredAt", "bytes", "sha256")},
            "acquisitionReceiptSha256": sha256_file(acquisition)}


def add_source(root: Path, *, slug: str, source_id: str, family: str, issuer: str, geography: str,
               licence: str, basis: str, attribution: str, notes: str, geometry_type: str,
               positives: dict[str, tuple[str, str]], negatives: dict[str, str], unknown: dict[str, str]) -> dict:
    names = [name for name in REVIEWED_FILES if name.startswith(slug + "-")]
    evidence = {name: retained(root, name) for name in names}
    metadata_name = "usgs-wbd-layer-retry.json" if slug == "usgs-wbd" else slug + "-layer.json"
    sample_name = "usgs-wbd-sample-by-id.json" if slug == "usgs-wbd" else slug + "-sample.json"
    rights_name = slug + ("-service.json" if slug == "usgs-wbd" else "-item.json")
    metadata = json.loads((root / evidence[metadata_name]["file"]).read_text(encoding="utf-8"))
    sample = json.loads((root / evidence[sample_name]["file"]).read_text(encoding="utf-8"))
    features = sample.get("features", [])
    if (sample.get("type") != "FeatureCollection" or len(features) != 5
            or metadata["geometryType"] != "esriGeometry" + geometry_type
            or any(feature.get("geometry", {}).get("type") != geometry_type for feature in features)):
        raise ValueError(f"reviewed five-feature representation changed: {slug}")
    reviewed_names = list(positives) + list(negatives) + list(unknown)
    observed_names = {key for feature in features for key in feature["properties"]} | {"geometry"}
    if len(set(reviewed_names)) != len(reviewed_names) or set(reviewed_names) != observed_names:
        raise ValueError(f"every retained property needs one explicit label or exclusion: {slug}")
    indexes = {entry["name"]: i for i, entry in enumerate(metadata["fields"])}
    fields, excluded = [], []
    for name in reviewed_names:
        path = "geometry" if name == "geometry" else f"properties.{name}"
        observed = wire_observation(path, features)
        if name in unknown:
            excluded.append({"path": path, "decision": "unknown", "reason": unknown[name],
                             "evidence": evidence[metadata_name]["url"], "observedWire": observed})
            continue
        if name == "geometry":
            declared = metadata["geometryType"]
            locator = {"sourceField": name, "geometryTypePointer": "/geometryType"}
        else:
            declared = metadata["fields"][indexes[name]]["type"]
            locator = {"sourceField": name, "fieldPointer": f"/fields/{indexes[name]}"}
        target, definition = positives[name] if name in positives else (None, negatives[name])
        field = {"path": path, "target": target, "definition": definition,
                 "decision": "positive" if target else "negative", "declaredType": declared,
                 "observedWire": observed, "inputEvidence": locator,
                 "evidence": evidence[rights_name]["url"] + "#/description"}
        if target:
            compatible = wire_compatible_rows(target, path, features)
            if compatible != 5:
                raise ValueError(f"positive sample contains missing or incompatible values: {slug}:{name}")
            field["wireCompatibleRows"] = compatible
        fields.append(field)
    source_crs = metadata["extent"]["spatialReference"]
    return {
        "id": source_id, "family": family, "split": "train", "issuer": issuer, "geography": geography,
        "datasetUrl": evidence[rights_name]["url"], "acquiredAt": evidence[sample_name]["acquiredAt"],
        "sample": {**evidence[sample_name], "rows": 5}, "metadata": evidence[metadata_name],
        "supportingEvidence": [item for name, item in evidence.items() if name not in (sample_name, metadata_name)],
        "permission": {"trainingEligible": True, "productionEligible": False, "sarvamDerived": False,
                       "licence": licence, "url": evidence[rights_name]["url"] + "#/" +
                       ("serviceDescription" if slug == "usgs-wbd" else "licenseInfo"),
                       "basis": basis, "attribution": attribution,
                       "scope": "Bounded offline schema research on the retained publisher metadata and five-row sample"},
        "geometryCrs": f"Source EPSG:{source_crs.get('latestWkid', source_crs['wkid'])}; publisher query returns outSR=4326 GeoJSON",
        "representation": f"Five unchanged GeoJSON {geometry_type} features; no geometry derivation or rights inference",
        "labelOrigin": "Publisher definitions and literal wire checks; no learned predictions or external provider labels",
        "inputEvidence": {"format": "arcgis-layer-json", "titlePointer": "/name"},
        "fields": fields, "excludedFields": excluded, "sourceNotes": notes,
    }


def training_additions(root: Path) -> list[dict]:
    return [
        add_source(root, slug="cambridge", source_id="cambridge-municipal-buildings",
                   family="cambridge-municipal-building-points", issuer="City of Cambridge GIS",
                   geography="Cambridge, Massachusetts, United States", geometry_type="Point",
                   licence="Public Domain Dedication and License 1.0",
                   basis="The issuing city dictionary links this exact ArcGIS item; its licenseInfo designates PDDL 1.0. The retained PDDL permits database extraction and reuse for any purpose.",
                   attribution="City of Cambridge GIS, Municipal Buildings",
                   positives={"SITE_NAME": ("building.name", "Issuer dictionary and item description table: SITE_NAME is Name of building")},
                   negatives={"ADDRESS": "Issuer table: Facility address", "TYPE": "Issuer table: Type of facility"},
                   unknown={"OBJECTID": "Numeric row OID is unsupported by literal_identifier@1; stability is unestablished",
                            "GlobalID": "Identifies a municipal point, not a verified footprint feature; preserve the fixed source-key target scope",
                            "EditDate": "All five values are present null and the issuing table gives no definition",
                            "geometry": "Municipal building locations are points, unsupported by geojson_polygon@1"},
                   notes="Independent city-maintained municipal point schema, not the MassGIS footprint product. Names and two non-name text fields are scored. No join to footprints or conversion of point IDs is inferred. EditDate is null, not absent."),
        add_source(root, slug="oregon", source_id="oregon-state-government-buildings",
                   family="oregon-state-government-building-points", issuer="State of Oregon, OR_FRAMEWORK",
                   geography="Oregon, United States", geometry_type="Point",
                   licence="Publisher: Public Domain Information; Public Use",
                   basis="The State of Oregon ArcGIS organization publishes this exact item with Access Constraint None (Public Domain Information) and Use Constraint None (Public Use). This is a state-published legacy TGS/HSIP-derived source; original lineage is retained.",
                   attribution="State of Oregon, Oregon State Government Buildings; publisher-documented TGS/HSIP lineage",
                   positives={"NAME": ("building.name", "Publisher description identifies NAME as building name; the bounded query excludes its NO NAME and UNKNOWN sentinels")},
                   negatives={"ADDRESS": "Street address of the facility", "CITY": "City label, not building name",
                              "STATE": "State code", "ZIP": "Postal area code", "COUNTY": "County label",
                              "FIPS": "County geographic code", "NAICSDESCR": "NAICS activity classification description"},
                   unknown={"OBJECTID": "Numeric row OID is unsupported by literal_identifier@1",
                            "UNIQUE_ID": "Publisher Unique ID is a string for the point record; a stable one-to-one footprint identity is unestablished",
                            "geometry": "Government building or property locations are points, unsupported by geojson_polygon@1"},
                   notes="Publisher dates original records to 2007-2008; no currentness claim. Query selects five genuinely named records and omits telephone/contact fields. NO NAME means verified unnamed, UNKNOWN means unverified; neither is silently converted into a meaningful name. No source ID is coerced or relabelled as a footprint key."),
        add_source(root, slug="tweed", source_id="tweed-council-buildings", family="tweed-council-building-polygons",
                   issuer="Tweed Shire Council", geography="Tweed Shire, New South Wales, Australia", geometry_type="Polygon",
                   licence="Creative Commons Attribution (CC BY; publisher does not specify version)",
                   basis="The council item explicitly permits distribution, adaptation and building upon the material for commercial and non-commercial purposes with council attribution. Its ownership reservation is retained alongside that licence grant; this decision does not assert transfer of intellectual property rights.",
                   attribution="Tweed Shire Council, Council Buildings",
                   positives={"Building_Name": ("building.name", "Publisher description: Includes Building Name; layer display field is Building_Name"),
                              "geometry": ("building.geometry", "Polygon outline in the council-managed community buildings layer")},
                   negatives={"locality": "Locality label", "TIMESTAMP": "Published timestamp, not a building name or source key"},
                   unknown={"OBJECTID": "Numeric row OID is unsupported by literal_identifier@1",
                            "Asset_Name": "Could describe the same building asset; authoritative equivalence and key semantics are unestablished, so it is not a negative",
                            "OPEN_DATA": "All five values are present null with no publisher field definition"},
                   notes="Attribution retained; council disclaims accuracy/currentness and warns against financial/legal reliance. Asset_Name is ambiguous; OPEN_DATA is null, not absent. No string footprint key is established, and no official parcel identity or property right follows."),
        add_source(root, slug="usgs-wbd", source_id="usgs-wbd-subwatersheds", family="usgs-wbd-hydrologic-units",
                   issuer="U.S. Geological Survey", geography="United States; sampled hydrologic units in Iowa, Minnesota and Georgia",
                   geometry_type="Polygon", licence="USGS WBD service: no use constraints; open and non-proprietary",
                   basis="The official hydro.nationalmap.gov WBD service states Use Constraints None and that all data are open and non-proprietary. Metadata identifies USGS/USDA NRCS WBD lineage. Retain attribution and temporal/scale limitations.",
                   attribution="U.S. Geological Survey, Watershed Boundary Dataset; USDA NRCS lineage as documented by the service",
                   positives={}, negatives={"tnmid": "Identifier of a hydrologic-unit feature, not a building footprint",
                                           "huc12": "Twelve-digit hydrologic-unit code, not a building source key",
                                           "name": "Name of the subwatershed, not a building",
                                           "states": "State codes for the hydrologic unit",
                                           "globalid": "GlobalID of a watershed feature, not a building footprint",
                                           "geometry": "Hydrologic-unit polygon boundary, not a building outline"},
                   unknown={"objectid": "Service row OID is outside the selected semantic controls"},
                   notes="Independent real non-building controls include strings resembling names/keys and actual polygons. USGS refreshed the service in July 2026 but disclaims site-specific regulatory/currentness use. An initial full-order query returned HTTP 504; a bounded object-ID query returned five unchanged complete geometries without simplification. No building semantics are inferred from polygon type."),
    ]


def preserve_previous(previous: dict, current: dict, prior_proof: dict, proof: dict,
                      version: str, maximum: int) -> None:
    """Reject edits, family leakage or changed inputs in the accepted source prefix."""
    size = len(previous["sources"])
    if current["sources"][:size] != previous["sources"]:
        raise ValueError(f"{version} source objects, labels or splits changed")
    for key in ("targets", "featureVersion", "labelEncoding", "excludedSources"):
        if current.get(key) != previous.get(key):
            raise ValueError(f"{version} contract changed: {key}")
    if proof["fields"][:len(prior_proof["fields"])] != prior_proof["fields"]:
        raise ValueError(f"{version} exact publisher-only inputs changed")
    additions = current["sources"][size:]
    prior_families = {source["family"] for source in previous["sources"]}
    families = {source["family"] for source in additions}
    if (not 1 <= len(families) <= maximum or families & prior_families or len(families) != len(additions)
            or any(source["split"] != "train" for source in additions)):
        raise ValueError(f"new sources must be independent training families, at most {maximum}")


def preserve_v6(previous: dict, current: dict, prior_proof: dict, proof: dict) -> None:
    preserve_previous(previous, current, prior_proof, proof, "V6", 6)


def preserve_v7(previous: dict, current: dict, prior_proof: dict, proof: dict) -> None:
    preserve_previous(previous, current, prior_proof, proof, "V7", 2)


def footprint_key_additions(root: Path, output: Path, source_pack: Path) -> list[dict]:
    """Copy the eleven unchanged retained responses; curate four fields, never rows."""
    acquisition = source_pack / "acquisition-receipt.json"
    if sha256_file(acquisition) != KEY_PACK_SHA256:
        raise ValueError("requires the accepted SOURCE-KEY-01 acquisition receipt")
    resources = json.loads(acquisition.read_text(encoding="utf-8"))["resources"]
    if len(resources) != 11 or len({entry["file"] for entry in resources}) != 11:
        raise ValueError("accepted source pack resource count changed")
    for entry in resources:
        _checked_file(source_pack, entry)
    destination = output / "originals"
    destination.mkdir()
    receipts = {}
    for entry in resources:
        path = destination / entry["file"]
        with path.open("xb") as stream:
            stream.write((source_pack / entry["file"]).read_bytes())
        receipts[entry["file"]] = {**entry, "file": path.relative_to(root).as_posix(),
                                  "acquisitionReceiptSha256": KEY_PACK_SHA256}
    with (output / "acquisition-receipt.json").open("xb") as stream:
        stream.write(acquisition.read_bytes())
    bag_schema = json.loads((destination / "bag-schema.json").read_text(encoding="utf-8"))
    landing = json.loads((destination / "bag-landing.json").read_text(encoding="utf-8"))
    ign_metadata = json.loads((destination / "ign-dataset-metadata.json").read_text(encoding="utf-8"))
    if not any(link.get("rel") == "license" and link.get("href") ==
               "https://creativecommons.org/publicdomain/mark/1.0/deed.nl" for link in landing["links"]):
        raise ValueError("BAG publisher public-domain designation changed")
    if ign_metadata["license"] != "lov2":
        raise ValueError("IGN licence designation changed")
    sources = []
    for slug, source_id, family, issuer, geography in (
        ("bag", "nl-bag-pand", "kadaster-bag-pand", "Kadaster / PDOK", "Netherlands"),
        ("ign", "fr-ign-bdtopo-batiment", "ign-bdtopo-batiment", "Institut national de l'information géographique et forestière (IGN)", "Brittany, France"),
    ):
        sample_name, metadata_name = slug + "-sample.geojson", slug + ("-schema.json" if slug == "bag" else "-schema.xml")
        features = json.loads((destination / sample_name).read_text(encoding="utf-8"))["features"]
        geometry_type = "Polygon" if slug == "bag" else "MultiPolygon"
        if len(features) != 5 or any(feature["geometry"]["type"] != geometry_type for feature in features):
            raise ValueError("retained native sample shape changed")
        native_key = "identificatie" if slug == "bag" else "cleabs"
        keys = [feature["properties"][native_key] for feature in features]
        if (len(set(keys)) != 5 or not all(isinstance(key, str) and len(key) == (16 if slug == "bag" else 24) for key in keys)):
            raise ValueError("native key wire representation changed")
        schema_url = receipts[metadata_name]["url"]
        guide_url = receipts["ign-bdtopo-description.pdf"]["url"]
        labels = {"geometry": ("building.geometry", bag_schema["description"] if slug == "bag" else "Type de géométrie : MultiPolygone 3D",
                    schema_url + "#/properties/geometry" if slug == "bag" else guide_url + "#page=65")}
        if slug == "ign":
            labels.update(cleabs=("building.sourceKey", "Identifiant unique de l'objet.", guide_url + "#page=20"),
                          origine_du_batiment=(None, "Précise l'origine de la géométrie du Bâtiment ou Réservoir.", guide_url + "#page=65"))
        fields, excluded = [], []
        for name in [*sorted({key for feature in features for key in feature["properties"]}), "geometry"]:
            path = "geometry" if name == "geometry" else "properties." + name
            observed = wire_observation(path, features)
            if name not in labels:
                reason = "Outside this bounded curation; retained without a target label. Field presence or type alone does not establish one of the three target meanings."
                if slug == "bag" and name == "identificatie":
                    reason = "Issuer defines a unique native object identifier, but retained lifecycle stability wording describes the separate service UUID id. Native identificatie revision stability is unestablished for the fixed stable-key target; do not transfer the UUID claim."
                elif name == "identifiants_rnb":
                    reason = "Separate RNB references are not substituted for the native BD TOPO cleabs key; relationship and revision semantics are outside this curation."
                elif name == "identifiants_sources":
                    reason = f"{observed['nullCount']} of {len(features)} source-reference values are present null; remaining native values are preserved. These source references are not substituted for cleabs; exact relationship and revision semantics are outside this curation."
                excluded.append({"path": path, "decision": "unknown", "reason": reason,
                    "evidence": receipts["bag-identification-catalogue.html"]["url"] if slug == "bag" and name == "identificatie" else schema_url,
                    "observedWire": observed})
                continue
            target, definition, label_url = labels[name]
            source_field = "geometrie" if slug == "ign" and name == "geometry" else name
            locator = {"sourceField": source_field}
            if slug == "bag":
                locator["fieldPointer"] = "/properties/" + name
            declared = ("geometry-polygon" if slug == "bag" else "gml:MultiSurfacePropertyType") if name == "geometry" else "xsd:string"
            field = {"path": path, "target": target, "definition": definition,
                     "decision": "positive" if target else "negative", "declaredType": declared,
                     "observedWire": observed, "inputEvidence": locator, "evidence": label_url}
            if target:
                field["wireCompatibleRows"] = wire_compatible_rows(target, path, features)
                if field["wireCompatibleRows"] != 5:
                    raise ValueError("new positive lacks five compatible native values")
            fields.append(field)
        permission = {"trainingEligible": True, "productionEligible": False, "sarvamDerived": False,
            "scope": "Bounded offline foreign schema research from this retained sample; no model run or production qualification",
            "licence": "Public Domain Mark 1.0 (publisher status mark, not a licence grant)" if slug == "bag" else "Licence Ouverte / Open Licence 2.0",
            "url": receipts["bag-landing.json" if slug == "bag" else "ign-open-licence.html"]["url"],
            "basis": "Issuer marks this BAG data service public domain; local schema extraction and independent labels use that designated data, without importing rights from unrelated products." if slug == "bag" else "Issuer dataset metadata designates lov2; retained terms expressly permit extraction, transformation and derived information, with source/update-date attribution and no endorsement.",
            "attribution": "Kadaster / PDOK, BAG Pand; service snapshot 2026-09-29; https://api.pdok.nl/kadaster/bag/ogc/v2/" if slug == "bag" else "IGN, BD TOPO; dataset last modified 2026-09-25, live WFS snapshot 2026-09-29; https://www.data.gouv.fr/datasets/bd-topo-r; Licence Ouverte 2.0; no IGN endorsement",
        }
        sources.append({"id": source_id, "family": family, "split": "train", "issuer": issuer, "geography": geography,
            "datasetUrl": "https://api.pdok.nl/kadaster/bag/ogc/v2/" if slug == "bag" else "https://www.data.gouv.fr/datasets/bd-topo-r",
            "acquiredAt": receipts[sample_name]["acquiredAt"], "sample": {**receipts[sample_name], "rows": 5},
            "metadata": receipts[metadata_name], "supportingEvidence": [item for name, item in receipts.items() if name.startswith(slug + "-") and name not in (sample_name, metadata_name)],
            "permission": permission, "geometryCrs": "OGC CRS84 longitude/latitude; no vertical coordinate in the sample" if slug == "bag" else "WFS EPSG:4326 output, EPSG:3857 query bounds; native GeoJSON longitude/latitude/Z preserved; vertical datum unqualified",
            "representation": "Five unchanged native " + geometry_type + " features; no row multiplication, simplification, translation or reprojection",
            "sourceVersion": "Live OGC API v2 snapshot 2026-09-29; no frozen national release" if slug == "bag" else "BD TOPO v3.5 guide July 2026; live WFS snapshot 2026-09-29; dataset metadata modified " + ign_metadata["last_modified"],
            "labelOrigin": "Retained issuer definitions/schema and native wire checks; independent source-only candidate awaiting review",
            "inputEvidence": {"format": "ogc-json-schema", "titlePointer": "/title"} if slug == "bag" else {"format": "wfs-xsd", "featureElement": "batiment", "complexType": "batimentType"},
            "fields": fields, "excludedFields": excluded,
            "sourceNotes": "Pand is a registered building, not a parcel, floor or legal unit. Native identificatie keeps all leading zeros but remains unlabelled for missing lifecycle evidence. Top-level service UUID is a separate ID; no substitution." if slug == "bag" else "Guide pages 13/20 define unique Cleabs and preserve it for attribute/geometry edits, with delete/recreate, split and merge exceptions. Source revision remains part of identity. Pages 65/66 distinguish cadastral wall contours from aerial roof contours; all five sampled origins are Cadastre. MultiPolygon Z, heights, storey and dwelling counts do not qualify datum, measurements, floors, units or ownership. WFS service ids and RNB references remain distinct.",
        })
    return sources


def write_once(path: Path, value: dict) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--originals-dir", required=True, type=Path)
    parser.add_argument("--input-corpus", required=True, type=Path)
    parser.add_argument("--prior-proof", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--footprint-key-pack", type=Path, help="Use only the retained SOURCE-KEY-01 pack to append source-only V8")
    args = parser.parse_args()
    v8 = args.footprint_key_pack is not None
    prior_sha, prior_proof_sha = (V7_SHA256, V7_PROOF_SHA256) if v8 else (V6_SHA256, V6_PROOF_SHA256)
    version, prior_version = ("v8", "V7") if v8 else ("v7", "V6")
    if sha256_file(args.input_corpus) != prior_sha or sha256_file(args.prior_proof) != prior_proof_sha:
        parser.error(f"requires the accepted immutable {prior_version} corpus and exact input proof")
    previous, prior_examples = load_examples(args.input_corpus, args.originals_dir)
    prior_proof = json.loads(args.prior_proof.read_text(encoding="utf-8"))
    if input_proof(args.input_corpus, prior_examples) != prior_proof:
        raise ValueError(f"{prior_version} proof no longer replays exactly")
    corpus = copy.deepcopy(previous)
    corpus.update(schemaVersion="usp-field-mapping-corpus-v7", previousCorpusSha256=V6_SHA256,
                  scope="Offline foreign-source schema research; V7 is corpus/input freeze only; no model run authorized",
                  curationNotes="V7 appends four independent training families only: Cambridge/Oregon building names, Tweed building names/polygons, and USGS watershed wrong-target controls. Every V6 source object, split, label and exact input is preserved. Point IDs stay unknown because the fixed key target identifies footprint features. No new key-positive family, Indian training qualification, fit, inference, threshold selection, held-out scoring or promotion is claimed.")
    if v8:
        args.originals_dir, args.output_dir = args.originals_dir.resolve(), args.output_dir.resolve()
        if not args.output_dir.is_relative_to(args.originals_dir):
            raise ValueError("V8 output must be inside the existing originals root")
    args.output_dir.mkdir(parents=True, exist_ok=False)
    if v8:
        corpus.update(schemaVersion="usp-field-mapping-corpus-v8", previousCorpusSha256=V7_SHA256,
            scope="Offline foreign-source schema research; V8 source/input freeze only; no model run authorized",
            curationNotes="V8 preserves all 16 V7 source objects, labels, splits and 88 inputs. Two independent training families add BAG geometry and IGN Cleabs/geometry plus one geometry-origin negative. BAG native identifier lacks retained lifecycle evidence and stays unknown. Native publisher names/types only; no translated or reviewer-authored descriptions in profiles. No fit, inference, threshold selection, evaluation or promotion.")
        corpus["sources"].extend(footprint_key_additions(args.originals_dir, args.output_dir, args.footprint_key_pack))
    else:
        corpus["sources"].extend(training_additions(args.originals_dir))
    corpus_path = args.output_dir / f"learning-corpus-{version}-immutable.json"
    proof_path = args.output_dir / f"input-proof-{version}.json"
    write_once(corpus_path, corpus)
    _, examples = load_examples(corpus_path, args.originals_dir)
    proof = input_proof(corpus_path, examples)
    (preserve_v7 if v8 else preserve_v6)(previous, corpus, prior_proof, proof)
    write_once(proof_path, proof)
    counts = {}
    for split in ("train", "calibration", "evaluation", "diagnostic"):
        subset = [item for item in examples if item["split"] == split]
        counts[split] = {"families": len({item["family"] for item in subset}), "fields": len(subset),
                         "positives": sum(item["target"] is not None for item in subset),
                         "positiveFamiliesByTarget": {target["id"]: sorted({item["family"] for item in subset
                                                       if item["target"] == target["id"] and item["wireCompatibleRows"]})
                                                      for target in corpus["targets"]}}
    summary = {"schemaVersion": f"usp-training-coverage-input-freeze-{version}", "corpusSha256": sha256_file(corpus_path),
               "inputProofSha256": sha256_file(proof_path), "previousCorpusSha256": prior_sha,
               "previousInputProofSha256": prior_proof_sha, "preservedInputs": len(prior_examples),
               "newFamilies": [source["family"] for source in corpus["sources"][len(previous["sources"]):]],
               "counts": counts, "modelRun": "not_run", "heldOutScoring": "not_run",
               "gaps": ["Only IGN adds a footprint-key positive family; BAG native-key lifecycle stability remains unestablished" if v8 else "No additional footprint-key positive family; point IDs remain unknown",
                        "No qualified Indian named-building/string-key source acquired",
                        "Schema coverage is not model quality, runtime conversion or source accuracy qualification"]}
    write_once(args.output_dir / f"coverage-freeze-{version}.json", summary)
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
