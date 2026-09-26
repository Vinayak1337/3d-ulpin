#!/usr/bin/env python3
"""Build documentation metadata from retained source manifests; never import data."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "docs/api/datasets.json"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked_content(manifest_path, content):
    result = dict(content)
    result["repositoryBytesVerified"] = False
    if content.get("state") != "available":
        return result
    file = (manifest_path.parent / content["path"]).resolve()
    if not file.is_relative_to(ROOT):
        raise ValueError("An available catalogue asset must remain inside this repository")
    data = file.read_bytes()
    if sha(data) != content["sha256"] or len(data) != content["bytes"]:
        raise ValueError(f"Source integrity mismatch: {file.relative_to(ROOT)}")
    result["repositoryPath"] = str(file.relative_to(ROOT))
    result["repositoryBytesVerified"] = True
    return result


def catalogue():
    runtime = json.loads((ROOT / 'docs/api/runtime-qualification.json').read_text())

    def qualification(manifest):
        observed = {key: entry['scope'] for key, entry in runtime['operations'].items()
                    if manifest in entry['sourceManifests']}
        if not observed:
            return {"apiInstallation": "not-verified", "runtimeVerified": False}
        return {"apiInstallation": "verified-in-stopped-isolated-run", "runtimeVerified": True,
                "runtimeEvidence": {"receipt": runtime['receipt'], "servedCodeCommit": runtime['servedCodeCommit'],
                                    "operations": observed, "environment": runtime['environment'],
                                    "qualification": runtime['qualification'], "unqualified": runtime['unqualified']}}

    packs = []
    for file in sorted((ROOT / "fixtures/usp").glob("**/manifest.json")):
        raw = file.read_bytes()
        manifest = json.loads(raw)
        assets = []
        for asset in manifest["assets"]:
            # These remain statements from the linked manifest, not new permissions
            # or assertions that the API has installed the dataset.
            entry = {key: asset[key] for key in (
                "id", "mediaType", "classification", "origin", "sourceVersion",
                "attribution", "permission", "reference", "dependencies", "provenance"
            ) if key in asset}
            entry["content"] = checked_content(file, asset["content"])
            entry["manifestVerification"] = asset.get("verification", {})
            assets.append(entry)
        packs.append({
            "manifest": str(file.relative_to(ROOT)), "manifestSha256": sha(raw),
            "packId": manifest["packId"], "profile": manifest["profile"],
            "version": manifest["version"], "description": manifest["description"],
            **qualification(str(file.relative_to(ROOT))),
            "missingCapabilities": manifest.get("missingCapabilities", []),
            "assets": assets,
        })
    retained = []
    for relative, source_key, hash_key in (
        ("fixtures/real-nyc/provenance.json", "originalFile", "originalSha256"),
        ("fixtures/real-area/manifest.json", "sourceFile", "sourceSha256"),
    ):
        file = ROOT / relative
        raw = file.read_bytes()
        manifest = json.loads(raw)
        original = file.parent / manifest[source_key]
        content = {"state": "available", "path": manifest[source_key],
                   "sha256": manifest[hash_key], "bytes": original.stat().st_size}
        retained.append({
            "manifest": relative, "manifestSha256": sha(raw),
            "issuer": manifest["provider"],
            "datasetUrl": manifest.get("datasetUrl", manifest.get("dataset")),
            "originalUrl": manifest.get("originalDownload"),
            "terms": manifest.get("license", {"reference": manifest.get("terms")}),
            "acquiredAt": manifest.get("retrievedAt", manifest.get("retrievedOn")),
            "content": checked_content(file, content),
            "geography": "New York City, United States",
            **qualification(relative),
            "limitations": manifest.get("limitations", [manifest.get("snapshotNote")]),
        })
    return {
        "schemaVersion": "ulpin-api-dataset-catalog/1",
        "purpose": "Source metadata for API integration; not installed records or permission grants.",
        "guide": "docs/api/real-sources.md",
        "availabilityMeaning": "available refers to checked repository bytes; unavailable may mean retained outside Git. Neither proves an API import.",
        "qualification": "Official provenance, permitted use, reference quality and runtime support are separate. Community OSM and research samples are not Indian official property records.",
        "packs": packs, "retainedOfficialTestSources": retained,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    document = catalogue()
    rendered = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_text() != rendered:
            raise SystemExit("Dataset catalogue changed; regenerate and review source metadata")
    else:
        OUTPUT.write_text(rendered)
    print(f"Dataset catalogue: {len(document['packs'])} retained USP packs and {len(document['retainedOfficialTestSources'])} official NYC source manifests; available bytes verified, bounded runtime receipts linked separately")


if __name__ == "__main__":
    main()
