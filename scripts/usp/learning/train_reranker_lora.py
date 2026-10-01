#!/usr/bin/env python3
"""AI-06D: one frozen V8 Qwen LoRA attempt; evaluation has no execution branch."""

from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
import traceback

from compare_reranker import (INSTRUCTION, PREFIX, SUFFIX, PRIOR_FILES, REVISION,
                              prompts_for, read_json, require, selected_inputs)
from geo.usp_learning.corpus import input_proof, load_examples, sha256_file
from geo.usp_learning.resources import guarded_run, write_json_once
from model_isolation import require_model_boundary, local_model_path

CORPUS_SHA = "ff9c80d3e1c31dec126d7f534a88c45b37ed0d589b35792ad67d4b2ed850efee"
PROOF_SHA = "d2ff07556ded56d8eaf7b0744f6cf2a8dd8c15f076f8df81f3136254a425fa9a"
BASE_SCORES_SHA = "4ba474ab5574b3956a414b8e0e961c975496bed8f6b2d5627ae65e6a5490039d"
BASE_RUN_SHA = "e0b40f2ad75206c64ce5c09653e79c4ef79f14d7340a8ca8e9bfc5d34226f541"
BASE_FREEZE_SHA = "d76f3c651269dfccd5c607038d603b698f9bbe7e62a75c0cf873c4378a467eb9"
SETTINGS = {
    "seed": 17, "cpuThreads": 2, "rank": 8, "alpha": 32, "dropout": 0.0,
    "targetModules": ["q_proj", "v_proj"], "epochs": 3, "microbatch": 1,
    "accumulation": 8, "learningRate": 5e-5, "weightDecay": 0.01,
    "adamBetas": [0.9, 0.999], "adamEpsilon": 1e-8, "gradientClip": 1.0,
    "positiveWeight": 8, "initialGradientScale": 128.0, "scaleGrowthInterval": 2000,
    "maxTokens": 512, "truncation": False, "baseDtype": "float16",
    "adapterDtype": "float32", "lossDtype": "float32", "attention": "sdpa",
    "gradientCheckpointing": "non-reentrant", "useCache": False,
    "checkpointSelection": "final_only", "evaluationAllowed": False,
    "diagnosticSplitAllowed": False, "newBaselineFieldsScored": 0,
    "maxCudaAllocatedBytes": 6 * 1024**3, "maxCudaReservedBytes": 6 * 1024**3,
    "minimumFreeCudaBytes": 1536 * 1024**2, "maxPeakProcessRssBytes": 6 * 1024**3,
    "maxRunSeconds": 600, "maxFitSeconds": 600,
}
CODE_PATHS = (
    "scripts/usp/learning/model_isolation.py", "scripts/usp/security/appcontainer_audit.py",
    "scripts/usp/learning/train_reranker_lora.py", "scripts/usp/learning/compare_reranker.py",
    "services/geo/geo/usp_learning/lora.py", "services/geo/geo/usp_learning/corpus.py",
    "services/geo/geo/usp_learning/model.py", "services/geo/geo/usp_learning/resources.py",
    "services/geo/geo/usp_learning/experiment.py", "services/geo/requirements-learning-lora.txt",
    "services/geo/tests/test_learning_lora.py",
)


def checked_context(args: argparse.Namespace) -> tuple[dict, list[dict], dict, dict]:
    require_model_boundary(args)
    from packaging.requirements import Requirement
    require(sha256_file(args.corpus) == CORPUS_SHA and sha256_file(args.input_proof) == PROOF_SHA,
            "requires the accepted unchanged V8 corpus/proof")
    corpus, all_fields = load_examples(args.corpus, args.originals_dir)
    require(input_proof(args.corpus, all_fields) == read_json(args.input_proof), "input proof does not replay")
    fields = [field for field in all_fields if field["split"] in ("train", "calibration")]
    train = [field for field in fields if field["split"] == "train"]
    require(len(fields) == 69 and len(train) == 44 and sum(f["target"] is not None for f in train) == 14
            and len({f["family"] for f in train}) == 10, "unexpected V8 development composition")
    for name, digest in PRIOR_FILES.items():
        require(sha256_file(args.retained_dir / name) == digest, f"prior model evidence changed: {name}")
    receipt = read_json(args.retained_dir / "reranker-download-receipt.json")
    require(receipt["revision"] == REVISION and receipt["license"] == "apache-2.0"
            and not receipt["remoteCodeDownloaded"], "unexpected retained model")
    for row in receipt["files"]:
        path = local_model_path() / row["file"]
        require(path.stat().st_size == row["bytes"] and sha256_file(path) == row["sha256"], "model bytes changed")
    old = read_json(args.baseline_dir / "freeze.json")
    require(sha256_file(args.baseline_dir / "freeze.json") == BASE_FREEZE_SHA
            and sha256_file(args.baseline_dir / "run/scores.json") == BASE_SCORES_SHA
            and sha256_file(args.baseline_dir / "run/run.json") == BASE_RUN_SHA, "saved baseline changed")
    prior = read_json(args.baseline_dir / "selected-inputs.json")
    require(sha256_file(args.baseline_dir / "selected-inputs.json") == old["selectedInputsSha256"], "prior inputs changed")
    require(prior["targets"] == corpus["targets"] and old["prompt"]["instruction"] == INSTRUCTION
            and old["prompt"]["prefix"] == PREFIX and old["prompt"]["suffix"] == SUFFIX, "prompt/targets changed")
    current = {(f["source"], f["path"]): f for f in selected_inputs(fields, corpus["targets"])["fields"]}
    for row in prior["fields"]:
        require(current[(row["source"], row["path"])] == row, "retained baseline profile changed")
    require(len(prior["fields"]) == 65 and len(current) == 69, "baseline reuse count changed")
    require(prior["prompts"] == prompts_for(prior["fields"], corpus["targets"]), "prior prompt construction changed")
    baseline = read_json(args.baseline_dir / "run/scores.json")
    require(baseline["fields"] == [{k: row[k] for k in ("source", "path", "split")} for row in prior["fields"]],
            "baseline rows do not align")
    dependencies = {}
    pins = [line.split("==") for line in (args.retained_dir / "requirements-resolved.txt").read_text().splitlines() if "==" in line]
    for name, version in [*pins, ("peft", "0.17.1"), ("accelerate", "1.10.1")]:
        dist = metadata.distribution(name)
        require(dist.version == version, f"dependency changed: {name}")
        record = next(file for file in dist.files if str(file).endswith(".dist-info/RECORD"))
        dependencies[name] = {"version": version, "recordSha256": sha256_file(Path(dist.locate_file(record))),
                              "installationRoot": str(Path(dist.locate_file("")).resolve())}
        for raw in dist.requires or []:
            requirement = Requirement(raw)
            if requirement.marker is None or requirement.marker.evaluate({"extra": ""}):
                require(metadata.version(requirement.name) in requirement.specifier, f"unsatisfied dependency: {raw}")
    return corpus, fields, receipt, dependencies


def frozen_config(args: argparse.Namespace, corpus: dict, fields: list[dict], receipt: dict,
                  dependencies: dict, lengths: list[int]) -> dict:
    from geo.usp_learning.lora import pair_plan
    from geo.usp_learning.experiment import ACCEPTANCE, FIT
    repo = Path(__file__).resolve().parents[3]
    return {
        "schemaVersion": "usp-qwen-v8-lora-v1", "settings": SETTINGS,
        "corpusSha256": CORPUS_SHA, "inputProofSha256": PROOF_SHA,
        "model": receipt, "dependencies": dependencies, "pythonVersion": platform.python_version(),
        "pythonExecutable": str(Path(sys.executable).resolve()),
        "environmentFiles": {name: sha256_file(Path(sys.prefix) / name)
                             for name in ("pyvenv.cfg", "Lib/site-packages/retained-qwen.pth")},
        "dependencyWheels": {name: sha256_file(args.retained_dir / "v8-lora-dependencies" / name)
                             for name in ("peft-0.17.1-py3-none-any.whl", "accelerate-1.10.1-py3-none-any.whl")},
        "codeSha256": {name: sha256_file(repo / name) for name in CODE_PATHS},
        "selectedInputsSha256": sha256_file(args.output_dir / "selected-inputs.json"),
        "promptSha256": [hashlib.sha256(p.encode()).hexdigest() for p in prompts_for(fields, corpus["targets"])],
        "tokenLengths": lengths, "trainingPlan": pair_plan([f for f in fields if f["split"] == "train"], corpus["targets"]),
        "priorScoresSha256": BASE_SCORES_SHA, "priorRunSha256": BASE_RUN_SHA,
        "selectionPolicy": {"name": FIT["thresholdPolicy"], "rule": ACCEPTANCE["calibration"]},
        "developmentCriterion": "recover >=1 previously abstained V7 training key; zero incorrect accepts across train/calibration; calibration >=5/7 positives with every target covered",
        "reloadSample": "first training field, all three candidates; bitwise equal margins/probabilities",
        "preflight": "first positive training pair; backward without optimizer step; discard gradients and reset seed/scaler",
        "runtimeEnvironment": {"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
                               "CUBLAS_WORKSPACE_CONFIG": ":4096:8", "deterministicAlgorithms": True,
                               "allowTf32": False, "callbackSDK": None, "networkAudit": "NET-01 pending; flags alone do not prove silence"},
        "modelSettingsRequested": "Astra/high/default", "actualModelEffortTier": "not independently exposed",
    }


def prepare(args: argparse.Namespace) -> None:
    require_model_boundary(args)
    import torch
    from transformers import AutoTokenizer
    corpus, fields, receipt, dependencies = checked_context(args)
    tokenizer = AutoTokenizer.from_pretrained(str(local_model_path()), local_files_only=True, trust_remote_code=False, padding_side="left")
    inputs = selected_inputs(fields, corpus["targets"])
    lengths = [len(tokenizer.encode(p, add_special_tokens=False)) for p in inputs["prompts"]]
    require(max(lengths) <= SETTINGS["maxTokens"], "no truncation permitted")
    require(torch.cuda.is_available(), "CUDA unavailable")
    free, total = torch.cuda.mem_get_info()
    # Six GiB is a ceiling, not a reservation. The worker checks peaks/headroom at every pair.
    require(free >= SETTINGS["minimumFreeCudaBytes"] + 2 * 1024**3, "insufficient initial GPU headroom")
    args.output_dir.mkdir(parents=True, exist_ok=False)
    write_json_once(args.output_dir / "selected-inputs.json", inputs)
    write_json_once(args.output_dir / "freeze.json", frozen_config(args, corpus, fields, receipt, dependencies, lengths))
    repo = Path(__file__).resolve().parents[3]
    for name in CODE_PATHS:
        path = args.output_dir / "code" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as stream:
            stream.write((repo / name).read_bytes())
    write_json_once(args.output_dir / "prepare.json", {"freezeSha256": sha256_file(args.output_dir / "freeze.json"),
                    "gpuFreeBytes": free, "gpuTotalBytes": total, "maxInputTokens": max(lengths),
                    "gitHead": require_model_boundary(args)[2]["sourceCommit"],
                    "inferenceOrGradientsRun": False})
    print(json.dumps({"prepared": str(args.output_dir), "maxTokens": max(lengths)}), flush=True)


def validate(args: argparse.Namespace) -> tuple[dict, list[dict], dict]:
    corpus, fields, receipt, dependencies = checked_context(args)
    frozen = read_json(args.output_dir / "freeze.json")
    require(read_json(args.output_dir / "selected-inputs.json") == selected_inputs(fields, corpus["targets"]), "inputs changed")
    require(frozen == frozen_config(args, corpus, fields, receipt, dependencies, frozen["tokenLengths"]), "frozen experiment changed")
    return corpus, fields, frozen


def worker(args: argparse.Namespace) -> None:
    require_model_boundary(args)
    import psutil
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import LoraConfig, get_peft_model, PeftModel
    from geo.usp_learning.lora import margin_loss, check_gradients, validate_adapter
    from geo.usp_learning.model import choose_calibration_threshold, metrics, predict

    require(read_json(args.output_dir / "attempt.json")["freezeSha256"] == sha256_file(args.output_dir / "freeze.json"), "attempt mismatch")
    corpus, fields, frozen = validate(args)
    run = args.output_dir / "run"
    torch.set_num_threads(2)
    torch.set_num_interop_threads(2)
    torch.manual_seed(17)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cudnn.benchmark = False
    torch.use_deterministic_algorithms(True)
    free, total = torch.cuda.mem_get_info()
    minimum_free = free
    torch.cuda.set_per_process_memory_fraction(SETTINGS["maxCudaReservedBytes"] / total)
    torch.cuda.reset_peak_memory_stats()

    def check_gpu() -> None:
        nonlocal minimum_free
        torch.cuda.synchronize()
        free_now, _ = torch.cuda.mem_get_info()
        minimum_free = min(minimum_free, free_now)
        require(torch.cuda.max_memory_allocated() <= SETTINGS["maxCudaAllocatedBytes"]
                and torch.cuda.max_memory_reserved() <= SETTINGS["maxCudaReservedBytes"], "GPU peak budget exceeded")
        require(free_now >= SETTINGS["minimumFreeCudaBytes"], "GPU free headroom breached")

    tokenizer = AutoTokenizer.from_pretrained(str(local_model_path()), padding_side="left", local_files_only=True, trust_remote_code=False)
    texts = prompts_for(fields, corpus["targets"])
    tokens = [tokenizer(p, add_special_tokens=False, truncation=False, return_tensors="pt") for p in texts]
    require([batch["input_ids"].shape[1] for batch in tokens] == frozen["tokenLengths"], "tokens changed")
    yes, no = tokenizer.convert_tokens_to_ids("yes"), tokenizer.convert_tokens_to_ids("no")
    require(yes != no and yes != tokenizer.unk_token_id and no != tokenizer.unk_token_id, "invalid yes/no tokens")

    def load_base():
        return AutoModelForCausalLM.from_pretrained(
            str(local_model_path()), torch_dtype=torch.float16, attn_implementation="sdpa",
            local_files_only=True, trust_remote_code=False, use_safetensors=True).to("cuda")

    model = get_peft_model(load_base(), LoraConfig(r=8, lora_alpha=32, lora_dropout=0.0,
                          target_modules=["q_proj", "v_proj"], bias="none", task_type="CAUSAL_LM"))
    model.config.use_cache = False
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.enable_input_require_grads()
    named = validate_adapter(model)
    require(model.config._attn_implementation == "sdpa", "attention mismatch")
    initial = {name: p.detach().cpu().clone() for name, p in named}
    parameters = [p for _, p in named]
    optimizer = torch.optim.AdamW(parameters, lr=5e-5, weight_decay=0.01, betas=(0.9, 0.999), eps=1e-8,
                                  foreach=False, fused=False)
    plan = frozen["trainingPlan"]
    train_indices = [i for i, f in enumerate(fields) if f["split"] == "train"]

    def forward(index: int):
        batch = {k: v.to("cuda") for k, v in tokens[index].items()}
        with torch.autocast("cuda", dtype=torch.float16):
            return model(**batch, use_cache=False, logits_to_keep=1).logits

    def backward(pair: dict, scaler):
        index = train_indices[pair["fieldIndex"]] * 3 + pair["targetIndex"]
        loss = margin_loss(forward(index), yes, no, pair["label"]) * pair["backwardWeight"]
        require(bool(torch.isfinite(loss)), "nonfinite loss")
        scalar = loss.item()
        scaler.scale(loss).backward()
        check_gpu()
        return scalar

    def new_scaler():
        return torch.amp.GradScaler("cuda", init_scale=128.0, growth_interval=2000)

    model.train()
    check_gpu()
    scaler = new_scaler()
    probe = next(pair for pair in plan["pairs"] if pair["label"] == 1)
    probe_loss = backward(probe, scaler)
    scaler.unscale_(optimizer)
    gradient_check = check_gradients(named)
    require(all(p.grad is None for p in model.parameters() if not p.requires_grad), "frozen weights received gradients")
    require(all(torch.equal(p.detach().cpu(), initial[name]) for name, p in named), "preflight modified adapter")
    write_json_once(run / "gradient-preflight.json", {**gradient_check, "loss": probe_loss,
                    "optimizerSteps": 0, "trainableParameters": sum(p.numel() for p in parameters),
                    "probe": probe, "yesTokenId": yes, "noTokenId": no})
    optimizer.zero_grad(set_to_none=True)
    scaler = new_scaler()
    torch.manual_seed(17)
    started = time.monotonic()
    write_json_once(run / "fit-started.json", {"monotonic": started})
    steps = 0
    for epoch, windows in enumerate(plan["epochWindows"]):
        total_loss = 0.0
        norms = []
        for window in windows:
            optimizer.zero_grad(set_to_none=True)
            for pair_index in window:
                total_loss += backward(plan["pairs"][pair_index], scaler)
            scaler.unscale_(optimizer)
            check_gradients(named)  # Do not silently skip/retry an overflowing update.
            norm = torch.nn.utils.clip_grad_norm_(parameters, 1.0, error_if_nonfinite=True)
            norms.append(float(norm))
            scaler.step(optimizer)
            scaler.update()
            require(all(bool(torch.isfinite(p).all()) for p in parameters), "nonfinite adapter after update")
            steps += 1
            check_gpu()
        report = {"epoch": epoch + 1, "steps": steps, "onlineEqualFamilyLoss": total_loss / plan["windowsPerEpoch"],
                  "preClipNorms": norms, "elapsedSeconds": time.monotonic() - started,
                  "gpuPeakAllocatedBytes": torch.cuda.max_memory_allocated(), "gpuPeakReservedBytes": torch.cuda.max_memory_reserved(),
                  "minimumSampledFreeGpuBytes": minimum_free}
        write_json_once(run / f"epoch-{epoch + 1}.json", report)
        print(json.dumps({k: v for k, v in report.items() if k != "preClipNorms"}), flush=True)
    write_json_once(run / "fit-completed.json", {"monotonic": time.monotonic(), "steps": steps})
    require(steps == 51, "unexpected optimizer step count")
    changed = sum(not torch.equal(p.detach().cpu(), initial[name]) for name, p in named)
    require(changed > 0, "adapter unchanged")
    optimizer.zero_grad(set_to_none=True)
    del optimizer, scaler, initial, parameters, named
    model.gradient_checkpointing_disable()
    model.disable_input_require_grads()
    model.eval()
    adapter_dir = run / "adapter"
    adapter_dir.mkdir(exist_ok=False)
    model.save_pretrained(adapter_dir, safe_serialization=True, save_embedding_layers=False)
    adapter_hashes = {p.name: sha256_file(p) for p in sorted(adapter_dir.iterdir()) if p.is_file()}
    write_json_once(run / "adapter-hashes.json", adapter_hashes)

    def score(indices: list[int]) -> tuple[list[float], list[float]]:
        margins, probabilities = [], []
        with torch.inference_mode():
            for index in indices:
                logits = forward(index)
                margin = (logits[:, -1, yes].float() - logits[:, -1, no].float()).item()
                probability = torch.softmax(logits[:, -1, [no, yes]].float(), dim=-1)[0, 1].item()
                require(bool(torch.isfinite(torch.tensor([margin, probability])).all()), "nonfinite score")
                margins.append(margin)
                probabilities.append(probability)
                check_gpu()
        return margins, probabilities

    margins, probabilities = score(list(range(len(tokens))))
    write_json_once(run / "scores.json", {"fields": [{k: f[k] for k in ("source", "path", "split")} for f in fields],
                    "targets": [t["id"] for t in corpus["targets"]],
                    "margins": torch.tensor(margins).reshape(69, 3).tolist(),
                    "scores": torch.tensor(probabilities).reshape(69, 3).tolist(),
                    "scoreDefinition": "float32 softmax of final-token [no,yes]; native margin logit_yes-logit_no"})
    # Release the entire trained base, then independently load the saved adapter.
    del model
    gc.collect()
    torch.cuda.empty_cache()
    require(all(sha256_file(adapter_dir / name) == digest for name, digest in adapter_hashes.items()), "adapter bytes changed")
    require((adapter_dir / "adapter_model.safetensors").is_file()
            and (adapter_dir / "adapter_config.json").is_file()
            and not any(p.suffix in (".bin", ".pt", ".pth") for p in adapter_dir.iterdir()), "safe local adapter files required")
    model = PeftModel.from_pretrained(load_base(), adapter_dir, is_trainable=False, local_files_only=True).eval()
    sample_indices = [train_indices[0] * 3 + i for i in range(3)]
    reloaded_margins, reloaded_scores = score(sample_indices)
    require(reloaded_margins == [margins[i] for i in sample_indices]
            and reloaded_scores == [probabilities[i] for i in sample_indices], "saved/reloaded sample mismatch")
    write_json_once(run / "reload.json", {"pairIndices": sample_indices, "margins": reloaded_margins,
                    "scores": reloaded_scores, "exactMatch": True, "adapterHashes": adapter_hashes})
    resources = {"gpuPeakAllocatedBytes": torch.cuda.max_memory_allocated(), "gpuPeakReservedBytes": torch.cuda.max_memory_reserved(),
                 "minimumSampledFreeGpuBytes": minimum_free, "device": torch.cuda.get_device_name(),
                 "torchThreads": torch.get_num_threads(), "gpuScope": "allocator peaks; free memory sampled after load and every forward/backward/update"}
    del model
    gc.collect()
    torch.cuda.empty_cache()
    # Read saved matrices before choosing the single calibration threshold.
    scores = torch.tensor(read_json(run / "scores.json")["scores"])
    indices = {split: [i for i, f in enumerate(fields) if f["split"] == split] for split in ("train", "calibration")}
    calibration = [fields[i] for i in indices["calibration"]]
    threshold = choose_calibration_threshold(calibration, scores[indices["calibration"]])
    write_json_once(run / "selection.json", {"scoresSha256": sha256_file(run / "scores.json"), "threshold": threshold,
                    "policy": frozen["selectionPolicy"], "evaluationOpened": False, "diagnosticSplitOpened": False})
    results = {}
    for split, indexes in indices.items():
        subset = [fields[i] for i in indexes]
        guesses = predict(subset, scores[indexes], threshold) if threshold is not None else [None] * len(subset)
        results[split] = metrics(subset, None, None, guesses)
        for row in results[split]["decisions"]:
            row.pop("topAllowedCosine")
    old_run = read_json(args.baseline_dir / "run/run.json")
    old_train = old_run["comparison"]["qwenCalibrated"]["train"]["decisions"]
    abstained_keys = {(r["source"], r["field"]) for r in old_train if r["expected"] == "building.sourceKey" and r["predicted"] is None}
    recovered = [r for r in results["train"]["decisions"] if (r["source"], r["field"]) in abstained_keys
                 and r["predicted"] == "building.sourceKey"]
    passed = bool(recovered) and all(r["incorrectMappings"] == 0 for r in results.values()) and results["calibration"]["correctPositive"] >= 5 \
        and all(r["correctPositive"] >= 1 for r in results["calibration"]["byTarget"].values())
    write_json_once(run / "baseline-reused.json", {"scoresSha256": BASE_SCORES_SHA, "runSha256": BASE_RUN_SHA,
                    "scores": read_json(args.baseline_dir / "run/scores.json"),
                    "comparison": old_run["comparison"]["qwenCalibrated"],
                    "reusedFields": 65, "newBaselineFieldsScored": 0, "fourNewTrainingFieldsBaseline": "not_scored"})
    write_json_once(run / "result.json", {"status": "development_pass" if passed else "development_fail",
                    "developmentPassed": passed, "threshold": threshold, "comparison": results,
                    "recoveredV7TrainingKeys": recovered, "resources": resources, "changedAdapterTensors": changed,
                    "optimizerSteps": steps, "adapterHashes": adapter_hashes,
                    "evaluationOpened": False, "diagnosticSplitOpened": False, "promoted": False})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "run"))
    for name in ("corpus", "input-proof", "originals-dir", "retained-dir", "baseline-dir", "output-dir"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--_worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--containment-profile", required=True, type=Path)
    parser.add_argument("--containment-sha256", required=True)
    args = parser.parse_args()
    if not args._worker:
        guard = guarded_run([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]],
                            args.containment_profile.parent / "receipts", SETTINGS,
                            containment_profile=args.containment_profile, containment_sha256=args.containment_sha256)
        print(json.dumps({"exitCode": guard["exitCode"], "outputsAccepted": guard["outputsAccepted"]}), flush=True)
        raise SystemExit(guard["exitCode"])
    require_model_boundary(args)
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
                      TOKENIZERS_PARALLELISM="false", OMP_NUM_THREADS="2", MKL_NUM_THREADS="2",
                      CUBLAS_WORKSPACE_CONFIG=":4096:8")
    if args.action == "run":
        validate(args)
        write_json_once(args.output_dir / "attempt.json", {"freezeSha256": sha256_file(args.output_dir / "freeze.json"),
                        "rule": "One attempt including preflight/failure. No retry, sweep or evaluation."})
        (args.output_dir / "run").mkdir(exist_ok=False)
        try:
            worker(args)
        except BaseException as error:
            import torch
            resource = {}
            if torch.cuda.is_initialized():
                resource = {"gpuPeakAllocatedBytes": torch.cuda.max_memory_allocated(),
                            "gpuPeakReservedBytes": torch.cuda.max_memory_reserved()}
            write_json_once(args.output_dir / "run/failure.json", {"type": type(error).__name__, "message": str(error),
                            "traceback": traceback.format_exc(), "resources": resource, "rerunAllowed": False})
            raise
    else:
        prepare(args)


if __name__ == "__main__":
    main()
