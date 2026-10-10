"""Small immutable-file helpers shared by offline plan commands."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def pin(path: Path) -> dict[str, Any]:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return {"path": path.as_posix(), "bytes": path.stat().st_size, "sha256": digest.hexdigest()}


def write_json(path: Path, value: Any) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode()
    with path.open("xb") as stream:
        stream.write(data)
    return pin(path)


def require_fresh_directory(path: Path, allowed_root: Path) -> Path:
    path = path.resolve()
    if not path.is_relative_to(allowed_root.resolve()) or path.exists():
        raise ValueError("output_must_be_fresh_and_inside_owned_root")
    path.mkdir(parents=True)
    return path
