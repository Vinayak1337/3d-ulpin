"""Check audit evidence paths without opening their contents."""
import json
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[3]
    audit = json.loads((root / "docs/evidence/m1/audit.json").read_text(encoding="utf-8"))
    paths = {item["path"] for row in audit["boxes"] for item in row["evidence"]}
    paths.update(item["path"] for item in audit["unsupportedClaims"])
    paths.update(item["path"] for item in audit["supportingReceipts"])
    missing = sorted(path for path in paths if not (root / path).is_file())
    print(f"{len(paths)} referenced paths checked; {len(missing)} missing")
    if missing:
        raise SystemExit("\n".join(missing))


if __name__ == "__main__":
    main()
