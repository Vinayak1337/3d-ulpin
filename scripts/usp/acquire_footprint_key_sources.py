"""Bounded exact-byte fetch/check for SOURCE-KEY-01 issuer evidence."""

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


SOURCES = {
    "bag-sample.geojson": "https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/items?limit=5",
    "bag-schema.json": "https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/schema?f=json",
    "bag-collection.json": "https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand?f=json",
    "bag-landing.json": "https://api.pdok.nl/kadaster/bag/ogc/v2/?f=json",
    "bag-identification-catalogue.html": "https://catalogus.kadaster.nl/bag/nl/page/Identificatie",
    "bag-pdok-publication.html": "https://www.pdok.nl/ogc-apis/-/article/basisregistratie-adressen-en-gebouwen-ba-1",
    "ign-sample.geojson": "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAME=BDTOPO_V3:batiment&COUNT=5&CRS=EPSG:4326&outputformat=application/json&bbox=-447003.741411712,6094782.887346813,-446392.2451854306,6095394.383573095,EPSG:3857",
    "ign-schema.xml": "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=DescribeFeatureType&TYPENAME=BDTOPO_V3:batiment",
    "ign-dataset-metadata.json": "https://www.data.gouv.fr/api/1/datasets/bd-topo-r/",
    "ign-open-licence.html": "https://www.data.gouv.fr/pages/legal/licences/etalab-2.0",
    "ign-bdtopo-description.pdf": "https://data.geopf.fr/annexes/ressources/documentation/DC_BDTOPO_3-5.pdf",
}

LIMIT = 50 * 1024 * 1024


def proof(path):
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
            size += len(chunk)
    return {"sha256": h.hexdigest(), "bytes": size}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--private-root", required=True, type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = args.private_root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    receipt_path = root / "acquisition-receipt.json"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8")) if receipt_path.exists() else {"schemaVersion": "source-key-acquisition/1", "resources": []}
    existing = {entry["file"]: entry for entry in receipt["resources"]}
    total = sum(entry["bytes"] for entry in receipt["resources"])

    for name, url in SOURCES.items():
        target = root / name
        if name in existing:
            assert target.is_file() and proof(target) == {k: existing[name][k] for k in ("sha256", "bytes")}
            assert existing[name]["url"] == url
            continue
        if args.check:
            raise FileNotFoundError(target)
        request = Request(url, headers={"User-Agent": "3D-ULPIN-SOURCE-KEY-01/1.0", "Accept-Encoding": "identity"})
        with urlopen(request, timeout=30) as response:
            if response.status != 200:
                raise RuntimeError(f"{name}: HTTP {response.status}")
            with target.open("xb") as output:
                while True:
                    chunk = response.read(min(1024 * 1024, LIMIT - total + 1))
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > LIMIT:
                        raise RuntimeError("50 MiB total download ceiling exceeded")
                    output.write(chunk)
            entry = {"file": name, "url": url, "acquiredAt": datetime.now(timezone.utc).isoformat(), "httpStatus": response.status, "mediaType": response.headers.get("Content-Type"), **proof(target)}
        receipt["resources"].append(entry)
        receipt_path.write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{name}: {entry['bytes']} bytes")
    print(f"verified {len(receipt['resources'])} resources, {total} bytes")


if __name__ == "__main__":
    main()
