"""Refresh only reviewed K2b producers and the native operation inventory."""
import hashlib
import json
from pathlib import Path


REVIEWED = [
    "apps/api/src/modules/intake/import-packages.controller.ts",
    "apps/api/src/modules/intake/wire-schemas.ts",
    "packages/contracts/src/canonical/building.ts",
    "packages/server/src/modules/registry/canonical-building.ts",
    "packages/server/src/modules/usp/ingestion/source-building-values.ts",
    "packages/server/src/modules/usp/ingestion/source-building-admission.test.ts",
]


def main() -> None:
    pin_file = Path("docs/api/source-pins.json")
    pins = json.loads(pin_file.read_text(encoding="utf-8"))
    for name in REVIEWED:
        contents = Path(name).read_bytes().replace(b"\r\n", b"\n")
        pins["sourceSha256"][name] = hashlib.sha256(contents).hexdigest()
    document = json.loads(Path("docs/api/openapi.json").read_text(encoding="utf-8"))
    methods = {"get", "post", "put", "patch", "delete", "head", "options"}
    pins["operations"] = sorted(
        f"{method.upper()} {path}"
        for path, operations in document["paths"].items()
        for method in operations if method in methods
    )
    pins["sourceSha256"] = dict(sorted(pins["sourceSha256"].items()))
    pin_file.write_text(json.dumps(pins, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Reviewed {len(REVIEWED)} K2b producers; {len(pins['operations'])} operations")


if __name__ == "__main__":
    main()
