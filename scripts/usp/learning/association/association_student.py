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


def admitted_runtime(freeze, inputs, preserve_preflight, preserve_technical=None, *, verified_root=None, profile=None):
    """Choose only an admitted representation before touching model bytes."""
    version = freeze.get("version", "")
    if version == "association-fragment-rank-reload-freeze/1":
        from geo.usp_learning.association import fragment_rank_reload as reload
        reload.checked_run_inputs(freeze, inputs, verified_root=verified_root, profile=profile)
        if not callable(preserve_preflight) or not callable(preserve_technical):
            raise RuntimeError("rank reload evidence callbacks required")
        return reload.run, {"rank_reload_authority": {"freeze": freeze, "inputs": inputs,
            "verified_root": verified_root, "profile": profile}, "preserve_preflight": preserve_preflight,
            "preserve_technical": preserve_technical}, reload.baseline.rank.SYSTEM_PROMPT
    if version == "association-fragment-rank-baseline-freeze/1":
        from geo.usp_learning.association import fragment_rank_baseline as rank
        rank.checked_run_inputs(freeze, inputs)
        if not callable(preserve_preflight) or not callable(preserve_technical):
            raise RuntimeError("rank evidence callbacks required")
        return run_local, {"rank_authority": {"freeze": freeze, "inputs": inputs},
            "preserve_preflight": preserve_preflight, "preserve_technical": preserve_technical}, rank.rank.SYSTEM_PROMPT
    if preserve_technical is not None or "rank" in str(version) or {"rank_authority", "rankAuthority", "policySha256", "donors"} & set(freeze):
        raise RuntimeError("explicit rank baseline freeze required")
    if version == "association-fragment-baseline-freeze/1":
        from geo.usp_learning.association import fragment_baseline as fragment
        contract, _, route = fragment.checked_run_inputs(freeze, inputs)
        return run_local, {"fragment_contract": contract, "fragment_route": route,
                           "preserve_preflight": preserve_preflight}, fragment.codec.SYSTEM_PROMPT
    if "fragment" in str(version) or {"fragmentRoute", "fragmentContract", "fragmentSchemaCanonicalLfSha256"} & set(freeze):
        raise RuntimeError("explicit fragment baseline freeze required")
    if version == "association-candidate-baseline-freeze/1":
        from geo.usp_learning.association import candidate_baseline as candidate
        from geo.usp_learning.association.selector_baseline import run_selectors
        contract, assignment, route = candidate.checked_run_inputs(freeze, inputs)
        return run_selectors, {"selector_contract": contract, "cases": assignment["cases"],
            "candidate_route": route, "preserve_preflight": preserve_preflight}, candidate.candidate.SYSTEM_PROMPT
    if "candidate" in str(version) or {"candidateRoute", "acceptedArtifactSha256", "representation",
            "candidateSetSha256", "candidateSchemaCanonicalLfSha256", "artifactRoot"} & set(freeze):
        raise RuntimeError("explicit candidate baseline freeze required")
    if str(version).startswith("association-selector-"):
        from geo.usp_learning.association.selector_baseline import checked_run_inputs, run_selectors
        from geo.usp_learning.association.selectors import SYSTEM_PROMPT as SELECTOR_PROMPT
        contract, assignment = checked_run_inputs(freeze, inputs)
        return run_selectors, {"selector_contract": contract, "cases": assignment["cases"],
            "preserve_preflight": preserve_preflight}, SELECTOR_PROMPT
    if "lexicalPolicy" in freeze or "selectorSchemaCanonicalLfSha256" in freeze:
        raise RuntimeError("explicit selector baseline freeze required")
    if version != "association-baseline-freeze/1":
        raise RuntimeError("explicit baseline freeze required")
    return run_local, {}, SYSTEM_PROMPT


def worker(args):
    verified_root, profile, _ = require_model_boundary(args)
    # Refuse unsupported/drifted rank metadata before output or native effects.
    freeze = json.loads(args.run_freeze.read_bytes())
    preadmit_rank(freeze, args.run_freeze.parent, verified_root=verified_root, profile=profile)
    if freeze.get("version") == "association-fragment-rank-reload-freeze/1":
        from geo.usp_learning.association import fragment_rank_reload as reload
        if args.run_freeze != verified_root / "inputs/run-freeze.json" or any(
                getattr(args, key) != verified_root / "inputs" / name for key, name in reload.INPUT_NAMES.items()):
            raise RuntimeError("rank reload CLI input scope drift")
    args.output_dir.mkdir(exist_ok=False)
    try:
        candidate_mode = freeze.get("version") == "association-candidate-baseline-freeze/1"
        fragment_mode = freeze.get("version") == "association-fragment-baseline-freeze/1"
        reload_mode = freeze.get("version") == "association-fragment-rank-reload-freeze/1"
        rank_mode = reload_mode or freeze.get("version") == "association-fragment-rank-baseline-freeze/1"
        structured_mode = candidate_mode or fragment_mode or rank_mode
        prefix = "fragment-rank-reload" if reload_mode else "fragment-rank" if rank_mode else "fragment" if fragment_mode else "candidate"
        binding = {}
        technical = (lambda value: write_json_once(args.output_dir / (prefix + "-technical-proof.json"),
                     {**value, "provenance": binding})) if rank_mode else None
        runner, runner_options, system_prompt = admitted_runtime(freeze, args.run_freeze.parent,
            lambda value: write_json_once(args.output_dir / (prefix + "-preflight.json" if structured_mode else "selector-preflight.json"),
                {**value, **({"provenance": binding} if structured_mode else {})}), technical,
            verified_root=verified_root, profile=profile)
        if reload_mode:
            from geo.usp_learning.association.fragment_rank_reload import provenance
            binding = provenance(freeze, sha(args.run_freeze))
        elif rank_mode:
            from geo.usp_learning.association.fragment_rank_baseline import provenance
            binding = provenance(freeze, sha(args.run_freeze))
        elif fragment_mode:
            from geo.usp_learning.association.fragment_baseline import provenance
            binding = provenance(freeze, sha(args.run_freeze))
        elif candidate_mode:
            from geo.usp_learning.association.candidate_baseline import provenance
            binding = provenance(freeze, sha(args.run_freeze))
        if freeze["settings"] != SETTINGS or freeze["systemPromptSha256"] != hashlib.sha256(system_prompt.encode()).hexdigest():
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
        raw, result = runner(batch["examples"], json.loads(schema_bytes), family, model_path,
                                lambda: require_model_boundary(args),
                                lambda index, value: write_json_once(args.output_dir / f"{prefix + '-' if structured_mode else ''}raw-{index}.json", value), **runner_options)
        if structured_mode:
            result = {**result, "provenance": binding}
            if rank_mode:
                result["technicalProofSha256"] = sha(args.output_dir / (prefix + "-technical-proof.json"))
        write_json_once(args.output_dir / "raw-outputs.json", raw)
        if structured_mode:
            write_json_once(args.output_dir / (prefix + "-raw-outputs.json"), raw)
            result["rawOutputsSha256"] = sha(args.output_dir / "raw-outputs.json")
            write_json_once(args.output_dir / (prefix + "-result.json"), result)
        write_json_once(args.output_dir / "result.json", result)
        if structured_mode:
            # The protected supervisor still owns completion.json and final
            # artifact acceptance. This receipt never claims guard acceptance.
            artifacts = (prefix + "-preflight.json", prefix + "-raw-outputs.json", prefix + "-result.json", "raw-outputs.json", "result.json")
            if rank_mode:
                artifacts += (prefix + "-technical-proof.json",)
            write_json_once(args.output_dir / (prefix + "-completion.json"), {
                "version": "association-" + prefix + "-worker-completion/1", "status": "worker_complete_awaiting_guard",
                "supervisorAccepted": False, "authoritativeCompletion": "completion.json", "provenance": binding,
                "artifacts": {name: sha(args.output_dir / name) for name in artifacts},
                "evaluationOpened": False, "fitPerformed": False, "promoted": False})
        print(json.dumps({"exampleCount": result["exampleCount"], "modelOutputValidCount": result["modelOutputValidCount"],
                          "runtime": result["runtime"]}), flush=True)
    except BaseException as error:
        write_json_once(args.output_dir / "failure.json", {"type": type(error).__name__, "message": str(error),
            "traceback": traceback.format_exc(), "evaluationOpened": False, "fitPerformed": False})
        raise


def preadmit_rank(freeze, inputs, *, verified_root=None, profile=None):
    """Host and child reject code-only/mixed authority before their first effects."""
    # Normal dispatch is pure until its returned runner is invoked. Reuse it so
    # unknown rank versions cannot fall through to a legacy/default route.
    return admitted_runtime(freeze, inputs, lambda value: None,
        (lambda value: None) if freeze.get("version") in ("association-fragment-rank-baseline-freeze/1",
            "association-fragment-rank-reload-freeze/1") else None, verified_root=verified_root, profile=profile)


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
        preadmit_rank(json.loads(args.run_freeze.read_bytes()), args.run_freeze.parent)
        report = guarded_run([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]],
            args.containment_profile.parent / "receipts", SETTINGS,
            containment_profile=args.containment_profile, containment_sha256=args.containment_sha256)
        print(json.dumps({"exitCode": report["exitCode"], "failure": report["failure"],
                          "outputsAccepted": report["outputsAccepted"], "cleanup": report["cleanup"]}), flush=True)
        raise SystemExit(report["exitCode"])


if __name__ == "__main__":
    main()
