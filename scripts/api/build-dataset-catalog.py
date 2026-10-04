#!/usr/bin/env python3
"""Build documentation metadata from retained source manifests; never import data."""
import argparse
from copy import deepcopy
from difflib import unified_diff
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "docs/api/datasets.json"

ASSET_SOURCE_FIELDS = (
    "id", "mediaType", "classification", "origin", "sourceVersion",
    "attribution", "permission", "reference", "dependencies", "provenance",
)
ASSET_GENERATED_FIELDS = {*ASSET_SOURCE_FIELDS, "content", "manifestVerification"}
# These reviewed annotations are authored in the published catalogue, not in
# issuing manifests. Delete a field there explicitly to retire it; a missing
# source/asset must not silently discard its reviewed history during generation.
# Their receipt-bound scopes stay historical, not qualification of updated bytes.
CURATED_ASSET_FIELDS = {
    "privateControlReviewEvidence", "currentPrivateReadEvidence",
    "privatePdfPacketEvidence", "privateRegionPreviewEvidence",
    "privateMultiRegionPdfPacketEvidence", "privateMultiRegionPdfNativeEvidence",
    "privateMultipleOriginalPdfPacketEvidence", "privateQueuedPdfPacketEvidence",
    "privatePdfEntryRecoveryEvidence", "privatePdfEntryProgressEvidence",
    "privatePdfBundleEvidence", "privateMixedPdfPacketEvidence",
}


def curated_assets(manifest, generated, published):
    current = {asset["id"]: asset for asset in generated}
    if len(current) != len(generated) or len({asset["id"] for asset in published}) != len(published):
        raise ValueError(f"Duplicate catalogue asset identity: {manifest}")
    for previous in published:
        unknown = previous.keys() - ASSET_GENERATED_FIELDS - CURATED_ASSET_FIELDS
        if unknown:
            raise ValueError(f"Unclassified catalogue fields: {manifest}/{previous['id']}: {sorted(unknown)}")
        annotations = previous.keys() & CURATED_ASSET_FIELDS
        if annotations and previous["id"] not in current:
            raise ValueError(f"Curated asset removed from manifest: {manifest}/{previous['id']}; review its history explicitly")
        for key in annotations:
            current[previous["id"]][key] = deepcopy(previous[key])
    return generated


def qualification(runtime, manifest, published):
    supported = {}
    for run in [runtime, *runtime.get("additionalRuns", [])]:
        observed = {key: entry["scope"] for key, entry in run["operations"].items()
                    if manifest in entry["sourceManifests"]}
        if observed:
            if run["receipt"] in supported:
                raise ValueError(f"Duplicate runtime receipt authority: {run['receipt']}")
            supported[run["receipt"]] = {
                "receipt": run["receipt"], "servedCodeCommit": run["servedCodeCommit"],
                "operations": observed, "environment": run["environment"],
                "qualification": run["qualification"], "unqualified": run["unqualified"],
            }
    # Published receipt references select accepted history. Runtime authority
    # supplies its current details, but newly appended observations do not
    # automatically qualify an existing source or expand its published scope.
    if published is None:
        selected = [runtime["receipt"]] if runtime["receipt"] in supported else []
    else:
        evidence = published.get("runtimeEvidence")
        selected = ([evidence["receipt"], *[item["receipt"] for item in evidence.get("additionalReceipts", [])]]
                    if evidence else [])
        if published.get("runtimeVerified") and not selected:
            raise ValueError(f"Published runtime qualification lacks receipt authority: {manifest}")
    if len(set(selected)) != len(selected):
        raise ValueError(f"Duplicate published runtime receipt: {manifest}")
    missing = set(selected) - supported.keys()
    if missing:
        raise ValueError(f"Published runtime receipt no longer supports {manifest}: {sorted(missing)}")
    evidence = [supported[receipt] for receipt in selected]
    if not evidence:
        return {"apiInstallation": "not-verified", "runtimeVerified": False}
    return {
        "apiInstallation": "verified-in-stopped-isolated-run", "runtimeVerified": True,
        "runtimeEvidence": {**evidence[0], **({"additionalReceipts": evidence[1:]} if len(evidence) > 1 else {})},
    }


def published_order(value, previous):
    """Keep review-friendly key order without retaining any previous values."""
    if isinstance(value, dict) and isinstance(previous, dict):
        keys = [key for key in previous if key in value] + [key for key in value if key not in previous]
        return {key: published_order(value[key], previous.get(key)) for key in keys}
    if isinstance(value, list) and isinstance(previous, list):
        return [published_order(item, previous[index] if index < len(previous) else None)
                for index, item in enumerate(value)]
    return value


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
    published = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.is_file() else {}
    previous_entries = [*published.get("packs", []), *published.get("retainedOfficialTestSources", [])]
    by_manifest = {entry["manifest"]: entry for entry in previous_entries}
    if len(by_manifest) != len(previous_entries):
        raise ValueError("Duplicate published source manifest identity")

    def source_qualification(manifest):
        return qualification(runtime, manifest, by_manifest.get(manifest))

    packs = []
    offline_reports = {
        "fixtures/usp/D1/single-roof/manifest.json": "docs/evidence/usp/cityjson-validity-handoff.md",
    }
    reference_reports = {
        "fixtures/usp/D1/single-roof/manifest.json": "docs/evidence/usp/cityjson-reference-evidence/manifest.json",
    }
    reference_enrollments = {
        "fixtures/usp/D1/single-roof/manifest.json": "docs/evidence/usp/reference-document-enrollment/manifest.json",
    }
    for file in sorted((ROOT / "fixtures/usp").glob("**/manifest.json")):
        raw = file.read_bytes()
        manifest = json.loads(raw)
        relative = file.relative_to(ROOT).as_posix()
        assets = []
        for asset in manifest["assets"]:
            # These remain statements from the linked manifest, not new permissions
            # or assertions that the API has installed the dataset.
            entry = {key: asset[key] for key in ASSET_SOURCE_FIELDS if key in asset}
            entry["content"] = checked_content(file, asset["content"])
            entry["manifestVerification"] = asset.get("verification", {})
            assets.append(entry)
        packs.append({
            "manifest": file.relative_to(ROOT).as_posix(), "manifestSha256": sha(raw),
            "packId": manifest["packId"], "profile": manifest["profile"],
            "version": manifest["version"], "description": manifest["description"],
            **source_qualification(relative),
            **({"offlineValidationEvidence": {
                "report": offline_reports[file.relative_to(ROOT).as_posix()],
                "reportSha256": sha((ROOT / offline_reports[file.relative_to(ROOT).as_posix()]).read_bytes().replace(b'\r\n', b'\n')),
                "reportHashScope": "crlf-to-lf",
            }} if file.relative_to(ROOT).as_posix() in offline_reports else {}),
            **({"referenceInterpretationEvidence": {
                "manifest": reference_reports[file.relative_to(ROOT).as_posix()],
                "manifestSha256": sha((ROOT / reference_reports[file.relative_to(ROOT).as_posix()]).read_bytes().replace(b'\r\n', b'\n')),
                "manifestHashScope": "crlf-to-lf",
                "scope": "Source-declared Dutch RD/NAP axes and metre units; issuer quality-field interpretation. Not independent object accuracy, API release binding or qualified transformation.",
                **({"documentEnrollment": {
                    "manifest": reference_enrollments[file.relative_to(ROOT).as_posix()],
                    "manifestSha256": sha((ROOT / reference_enrollments[file.relative_to(ROOT).as_posix()]).read_bytes().replace(b'\r\n', b'\n')),
                    "manifestHashScope": "crlf-to-lf",
                    "scope": "Two separate source-only cases with accepted literal reference-document parts. No attachment to D1, reviewed applicability, accuracy or admission qualification.",
                }} if file.relative_to(ROOT).as_posix() in reference_enrollments else {}),
            }} if file.relative_to(ROOT).as_posix() in reference_reports else {}),
            "missingCapabilities": manifest.get("missingCapabilities", []),
            "assets": curated_assets(relative, assets, by_manifest.get(relative, {}).get("assets", [])),
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
            **source_qualification(relative),
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
    document = {
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
    current_entries = {entry["manifest"]: entry for entry in [*packs, *retained]}
    for previous in previous_entries:
        if previous["manifest"] not in current_entries:
            if previous.get("runtimeEvidence") or any(asset.keys() & CURATED_ASSET_FIELDS for asset in previous.get("assets", [])):
                raise ValueError(f"Reviewed source removed: {previous['manifest']}; review its history explicitly")
            continue
        unknown = previous.keys() - current_entries[previous["manifest"]].keys()
        # Optional generated evidence belongs to the declared generator/source
        # mappings; every other unsupported extension needs an explicit owner.
        unknown -= {"offlineValidationEvidence", "referenceInterpretationEvidence", "documents"}
        if unknown:
            raise ValueError(f"Unclassified source metadata: {previous['manifest']}: {sorted(unknown)}")
    unknown = published.keys() - document.keys()
    if unknown:
        raise ValueError(f"Unclassified catalogue metadata: {sorted(unknown)}")
    return published_order(document, published)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--preview", action="store_true", help="Show the complete candidate diff without replacing the published catalogue")
    args = parser.parse_args()
    document = catalogue()
    rendered = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    if args.preview:
        previous = OUTPUT.read_text(encoding="utf-8") if OUTPUT.is_file() else ""
        print("".join(unified_diff(previous.splitlines(keepends=True), rendered.splitlines(keepends=True),
                                  fromfile="published datasets.json", tofile="candidate datasets.json")), end="")
        print("Dataset catalogue preview: " + ("unchanged" if previous == rendered else "changes above; published file untouched"))
    elif args.check:
        if not OUTPUT.is_file() or OUTPUT.read_text(encoding="utf-8") != rendered:
            raise SystemExit("Dataset catalogue changed; regenerate and review source metadata")
    else:
        OUTPUT.write_text(rendered, encoding="utf-8", newline="\n")
    print(f"Dataset catalogue: {len(document['packs'])} retained USP packs and {len(document['retainedOfficialTestSources'])} official NYC source manifests; available bytes verified, bounded runtime receipts linked separately")


if __name__ == "__main__":
    main()
