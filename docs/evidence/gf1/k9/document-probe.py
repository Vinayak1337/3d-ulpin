"""Offline parity probes; unchanged readers/assets, with task-local bytecode-safe launch flags."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
from typing import Any


TESSERACT = Path("E:/BhuAayam-data/task-data/k2/tesseract-runtime-k2b/Library/bin/tesseract.exe")
ASSETS = Path("E:/BhuAayam-data/task-data/desktop-ai04f-docling-tesseract")
PLAN = Path("E:/BhuAayam-data/datasets/rera-storeys/haryana-2831/haryana-2831-tower3-plan1.pdf")
PLAN_SHA = "2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865"
SITE_PLAN = PLAN.parent / "haryana-2831-site-plan.pdf"
SITE_SHA = "26c2d3101bfe676c8ac66f129439e066b603a555b3c55a35ba509befb707fad9"


def render_probe(output: Path) -> None:
    import fitz
    from run_pdf_pages import _offline_worker, inspect_pages

    output.mkdir()
    _offline_worker()
    metadata = inspect_pages(PLAN, PLAN_SHA, 0, 1, None, output)
    # The product still refuses whole-page raster on this oversized sheet.
    # This bounded, driver-only preview compares native rendering bytes, not product support.
    with fitz.open(stream=PLAN.read_bytes(), filetype="pdf") as document:
        pixmap = document[0].get_pixmap(matrix=fitz.Matrix(0.5, 0.5), colorspace=fitz.csRGB, alpha=False)
        assert pixmap.width * pixmap.height <= 1_600_000
        png = pixmap.tobytes("png")
    (output / "page-preview.png").write_bytes(png)
    value = {
        "metadata": metadata,
        "previewScope": "bounded driver-only native preview; product whole-page raster remains unsupported",
        "previewSha256": hashlib.sha256(png).hexdigest(),
        "previewBytes": len(png),
        "previewPixels": [pixmap.width, pixmap.height],
    }
    (output / "render.json").write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    assert hashlib.sha256(PLAN.read_bytes()).hexdigest() == PLAN_SHA


def bytecode_safe_children() -> None:
    class SafePopen(subprocess.Popen):
        def __init__(self, command: list[str], *args: Any, **kwargs: Any) -> None:
            executable = Path(command[0]).name.lower()
            if executable == "python.exe" and "-B" not in command:
                command = [command[0], "-B", *command[1:]]
            config = os.environ.get("K9_TESSERACT_TSV_CONFIG")
            if executable == "tesseract.exe" and command[-1] == "tsv" and config:
                command = [*command[:-1], config]
            environment = dict(kwargs.get("env", os.environ))
            environment.update({"CUDA_VISIBLE_DEVICES": "", "PYTHONDONTWRITEBYTECODE": "1"})
            kwargs["env"] = environment
            super().__init__(command, *args, **kwargs)

    subprocess.Popen = SafePopen


def configure_split_prefix(repo: Path, config: Path) -> None:
    import run_trial

    manifest = json.loads((repo / "docs/evidence/gf-backend/k2f/prefix.json").read_bytes())
    expected = next(entry["sha256"] for entry in manifest["files"] if entry["file"] == "configs/tsv")
    assert hashlib.sha256(config.read_bytes()).hexdigest() == expected
    os.environ["K9_TESSERACT_TSV_CONFIG"] = str(config.resolve())
    original = "runpy.run_path(command[1],run_name='__main__')"
    assert run_trial._WINDOWS_GATE.count(original) == 1
    wrapper = f"runpy.run_path({str(Path(__file__).resolve())!r},run_name='__main__')"
    run_trial._WINDOWS_GATE = run_trial._WINDOWS_GATE.replace(original, wrapper)


def ocr_probe(repo: Path, output: Path, config: Path | None) -> None:
    bytecode_safe_children()
    if config is not None:
        configure_split_prefix(repo, config)
    prefix = ASSETS / "tesseract/share/tessdata"
    os.environ.update({
        "CUDA_VISIBLE_DEVICES": "", "PYTHONDONTWRITEBYTECODE": "1",
        "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
        "DOCLING_ARTIFACTS_PATH": str(ASSETS / "models"), "TESSDATA_PREFIX": str(prefix),
        "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2",
    })
    runner = repo / "scripts/usp/document-models/run_source_ocr.py"
    sys.argv = [
        str(runner), "--source", str(SITE_PLAN), "--expected-source-sha256", SITE_SHA,
        "--page", "1", "--region", "280", "860", "960", "2580",
        "--models", str(ASSETS / "models"), "--tesseract", str(TESSERACT),
        "--tessdata", str(prefix), "--output", str(output), "--max-seconds", "90", "--max-items", "64",
    ]
    runpy.run_path(str(runner), run_name="__main__")


def main() -> None:
    if "--worker" in sys.argv:
        # Only the optional split-prefix comparison runs this wrapper in the unchanged Windows Job.
        runner = Path(__file__).resolve().parents[4] / "scripts/usp/document-models/run_source_ocr.py"
        assert Path(sys.argv[0]).resolve() == Path(__file__).resolve()
        sys.argv[0] = str(runner)
        bytecode_safe_children()
        runpy.run_path(str(runner), run_name="__main__")
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["render", "ocr"])
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--tsv-config", type=Path, help="retained absolute config; no tessdata copies")
    args = parser.parse_args()
    sys.path.insert(0, str(args.repo / "scripts/usp/document-models"))
    sys.path.insert(0, str(args.repo / "services/geo"))
    if args.action == "render":
        render_probe(args.output)
    else:
        ocr_probe(args.repo, args.output, args.tsv_config)


if __name__ == "__main__":
    main()
