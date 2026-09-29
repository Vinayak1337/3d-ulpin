"""Pin intentional NET-01 clone relocations and the final one-field sample."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path("E:/BhuAayam-model-evaluation/20260929/net01-audit-20260930")
BASE = ROOT / "runtime/base"
VENV = ROOT / "runtime/lora-venv"
ORIGINAL_VENV = Path("E:/BhuAayam-model-evaluation/20260929/.venv-v8-lora")


def digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def main() -> None:
    prior = ROOT / "stage-verification.json"
    sample_proof = ROOT / "sample-proof.json"
    sample = json.loads(sample_proof.read_text(encoding="utf-8"))
    if digest(ROOT / "development/selected-inputs.json") != sample["sampleSha256"]:
        raise RuntimeError("one-field sample changed")
    if (ROOT / "development/scores.json").exists():
        raise RuntimeError("full saved score matrix remains in replay clone")
    if digest(VENV / "Scripts/python.exe") != digest(BASE / "python.exe"):
        raise RuntimeError("owned venv launcher is not the staged CPython executable")
    added = {}
    for name in ("python311.dll", "python3.dll", "vcruntime140.dll", "vcruntime140_1.dll"):
        left, right = digest(BASE / name), digest(VENV / "Scripts" / name)
        if left != right:
            raise RuntimeError(f"added DLL changed: {name}")
        added[name] = right
    replay = ROOT / "replay_net01.py"
    source = Path(__file__).with_name("replay_net01.py")
    if digest(replay) != digest(source):
        raise RuntimeError("staged replay code changed")
    data = {
        "preRelocationStageVerificationSha256": digest(prior),
        "sampleProofSha256": digest(sample_proof),
        "sampleSha256": sample["sampleSha256"],
        "originalUvTrampolineSha256": digest(ORIGINAL_VENV / "Scripts/python.exe"),
        "stagedCpythonLauncherSha256": digest(VENV / "Scripts/python.exe"),
        "addedDllSha256": added,
        "originalPyvenvConfigSha256": digest(ORIGINAL_VENV / "pyvenv.cfg"),
        "stagedPyvenvConfigSha256": digest(VENV / "pyvenv.cfg"),
        "originalRetainedPthSha256": digest(ORIGINAL_VENV / "Lib/site-packages/retained-qwen.pth"),
        "stagedRetainedPthSha256": digest(VENV / "Lib/site-packages/retained-qwen.pth"),
        "virtualenvStartupPySha256": digest(VENV / "Lib/site-packages/_virtualenv.py"),
        "replayScriptSha256": digest(replay),
        "originalSourceHashesPreservedIn": "stage-verification.json",
    }
    if "retained-site-packages" not in (VENV / "Lib/site-packages/retained-qwen.pth").read_text():
        raise RuntimeError("retained path was not relocated")
    path = ROOT / "final-stage.json"
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(data, stream, indent=2, sort_keys=True)
        stream.write("\n")
    print(json.dumps(data, indent=2))


if __name__ == "__main__":
    main()
