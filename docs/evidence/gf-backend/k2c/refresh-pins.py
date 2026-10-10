"""Refresh reviewed native producer hashes using the published LF hash scope."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def main() -> None:
    target = ROOT / "docs/api/source-pins.json"
    pins = json.loads(target.read_text(encoding="utf-8"))
    assert pins["producerHashScope"] == "crlf-to-lf"
    changed: list[dict[str, str]] = []
    for name, previous in pins["sourceSha256"].items():
        current = digest(ROOT / name)
        if current != previous:
            changed.append({"producer": name, "before": previous, "after": current})
            pins["sourceSha256"][name] = current
    target.write_text(json.dumps(pins, indent=2) + "\n", encoding="utf-8")
    receipt = ROOT / "docs/evidence/gf-backend/k2c/pins-review.json"
    receipt.write_text(json.dumps({"hashScope": "crlf-to-lf", "reviewed": changed}) + "\n", encoding="utf-8")
    print(f"Refreshed {len(changed)} reviewed producer pins.")


if __name__ == "__main__":
    main()
