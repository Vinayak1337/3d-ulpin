"""Fixed contained fit/reload entry points for STUDENT-02."""
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
from geo.usp_learning.association.student import SETTINGS, SYSTEM_PROMPT
from geo.usp_learning.association.adapter import FIT, NUMERICS, V2_SHA, checked_teacher, digest_file, fit, reload_and_compare
from geo.usp_learning.association.chunked_loss import LOSS_POLICY
from geo.usp_learning.association.reclamation import RECLAMATION_POLICY
from geo.usp_learning.association.query_attention import ATTENTION_POLICY, ATTENTION_CONTROL


def worker(args):
    require_model_boundary(args)
    args.output_dir.mkdir(exist_ok=False)
    phases = None
    try:
        freeze = json.loads(args.run_freeze.read_bytes())
        assignment = json.loads(args.assignment.read_bytes())
        if (assignment["settings"] != FIT or assignment["teacherV2Sha256"] != V2_SHA
                or freeze["fitSettings"] != FIT or freeze["numerics"] != NUMERICS
                or freeze["inferenceSettings"] != SETTINGS or freeze["action"] != args.action
                or freeze["memoryExecutionPolicy"] != assignment["memoryExecutionPolicy"]
                or assignment["memoryExecutionPolicy"]["headChunkTokens"] != 64
                or freeze["lossImplementation"] != LOSS_POLICY
                or freeze["reclamationImplementation"] != RECLAMATION_POLICY
                or freeze["attentionImplementation"] != ATTENTION_POLICY
                or assignment["attentionControlBeforeFit"] != ATTENTION_CONTROL
                or assignment["memoryExecutionPolicy"]["queryChunkedAttention"]["queryChunkTokens"] != 128
                or not assignment["memoryExecutionPolicy"].get("interUpdateReclamation")
                or not assignment["memoryExecutionPolicy"].get("preBackwardReclamation")
                or freeze["previousFailureReceiptSha256"] != assignment["previousFailureReceiptSha256"]
                or freeze["previousFailedFit"] != assignment["previousFailedFit"]
                or freeze["systemPromptSha256"] != hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest()):
            raise RuntimeError("frozen assignment/settings/prompt drift")
        for option, digest in freeze["inputSha256"].items():
            if digest_file(getattr(args, option)) != digest:
                raise RuntimeError("frozen input drift: " + option)
        family = json.loads(args.family_freeze.read_bytes())
        schema_bytes = args.schema.read_bytes()
        if hashlib.sha256(schema_bytes.replace(b"\r\n", b"\n")).hexdigest() != family["schemaSha256"]:
            raise RuntimeError("schema pin drift")
        contract = json.loads(schema_bytes)
        receipt = json.loads(args.model_receipt.read_bytes())
        if (receipt["model"] != assignment["model"] or receipt["revision"] != assignment["revision"]):
            raise RuntimeError("frozen base model identity changed")
        model_path = local_model_path()
        for row in receipt["files"]:
            if Path(row["file"]).name != row["file"] or digest_file(model_path / row["file"]) != row["sha256"]:
                raise RuntimeError("base model file drift")
        if args.action == "fit":
            from geo.usp_learning.association.memory_observation import PhaseRecorder
            phases = PhaseRecorder(args.output_dir, lambda: require_model_boundary(args))
            rows, delta = checked_teacher(args.teacher_v1.read_bytes(), args.training_data.read_bytes(), contract, family)
            write_json_once(args.output_dir / "teacher-delta.json", delta)
            result = fit(rows, contract, family, model_path, args.output_dir,
                         lambda: require_model_boundary(args), write_json_once, phases)
            print(json.dumps({"updates": result["updates"], "fitSeconds": result["fitSeconds"], "gpu": result["gpu"]}), flush=True)
        else:
            manifest = json.loads(args.adapter_manifest.read_bytes())
            proof = json.loads(args.fit_proof.read_bytes())
            if (not proof["fitResourceAccepted"] or proof["updates"] != 66
                    or proof["adapterManifestSha256"] != digest_file(args.adapter_manifest)
                    or proof["lossImplementation"] != LOSS_POLICY or not proof["lossEquivalencePassed"]
                    or manifest["lossImplementation"] != LOSS_POLICY
                    or proof["reclamationImplementation"] != manifest["reclamationImplementation"]
                    or proof["reclamationImplementation"] != RECLAMATION_POLICY or not proof["reclamationControlPassed"]
                    or not proof["liveGraphControlPassed"] or not proof["preBackwardReclamationHistoryPassed"]
                    or proof["attentionImplementation"] != manifest["attentionImplementation"]
                    or proof["attentionImplementation"] != ATTENTION_POLICY or not proof["attentionControlPassed"]
                    or not proof["attentionScopeRestored"] or not proof["attentionBlockHistoryPassed"]
                    or proof["attentionControlSha256"] != manifest["attentionControlSha256"]
                    or proof["reclamationControlSha256"] != manifest["reclamationControlSha256"]
                    or proof["lossEquivalenceSha256"] != manifest["lossEquivalenceSha256"]):
                raise RuntimeError("adapter lacks matching accepted fit receipt")
            batch = json.loads(args.input_batch.read_bytes())
            if batch["version"] != "association-development/1" or len(batch["examples"]) != 2:
                raise RuntimeError("frozen development input changed")
            raw, result = reload_and_compare(batch["examples"], contract, family, model_path, args.adapter_dir, manifest,
                lambda: require_model_boundary(args), lambda index, value: write_json_once(args.output_dir / f"raw-{index}.json", value))
            write_json_once(args.output_dir / "raw-outputs.json", raw)
            write_json_once(args.output_dir / "result.json", result)
            print(json.dumps({"examples": len(raw), "validRawOutputs": result["modelOutputValidCount"], "gpu": result["runtime"]}), flush=True)
    except BaseException as error:
        primary = {"type": type(error).__name__, "message": str(error), "traceback": traceback.format_exc(),
                   "action": args.action, "evaluationOpened": False}
        try:
            if phases is not None:
                primary["lastObservation"] = phases.sample("failure", sys.modules.get("torch"), failure=True, primaryException=primary["type"])
        except BaseException as observation_error:
            primary["observationFailure"] = str(observation_error)
        try:
            write_json_once(args.output_dir / "failure.json", primary)
        except BaseException as receipt_error:
            print("Failure receipt write failed: " + str(receipt_error), file=sys.stderr, flush=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("fit", "reload"))
    for name in ("schema", "family-freeze", "model-receipt", "run-freeze", "assignment", "output-dir", "containment-profile"):
        parser.add_argument("--" + name, type=Path, required=True)
    for name in ("training-data", "teacher-v1", "input-batch", "adapter-dir", "adapter-manifest", "fit-proof"):
        parser.add_argument("--" + name, type=Path)
    parser.add_argument("--containment-sha256", required=True)
    parser.add_argument("--_worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args._worker:
        worker(args)
    else:
        report = guarded_run([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]], args.containment_profile.parent / "receipts", SETTINGS,
            containment_profile=args.containment_profile, containment_sha256=args.containment_sha256)
        print(json.dumps({"exitCode": report["exitCode"], "failure": report["failure"],
                          "outputsAccepted": report["outputsAccepted"], "cleanupPassed": report["cleanup"]["passed"]}), flush=True)
        raise SystemExit(report["exitCode"])


if __name__ == "__main__":
    main()
