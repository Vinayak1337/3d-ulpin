"""Pinned local Granite Docling page/region extraction with bounded inputs."""

from __future__ import annotations

import hashlib
import math
import os
import sys
import time
from pathlib import Path
from typing import Any

import fitz
import psutil
from PIL import Image

if os.name != "nt":
    import resource


MODEL_ID = "ibm-granite/granite-docling-258M"
MODEL_REVISION = "982fe3b40f2fa73c365bdb1bcacf6c81b7184bfe"
MODEL_LICENSE = "Apache-2.0"
MODEL_FILES_SHA256 = {
    "added_tokens.json": "882e49757a3bea90e00df1d2dc8c18b2b526ff77380db20439feeb1f053a63cd",
    "chat_template.jinja": "a4b0bf4348b014acca131da664d05b61e39d5dc8af980f1913846a57ccc6d289",
    "config.json": "4fbb5d2ad9549663e5740b36a5f45cb3d861d20d2e1c158af8569765f9864f30",
    "generation_config.json": "369256b622c73d709b248da31ba4332ef19c01dec6e311d8e4b671bc1321bc06",
    "merges.txt": "b6fe424e334903f7fb84d3a106d9730455f4744b9fe3c21ee136d97a00e72502",
    "model.safetensors": "1cdad234deb1cde18ee6a586f849057f19851daf1fedce2e40aff791dbe46f61",
    "preprocessor_config.json": "6cb6e36d6fcb88ca1502c4a26750715dc3e7dedddc9a8f17b27d8d167d1457e7",
    "processor_config.json": "e7bff42da73ae9eec9042ef20e066e11f1ee20f025358ff79131e3c0fb549b46",
    "special_tokens_map.json": "45c073d82ba37a1fc69c8d6a772d17a8e4f78b64b63c0fce2c77d18a3259d18e",
    "tokenizer.json": "673ef3c60759806916ebf37c5d9b79f7ffd53a1419f1ebd75bfec8f177c2b1b3",
    "tokenizer_config.json": "261f9491897226589c131a4ac5993c495eec2104dace144f69c397682865a3a0",
    "vocab.json": "e2bad0ce74e6ddfece426ef99e18067f4a6c3d4e65bb6dd9cfd638450cca0142",
    "README.md": "b43727febeba2c6ce20b8746322e7687ca667d81a12d0364f346148f30622d84",
}
PROMPT = "Convert this page to docling."
MAX_PIXELS = 1_600_000
MAX_SIDE = 1_400
MAX_GENERATED_TOKENS = 512
MAX_CPU_THREADS = 2
MPS_MEMORY_FRACTION = 0.45


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_model_files(model_dir: Path) -> dict[str, dict[str, Any]]:
    receipt: dict[str, dict[str, Any]] = {}
    for name, expected in MODEL_FILES_SHA256.items():
        path = model_dir / name
        observed = sha256_file(path)
        if observed != expected:
            raise ValueError(f"pinned Granite Docling file mismatch: {name}")
        receipt[name] = {"bytes": path.stat().st_size, "sha256": observed}
    return receipt


def render_pdf_region(
    original: Path,
    page_number: int,
    bbox_norm: list[float],
    output_png: Path,
    *,
    max_pixels: int = MAX_PIXELS,
    max_side: int = MAX_SIDE,
) -> dict[str, Any]:
    if page_number < 1 or len(bbox_norm) != 4:
        raise ValueError("page or normalized region outside the bounded profile")
    x0, y0, x1, y1 = bbox_norm
    if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
        raise ValueError("invalid normalized region")
    if not (0 < max_pixels <= MAX_PIXELS and 0 < max_side <= MAX_SIDE):
        raise ValueError("image bound exceeds the trial profile")
    with fitz.open(original) as document:
        if document.needs_pass or page_number > len(document):
            raise ValueError("page unavailable or encrypted")
        page = document[page_number - 1]
        box = page.rect
        clip = fitz.Rect(box.x0 + x0 * box.width, box.y0 + y0 * box.height,
                         box.x0 + x1 * box.width, box.y0 + y1 * box.height)
        scale = min(3.0, max_side / clip.width, max_side / clip.height,
                    math.sqrt(max_pixels / (clip.width * clip.height)))
        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False)
        if pixmap.width * pixmap.height > max_pixels or max(pixmap.width, pixmap.height) > max_side:
            raise ValueError("render exceeded image bounds")
        output_png.parent.mkdir(parents=True, exist_ok=True)
        pixmap.save(output_png)
        return {
            "pdfPage": page_number, "bboxNorm": bbox_norm, "bboxPoints": [round(v, 3) for v in clip],
            "width": pixmap.width, "height": pixmap.height, "pixels": pixmap.width * pixmap.height,
            "scale": round(scale, 6), "sha256": sha256_file(output_png), "bytes": output_png.stat().st_size,
        }


def select_runtime(requested_device: str) -> tuple[str, Any]:
    if requested_device not in {"auto", "cpu", "mps"}:
        raise ValueError("unsupported document model device")
    import torch

    mps_available = torch.backends.mps.is_available()
    if requested_device == "mps" and not mps_available:
        raise RuntimeError("MPS was requested but is unavailable")
    device = ("mps" if mps_available else "cpu") if requested_device == "auto" else requested_device
    dtype = torch.bfloat16 if device == "mps" else torch.float32
    return device, dtype


def extract_region(image_path: Path, model_dir: Path, *, max_new_tokens: int = MAX_GENERATED_TOKENS,
                   cpu_threads: int = MAX_CPU_THREADS, device_choice: str = "auto") -> dict[str, Any]:
    """Run local image-to-DocTags inference; all output remains model-derived."""
    if not (1 <= max_new_tokens <= MAX_GENERATED_TOKENS and 1 <= cpu_threads <= MAX_CPU_THREADS):
        raise ValueError("inference bound exceeds the trial profile")
    verify_model_files(model_dir)
    import torch
    from transformers import AutoModelForVision2Seq, AutoProcessor

    torch.set_num_threads(cpu_threads)
    device, dtype = select_runtime(device_choice)
    if device == "mps":
        torch.mps.set_per_process_memory_fraction(MPS_MEMORY_FRACTION)
    started = time.monotonic()
    processor = AutoProcessor.from_pretrained(model_dir, local_files_only=True, trust_remote_code=False)
    model = AutoModelForVision2Seq.from_pretrained(
        model_dir, local_files_only=True, trust_remote_code=False,
        use_safetensors=True, torch_dtype=dtype, attn_implementation="sdpa",
    ).to(device).eval()
    with Image.open(image_path) as source_image:
        if source_image.width * source_image.height > MAX_PIXELS or max(source_image.size) > MAX_SIDE:
            raise ValueError("image exceeds bounded page pixels")
        image = source_image.convert("RGB")
    messages = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": PROMPT}]}]
    prompt = processor.apply_chat_template(messages, add_generation_prompt=True)
    batch = processor(text=prompt, images=[image], return_tensors="pt").to(device)
    with torch.inference_mode():
        generated = model.generate(**batch, max_new_tokens=max_new_tokens, do_sample=False, num_beams=1)
    input_tokens = int(batch.input_ids.shape[1])
    output_tokens = int(generated.shape[1] - input_tokens)
    doctags = processor.batch_decode(generated[:, input_tokens:], skip_special_tokens=False)[0].lstrip()
    markdown: str | None = None
    parse_error: str | None = None
    try:
        from docling_core.types.doc import DoclingDocument
        from docling_core.types.doc.document import DocTagsDocument
        parsed = DocTagsDocument.from_doctags_and_image_pairs([doctags], [image])
        markdown = DoclingDocument.load_from_doctags(parsed, document_name="Offline candidate region").export_to_markdown()
    except Exception as exc:
        parse_error = f"{type(exc).__name__}: {exc}"
    if os.name == "nt":
        memory = psutil.Process().memory_info()
        peak_rss = int(getattr(memory, "peak_wset", memory.rss))
    else:
        peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        if sys.platform != "darwin":
            peak_rss *= 1024
    return {
        "modelDerived": True, "nativeText": False, "model": MODEL_ID, "revision": MODEL_REVISION,
        "prompt": PROMPT, "device": device, "dtype": str(dtype), "inputTokens": input_tokens,
        "generatedTokens": output_tokens, "hitTokenCap": output_tokens >= max_new_tokens,
        "doctags": doctags, "markdown": markdown, "parseError": parse_error,
        "hasAlphanumericMarkdown": any(character.isalnum() for character in markdown or ""),
        "elapsedSeconds": round(time.monotonic() - started, 3), "peakProcessRssBytes": peak_rss,
        "mpsDriverAllocatedBytes": int(torch.mps.driver_allocated_memory()) if device == "mps" else None,
    }
