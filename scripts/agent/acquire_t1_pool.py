"""Retain public issuing-portal HTML responses; never replace originals or manifests."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path("E:/BhuAayam-data/datasets/messy-india-pool")
SOURCES = (
    ("smc-building-stock", "buildings", "Departments/TownPlanningBuildingStatistics",
     "High-rise and commercial building counts by Surat zone"),
    ("smc-tax-recovery", "taxstatistics", "Departments/PropertyTaxRecoveryStatistics",
     "Surat property-tax demand and recovery by tax category and financial year"),
    ("smc-water-projects", "hydraulic", "Departments/HydraulicHome",
     "Surat water-supply project history across published years"),
    ("smc-sewage-plants", "sewageplants", "Departments/DrainageTreatmentPlants",
     "Surat sewage-treatment plant names and design capacities"),
    ("smc-water-charges", "watercharges", "Departments/HydraulicUserCharges",
     "Surat water/sewerage tariffs by carpet area, connection size and usage"),
)
EXCLUDED = ("smc-waste-collection", "wastestats", "Departments/SolidWasteManagementStatistics",
            "Surat solid-waste collection modes, vehicles, trips and daily quantities")


def retain_original(source: Path, family: str) -> dict[str, Any]:
    raw = source.read_bytes()
    if not raw or len(raw) > 10 * 1024 * 1024 or b"<table" not in raw.lower():
        raise ValueError("T1_POOL_RESPONSE_INVALID")
    sha256 = hashlib.sha256(raw).hexdigest()
    path = ROOT / "originals" / f"{family}-{sha256[:12]}.html"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if hashlib.sha256(path.read_bytes()).hexdigest() != sha256:
            raise ValueError("T1_POOL_ORIGINAL_CHANGED")
    else:
        with path.open("xb") as handle:
            handle.write(raw)
    return {"externalPath": path.as_posix(), "sha256": sha256, "bytes": len(raw)}


def retain_asset(input_dir: Path, family: str, discovery: str, route: str, title: str) -> dict[str, Any]:
    source = input_dir / f"t1-surat-{discovery}.html"
    original = retain_original(source, family)
    acquired = datetime.fromtimestamp(source.stat().st_mtime, timezone.utc).isoformat()
    return {
        "id": family, "family": family, "split": "pool", "title": title,
        "mediaType": "text/html", "issuer": "Surat Municipal Corporation",
        "url": f"https://www.suratmunicipal.gov.in/{route}", "acquiredAt": acquired,
        "acquisitionDateBasis": "Retained curl response modification time in UTC",
        "httpStatus": 200, "transport": "Observed curl HTTPS GET; no authentication or bypass",
        "original": original,
        "permission": {"state": "unconfirmed", "licence": None,
                       "note": "Public access; no explicit open licence verified. Internal test_only pool."},
        "geography": {"country": "IN", "state": "Gujarat", "city": "Surat"}, "crs": None,
        "privacy": "public municipal aggregate/infrastructure tables", "usage": "test_only",
        "familyRule": "One distinct source schema/topic, not one family per table or year.",
    }


def acquisition_gaps() -> list[dict[str, Any]]:
    return [
        {"portal": "Pune", "code": "CAPTCHA_PERSONAL_DETAILS_REQUIRED", "decision": "skip"},
        {"portal": "Kerala RERA", "code": "HTTP_503", "decision": "skip"},
        {"portal": "Tamil Nadu RERA", "code": "HTTP_403", "decision": "skip"},
        {"portal": "Surat guessed routes", "code": "HTTP_404",
         "hypothesis": "Public homepage links resolve where guessed department slugs do not.",
         "result": "Published issuer links resolved; no failing route repeated."},
        {"portal": "Surat solid waste", "code": "NATIVE_HTML_LIMIT",
         "hypothesis": "Selecting one publisher table avoids the whole-page cell limit.",
         "result": "Selected table also exceeds 2000 cells; preserve limits and original, exclude profile.",
         "next": "Use distinct municipal water-tariff schema instead; no further limit retries."},
        {"portal": "Bihar project list", "code": "UnicodeEncodeError_cp1252",
         "result": "ASCII JSON transport round-trips Unicode; source bytes unchanged."},
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_dir", type=Path, help="Directory containing observed HTTP 200 curl responses")
    parser.add_argument("--manifest-name", default="manifest-v2.json")
    args = parser.parse_args()
    if Path(args.manifest_name).name != args.manifest_name:
        raise ValueError("T1_MANIFEST_NAME_INVALID")
    manifest = {
        "task": "T1-prep", "assets": [retain_asset(args.input_dir, *source) for source in SOURCES],
        "excludedAssets": [dict(retain_asset(args.input_dir, *EXCLUDED), profileStatus="NATIVE_HTML_LIMIT")],
        "gaps": acquisition_gaps(), "supersedesForPreparation": "manifest.json",
    }
    with (ROOT / args.manifest_name).open("x", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps({"poolFamilies": len(manifest["assets"]), "manifest": str(ROOT / args.manifest_name)}))


if __name__ == "__main__":
    main()
