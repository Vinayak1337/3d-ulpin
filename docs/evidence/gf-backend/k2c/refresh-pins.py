"""Refresh reviewed native producer hashes using the published LF hash scope."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def refresh_operations(pins: dict) -> list[str]:
    document = json.loads((ROOT / "docs/api/openapi.json").read_text(encoding="utf-8"))
    methods = {"get", "post", "put", "patch", "delete", "head", "options"}
    current = {f"{method.upper()} {path}" for path, value in document["paths"].items()
               for method in value if method in methods}
    previous = set(pins["operations"])
    if not previous.issubset(current):
        raise ValueError("An established operation disappeared; review its disposition instead of masking it.")
    pins["operations"] = sorted(current)
    return sorted(current - previous)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--receipt", default="pins-review.json")
    parser.add_argument("--producer", action="append", default=[])
    args = parser.parse_args()
    receipt = ROOT / "docs/evidence/gf-backend/k2c" / Path(args.receipt).name
    if receipt.exists():
        raise FileExistsError("Preserve the prior pin review; choose a new receipt name.")
    target = ROOT / "docs/api/source-pins.json"
    pins = json.loads(target.read_text(encoding="utf-8"))
    assert pins["producerHashScope"] == "crlf-to-lf"
    for name in args.producer:
        if not name.endswith(".ts") or not name.startswith(("packages/", "apps/")) or ".." in name:
            raise ValueError("Only explicit reviewed TypeScript producers are admitted.")
        pins["sourceSha256"].setdefault(name, "")
    changed: list[dict[str, str]] = []
    for name, previous in pins["sourceSha256"].items():
        current = digest(ROOT / name)
        if current != previous:
            changed.append({"producer": name, "before": previous, "after": current})
            pins["sourceSha256"][name] = current
    additions = refresh_operations(pins)
    target.write_text(json.dumps(pins, indent=2) + "\n", encoding="utf-8")
    receipt.write_text(json.dumps({"hashScope": "crlf-to-lf", "reviewed": changed,
                                  "operationAdditions": additions}) + "\n", encoding="utf-8")
    print(f"Refreshed {len(changed)} reviewed producer pins.")


if __name__ == "__main__":
    main()
