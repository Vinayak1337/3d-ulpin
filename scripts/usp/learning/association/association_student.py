"""Contained cited association baseline CLI; host execution never loads a model."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import traceback

REPO = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(REPO / "scripts/usp/learning"), str(REPO / "services/geo")]
from model_isolation import require_model_boundary, local_model_path
from geo.usp_learning.resources import guarded_run, write_json_once
from geo.usp_learning.association.student import SETTINGS, SYSTEM_PROMPT, run_local


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024**2), b""):
            digest.update(block)
    return digest.hexdigest()


def worker(args):
    require_model_boundary(args)
    args.output_dir.mkdir(exist_ok=False)
    try:
        freeze = json.loads(args.run_freeze.read_bytes())
        if freeze["settings"] != SETTINGS or freeze["systemPromptSha256"] != hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest():
            raise RuntimeError("frozen baseline settings or prompt drift")
        for option, digest in freeze["inputSha256"].items():
            if sha(getattr(args, option)) != digest:
                raise RuntimeError("frozen baseline input drift: " + option)
        family = json.loads(args.family_freeze.read_bytes())
        schema_bytes = args.schema.read_bytes()
        if hashlib.sha256(schema_bytes.replace(b"\r\n", b"\n")).hexdigest() != family["schemaSha256"]:
            raise RuntimeError("coordinator schema pin drift")
        receipt = json.loads(args.model_receipt.read_bytes())
        if receipt["model"] != freeze["model"] or receipt["revision"] != freeze["modelRevision"]:
            raise RuntimeError("frozen model identity drift")
        model_path = local_model_path()
        for row in receipt["files"]:
            if sha(model_path / row["file"]) != row["sha256"]:
                raise RuntimeError("acquired model file drift")
        batch = json.loads(args.input_batch.read_bytes())
        if batch["version"] != "association-development/1" or len(batch["examples"]) != 2:
            raise RuntimeError("requires the frozen compact development baseline")
        raw, result = run_local(batch["examples"], json.loads(schema_bytes), family, model_path,
                                lambda: require_model_boundary(args),
                                lambda index, value: write_json_once(args.output_dir / f"raw-{index}.json", value))
        write_json_once(args.output_dir / "raw-outputs.json", raw)
        write_json_once(args.output_dir / "result.json", result)
        print(json.dumps({"exampleCount": len(raw), "modelOutputValidCount": result["modelOutputValidCount"],
                          "runtime": result["runtime"]}), flush=True)
    except BaseException as error:
        write_json_once(args.output_dir / "failure.json", {"type": type(error).__name__, "message": str(error),
            "traceback": traceback.format_exc(), "evaluationOpened": False, "fitPerformed": False})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("run",))
    for name in ("input-batch", "schema", "family-freeze", "model-receipt", "run-freeze", "output-dir", "containment-profile"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--containment-sha256", required=True)
    parser.add_argument("--_worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args._worker:
        worker(args)
    else:
        report = guarded_run([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]],
            args.containment_profile.parent / "receipts", SETTINGS,
            containment_profile=args.containment_profile, containment_sha256=args.containment_sha256)
        print(json.dumps({"exitCode": report["exitCode"], "failure": report["failure"],
                          "outputsAccepted": report["outputsAccepted"], "cleanup": report["cleanup"]}), flush=True)
        raise SystemExit(report["exitCode"])


if __name__ == "__main__":
    main()
