"""Retain only the first frozen V8 development field for NET-01 replay."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path("E:/BhuAayam-model-evaluation/20260929/net01-audit-20260930").resolve()
RUN = Path("E:/BhuAayam-data/task-data/ai-06a-learning/desktop-ai06a/v8-lora-01")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    selected = ROOT / "development/selected-inputs.json"
    scores = ROOT / "development/scores.json"
    original_selected = RUN / "selected-inputs.json"
    original_scores = RUN / "run/scores.json"
    if selected.resolve().parent != ROOT / "development" or scores.resolve().parent != ROOT / "development":
        raise RuntimeError("unexpected stage path")
    if digest(selected) != digest(original_selected) or digest(scores) != digest(original_scores):
        raise RuntimeError("owned full copies changed before reduction")
    old = json.loads(original_selected.read_text(encoding="utf-8"))
    if old["fields"][0]["split"] != "train" or len(old["prompts"]) < 3:
        raise RuntimeError("first development field changed")
    sample = {"fields": old["fields"][:1], "prompts": old["prompts"][:3], "targets": old["targets"]}
    encoded = (json.dumps(sample, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    proof = {"originalSelectedSha256": digest(original_selected),
             "originalScoresSha256": digest(original_scores), "fieldIndex": 0,
             "source": sample["fields"][0]["source"], "path": sample["fields"][0]["path"],
             "sampleSha256": hashlib.sha256(encoded).hexdigest(),
             "promptSha256": [hashlib.sha256(p.encode("utf-8")).hexdigest() for p in sample["prompts"]],
             "sampleFieldCount": 1, "samplePromptCount": 3}
    (ROOT / "sample-proof.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    selected.write_bytes(encoded)
    scores.unlink()  # Exact owned copy; original saved scores remain unchanged in RUN.
    if digest(selected) != proof["sampleSha256"] or scores.exists():
        raise RuntimeError("stage reduction failed")
    print(json.dumps(proof, indent=2))


if __name__ == "__main__":
    main()
