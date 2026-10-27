"""Independent place envelopes and declaration-only checks; no large-file feature parsing."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

from pyproj import CRS

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "services/geo"))
from geo.area import _geojson_crs
from geo.gis_inspection import inspect_gis


def contains(outer: list[float], inner: list[float]) -> bool:
    return outer[0] <= inner[0] <= inner[2] <= outer[2] and outer[1] <= inner[1] <= inner[3] <= outer[3]


def large_declarations() -> list[dict]:
    receipt = json.loads((ROOT / "docs/evidence/gf1/da1/result.json").read_text())
    results = []
    for asset in receipt["assets"]:
        path = Path(asset["path"])
        if path.suffix != ".geojson":
            continue
        with path.open("rb") as original:
            head = original.read(64 * 1024)
        text = head.decode("utf-8-sig", errors="strict")
        match = re.search(r'"crs"\s*:\s*', text)
        features = re.search(r'"features"\s*:\s*\[', text)
        assert match and features and match.start() < features.start()
        member, end = json.JSONDecoder().raw_decode(text[match.end():])
        assert match.end() + end < features.start()
        reference, name = _geojson_crs({"crs": member})
        results.append({"path": str(path), "headBytesRead": len(head),
                        "headSha256": hashlib.sha256(head).hexdigest(), "member": member,
                        "answer": "accepted declared two-dimensional horizontal CRS",
                        "sourceCrs": ":".join(reference.to_authority()),
                        "crsEvidence": f"Declared in the file's crs member: `{name}`",
                        "scope": "Inspection's shared declaration check only; "
                                 "no features framed, parsed or normalized."})
    assert len(results) == 2
    return results


def public_page() -> dict:
    url = "https://open.niagarafalls.ca/datasets/f657095d520a421a93f0eec753027c29_0"
    with urlopen(Request(url, headers={"User-Agent": "BhuAayam local source verification"}), timeout=30) as reply:
        raw = reply.read(1024 * 1024 + 1)
        assert len(raw) <= 1024 * 1024
        return {"url": url, "status": reply.status, "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
                "finding": "Static dataset page is an application shell; no dataset geographic extent stated there."}


def small_inspection() -> dict:
    path = Path("E:/BhuAayam-data/datasets/map-formats/niagara-falls/"
                "Niagara_Falls_Condominiums_7254610803234545967.geojson")
    raw = path.read_bytes()
    result = inspect_gis({"base64": base64.b64encode(raw).decode("ascii")})
    assert result["featureCount"] == 155
    assert result["sourceCrs"] == "EPSG:2958"
    return result


def main() -> None:
    runtime = json.loads((ROOT / "docs/evidence/gf1/cr1/runtime.json").read_text())
    extent = runtime["runtime"]["evidence"]["result"]["geographicExtent"]
    area = CRS.from_epsg(2958).area_of_use
    bounds = [area.west, area.south, area.east, area.north]
    page = public_page()
    item_path = Path("E:/BhuAayam-data/datasets/map-formats/discovery/da5/condo-item.response")
    item_bytes = item_path.read_bytes()
    item = json.loads(item_bytes)
    assert hashlib.sha256(item_bytes).hexdigest() == "d39f67f19283fe779c112077cd012f0a564ba300f787c2587f6cf2deeb694715"
    item_extent = [*item["extent"][0], *item["extent"][1]]
    result = {"method": "Compare stored geographic extent to declared CRS area of use; no coordinate transform called.",
              "geographicExtent": extent, "areaOfUse": {"name": area.name, "bounds": bounds,
                                                        "contains": contains(bounds, extent)},
              "strength": "Area-of-use containment alone is weaker than dataset extent; "
                          "a world-wide CRS would not detect swapped axes.",
              "publisherPage": page,
              "publisherItem": {"path": str(item_path), "geographicExtent": item_extent,
                                "contains": contains(item_extent, extent),
                                "url": "https://www.arcgis.com/sharing/rest/content/items/"
                                       "f657095d520a421a93f0eec753027c29?f=json",
                                "basis": "DA5 retained public publisher item metadata; "
                                         "ArcGIS item.extent is longitude/latitude."},
              "largeDeclarationChecks": large_declarations(), "smallFileInspection": small_inspection()}
    print(json.dumps(result))
    assert contains(bounds, extent)
    assert contains(item_extent, extent)


if __name__ == "__main__":
    main()
