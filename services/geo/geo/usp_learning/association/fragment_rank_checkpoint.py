"""Bounded safetensors/JSON full-state persistence; no pickle or model loader.

State coverage follows PyTorch v2.8.0 GradScaler.state_dict and Accelerate
v1.10.1 checkpointing guidance (BSD-style / Apache-2.0 respectively). No upstream
serialization code is copied: explicit JSON and safetensors replace pickle.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import os
from pathlib import Path
import random
import stat
import struct

from .validation import require, strict_json

VERSION = "association-rank-full-state/1"
FILES = ("state.json", "tensors.safetensors", "manifest.json")
MAX_JSON, MAX_TENSORS, MAX_HEADER = 512 * 1024, 8 * 1024**2, 256 * 1024
PROOF_POLICY = {"version": "association-rank-checkpoint-equivalence/1", "device": "cuda",
    "dropout": 0.05, "updates": 4, "splitAfter": 2, "freshObjects": True,
    "actualSerializerAndRestore": True, "comparison": "exact next losses/gradients/masters/AdamW/scaler/CPU-CUDA-Python RNG/cursor",
    "trainingRngRestored": True, "atol": 0, "rtol": 0}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def same(a, b):
    return canonical(a) == canonical(b)


def exact(value, keys, code):
    require(type(value) is dict and set(value) == set(keys), code)


def finite(value):
    require(type(value) in (float, int) and math.isfinite(value), "checkpoint_nonfinite_number")
    return value


def checked_path(path):
    path = Path(path)
    require(path.is_absolute() and path == path.resolve(), "checkpoint_path_alias")
    for part in (path, *path.parents):
        if part.exists():
            info = part.lstat()
            require(not part.is_symlink() and not getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT,
                    "checkpoint_reparse_refused")
    return path


def read_bytes(path, maximum):
    path = checked_path(path)
    require(path.is_file() and 0 < path.stat().st_size <= maximum, "checkpoint_file_bound")
    with path.open("rb") as stream:
        raw = stream.read(maximum + 1)
    require(0 < len(raw) <= maximum, "checkpoint_read_bound")
    return raw


def durable_write(path, raw):
    checked_path(path)
    with Path(path).open("xb") as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())


def production_shapes():
    return {f"base_model.model.model.layers.{layer}.self_attn.{projection}.lora_{part}.default.weight":
        ([8, 896] if part == "A" else [896 if projection == "q_proj" else 128, 8])
        for layer in range(24) for projection in ("q_proj", "v_proj") for part in ("A", "B")}


def schema():
    return {"version": VERSION, "files": list(FILES), "maxJsonBytes": MAX_JSON, "maxTensorFileBytes": MAX_TENSORS,
        "masterShapes": production_shapes(), "tensorRoles": ["master", "exp_avg", "exp_avg_sq", "step"],
        "masterAndMomentsDtype": "F32", "step": {"dtype": "F32", "shape": [], "device": "cpu"},
        "rng": {"torch_cpu": {"dtype": "U8", "shape": [5056]}, "torch_cuda": {"dtype": "U8", "shape": [16]},
                "python": "version3, 624 uint32 words plus index0..624, optional finite Gaussian cache"},
        "scalerKeys": ["scale", "growth_factor", "backoff_factor", "growth_interval", "_growth_tracker"],
        "unusedRng": ["NumPy"], "boundaries": [20, 40, 60], "manifestPublishedLast": True}


def tensor_specs(shapes):
    result = {role + ":" + name: {"dtype": "F32", "shape": [] if role == "step" else shape}
              for name, shape in shapes.items() for role in ("master", "exp_avg", "exp_avg_sq", "step")}
    return {**result, "rng:torch_cpu": {"dtype": "U8", "shape": [5056]}, "rng:torch_cuda": {"dtype": "U8", "shape": [16]}}


def checked_tensor_bytes(raw, shapes, updates):
    """Validate bounded native file structure and numeric payload before native load."""
    require(8 < len(raw) <= MAX_TENSORS, "checkpoint_tensor_size")
    size = struct.unpack("<Q", raw[:8])[0]
    require(0 < size <= MAX_HEADER and 8 + size <= len(raw), "checkpoint_tensor_header_bound")
    header = strict_json(raw[8:8 + size]); specs = tensor_specs(shapes)
    exact(header, specs, "checkpoint_tensor_names")
    ranges = []
    for name, spec in specs.items():
        row = header[name]; exact(row, ("dtype", "shape", "data_offsets"), "checkpoint_tensor_header_fields")
        require(same({k: row[k] for k in ("dtype", "shape")}, spec), "checkpoint_tensor_shape_dtype")
        offsets = row["data_offsets"]
        require(type(offsets) is list and len(offsets) == 2 and all(type(n) is int and n >= 0 for n in offsets), "checkpoint_tensor_offsets")
        start, end = offsets; count = math.prod(spec["shape"])
        require(end - start == count * (4 if spec["dtype"] == "F32" else 1) and 8 + size + end <= len(raw), "checkpoint_tensor_extent")
        ranges.append((start, end))
        if spec["dtype"] == "F32":
            values = struct.iter_unpack("<f", memoryview(raw)[8 + size + start:8 + size + end])
            for (value,) in values:
                require(math.isfinite(value), "checkpoint_nonfinite_tensor")
                if name.startswith("step:"): require(value == updates, "checkpoint_adam_step_cursor")
                if name.startswith("exp_avg_sq:"): require(value >= 0, "checkpoint_negative_second_moment")
    ordered = sorted(ranges)
    require(ordered[0][0] == 0 and all(a[1] == b[0] for a, b in zip(ordered, ordered[1:]))
            and ordered[-1][1] == len(raw) - 8 - size, "checkpoint_tensor_gaps_overlap_or_suffix")
    return header


def python_rng(value):
    require(type(value) is list and len(value) == 3 and type(value[0]) is int and value[0] == 3,
            "checkpoint_python_rng_version")
    words = value[1]
    require(type(words) is list and len(words) == 625 and all(type(n) is int and 0 <= n < 2**32 for n in words[:-1])
            and type(words[-1]) is int and 0 <= words[-1] <= 624, "checkpoint_python_rng_words")
    require(value[2] is None or type(value[2]) is float and math.isfinite(value[2]), "checkpoint_python_rng_gaussian")
    return (3, tuple(words), value[2])


def checked_group(group, names):
    required = {"params", "lr", "betas", "eps", "weight_decay", "amsgrad", "maximize", "foreach", "capturable", "differentiable", "fused"}
    require(type(group) is dict and set(group) in (required, required | {"decoupled_weight_decay"}), "checkpoint_optimizer_group_fields")
    expected = {"params": names, "lr": 0.0002, "betas": [0.9, 0.999], "eps": 1e-8, "weight_decay": 0,
        "amsgrad": False, "maximize": False, "foreach": None, "capturable": False, "differentiable": False, "fused": None}
    require(all(same(group[k], v) for k, v in expected.items()) and group.get("decoupled_weight_decay", True) is True,
            "checkpoint_optimizer_recipe_or_order")


def checked_state(value, binding, shapes, schedule, boundaries):
    exact(value, ("version", "binding", "masterNames", "optimizerGroup", "scaler", "cursor", "pythonRng"), "checkpoint_state_fields")
    require(value["version"] == VERSION and same(value["binding"], binding) and value["masterNames"] == list(shapes), "checkpoint_state_identity")
    cursor = value["cursor"]
    exact(cursor, ("updates", "contributions", "losses", "scheduleSha256"), "checkpoint_cursor_fields")
    update = cursor["updates"]
    require(type(update) is int and update in boundaries and 0 < update <= len(schedule), "checkpoint_boundary_cursor")
    require(type(cursor["contributions"]) is int and cursor["contributions"] == sum(r["candidates"] for r in schedule[:update])
            and cursor["scheduleSha256"] == sha(canonical(schedule)), "checkpoint_contribution_or_order_cursor")
    require(type(cursor["losses"]) is list and len(cursor["losses"]) == update
            and all(type(v) in (float, int) and math.isfinite(v) and v >= 0 for v in cursor["losses"]), "checkpoint_loss_prefix")
    checked_group(value["optimizerGroup"], list(shapes))
    scaler = value["scaler"]
    exact(scaler, schema()["scalerKeys"], "checkpoint_scaler_fields")
    require(type(scaler["scale"]) in (int, float) and scaler["scale"] == 128.0
            and scaler["growth_factor"] == 2.0 and scaler["backoff_factor"] == 0.5
            and type(scaler["growth_interval"]) is int and scaler["growth_interval"] == 2000
            and type(scaler["_growth_tracker"]) is int and scaler["_growth_tracker"] == update,
            "checkpoint_scaler_recipe_or_skipped_step")
    python_rng(value["pythonRng"])
    return value


def rng_snapshot(torch):
    require(torch.cuda.device_count() == 1, "checkpoint_single_cuda_device_required")
    return {"torch_cpu": torch.get_rng_state().clone(), "torch_cuda": torch.cuda.get_rng_state(0).clone(),
            "python": random.getstate()}


def rng_restore(torch, value):
    torch.set_rng_state(value["torch_cpu"]); torch.cuda.set_rng_state(value["torch_cuda"], 0); random.setstate(value["python"])


def rng_equal(torch, a, b):
    return a["python"] == b["python"] and all(torch.equal(a[k], b[k]) for k in ("torch_cpu", "torch_cuda"))


def capture(torch, trainable, optimizer, scaler, binding, cursor, shapes, schedule, boundaries):
    require([n for n, _ in trainable] == list(shapes) and len(optimizer.param_groups) == 1, "checkpoint_parameter_order")
    params = [p for _, p in trainable]; group = optimizer.param_groups[0]
    require(len(group["params"]) == len(params) and all(a is b for a, b in zip(group["params"], params)), "checkpoint_optimizer_parameters")
    require(set(optimizer.state) == set(params), "checkpoint_optimizer_state_set")
    group = {**{k: v for k, v in group.items() if k != "params"}, "params": list(shapes)}
    group = strict_json(canonical(group))
    rng = rng_snapshot(torch); tensors = {"rng:torch_cpu": rng["torch_cpu"], "rng:torch_cuda": rng["torch_cuda"]}
    for name, p in trainable:
        require(p.grad is None and p.dtype == torch.float32 and list(p.shape) == shapes[name], "checkpoint_live_gradient_or_master_drift")
        state = optimizer.state[p]; exact(state, ("step", "exp_avg", "exp_avg_sq"), "checkpoint_adam_fields")
        tensors["master:" + name] = p.detach().cpu().contiguous().clone()
        for key, value in state.items():
            require(value.dtype == torch.float32 and list(value.shape) == ([] if key == "step" else shapes[name]), "checkpoint_adam_shape_dtype")
            if key == "step": require(value.device.type == "cpu", "checkpoint_adam_step_device")
            tensors[key + ":" + name] = value.detach().cpu().contiguous().clone()
    metadata = {"version": VERSION, "binding": copy.deepcopy(binding), "masterNames": list(shapes),
        "optimizerGroup": group, "scaler": scaler.state_dict(), "cursor": copy.deepcopy(cursor),
        "pythonRng": [rng["python"][0], list(rng["python"][1]), rng["python"][2]]}
    checked_state(metadata, binding, shapes, schedule, boundaries)
    return metadata, tensors


def native_codec():
    from safetensors.torch import save, load
    return save, load


def publish(directory, state, tensors, *, torch, binding, shapes, schedule, boundaries, codec=None):
    """Exclusive durable files; manifest appears only after exact native readback."""
    before = rng_snapshot(torch)
    checked_state(state, binding, shapes, schedule, boundaries)
    save, load = native_codec() if codec is None else codec
    raw = save(tensors); checked_tensor_bytes(raw, shapes, state["cursor"]["updates"])
    metadata = canonical(state); require(len(metadata) <= MAX_JSON, "checkpoint_json_bound")
    directory = checked_path(directory); directory.mkdir()
    durable_write(directory / FILES[0], metadata); durable_write(directory / FILES[1], raw)
    back = read_bytes(directory / FILES[1], MAX_TENSORS); restored = load(back)
    require(read_bytes(directory / FILES[0], MAX_JSON) == metadata and back == raw
            and set(restored) == set(tensors) and all(torch.equal(restored[k], tensors[k]) for k in tensors), "checkpoint_roundtrip_not_exact")
    require(rng_equal(torch, before, rng_snapshot(torch)), "checkpoint_save_changed_rng")
    manifest = {"version": VERSION, "files": {FILES[0]: {"bytes": len(metadata), "sha256": sha(metadata)},
        FILES[1]: {"bytes": len(raw), "sha256": sha(raw)}}, "bindingSha256": sha(canonical(binding)),
        "tensorSpecsSha256": sha(canonical(tensor_specs(shapes))), "updates": state["cursor"]["updates"],
        "roundtripExact": True, "rngUnchanged": True}
    durable_write(directory / FILES[2], canonical(manifest))
    return manifest


def read_checkpoint(paths, *, binding, shapes, schedule, boundaries, expected_pins=None):
    require(set(paths) == set(FILES) and len({str(checked_path(p)).casefold() for p in paths.values()}) == 3, "checkpoint_file_map")
    raw = {name: read_bytes(path, MAX_TENSORS if name == FILES[1] else MAX_JSON) for name, path in paths.items()}
    if expected_pins is not None:
        require(set(expected_pins) == set(FILES) and all(sha(raw[n]) == expected_pins[n] for n in FILES), "checkpoint_external_pins")
    manifest = strict_json(raw[FILES[2]])
    exact(manifest, ("version", "files", "bindingSha256", "tensorSpecsSha256", "updates", "roundtripExact", "rngUnchanged"), "checkpoint_manifest_fields")
    require(manifest["version"] == VERSION and manifest["roundtripExact"] is True and manifest["rngUnchanged"] is True
            and manifest["bindingSha256"] == sha(canonical(binding)) and manifest["tensorSpecsSha256"] == sha(canonical(tensor_specs(shapes))), "checkpoint_manifest_identity")
    exact(manifest["files"], FILES[:2], "checkpoint_manifest_file_set")
    for name in FILES[:2]:
        require(same(manifest["files"][name], {"bytes": len(raw[name]), "sha256": sha(raw[name])}), "checkpoint_manifest_file_pin")
    state = checked_state(strict_json(raw[FILES[0]]), binding, shapes, schedule, boundaries)
    require(type(manifest["updates"]) is int and manifest["updates"] == state["cursor"]["updates"], "checkpoint_manifest_cursor")
    checked_tensor_bytes(raw[FILES[1]], shapes, manifest["updates"])
    return state, raw[FILES[1]], manifest


def restore(state, raw, *, torch, trainable, optimizer, scaler, binding, shapes, schedule, boundaries, codec=None):
    checked_state(state, binding, shapes, schedule, boundaries)
    checked_tensor_bytes(raw, shapes, state["cursor"]["updates"])
    _, load = native_codec() if codec is None else codec; tensors = load(raw)
    require([n for n, _ in trainable] == list(shapes) and len(optimizer.param_groups) == 1 and not optimizer.state,
            "checkpoint_fresh_optimizer_required")
    group = optimizer.param_groups[0]; params = [p for _, p in trainable]
    require(len(group["params"]) == len(params) and all(a is b for a, b in zip(group["params"], params)), "checkpoint_restore_parameter_order")
    require(same({**{k: v for k, v in group.items() if k != "params"}, "params": list(shapes)}, state["optimizerGroup"]), "checkpoint_fresh_optimizer_recipe")
    with torch.no_grad():
        for name, p in trainable:
            require(p.grad is None and p.dtype == torch.float32 and list(p.shape) == shapes[name], "checkpoint_restore_master_shape")
            p.copy_(tensors["master:" + name])
            optimizer.state[p] = {key: tensors[key + ":" + name].to("cpu" if key == "step" else p.device).clone()
                                  for key in ("step", "exp_avg", "exp_avg_sq")}
    scaler.load_state_dict(state["scaler"])
    rng_restore(torch, {"torch_cpu": tensors["rng:torch_cpu"], "torch_cuda": tensors["rng:torch_cuda"], "python": python_rng(state["pythonRng"])})
    actual, copied = capture(torch, trainable, optimizer, scaler, binding, state["cursor"], shapes, schedule, boundaries)
    require(same(actual, state) and set(copied) == set(tensors) and all(torch.equal(copied[k], tensors[k]) for k in tensors), "checkpoint_restore_not_exact")
    return copy.deepcopy(state["cursor"])


def run_equivalence(torch, output_dir, write, phases):
    """Future native four-step proof; serialize and restore fresh stochastic objects."""
    before = rng_snapshot(torch); result = {"passed": False, "policy": PROOF_POLICY}
    shapes = {"proof.weight": [4, 4]}
    schedule = [{"candidates": 1, "update": i} for i in range(1, 5)]
    binding = {"syntheticOnly": True, "policy": PROOF_POLICY}
    cursor = lambda losses: {"updates": len(losses), "contributions": len(losses), "losses": losses,
                             "scheduleSha256": sha(canonical(schedule))}

    def fresh():
        model = torch.nn.Sequential(torch.nn.Linear(4, 4, bias=False), torch.nn.Dropout(0.05)).to("cuda").train()
        named = [("proof.weight", model[0].weight)]
        optimizer = torch.optim.AdamW([named[0][1]], lr=0.0002, betas=(0.9, 0.999), eps=1e-8, weight_decay=0)
        scaler = torch.amp.GradScaler("cuda", init_scale=128.0, growth_interval=2000)
        return model, named, optimizer, scaler

    def step(objects):
        model, named, optimizer, scaler = objects
        optimizer.zero_grad(set_to_none=True)
        value = torch.rand((2, 4), device="cuda") + random.random() + float(torch.rand(()))
        with torch.autocast("cuda", dtype=torch.float16):
            loss = model(value).float().square().mean()
        require(bool(torch.isfinite(loss)), "checkpoint_proof_loss")
        scaler.scale(loss).backward(); scaler.unscale_(optimizer)
        gradient = named[0][1].grad.detach().cpu().clone()
        require(bool(torch.isfinite(gradient).all()), "checkpoint_proof_gradient")
        torch.nn.utils.clip_grad_norm_([named[0][1]], 1.0, error_if_nonfinite=True)
        scaler.step(optimizer); scaler.update(); optimizer.zero_grad(set_to_none=True); torch.cuda.synchronize()
        return float(loss.detach()), gradient

    try:
        torch.manual_seed(3017); random.seed(3017)
        reference = fresh(); losses = [step(reference)[0] for _ in range(2)]
        state, tensors = capture(torch, *reference[1:], binding, cursor(losses), shapes, schedule, (2, 4))
        directory = Path(output_dir) / "checkpoint-equivalence-state"
        publish(directory, state, tensors, torch=torch, binding=binding, shapes=shapes, schedule=schedule, boundaries=(2, 4))
        reference_tail = [step(reference) for _ in range(2)]
        expected, expected_tensors = capture(torch, *reference[1:], binding,
            cursor(losses + [v for v, _ in reference_tail]), shapes, schedule, (2, 4))
        resumed = fresh()
        saved, raw, _ = read_checkpoint({name: directory / name for name in FILES}, binding=binding, shapes=shapes,
                                       schedule=schedule, boundaries=(2, 4))
        restored = restore(saved, raw, torch=torch, trainable=resumed[1], optimizer=resumed[2], scaler=resumed[3],
            binding=binding, shapes=shapes, schedule=schedule, boundaries=(2, 4))
        resumed_tail = [step(resumed) for _ in range(2)]
        actual, actual_tensors = capture(torch, *resumed[1:], binding,
            cursor(restored["losses"] + [v for v, _ in resumed_tail]), shapes, schedule, (2, 4))
        require([v for v, _ in reference_tail] == [v for v, _ in resumed_tail]
                and all(torch.equal(a[1], b[1]) for a, b in zip(reference_tail, resumed_tail))
                and same(expected, actual) and all(torch.equal(expected_tensors[k], actual_tensors[k]) for k in expected_tensors),
                "checkpoint_native_split_equivalence_failed")
        result.update(passed=True, freshObjects=True, exactLossesGradientsMastersOptimizerScalerRngCursor=True,
                      continuationLosses=[v for v, _ in resumed_tail], native=True)
    except Exception as error:
        result["error"] = str(error)
        raise
    finally:
        rng_restore(torch, before)
        result["trainingRngRestored"] = rng_equal(torch, before, rng_snapshot(torch))
        write(Path(output_dir) / "checkpoint-equivalence.json", result)
    require(result["trainingRngRestored"], "checkpoint_control_rng_restore")
    phases.sample("checkpoint_equivalence_passed", torch)
    return result
