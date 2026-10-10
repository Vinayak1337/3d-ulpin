"""Invoke the existing supervised region runner; never patch its shared runtime."""
from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from raster_common import pin

if TYPE_CHECKING:
    from geo.raster_plan import OcrAssets, PlanSelection


@dataclass(frozen=True)
class OcrRunner:
    python: Path
    script: Path
    seconds: int = 90


def runner_environment(assets: OcrAssets) -> dict[str, str]:
    retained = ("SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA")
    environment = {key: os.environ[key] for key in retained if key in os.environ}
    environment.update(CUDA_VISIBLE_DEVICES="", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                       OMP_NUM_THREADS="2", MKL_NUM_THREADS="2", OPENBLAS_NUM_THREADS="2",
                       PYTHONNOUSERSITE="1", TESSDATA_PREFIX=str(assets.tessdata))
    environment["PATH"] = str(assets.tesseract.parent) + os.pathsep + environment.get("PATH", "")
    return environment


def runner_command(selection: PlanSelection, region: list[float], assets: OcrAssets,
                   runner: OcrRunner, output: Path) -> list[str]:
    return [str(runner.python), str(runner.script), "--source", str(selection.source),
            "--expected-source-sha256", selection.sha256, "--page", str(selection.page),
            "--region", *map(str, region), "--models", str(assets.models), "--tesseract", str(assets.tesseract),
            "--tessdata", str(assets.tessdata), "--max-items", "64", "--max-seconds", str(runner.seconds),
            "--output", str(output)]


def normalize_runner_result(output: Path, selection: PlanSelection, region: list[float]) -> dict[str, Any]:
    receipt = json.loads((output / "receipt.json").read_text(encoding="utf-8"))
    result = json.loads((output / "result.json").read_text(encoding="utf-8"))
    if receipt["status"] not in {"complete", "partial"} or receipt["worker"]["exitCode"] != 0:
        raise ValueError(f"region_runner_failed; retain traceback in {output / 'worker.log'}")
    if (result["sourceSha256"] != selection.sha256 or result["sourcePage"] != selection.page
            or result["selection"]["sourcePageBox"] != region):
        raise ValueError("runner_source_selection_mismatch")
    return {"schemaVersion": "source-ocr-candidate/1", "method": result["method"],
            "frame": {"source": {"sha256": selection.sha256, "bytes": result["sourceBytes"]},
                      "pageNumber": selection.page, "pageFrame": result["sourcePageFrame"],
                      "requestedRegion": region, "render": result["render"]},
            "items": result["items"], "issues": result["issues"], "partial": result["outputStatus"] == "partial",
            "textCompleteness": "unverified", "runnerReceipt": pin(output / "receipt.json"),
            "runnerResult": pin(output / "result.json"), "runnerLog": pin(output / "worker.log")}


def observe_tile(selection: PlanSelection, region: list[float], assets: OcrAssets,
                 runner: OcrRunner, output: Path) -> dict[str, Any]:
    if output.exists():
        raise ValueError("runner_output_must_be_new")
    command = runner_command(selection, region, assets, runner, output)
    process = subprocess.run(command, env=runner_environment(assets), stdin=subprocess.DEVNULL,
                             capture_output=True, timeout=runner.seconds + 30, check=False)
    # Worker tracebacks are in the runner's bounded log. Parent diagnostics are kept separately.
    destination = output / "invocation.json" if output.exists() else output.with_suffix(".failure.json")
    from raster_common import write_json

    write_json(destination, {"command": command, "exitCode": process.returncode,
                             "stdout": process.stdout.decode("utf-8", errors="replace")[-32_768:],
                             "stderr": process.stderr.decode("utf-8", errors="replace")[-32_768:]})
    if process.returncode:
        raise ValueError(f"region_runner_exit_{process.returncode}; diagnostics: {destination}")
    return normalize_runner_result(output, selection, region)
