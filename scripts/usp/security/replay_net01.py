"""Read-only one-field saved-adapter replay inside the NET-01 AppContainer."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import ntpath
import os
from pathlib import Path
import sys
import traceback


os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
                  TOKENIZERS_PARALLELISM="false", OMP_NUM_THREADS="2", MKL_NUM_THREADS="2",
                  CUBLAS_WORKSPACE_CONFIG=":4096:8")
network_events: Counter[str] = Counter()
network_details: list[dict] = []


def audit(event: str, arguments: tuple) -> None:
    if event.startswith("socket.") or event == "subprocess.Popen":
        network_events[event] += 1
        if event == "socket.bind" and len(arguments) > 1:
            address = arguments[1]
            if isinstance(address, tuple) and len(address) >= 2:
                host = str(address[0])
                network_details.append({"event": event, "host": host if host in ("", "127.0.0.1", "::1") else "sha256:" + hashlib.sha256(host.encode()).hexdigest(),
                                        "port": address[1], "stack": [(Path(frame.filename).name, frame.lineno, frame.name)
                                                                        for frame in traceback.extract_stack(limit=8)[:-1]]})
        elif event == "subprocess.Popen" and arguments:
            executable = str(arguments[0])
            network_details.append({"event": event, "executableBaseName": ntpath.basename(executable),
                                    "argumentSha256": hashlib.sha256(repr(arguments[1] if len(arguments) > 1 else None).encode()).hexdigest(),
                                    "stack": [(Path(frame.filename).name, frame.lineno, frame.name)
                                              for frame in traceback.extract_stack(limit=8)[:-1]]})


sys.addaudithook(audit)


def score(root: Path) -> dict:
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    selected = json.loads((root / "development/selected-inputs.json").read_text(encoding="utf-8"))
    expected = json.loads((root / "development/reload.json").read_text(encoding="utf-8"))
    assert selected["fields"][0]["split"] == "train" and expected["pairIndices"] == [0, 1, 2]
    prompts = selected["prompts"][:3]
    torch.set_num_threads(2)
    torch.set_num_interop_threads(2)
    torch.manual_seed(17)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cudnn.benchmark = False
    torch.use_deterministic_algorithms(True)
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable inside AppContainer")
    free, total = torch.cuda.mem_get_info()
    if free < 1536 * 1024**2 + 2 * 1024**3:
        raise RuntimeError("insufficient initial GPU headroom")
    torch.cuda.set_per_process_memory_fraction(6 * 1024**3 / total)
    torch.cuda.reset_peak_memory_stats()
    minimum_free = free

    def check_gpu() -> None:
        nonlocal minimum_free
        torch.cuda.synchronize()
        now, _ = torch.cuda.mem_get_info()
        minimum_free = min(minimum_free, now)
        if (torch.cuda.max_memory_allocated() > 6 * 1024**3 or
                torch.cuda.max_memory_reserved() > 6 * 1024**3 or now < 1536 * 1024**2):
            raise RuntimeError("GPU budget exceeded")

    model_dir = root / "model"
    adapter_dir = root / "development/adapter"
    tokenizer = AutoTokenizer.from_pretrained(model_dir, padding_side="left", local_files_only=True,
                                               trust_remote_code=False)
    tokens = [tokenizer(p, add_special_tokens=False, truncation=False, return_tensors="pt") for p in prompts]
    if max(batch["input_ids"].shape[1] for batch in tokens) > 512:
        raise RuntimeError("unexpected prompt truncation")
    yes, no = tokenizer.convert_tokens_to_ids("yes"), tokenizer.convert_tokens_to_ids("no")
    if yes == no or yes == tokenizer.unk_token_id or no == tokenizer.unk_token_id:
        raise RuntimeError("invalid yes/no tokens")
    base = AutoModelForCausalLM.from_pretrained(
        model_dir, torch_dtype=torch.float16, attn_implementation="sdpa",
        local_files_only=True, trust_remote_code=False, use_safetensors=True).to("cuda")
    model = PeftModel.from_pretrained(base, adapter_dir, is_trainable=False, local_files_only=True).eval()
    check_gpu()
    margins, probabilities = [], []
    with torch.inference_mode():
        for batch in tokens:
            batch = {key: value.to("cuda") for key, value in batch.items()}
            with torch.autocast("cuda", dtype=torch.float16):
                logits = model(**batch, use_cache=False, logits_to_keep=1).logits
            margins.append((logits[:, -1, yes].float() - logits[:, -1, no].float()).item())
            probabilities.append(torch.softmax(logits[:, -1, [no, yes]].float(), dim=-1)[0, 1].item())
            check_gpu()
    return {"status": "score_replay", "pairIndices": [0, 1, 2], "margins": margins,
            "scores": probabilities, "exactMatch": margins == expected["margins"] and probabilities == expected["scores"],
            "gpuPeakAllocatedBytes": torch.cuda.max_memory_allocated(),
            "gpuPeakReservedBytes": torch.cuda.max_memory_reserved(),
            "minimumSampledFreeGpuBytes": minimum_free, "torchThreads": torch.get_num_threads()}


def missing_config(root: Path) -> dict:
    from peft import PeftConfig

    empty = root / "development/missing-adapter-config"
    if not empty.is_dir() or any(empty.iterdir()):
        raise RuntimeError("missing-config fixture must be an empty owned directory")
    try:
        PeftConfig.from_pretrained(empty, local_files_only=True)
    except Exception as error:
        return {"status": "missing_config_failed_closed", "exceptionType": type(error).__name__,
                "message": str(error)[:300]}
    raise RuntimeError("missing local adapter config was unexpectedly accepted")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("score", "missing-config"))
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    result = score(args.root) if args.mode == "score" else missing_config(args.root)
    result["pythonAuditEvents"] = dict(network_events)
    result["pythonAuditDetails"] = network_details
    print(json.dumps(result, sort_keys=True), flush=True)
    if result.get("exactMatch") is False:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
