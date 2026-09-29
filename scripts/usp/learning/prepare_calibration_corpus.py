#!/usr/bin/env python3
"""Apply the reviewed GNWT licence trace to immutable V5; preserve its other splits."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from geo.usp_learning.corpus import load_examples, sha256_file


V5_SHA256 = "bf8163172de050ee1bafa7618714ad080ba62b6f11eda0d82952f00b8771d9f3"
DESKTOP = Path("desktop-ai06a")


def retained_evidence(root: Path, folder: str, receipt_name: str, filename: str) -> dict:
    directory = root / DESKTOP / folder
    receipts = json.loads((directory / receipt_name).read_text(encoding="utf-8"))
    if not isinstance(receipts, list):
        receipts = [receipts]
    receipt, = [item for item in receipts
                if item["file"].replace("\\", "/").rsplit("/", 1)[-1] == filename]
    path = directory / filename
    if path.stat().st_size != receipt["bytes"] or sha256_file(path) != receipt["sha256"]:
        raise ValueError(f"reviewed GNWT evidence changed: {filename}")
    return {"file": (DESKTOP / folder / filename).as_posix(),
            **{key: receipt[key] for key in ("url", "acquiredAt", "bytes", "sha256")},
            "finalUrl": receipt.get("finalUrl", receipt["url"])}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--originals-dir", type=Path, required=True)
    parser.add_argument("--input-corpus", type=Path, required=True)
    parser.add_argument("--output-corpus", type=Path, required=True)
    args = parser.parse_args()
    if args.output_corpus.exists():
        parser.error("output exists; preserve historical corpus bytes")
    if sha256_file(args.input_corpus) != V5_SHA256:
        parser.error("curation requires the accepted immutable V5 corpus")
    corpus, _ = load_examples(args.input_corpus, args.originals_dir)
    source, = [item for item in corpus["excludedSources"] if item["id"] == "gnwt-buildings"]
    additions = [retained_evidence(args.originals_dir, *entry) for entry in (
        ("rights-review", "acquisition.json", "gnwt-atlas.html"),
        ("calibration-followup", "atlas-viewer-receipt.json", "atlas-viewer.json"),
        ("calibration-followup", "atlas-site-receipts.json", "atlas-site.json"),
        ("calibration-followup", "atlas-site-receipts.json", "atlas-desktop.json"),
        ("calibration-followup", "atlas-layer-trace-receipts.json", "atlas-map.json"),
        ("calibration-followup", "atlas-layer-trace-receipts.json", "atlas-export-workflow.json"),
        ("calibration-followup", "terms-followup-receipts.json", "catalogue-licences.json"),
        ("calibration-followup", "atlas-manual-receipt.json", "atlas-manual.pdf"),
    )]
    root = args.originals_dir / DESKTOP
    catalogue = json.loads((root / "rights-review/gnwt-catalogue.json").read_text(encoding="utf-8"))["result"]
    registry = json.loads((root / "calibration-followup/catalogue-licences.json").read_text(encoding="utf-8"))["result"]
    licence, = [item for item in registry if item["id"] == "nwt-tno"]
    if (catalogue["license_id"] != licence["id"] or catalogue["restrictions"] != "unrestricted"
            or catalogue["license_url"] != licence["url"] or not licence["domain_data"]):
        raise ValueError("GNWT catalogue designation differs from the reviewed licence")
    map_config = json.loads((root / "calibration-followup/atlas-map.json").read_text(encoding="utf-8"))
    service, = [item for item in map_config["mapServices"] if item["displayName"] == "ATLAS_Public"]
    layer, = [item for item in service["layers"] if item["nativeID"] == "8"]
    metadata = json.loads((args.originals_dir / source["metadata"]["file"]).read_text(encoding="utf-8"))
    if (metadata["id"] != 8 or layer["name"] != metadata["name"]
            or service["copyright"] != metadata["copyrightText"]
            or layer["displayField"] != metadata["displayField"]
            or not layer["description"].startswith(metadata["description"])
            or any(layer["fullExtent"][key] != metadata["extent"][key]
                   for key in ("xmin", "ymin", "xmax", "ymax"))):
        raise ValueError("ATLAS viewer layer does not match the retained building metadata")

    source["supportingEvidence"].extend(additions)
    source["permission"].update(
        trainingEligible=True,
        basis=("The official GNWT ATLAS dataset designation names OGL-NWT and unrestricted access. "
               "Its linked public viewer identifies ATLAS_Public layer 8 as Building Footprints, "
               "matching the retained service metadata and GNWT copyright. The issuing manual "
               "also lists this layer and describes download/service reuse. OGL-NWT permits lawful "
               "copying and adaptation with attribution, including this bounded offline schema "
               "calibration. No additional agreement appears in the reviewed download instructions."),
        licence="Open Government Licence Northwest Territories 1.0",
        licenceUrl=catalogue["license_url"],
        attribution=("Government of Northwest Territories, Land Management and Administration, "
                     "Department of Environment and Climate Change. Contient des renseignements "
                     "visés par la licence du gouvernement ouvert des Territoires du Nord-Ouest."),
    )
    source["permission"]["review"] = {
        "reviewedAt": "2026-09-29",
        "scope": "Retained five-feature Building Footprints response and publisher field metadata only; calibration only",
        "catalogueLocators": ["/result/license_id", "/result/license_url", "/result/restrictions", "/result/resources/0"],
        "viewerLayerLocator": f"/mapServices/{map_config['mapServices'].index(service)}/layers/{service['layers'].index(layer)}",
        "manualPdfPages": {"downloadInstructions": 15, "publishedServices": 19, "buildingLayerDescription": 21},
        "catalogueIsopen": catalogue["isopen"],
        "licenceRegistryConformance": {key: licence[key] for key in
                                       ("is_okd_compliant", "is_osi_compliant", "od_conformance", "osd_conformance")},
        "catalogueFlagInterpretation": "False catalogue/conformance flags are retained; permission rests on the explicit dataset designation and issuing licence text.",
        "historicalAgreement": "Previously mentioned ATLAS_License_Agreement.pdf remains unretrieved. The current manual gives no separate agreement step; no bulk export workflow was invoked.",
        "exclusions": ["Personal information, inaccessible records, unauthorized third-party rights and official symbols remain excluded by OGL-NWT.",
                       "Other viewer layers, third-party basemaps/imagery, private records and unrelated export products are outside this decision.",
                       "Approximate outlines do not establish surveyed positions, property rights or official identifiers. No endorsement is implied."],
    }
    source.pop("exclusionReason")
    source["split"] = "calibration"
    corpus["excludedSources"].remove(source)
    corpus["sources"].append(source)
    corpus["schemaVersion"] = "usp-field-mapping-corpus-v6"
    corpus["previousCorpusSha256"] = V5_SHA256
    corpus["curationNotes"] = (
        "V6 admits the retained GNWT source to calibration after tracing the OGL-NWT catalogue "
        "designation through the actual ATLAS viewer layer and issuing manual. Its original bytes, "
        "labels and publisher-only profiles are unchanged. Every V5 eligible family, label and split "
        "is unchanged: Halifax/Kitchener remain unopened evaluation; DC/SF remain observed diagnostics; "
        "Census supplies the retained non-building polygon calibration control. No numeric identity coercion."
    )
    with args.output_corpus.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(corpus, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write("\n")
    _, examples = load_examples(args.output_corpus, args.originals_dir)
    print(json.dumps({"corpus": str(args.output_corpus), "sha256": sha256_file(args.output_corpus),
                      "eligibleFamilies": len(corpus["sources"]), "scoredFields": len(examples)}))


if __name__ == "__main__":
    main()
