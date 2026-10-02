"""Reclaim only unused storage; persistent learning state and peak counters survive."""
from __future__ import annotations

import gc
import hashlib
import json

from .validation import require

RECLAMATION_POLICY = {
    "version": "association-unused-cache-reclamation/1", "afterSetup": True, "afterEveryCompletedUpdate": True,
    "gradients": "optimizer.zero_grad(set_to_none=True)",
    "finishedReferences": ["ids", "labels", "target", "selected", "hidden", "loss", "norm"],
    "cache": "synchronize, gc.collect, cuda.empty_cache, synchronize; unused cache only",
    "persistentState": "same model, parameters, Adam moments, scaler, encoded rows, order and RNG",
    "peaks": "never reset between samples; enforce cumulative bounds before and after reclamation",
    "control": {"seed": 2904, "parameterShape": [32, 16], "inputShape": [7, 32], "steps": 2,
                "dtype": "float32 parameters/Adam moments; float16 autocast; float32 loss; scale128",
                "comparison": "exact state/RNG fingerprints across cleanup; exact next loss/gradient/parameter/optimizer/scaler equality",
                "trainingRngIsolation": "torch.random.fork_rng; verify CPU and CUDA state restored"}}


def release_unused_cache(torch):
    torch.cuda.synchronize()
    collected = gc.collect()
    torch.cuda.empty_cache()
    torch.cuda.synchronize()
    return {"unreachableObjectsCollected": collected, "peaksReset": False}


def state_digest(value):
    digest = hashlib.sha256()
    def visit(item):
        if hasattr(item, "detach"):
            tensor = item.detach().cpu().contiguous()
            digest.update(json.dumps([str(tensor.dtype), list(tensor.shape)]).encode())
            digest.update(tensor.numpy().tobytes())
        elif isinstance(item, dict):
            for key in sorted(item, key=str):
                digest.update(repr(key).encode()); visit(item[key])
        elif isinstance(item, (list, tuple)):
            for child in item:
                visit(child)
        else:
            digest.update(json.dumps(item, sort_keys=True, allow_nan=False).encode())
    visit(value)
    return digest.hexdigest()


def run_reclamation_control(torch, output_dir, write, phases):
    before_cpu, before_cuda = torch.get_rng_state().clone(), torch.cuda.get_rng_state().clone()
    phases.sample("reclamation_control_before", torch)
    report = {"version": "association-reclamation-control/1", "policy": RECLAMATION_POLICY,
              "qualification": "technical tensor control, not source evidence or model quality", "cases": []}
    with torch.random.fork_rng(devices=[torch.cuda.current_device()]):
        def case(reclaim):
            torch.manual_seed(RECLAMATION_POLICY["control"]["seed"])
            parameter = torch.nn.Parameter((torch.arange(512, device="cuda", dtype=torch.float32).reshape(32, 16) - 256) / 1024)
            inputs = torch.arange(224, device="cuda", dtype=torch.float32).reshape(7, 32) / 224
            optimizer = torch.optim.AdamW([parameter], lr=0.0002, weight_decay=0, betas=(0.9, 0.999), eps=1e-8)
            scaler = torch.amp.GradScaler("cuda", init_scale=128.0, growth_interval=2000)

            def state():
                return {"parameters": state_digest(parameter), "optimizer": state_digest(optimizer.state_dict()),
                        "scaler": state_digest(scaler.state_dict()), "cpuRng": state_digest(torch.get_rng_state()),
                        "cudaRng": state_digest(torch.cuda.get_rng_state())}

            def step():
                optimizer.zero_grad(set_to_none=True)
                with torch.autocast("cuda", dtype=torch.float16):
                    predicted = torch.nn.functional.dropout(inputs, p=0.05, training=True) @ parameter
                    loss = (predicted.float() - 0.125).square().mean()
                require(bool(torch.isfinite(loss)), "reclamation_control_nonfinite_loss")
                scaler.scale(loss).backward(); scaler.unscale_(optimizer)
                require(bool(torch.isfinite(parameter.grad).all()), "reclamation_control_nonfinite_gradient")
                norm = torch.nn.utils.clip_grad_norm_([parameter], 1.0, error_if_nonfinite=True)
                facts = {"loss": float(loss.detach()), "clippedGradientSha256": state_digest(parameter.grad), "norm": float(norm)}
                scale = scaler.get_scale(); scaler.step(optimizer); scaler.update()
                require(scaler.get_scale() >= scale, "reclamation_control_skipped_step")
                torch.cuda.synchronize()
                return facts  # Finished calculation tensors are no longer referenced.

            first = step()
            before = state()
            identity = [id(parameter), id(optimizer), id(scaler), *[id(value) for value in optimizer.state[parameter].values()]]
            peaks_before = [torch.cuda.max_memory_allocated(), torch.cuda.max_memory_reserved()]
            if reclaim:
                optimizer.zero_grad(set_to_none=True)
                release_unused_cache(torch)
            after = state()
            identities_kept = identity == [id(parameter), id(optimizer), id(scaler), *[id(value) for value in optimizer.state[parameter].values()]]
            peaks_after = [torch.cuda.max_memory_allocated(), torch.cuda.max_memory_reserved()]
            observed = {"reclaimed": reclaim, "stateBefore": before, "stateAfter": after,
                        "persistentIdentitiesKept": identities_kept, "peaksBefore": peaks_before, "peaksAfter": peaks_after,
                        "cumulativePeaksPreserved": all(new >= old for old, new in zip(peaks_before, peaks_after))}
            with (output_dir / "reclamation-control-progress.jsonl").open("a", encoding="utf-8", newline="\n") as stream:
                stream.write(json.dumps(observed, sort_keys=True) + "\n")
            require(before == after and identities_kept and observed["cumulativePeaksPreserved"], "reclamation_changed_persistent_state_rng_or_peaks")
            gradients_cleared = parameter.grad is None
            next_step = step()
            result = {**observed, "firstStep": first, "gradientsCleared": gradients_cleared,
                      "nextStep": next_step, "finalState": state()}
            return result

        report["cases"].append(case(False))
        release_unused_cache(torch)
        report["cases"].append(case(True))
        release_unused_cache(torch)
    reference, reclaimed = report["cases"]
    report.update(trainingRngRestored=torch.equal(before_cpu, torch.get_rng_state()) and torch.equal(before_cuda, torch.cuda.get_rng_state()),
                  firstStepEqual=reference["firstStep"] == reclaimed["firstStep"],
                  nextStepEqual=reference["nextStep"] == reclaimed["nextStep"],
                  finalStateEqual=reference["finalState"] == reclaimed["finalState"])
    report["passed"] = all(report[key] for key in ("trainingRngRestored", "firstStepEqual", "nextStepEqual", "finalStateEqual")) and reclaimed["gradientsCleared"]
    write(output_dir / "reclamation-control.json", report)
    phases.sample("reclamation_control_after", torch, controlPassed=report["passed"])
    require(report["passed"], "reclamation_state_or_next_step_control_failed")
    return report
