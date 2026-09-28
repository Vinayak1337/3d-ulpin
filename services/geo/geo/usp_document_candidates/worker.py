"""Isolated single-region Granite Docling inference process."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .granite import extract_region, select_runtime, sha256_file


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--max-new-tokens", type=int, default=512)
    parser.add_argument("--cpu-threads", type=int, default=2)
    parser.add_argument("--device", choices=("auto", "cpu", "mps"), default="auto")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=False)
    device, dtype = select_runtime(args.device)
    selection_path = args.output_dir / "runtime-selection.json"
    selection_path.write_text(json.dumps({"requestedDevice": args.device, "selectedDevice": device,
                                          "dtype": str(dtype)}, indent=2, sort_keys=True) + "\n")
    result = extract_region(args.image, args.model_dir, max_new_tokens=args.max_new_tokens,
                            cpu_threads=args.cpu_threads, device_choice=device)
    doctags = result.pop("doctags")
    markdown = result.pop("markdown")
    raw_path = args.output_dir / "extracted.doctags.txt"
    raw_path.write_text(doctags)
    result["doctagsArtifact"] = {"file": raw_path.name, "bytes": raw_path.stat().st_size,
                                 "sha256": sha256_file(raw_path)}
    if markdown is not None:
        markdown_path = args.output_dir / "extracted.md"
        markdown_path.write_text(markdown)
        result["markdownArtifact"] = {"file": markdown_path.name, "bytes": markdown_path.stat().st_size,
                                      "sha256": sha256_file(markdown_path)}
    receipt_path = args.output_dir / "model-result.json"
    receipt_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"status": "completed", "receipt": str(receipt_path),
                      "generatedTokens": result["generatedTokens"], "parseError": result["parseError"]}))


if __name__ == "__main__":
    main()
