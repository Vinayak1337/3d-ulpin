"""Check DATA-LINK-01 metadata and retained private PDF bytes; never parses PDF truth."""

import argparse
import hashlib
import json
from pathlib import Path


REPO = Path(__file__).resolve().parents[3]
EVIDENCE = REPO / "docs/evidence/usp/association-sources"
D5 = REPO / "fixtures/usp/D5/gf0-public-plans-v1/manifest.json"
SOURCE_CHECK = REPO / "docs/evidence/usp/finale/GF-DATA/DATA-05/source-check.json"


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def file_proof(path: Path):
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    return {"sha256": digest.hexdigest(), "bytes": size}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--private-root", required=True, type=Path)
    parser.add_argument("--retained-root", type=Path)
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()

    manifest = read_json(EVIDENCE / "manifest.json")
    observations = read_json(EVIDENCE / "observations.json")
    catalogue = {asset["id"]: asset for asset in read_json(D5)["assets"]}
    historic = read_json(SOURCE_CHECK)["expectedActual"][0]["expected"]
    source_by_id = {source["id"]: source for source in manifest["sources"]}
    checked = []
    assert len(source_by_id) == len(manifest["sources"])

    for source in manifest["sources"]:
        asset = catalogue[source["id"]]
        assert asset["origin"]["url"] == source["url"]
        assert asset["provenance"]["original"] == {
            "sha256": source["sha256"], "bytes": source["bytes"]
        }
        assert asset["provenance"]["acquiredAt"] == source["firstAcquiredAt"]
        assert source["permissions"]["mlTraining"] == "unconfirmed"
        copy = args.private_root / source["privateCopy"]
        proof = file_proof(copy)
        assert proof == {"sha256": source["sha256"], "bytes": source["bytes"]}
        if args.retained_root:
            assert file_proof(args.retained_root / source["privateCopy"]) == proof
        historical_name = source["id"]
        assert historic[historical_name]["sha256"] == source["sha256"]
        assert historic[historical_name]["bytes"] == source["bytes"]
        checked.append({"id": source["id"], "privateCopy": source["privateCopy"], **proof})

    assert observations["status"] == "unreviewed"
    for observation in observations["observations"]:
        source = source_by_id[observation["sourceId"]]
        assert observation["sourceSha256"] == source["sha256"]
        assert observation["canonicalMatchState"] == "not_assessed"
        assert observation["reviewState"] == "unreviewed"
        assert observation["canonicalBuildingId"] is None
        assert observation["canonicalFloorIds"] == []
        assert observation["citations"]
        for citation in observation["citations"]:
            assert 1 <= citation["page"] <= historic[source["id"]]["pageCount"]
            assert citation["region"].strip() and citation["literalText"].strip()

    result = {
        "schemaVersion": "association-source-copy-check/1",
        "sourceManifest": "docs/evidence/usp/association-sources/manifest.json",
        "observations": len(observations["observations"]),
        "checked": checked,
        "checks": "D5/DATA-05 metadata, original and copied bytes, locator structure; visual meaning requires human review",
        "eligibility": "unreviewed; source-specific ML training permission unconfirmed",
    }
    if args.receipt:
        args.receipt.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
