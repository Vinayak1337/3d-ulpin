"""Pre-relocation byte comparison for the owned NET-01 replay clone.

Run before replacing the uv trampoline or reducing selected inputs. The later
final-stage receipt records those deliberate owned-clone changes separately.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path("E:/BhuAayam-model-evaluation/20260929/net01-audit-20260930")
RUN = Path("E:/BhuAayam-data/task-data/ai-06a-learning/desktop-ai06a/v8-lora-01")
PAIRS = {
    "base": (Path("C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none"), ROOT / "runtime/base"),
    "retained": (Path("E:/BhuAayam-model-evaluation/20260929/.venv/Lib/site-packages"), ROOT / "runtime/retained-site-packages"),
    "extension": (Path("E:/BhuAayam-model-evaluation/20260929/.venv-v8-lora"), ROOT / "runtime/lora-venv"),
    "model": (Path("E:/BhuAayam-model-evaluation/20260929/qwen3-reranker-0.6b/e61197ed45024b0ed8a2d74b80b4d909f1255473"), ROOT / "model"),
    "adapter": (RUN / "run/adapter", ROOT / "development/adapter"),
    "selected": (RUN / "selected-inputs.json", ROOT / "development/selected-inputs.json"),
    "scores": (RUN / "run/scores.json", ROOT / "development/scores.json"),
    "reload": (RUN / "run/reload.json", ROOT / "development/reload.json"),
}
RELOCATED = {"extension": {"pyvenv.cfg", "Lib/site-packages/retained-qwen.pth"}}


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def files(path: Path) -> dict[str, Path]:
    if path.is_file():
        return {".": path}
    return {p.relative_to(path).as_posix(): p for p in path.rglob("*") if p.is_file()}


def verify(label: str, source: Path, clone: Path) -> dict:
    originals, copies = files(source), files(clone)
    if originals.keys() != copies.keys():
        raise RuntimeError(f"{label}: file set differs; missing={sorted(originals.keys()-copies.keys())[:5]}, extra={sorted(copies.keys()-originals.keys())[:5]}")
    aggregate = hashlib.sha256()
    relocated = {}
    total = 0
    for name, original in sorted(originals.items()):
        copy = copies[name]
        left, right = file_hash(original), file_hash(copy)
        if name in RELOCATED.get(label, set()):
            relocated[name] = {"sourceSha256": left, "cloneSha256": right,
                               "cloneText": copy.read_text(encoding="utf-8")}
        elif left != right:
            raise RuntimeError(f"{label}: bytes differ at {name}")
        total += copy.stat().st_size
        aggregate.update(name.encode("utf-8") + b"\0" + right.encode("ascii") + b"\n")
    return {"source": str(source), "clone": str(clone), "files": len(copies),
            "cloneBytes": total, "cloneTreeSha256": aggregate.hexdigest(), "relocated": relocated}


def main() -> None:
    receipt = {label: verify(label, source, clone) for label, (source, clone) in PAIRS.items()}
    path = ROOT / "stage-verification.json"
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(receipt, stream, indent=2, sort_keys=True)
        stream.write("\n")
    print(json.dumps({label: {key: result[key] for key in ("files", "cloneBytes", "cloneTreeSha256")}
                      for label, result in receipt.items()}, indent=2))


if __name__ == "__main__":
    main()
