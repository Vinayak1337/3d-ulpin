"""Copy and pin an isolated runtime/model/input stage for the single baseline."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "scripts/usp/learning"), str(REPO / "services/geo")]
import model_isolation as isolation
from geo.usp_learning.association.student import SETTINGS, SYSTEM_PROMPT

PYTHON_ROOT = Path("C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none")
PACKAGES = Path("E:/BhuAayam-model-evaluation/20260929/.venv/Lib/site-packages")
LOCK = Path("E:/BhuAayam-model-evaluation/20260929/requirements-resolved.txt")
CODE = ("scripts/usp/learning/model_isolation.py", "scripts/usp/security/appcontainer_audit.py",
        "scripts/usp/learning/association/association_student.py", "services/geo/geo/__init__.py",
        "services/geo/geo/usp_learning/__init__.py", "services/geo/geo/usp_learning/resources.py",
        "services/geo/geo/usp_learning/association/__init__.py", "services/geo/geo/usp_learning/association/student.py",
        "services/geo/geo/usp_learning/association/validation.py")


def stage(data_dir, model_dir):
    root = isolation.ASSOCIATION_STAGING_PARENT / ("baseline-" + uuid.uuid4().hex)
    if shutil.disk_usage(root.parent).free < 15 * 1024**3:
        raise RuntimeError("insufficient private staging disk headroom")
    root.mkdir()
    for name in (*isolation.READONLY, "outputs", "scratch", "state", "receipts"):
        (root / name).mkdir()
    files = {}
    copied = {"fileCount": 0, "bytes": 0}

    def copy(source, destination):
        if source.is_symlink():
            raise RuntimeError("source symlink refused: " + str(source))
        destination.parent.mkdir(parents=True, exist_ok=True)
        digest, count = hashlib.sha256(), 0
        with source.open("rb") as src, destination.open("xb") as dst:
            while block := src.read(8 * 1024**2):
                dst.write(block)
                digest.update(block)
                count += len(block)
        files[destination.relative_to(root).as_posix()] = digest.hexdigest()
        copied["fileCount"] += 1
        copied["bytes"] += count

    def tree(source, destination):
        for current, directories, names in os.walk(source, followlinks=False):
            directories[:] = [name for name in directories if name != "__pycache__"]
            for name in names:
                if Path(name).suffix not in (".pyc", ".pyo"):
                    path = Path(current) / name
                    copy(path, destination / path.relative_to(source))

    for name in ("python.exe", "python311.dll", "python3.dll", "vcruntime140.dll", "vcruntime140_1.dll", "LICENSE.txt"):
        copy(PYTHON_ROOT / name, root / "runtime" / name)
    for name in ("Lib", "DLLs"):
        tree(PYTHON_ROOT / name, root / "runtime" / name)
    tree(PACKAGES, root / "runtime/packages")
    copy(LOCK, root / "inputs/runtime-requirements-resolved.txt")
    print(json.dumps({"stage": str(root), "runtimeCopied": copied}), flush=True)
    receipt = json.loads((model_dir / "acquisition.json").read_bytes())
    for row in receipt["files"]:
        if Path(row["file"]).name != row["file"] or Path(row["file"]).suffix in (".bin", ".pt", ".pth", ".pkl", ".py"):
            raise RuntimeError("unsupported model file")
        copy(model_dir / row["file"], root / "model" / row["file"])
        if files["model/" + row["file"]] != row["sha256"]:
            raise RuntimeError("model acquisition pin drift")
    copy(model_dir / "acquisition.json", root / "inputs/model-acquisition.json")
    for relative in CODE:
        copy(REPO / relative, root / "code" / relative)
    input_names = {"input_batch": "development.json", "schema": "schema-v1.json", "family_freeze": "family-freeze.json"}
    for name in input_names.values():
        copy(data_dir / name, root / "inputs" / name)
    # Expectations remain outside the inference stage and prompt.
    freeze = {"version": "association-baseline-freeze/1", "settings": SETTINGS,
              "systemPromptSha256": hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest(),
              "model": receipt["model"], "modelRevision": receipt["revision"],
              "inputSha256": {key: files["inputs/" + name] for key, name in input_names.items()},
              "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
              "expectedClaimsSha256": isolation.sha(data_dir / "expectations.json"),
              "selection": "one complete and one naturally incomplete IFC case; one related development family",
              "promptSelection": "single frozen prompt; no prompt/threshold/parameter sweep", "fitPerformed": False,
              "evaluationAllowed": False, "canonicalAssociationQualified": False}
    freeze["inputSha256"]["model_receipt"] = files["inputs/model-acquisition.json"]
    isolation.write(root / "inputs/run-freeze.json", freeze)
    files["inputs/run-freeze.json"] = isolation.sha(root / "inputs/run-freeze.json")
    profile = {"schemaVersion": "usp-qwen-containment-v1", "root": str(root), "python": "runtime/python.exe",
               "packageRoots": ["runtime/packages"], "jobMemoryBytes": 6 * 1024**3, "timeoutSeconds": 600, "files": files}
    isolation.write(root / "profile.json", profile)
    command = [str(PYTHON_ROOT / "python.exe"), "-B", "-I", "-S", str(REPO / "scripts/usp/learning/association/association_student.py"), "run",
               "--input-batch", str(root / "inputs/development.json"), "--schema", str(root / "inputs/schema-v1.json"),
               "--family-freeze", str(root / "inputs/family-freeze.json"), "--model-receipt", str(root / "inputs/model-acquisition.json"),
               "--run-freeze", str(root / "inputs/run-freeze.json"), "--output-dir", str(root / "outputs/baseline"),
               "--containment-profile", str(root / "profile.json"), "--containment-sha256", isolation.sha(root / "profile.json")]
    isolation.write(root / "stage.json", {"root": str(root), "profileSha256": isolation.sha(root / "profile.json"),
        "copied": copied, "sourcePython": str(PYTHON_ROOT), "sourcePackages": str(PACKAGES), "command": command,
        "requirementsSha256": files["inputs/runtime-requirements-resolved.txt"], "sourceExpectations": str(data_dir / "expectations.json"),
        "relocation": "Standalone copied CPython; -I -S; explicit pinned package directory. No shared ACL or startup file changes."})
    print(json.dumps({"stage": str(root), "profileSha256": isolation.sha(root / "profile.json"), "copied": copied}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    args = parser.parse_args()
    stage(args.data_dir, args.model_dir)
