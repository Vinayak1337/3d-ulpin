#!/usr/bin/env python3
"""Append the reviewed V7 training families and freeze inputs without loading a model."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

from geo.usp_learning.corpus import input_proof, load_examples, sha256_file, wire_compatible_rows, wire_observation


V6_SHA256 = "d36d6c64fb1609e718f393f188249dffa653160f65383f5bb45d7ea7b28a9b16"
V6_PROOF_SHA256 = "1883102720f4a1933c8724c2dbeac9523ba52c0bde8d9069f7ee5172fb40daf6"
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


def preserve_v6(previous: dict, current: dict, prior_proof: dict, proof: dict) -> None:
    """Reject edits, family leakage or changed encoder inputs in the accepted V6 prefix."""
    size = len(previous["sources"])
    if current["sources"][:size] != previous["sources"]:
        raise ValueError("V6 source objects, labels or splits changed")
    for key in ("targets", "featureVersion", "labelEncoding", "excludedSources"):
        if current.get(key) != previous.get(key):
            raise ValueError(f"V6 contract changed: {key}")
    if proof["fields"][:len(prior_proof["fields"])] != prior_proof["fields"]:
        raise ValueError("V6 exact publisher-only inputs changed")
    additions = current["sources"][size:]
    prior_families = {source["family"] for source in previous["sources"]}
    families = {source["family"] for source in additions}
    if (not 1 <= len(families) <= 6 or families & prior_families or len(families) != len(additions)
            or any(source["split"] != "train" for source in additions)):
        raise ValueError("new sources must be independent training families, at most six")


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
    args = parser.parse_args()
    if sha256_file(args.input_corpus) != V6_SHA256 or sha256_file(args.prior_proof) != V6_PROOF_SHA256:
        parser.error("requires the accepted immutable V6 corpus and exact input proof")
    previous, prior_examples = load_examples(args.input_corpus, args.originals_dir)
    prior_proof = json.loads(args.prior_proof.read_text(encoding="utf-8"))
    if input_proof(args.input_corpus, prior_examples) != prior_proof:
        raise ValueError("V6 proof no longer replays exactly")
    corpus = copy.deepcopy(previous)
    corpus.update(schemaVersion="usp-field-mapping-corpus-v7", previousCorpusSha256=V6_SHA256,
                  scope="Offline foreign-source schema research; V7 is corpus/input freeze only; no model run authorized",
                  curationNotes="V7 appends four independent training families only: Cambridge/Oregon building names, Tweed building names/polygons, and USGS watershed wrong-target controls. Every V6 source object, split, label and exact input is preserved. Point IDs stay unknown because the fixed key target identifies footprint features. No new key-positive family, Indian training qualification, fit, inference, threshold selection, held-out scoring or promotion is claimed.")
    corpus["sources"].extend(training_additions(args.originals_dir))
    args.output_dir.mkdir(parents=True, exist_ok=False)
    corpus_path = args.output_dir / "learning-corpus-v7-immutable.json"
    proof_path = args.output_dir / "input-proof-v7.json"
    write_once(corpus_path, corpus)
    _, examples = load_examples(corpus_path, args.originals_dir)
    proof = input_proof(corpus_path, examples)
    preserve_v6(previous, corpus, prior_proof, proof)
    write_once(proof_path, proof)
    counts = {}
    for split in ("train", "calibration", "evaluation", "diagnostic"):
        subset = [item for item in examples if item["split"] == split]
        counts[split] = {"families": len({item["family"] for item in subset}), "fields": len(subset),
                         "positives": sum(item["target"] is not None for item in subset),
                         "positiveFamiliesByTarget": {target["id"]: sorted({item["family"] for item in subset
                                                       if item["target"] == target["id"] and item["wireCompatibleRows"]})
                                                      for target in corpus["targets"]}}
    summary = {"schemaVersion": "usp-training-coverage-input-freeze-v7", "corpusSha256": sha256_file(corpus_path),
               "inputProofSha256": sha256_file(proof_path), "previousCorpusSha256": V6_SHA256,
               "previousInputProofSha256": V6_PROOF_SHA256, "preservedInputs": len(prior_examples),
               "newFamilies": [source["family"] for source in corpus["sources"][len(previous["sources"]):]],
               "counts": counts, "modelRun": "not_run", "heldOutScoring": "not_run",
               "gaps": ["No additional footprint-key positive family; point IDs remain unknown",
                        "No qualified Indian named-building/string-key source acquired",
                        "Schema coverage is not model quality, runtime conversion or source accuracy qualification"]}
    write_once(args.output_dir / "coverage-freeze-v7.json", summary)
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
