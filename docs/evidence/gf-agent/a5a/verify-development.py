"""Run permitted D1f/D8 checks without opening closed restart receipts or provisional files."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]


def deny_closed_reads(event: str, args: tuple[Any, ...]) -> None:
    if event not in ("open", "os.listdir", "os.scandir") or not args or not isinstance(args[0], (str, bytes)):
        return
    path = Path(args[0].decode() if isinstance(args[0], bytes) else args[0])
    parts = {part.lower() for part in path.parts}
    if parts.intersection({"heldout", "evaluator", "provisional", "acquisitions", "runtime"}):
        raise PermissionError("A5A_CLOSED_PATH_DENIED")
    if any(part.startswith(".env") for part in parts):
        raise PermissionError("A5A_CREDENTIAL_PATH_DENIED")


def main() -> None:
    sys.addaudithook(deny_closed_reads)
    path = ROOT / "scripts/agent/verify-d1f.py"
    spec = importlib.util.spec_from_file_location("a5a_d1f_verifier", path)
    assert spec is not None and spec.loader is not None
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    acquisition = verifier.load_module(path.with_name("acquire-d1f.py"), "a5a_acquisition_reader")
    manifest = json.loads(verifier.MANIFEST.read_bytes())
    report = json.loads(verifier.REPORT.read_bytes())
    assert acquisition.digest(verifier.MANIFEST) == report["manifestSha256"]
    assert verifier.family_coverage(manifest, acquisition) == report["families"]
    verifier.verify_indian_development()
    print(json.dumps({"files": len(manifest["assets"]), "families": len(manifest["families"]),
                      "indianDevelopmentChecked": True, "closedFoldersOpened": 0,
                      "restartIntegrity": "not_run_closed_acquisitions_and_provisional"}))


if __name__ == "__main__":
    main()
