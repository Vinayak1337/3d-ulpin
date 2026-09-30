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
    result["repositoryPath"] = file.relative_to(ROOT).as_posix()
    result["repositoryBytesVerified"] = True
    return result


def catalogue():
    runtime = json.loads((ROOT / 'docs/api/runtime-qualification.json').read_text(encoding="utf-8"))

    def qualification(manifest):
        evidence = []
        for run in [runtime, *runtime.get('additionalRuns', [])]:
            observed = {key: entry['scope'] for key, entry in run['operations'].items()
                        if manifest in entry['sourceManifests']}
            if observed:
                evidence.append({"receipt": run['receipt'], "servedCodeCommit": run['servedCodeCommit'],
                                 "operations": observed, "environment": run['environment'],
                                 "qualification": run['qualification'], "unqualified": run['unqualified']})
        if not evidence:
            return {"apiInstallation": "not-verified", "runtimeVerified": False}
        return {"apiInstallation": "verified-in-stopped-isolated-run", "runtimeVerified": True,
                "runtimeEvidence": {**evidence[0], **({"additionalReceipts": evidence[1:]} if len(evidence) > 1 else {})}}

    packs = []
    offline_reports = {
        "fixtures/usp/D1/single-roof/manifest.json": "docs/evidence/usp/cityjson-validity-handoff.md",
    }
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
            "manifest": file.relative_to(ROOT).as_posix(), "manifestSha256": sha(raw),
            "packId": manifest["packId"], "profile": manifest["profile"],
            "version": manifest["version"], "description": manifest["description"],
            **qualification(file.relative_to(ROOT).as_posix()),
            **({"offlineValidationEvidence": {
                "report": offline_reports[file.relative_to(ROOT).as_posix()],
                "reportSha256": sha((ROOT / offline_reports[file.relative_to(ROOT).as_posix()]).read_bytes().replace(b'\r\n', b'\n')),
                "reportHashScope": "crlf-to-lf",
            }} if file.relative_to(ROOT).as_posix() in offline_reports else {}),
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
        # Publish the retained official text used by document intake, not just
        # the geometry asset in the same source manifest. Verify exact bytes.
        documents = [asset for asset in manifest.get('assets', [])
                     if asset['file'] == 'evidence/nyc-building-metadata.md']
        if documents:
            retained[-1]['documents'] = [{
                'originalUrl': asset['url'], 'acquiredAt': asset['retrievedAt'],
                'content': checked_content(file, {
                    'state': 'available', 'path': asset['file'],
                    'sha256': asset['sha256'], 'bytes': asset['byteLength']}),
                'purpose': 'Foreign official native-text extraction test; not property facts or an installed document.',
                'handoff': 'docs/evidence/usp/document-ingestion-handoff.md',
            } for asset in documents]
    learning_path = ROOT / "docs/api/learning-corpus.json"
    learning_raw = learning_path.read_bytes()
    learning = json.loads(learning_raw)
    local_sources = json.loads((ROOT / "docs/api/retained-local-datasets.json").read_text(encoding="utf-8"))
    return {
        "schemaVersion": "ulpin-api-dataset-catalog/1",
        "purpose": "Source metadata for API integration; not installed records or permission grants.",
        "guide": "docs/api/real-sources.md",
        "availabilityMeaning": "available refers to checked repository bytes; unavailable may mean retained outside Git. Neither proves an API import.",
        "qualification": "Official provenance, permitted use, reference quality and runtime support are separate. Community OSM and research samples are not Indian official property records.",
        "servingObservation": json.loads((ROOT / "docs/api/serving-observation.json").read_text(encoding="utf-8")),
        "packs": packs, "retainedOfficialTestSources": retained,
        # External originals are not reproducible repository assets. Preserve
        # their separately maintained acquisition metadata on every regeneration.
        "localDemoSources": [source for source in local_sources
                             if source.get("apiInstallation") == "local-opt-in-demo-only"],
        "retainedExternalSources": [source for source in local_sources
                                    if source.get("apiInstallation") != "local-opt-in-demo-only"],
        "offlineLearningCorpus": {
            "manifest": "docs/api/learning-corpus.json", "manifestSha256": sha(learning_raw.decode('utf-8').replace('\r\n', '\n').encode('utf-8')),
            "manifestHashScope": "UTF-8 metadata with LF line endings; retained source originals use exact-byte hashes.",
            "guide": "docs/api/learning.md", "scope": learning["scope"],
            "apiInstallation": "not-installed", "productionModelPromoted": False,
            "availability": "Originals retained outside Git; manifest pins are not repository-byte verification.",
            "sources": [{key: source[key] for key in (
                "id", "family", "split", "issuer", "geography", "datasetUrl", "acquiredAt",
                "sample", "metadata", "permission", "geometryCrs")}
                for source in learning["sources"]],
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    document = catalogue()
    rendered = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_text(encoding="utf-8") != rendered:
            raise SystemExit("Dataset catalogue changed; regenerate and review source metadata")
    else:
        OUTPUT.write_text(rendered, encoding="utf-8", newline="\n")
    print(f"Dataset catalogue: {len(document['packs'])} retained USP packs and {len(document['retainedOfficialTestSources'])} official NYC source manifests; available bytes verified, bounded runtime receipts linked separately")


if __name__ == "__main__":
    main()
