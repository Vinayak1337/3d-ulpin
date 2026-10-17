"""Copy retained tessdata assets into a new prefix; never replace an existing file."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[4]
RUNTIME = Path("E:/BhuAayam-data/runtime/ulpin-demo")
INSTALL = Path("E:/BhuAayam-data/task-data/desktop-ai04f-docling-tesseract/tesseract")
CACHE = (INSTALL.parent / "mamba-root/pkgs/https/conda.anaconda.org/conda-forge/win-64"
         / "tesseract-5.5.1-hfa586c3_2")
TARGET = RUNTIME / "tessdata-complete"
EVIDENCE = ROOT / "docs/evidence/gf-backend/k2f/prefix.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def copy_exact(source: Path, relative: str) -> dict[str, Any]:
    before = digest(source)
    target = TARGET / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("xb") as output:
        output.write(source.read_bytes())
    assert digest(target) == before == digest(source), "Source/copy hash changed"
    return {"file": relative, "source": source.as_posix(), "sha256": before, "bytes": target.stat().st_size}


def copy_configs() -> list[dict[str, Any]]:
    origin = INSTALL / "Library/share/tessdata"
    records = []
    for directory in ("configs", "tessconfigs"):
        sources = sorted(path for path in (origin / directory).rglob("*") if path.is_file())
        assert sources, "Retained configuration directory is empty"
        for source in sources:
            records.append(copy_exact(source, source.relative_to(origin).as_posix()))
    assert (TARGET / "configs/tsv").read_bytes() == (origin / "configs/tsv").read_bytes()
    return records


def copy_models() -> list[dict[str, Any]]:
    retained = json.loads((ROOT / "docs/evidence/gf-backend/k2b/tessdata-acquisition.json").read_bytes())
    original = RUNTIME / "tessdata"
    records = []
    for language in retained["languages"]:
        name = f"{language['language']}.traineddata"
        assert digest(original / name) == language["sha256"], "Retained language hash differs"
        records.append(copy_exact(original / name, name))
    osd = INSTALL / "share/tessdata/osd.traineddata"
    assert digest(osd) == digest(CACHE / "share/tessdata/osd.traineddata"), "Retained OSD copies differ"
    records.append(copy_exact(osd, "osd.traineddata"))
    records.append(copy_exact(original / "LICENSE", "LICENSE"))
    records.append(copy_exact(CACHE / "info/licenses/tesseract/LICENSE", "LICENSE.tesseract"))
    return records


def main() -> None:
    assert not TARGET.exists() and not EVIDENCE.exists(), "Prefix already prepared; do not overwrite or rerun"
    metadata = json.loads((CACHE / "info/index.json").read_bytes())
    assert metadata["name"] == "tesseract" and metadata["license"] == "Apache-2.0"
    TARGET.mkdir()
    records = copy_configs() + copy_models()
    evidence = {"createdAt": datetime.now(timezone.utc).isoformat(), "prefix": TARGET.as_posix(),
                "operation": "unchanged retained-file copies only", "downloadedBytes": 0,
                "retainedPackage": {"name": metadata["name"], "version": metadata["version"],
                                    "build": metadata["build"], "licence": metadata["license"]},
                "files": records, "sourceHashesRechecked": True, "oldPrefixModified": False,
                "retainedEnvironmentModified": False, "globalOcrConfigurationChanged": False,
                "catalogueChangeRequired": False, "catalogueReason": "No acquisition; retained OSD reused"}
    with EVIDENCE.open("x", encoding="utf-8") as output:
        output.write(json.dumps(evidence, separators=(",", ":")) + "\n")
    print(f"Prepared new complete prefix with {len(records)} unchanged retained files; no downloads.")


if __name__ == "__main__":
    main()
