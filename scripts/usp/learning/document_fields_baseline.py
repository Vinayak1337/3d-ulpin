#!/usr/bin/env python3
"""Offline, bounded PDF-region observations and literal field proposals for review.

Commands: render, ocr, model, propose. No API save payload or canonical identity
is produced. Existing source-ocr-candidate/1 results can be reused as observations.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.metadata
import io
import json
import math
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

SCRIPT = Path(__file__).resolve()
REPO = SCRIPT.parents[3]
MAX_JSON = 512 * 1024
MEMORY = 6 * 1024**3
MAX_LINES = 256
MAX_WORDS = 1024
MAX_TEXT = 32 * 1024
MAX_STORE = 8 * 1024**2


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def pin(path: Path) -> dict:
    return {"path": str(path.resolve()), "bytes": path.stat().st_size, "sha256": digest(path)}


def load(path: Path) -> dict:
    if not 0 < path.stat().st_size <= MAX_JSON:
        raise ValueError("JSON exceeds the bounded profile")
    value = json.loads(path.read_bytes(), parse_constant=lambda v: (_ for _ in ()).throw(ValueError(v)))
    if not isinstance(value, dict):
        raise ValueError("JSON object required")
    return value


def save(path: Path, value: dict, limit: int = MAX_JSON) -> None:
    data = (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode()
    if len(data) > limit:
        raise ValueError("result exceeds byte bound")
    with path.open("xb") as stream:
        stream.write(data)


def checked(entry: dict) -> Path:
    path = Path(entry["path"])
    if pin(path) != {"path": str(path.resolve()), "bytes": entry["bytes"], "sha256": entry["sha256"]}:
        raise ValueError("input pin mismatch")
    return path


def helpers() -> None:
    sys.path.insert(0, str(REPO / "services" / "geo"))
    sys.path.insert(0, str(REPO / "scripts" / "usp" / "document-models"))


def offline() -> None:
    os.environ.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
                       "HF_HUB_DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1",
                       "CUDA_VISIBLE_DEVICES": "", "PYTHONDONTWRITEBYTECODE": "1",
                       "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2",
                       "OPENBLAS_NUM_THREADS": "2", "TOKENIZERS_PARALLELISM": "false"})
    def deny_network(event, arguments):
        if event in {"socket.connect", "socket.getaddrinfo", "socket.bind", "socket.sendto"}:
            raise RuntimeError("external Python network access denied")
    # Keep socket classes intact: ssl subclasses them during torch import.
    sys.addaudithook(deny_network)


def source_bytes(path: Path, expected: str) -> bytes:
    if not 0 < path.stat().st_size <= 16 * 1024**2:
        raise ValueError("source byte limit")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("source hash mismatch")
    return data


def crop_record(path: Path, source: Path) -> tuple[dict, Path]:
    record = load(path)
    source_bytes(source, record["sourceSha256"])
    if record.get("schemaVersion") == "document-field-crop/1":
        image = checked(record["ocrImage"])
    elif record.get("schemaVersion") == "source-ocr-candidate/1":
        image = path.parent / "render.png"
        if (digest(image) != record["render"]["pngSha256"]
                or image.stat().st_size != record["render"]["pngBytes"]):
            raise ValueError("retained render pin mismatch")
    else:
        raise ValueError("unsupported crop provenance")
    return record, image


def render(args) -> dict:
    import fitz
    from PIL import Image
    from run_pdf_pages import _deny_external_files
    from geo.usp_document_candidates.docling_tesseract import render_pdf_selection, _selection
    data = source_bytes(args.source, args.expected_source_sha256)
    with fitz.open(stream=data, filetype="pdf") as document:
        if document.needs_pass or document.xref_length() > 50_000 or len(document) > 8:
            raise ValueError("unsupported PDF")
        _deny_external_files(document)
        if not 1 <= args.page <= len(document):
            raise ValueError("invalid source page")
        page = document[args.page - 1]
        clip, _ = _selection(page, args.region)
        native = page.get_text("blocks", clip=clip)
        native_lines = [{"text": b[4], "sourcePageBox": list(b[:4])}
                        for b in native if b[6] == 0 and b[4].strip()]
        if len(native_lines) > MAX_LINES or sum(len(b["text"].encode()) for b in native_lines) > MAX_TEXT:
            raise ValueError("native text limit")
    frame = render_pdf_selection(args.source, args.expected_source_sha256, args.page,
                                 args.region, args.output / "render.png")
    scale = frame["render"]["scale"]
    ox, oy = frame["render"]["pixelOrigin"]
    width, height = frame["render"]["pixels"]
    affine = [1/scale, 0, ox/scale, 0, 1/scale, oy/scale]
    image_path = args.output / "render.png"
    if args.rotate_ccw == 90:
        with Image.open(image_path) as image:
            image.transpose(Image.Transpose.ROTATE_90).save(args.output / "upright.png")
        image_path = args.output / "upright.png"
        affine = [0, -1/scale, (ox+width)/scale, 1/scale, 0, oy/scale]
        width, height = height, width
    return {"schemaVersion": "document-field-crop/1", "sourceSha256": frame["source"]["sha256"],
            "sourceBytes": frame["source"]["bytes"], "sourcePath": str(args.source.resolve()),
            "sourcePage": args.page, "sourcePageFrame": frame["pageFrame"],
            "selection": {"sourcePageBox": frame["requestedRegion"], "kind": "selected_region"},
            "render": frame["render"], "rasterRotationCounterclockwiseDegrees": args.rotate_ccw,
            "ocrImage": pin(image_path), "ocrPixels": [width, height],
            "outputPixelEdgeToSourcePagePoints": affine, "nativeLines": native_lines,
            "nativeTextStatus": "available" if native_lines else "absent_in_selected_region"}


def mapped_box(box: list[float], affine: list[float]) -> list[float]:
    a, b, c, d, e, f = affine
    x0, y0, x1, y1 = box
    points = [(a*x+b*y+c, d*x+e*y+f) for x, y in [(x0,y0),(x1,y0),(x0,y1),(x1,y1)]]
    return [min(p[0] for p in points), min(p[1] for p in points),
            max(p[0] for p in points), max(p[1] for p in points)]


def ocr(args) -> dict:
    from geo.usp_document_candidates.docling_tesseract import TESSERACT_SHA256, ENG_SHA256
    crop, image = crop_record(args.crop, args.source)
    if crop.get("schemaVersion") != "document-field-crop/1":
        raise ValueError("reuse retained OCR instead of rerunning it")
    if digest(args.tesseract) != TESSERACT_SHA256 or digest(args.tessdata / "eng.traineddata") != ENG_SHA256:
        raise ValueError("OCR asset mismatch")
    from PIL import Image
    with Image.open(image) as im:
        if list(im.size) != crop["ocrPixels"] or max(im.size) > 1400 or im.width*im.height > 1_600_000:
            raise ValueError("image bound or metadata mismatch")
    command = [str(args.tesseract), str(image), "stdout", "--tessdata-dir", str(args.tessdata),
               "-l", "eng", "--psm", "11", "tsv"]
    os.environ["PATH"] = str(args.tesseract.parent) + os.pathsep + os.environ.get("PATH", "")
    tsv_path = args.output / "words.tsv"
    stderr = ""
    if args.reuse_tsv:
        if (args.reuse_tsv.stat().st_size > 2*1024**2
                or digest(args.reuse_tsv) != args.expected_tsv_sha256):
            raise ValueError("reused TSV pin or byte bound mismatch")
        with tsv_path.open("xb") as out:
            out.write(args.reuse_tsv.read_bytes())
    else:
        with tsv_path.open("xb") as out:
            completed = subprocess.run(command, stdout=out, stderr=subprocess.PIPE, timeout=55,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        stderr = completed.stderr.decode(errors="replace")[:2048]
        if completed.returncode != 0:
            raise ValueError("OCR failed")
    if tsv_path.stat().st_size > 2*1024**2:
        raise ValueError("OCR failed or TSV exceeds bound")
    rows = csv.DictReader(io.StringIO(tsv_path.read_text(encoding="utf-8")), delimiter="\t", quoting=csv.QUOTE_NONE)
    if rows.fieldnames != ["level","page_num","block_num","par_num","line_num","word_num",
                          "left","top","width","height","conf","text"]:
        raise ValueError("invalid TSV header")
    groups = {}
    word_count = 0
    width, height = crop["ocrPixels"]
    for row in rows:
        if row["level"] != "5" or not row["text"].strip():
            continue
        word_count += 1
        if word_count > MAX_WORDS:
            raise ValueError("OCR word limit")
        page, block, par, line, word = [int(row[k]) for k in ["page_num","block_num","par_num","line_num","word_num"]]
        x,y,w,h = [int(row[k]) for k in ["left","top","width","height"]]
        confidence = float(row["conf"])
        if (page != 1 or min(block,par,line,word) < 1 or min(x,y) < 0 or min(w,h) <= 0
                or x+w > width or y+h > height or not math.isfinite(confidence) or not 0 <= confidence <= 100):
            raise ValueError("uncitable OCR word")
        groups.setdefault((block,par,line), []).append({"text": row["text"], "pixelBox": [x,y,x+w,y+h],
                                                       "confidence": confidence})
    if len(groups) > MAX_LINES:
        raise ValueError("OCR line limit")
    lines = []
    for words in groups.values():
        text = " ".join(w["text"] for w in words)
        boxes = [w["pixelBox"] for w in words]
        box = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
        page_box = mapped_box(box, crop["outputPixelEdgeToSourcePagePoints"])
        frame = crop["sourcePageFrame"]
        if min(page_box) < 0 or page_box[2] > frame["width"]+.01 or page_box[3] > frame["height"]+.01:
            raise ValueError("mapped OCR box outside source")
        lines.append({"text": text, "sourcePageBox": page_box, "pixelBox": box, "words": words,
                      "minimumConfidence": min(w["confidence"] for w in words),
                      "quoteVerification": "not_machine_verified",
                      "spacing": "recognized_tokens_joined_with_single_spaces"})
    if sum(len(l["text"].encode()) for l in lines) > MAX_TEXT:
        raise ValueError("OCR text limit")
    return {"schemaVersion": "document-field-ocr/1", "crop": pin(args.crop), "sourceSha256": crop["sourceSha256"],
            "sourcePage": crop["sourcePage"], "lines": lines, "rawTsv": pin(tsv_path),
            "method": "tesseract-cli-5.5.1:english:sparse-psm11", "command": command,
            "assets": {"executable": pin(args.tesseract), "english": pin(args.tessdata / "eng.traineddata")},
            "stderr": stderr, "executionMode": "reused_pinned_tsv" if args.reuse_tsv else "fresh_ocr",
            "reusedTsv": pin(args.reuse_tsv) if args.reuse_tsv else None}


def model(args) -> dict:
    from geo.usp_document_candidates.granite import extract_region, verify_model_files, MODEL_ID, MODEL_REVISION
    crop, image = crop_record(args.crop, args.source)
    result = extract_region(image, args.model_dir, max_new_tokens=96, cpu_threads=2, device_choice="cpu")
    return {"schemaVersion": "document-field-model/1", "crop": pin(args.crop),
            "sourceSha256": crop["sourceSha256"], "sourcePage": crop["sourcePage"],
            "modelId": MODEL_ID, "modelRevision": MODEL_REVISION,
            "modelFiles": verify_model_files(args.model_dir), "result": result,
            "quoteVerification": "not_machine_verified", "citationPrecision": "selected_region_only"}


FIELD_PATTERNS = [("floor_caption", re.compile(r"TYPICAL\s+FLOOR[^\n]*", re.I)),
                  ("source_building_label", re.compile(r"\b(?:TOWER\s*-?\s*\d+|T\s*-\s*\d+)\b", re.I)),
                  ("printed_floor_notation", re.compile(r"\bG\s*\+\s*\d+\b"))]


def propose(args) -> dict:
    inputs = load(args.inputs)
    sources = inputs["sources"]
    if not 1 <= len(sources) <= 2 or sum(len(s["observations"]) for s in sources) > 4:
        raise ValueError("source/observation bound")
    proposals, rejected, provenance = [], [], []
    for source in sources:
        uuid.UUID(source["sourceId"])
        if type(source["sourceRevision"]) is not int or source["sourceRevision"] < 1:
            raise ValueError("source revision required")
        original = checked(source["original"])
        acquisition = checked(source["acquisitionReceipt"])
        receipt = load(acquisition)
        if receipt["sha256"] != source["original"]["sha256"] or receipt["bytes"] != source["original"]["bytes"]:
            raise ValueError("acquisition/source mismatch")
        base = {"sourceId": source["sourceId"], "sourceRevision": source["sourceRevision"],
                "original": source["original"], "originalUrl": receipt["finalUrl"],
                "acquisitionReceipt": source["acquisitionReceipt"]}
        for observation_pin in source["observations"]:
            path = checked(observation_pin)
            observation = load(path)
            kind = observation["schemaVersion"]
            if observation["sourceSha256"] != source["original"]["sha256"]:
                raise ValueError("observation/source mismatch")
            if kind == "source-ocr-candidate/1":
                crop, crop_image = crop_record(path, original)
                lines = [{"text": item["text"], "sourcePageBox": item["sourcePageBoxes"][0]["box"]}
                         for item in observation["items"]]
                method = observation["method"]
            elif kind in {"document-field-ocr/1", "document-field-model/1"}:
                crop_path = checked(observation["crop"])
                crop, crop_image = crop_record(crop_path, original)
                if observation["sourcePage"] != crop["sourcePage"]:
                    raise ValueError("observation page mismatch")
                if kind == "document-field-model/1":
                    r = observation["result"]
                    if r["hitTokenCap"] or r["parseError"] or not r["hasAlphanumericMarkdown"]:
                        rejected.append({**base, "observation": observation_pin, "reason": "model_incomplete_or_unparsed",
                                         "rawOutput": r["doctags"]})
                        continue
                    # Markdown is a presentation serialization (e.g. &amp;).
                    # Preserve the actual generated text payload, including spacing.
                    texts = re.findall(r"<text>(?:<loc_\d+>){4}([^<>]*)</text>", r["doctags"])
                    if not texts:
                        rejected.append({**base, "observation": observation_pin,
                                         "reason": "no_supported_literal_model_text_payload", "rawOutput": r["doctags"]})
                        continue
                    lines = [{"text": t, "sourcePageBox": crop["selection"]["sourcePageBox"]} for t in texts]
                    method = "model:" + observation["modelId"] + "@" + observation["modelRevision"]
                else:
                    checked(observation["rawTsv"])
                    lines, method = observation["lines"], observation["method"]
            else:
                raise ValueError("unsupported observation")
            if len(lines) > MAX_LINES or sum(len(l["text"].encode()) for l in lines) > MAX_TEXT:
                raise ValueError("observation text limit")
            provenance.append({**base, "observation": observation_pin, "sourcePage": crop["sourcePage"],
                               "sourcePageFrame": crop["sourcePageFrame"], "selection": crop["selection"],
                               "render": crop["render"], "rasterRotationCounterclockwiseDegrees": crop.get("rasterRotationCounterclockwiseDegrees", 0),
                               "outputPixelEdgeToSourcePagePoints": crop.get("outputPixelEdgeToSourcePagePoints"),
                               "cropImage": pin(crop_image), "method": method})
            for line in lines:
                text = line["text"]
                found = []
                for role, pattern in FIELD_PATTERNS:
                    for match in pattern.finditer(text):
                        found.append((role, match))
                        if role == "floor_caption":
                            found.extend(("represented_floor_label", m) for m in re.finditer(r"\b\d+(?:st|nd|rd|th)\b", text, re.I))
                for role, match in found:
                    reasons = ["operator_review_required", "no_independent_native_quote_verification"]
                    if line.get("minimumConfidence", 100) < 60:
                        rejected.append({**base, "observation": observation_pin, "quote": match.group(),
                                         "fieldRole": role, "sourcePageBox": line["sourcePageBox"], "reason": "low_ocr_word_confidence"})
                        continue
                    row_context = []
                    if role == "printed_floor_notation" and line.get("pixelBox"):
                        box = line["pixelBox"]
                        for other in lines:
                            other_box = other.get("pixelBox")
                            if (other_box and other_box[2] <= box[0]
                                    and min(other_box[3],box[3]) > max(other_box[1],box[1])
                                    and FIELD_PATTERNS[1][1].fullmatch(other["text"])):
                                row_context.append({"quote": other["text"], "sourcePageBox": other["sourcePageBox"],
                                                    "relation": "same_raster_row_left_of_value", "status": "needs_review"})
                    proposals.append({**base, "proposalId": f"proposal-{len(proposals)+1}", "observation": observation_pin,
                                      "sourcePage": crop["sourcePage"], "sourcePageFrame": crop["sourcePageFrame"],
                                      "sourcePageBox": line["sourcePageBox"], "selectedRegion": crop["selection"]["sourcePageBox"],
                                      "quote": match.group(), "lineQuote": text, "quoteCharacterSpan": list(match.span()),
                                      "fieldRole": role, "method": method, "status": "needs_review",
                                      "quoteVerification": "not_machine_verified", "reasons": reasons,
                                      "canonicalTarget": None, "canonicalMatchState": "not_assessed",
                                      "humanAuthenticated": False, "independentGroundTruth": False,
                                      "sourceRowContext": row_context,
                                      "citationPrecision": "selected_region_only" if kind == "document-field-model/1" else "observed_line_box"})
                if not found:
                    rejected.append({**base, "observation": observation_pin, "lineQuote": text,
                                     "sourcePageBox": line["sourcePageBox"], "reason": "outside_literal_field_scope"})
    counts = [p for p in proposals if p["fieldRole"] == "printed_floor_notation"]
    conflicts = []
    for sid in {p["sourceId"] for p in counts}:
        selected = [p for p in counts if p["sourceId"] == sid]
        if len({re.sub(r"\s", "", p["quote"]) for p in selected}) > 1:
            conflicts.append({"kind": "different_printed_floor_notations", "status": "conflict",
                              "proposalIds": [p["proposalId"] for p in selected],
                              "targetIdentity": "unknown", "resolution": None,
                              "reason": "source_contains_different_notations; same-building_scope_requires_operator_review"})
    review_context = None
    if inputs.get("retainedManualReview"):
        manual_path = checked(inputs["retainedManualReview"])
        review = load(manual_path)["review"]
        source_pins = {(s["sourceId"], s["sourceRevision"], s["original"]["sha256"]) for s in sources}
        if {(s["sourceId"],s["sourceRevision"],s["sourceSha256"]) for s in review["sources"]} != source_pins:
            raise ValueError("retained review/source authority mismatch")
        review_context = {"input": inputs["retainedManualReview"], "claims": review["claims"],
                          "conflicts": review["conflicts"], "method": "human_entry",
                          "quoteVerification": "not_machine_verified", "humanAuthenticated": False,
                          "independentGroundTruth": False, "use": "provisional_review_context_only",
                          "locatorProposals": []}
        for locator in inputs.get("reviewLocatorProposals", []):
            claim_index = locator["claimOrdinal"]
            if type(claim_index) is not int or not 0 <= claim_index < len(review["claims"]):
                raise ValueError("invalid manual claim locator")
            crop_path = checked(locator["crop"])
            source = next(s for s in sources if s["sourceId"] == review["claims"][claim_index]["sourceId"])
            crop, _ = crop_record(crop_path, checked(source["original"]))
            x0,y0,x1,y1 = locator["pixelBox"]
            w,h = crop["ocrPixels"]
            if not all(math.isfinite(v) for v in [x0,y0,x1,y1]) or not (0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h):
                raise ValueError("locator outside verified crop")
            review_context["locatorProposals"].append({"claimOrdinal": claim_index, "crop": locator["crop"],
                "pixelBox": locator["pixelBox"], "sourcePage": crop["sourcePage"],
                "sourcePageFrame": crop["sourcePageFrame"],
                "sourcePageBox": mapped_box(locator["pixelBox"], crop["outputPixelEdgeToSourcePagePoints"]),
                "method": "assistant_visual_region_selection", "status": "needs_review",
                "quoteVerification": "not_machine_verified", "textExtractionPerformed": False})
    caption_differences = []
    for sid in {p["sourceId"] for p in proposals}:
        captions = [p for p in proposals if p["sourceId"] == sid and p["fieldRole"] == "floor_caption"]
        if len({p["quote"] for p in captions}) > 1:
            caption_differences.append({"sourceId": sid, "proposalIds": [p["proposalId"] for p in captions],
                                        "status": "needs_review", "reason": "literal_quote_differs_between_methods"})
    return {"schemaVersion": "document-field-proposals/1", "inputs": pin(args.inputs),
            "provenance": provenance, "proposals": proposals, "rejected": rejected, "conflicts": conflicts,
            "retainedManualReviewContext": review_context, "crossMethodQuoteDifferences": caption_differences,
            "unknowns": ["canonical_building_floor_identity", "approved_revision_and_current_approval",
                         "numeric_floor_count_interpretation", "height_units_rights_and_placement"],
            "qualification": {"scope": "literal_review_proposals_only", "apiSavePayload": False,
                              "accuracy": "not_assessed", "trainingLabels": False, "operatorReviewRequired": True}}


# --- Storey and unit facts -------------------------------------------------------------
# Native text, or supervised OCR on tiles, is retained as a page store. One pattern table then
# runs over the stored lines, so every value keeps its quote and locator.
STOREY_METHOD = "deterministic:storey-rules@1"
TILE_EDGE_POINTS = 500.0
TILE_OVERLAP_POINTS = 50.0
NATIVE_TEXT_MIN_CHARS = 20
RUNNER_MAX_PAGES = 8
RUNNER_MAX_BYTES = 16 * 1024**2
OCR_TILE_SECONDS = 90

EXPRESSION_PART = r"(?:\d{0,2}B|S|G|P|UG|LG|ST|(?i:STILT|BASEMENT|GROUND|PODIUM))"
FLOOR_EXPRESSION = re.compile(rf"(?<![A-Za-z0-9])(?:{EXPRESSION_PART}\s*\+\s*){{1,4}}\d{{1,3}}(?![0-9A-Za-z])")
BASEMENT_PREFIX = re.compile(r"(?<![A-Za-z0-9])(\d{1,2})B\s*\+")
NUMBER_WORDS = {"ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5, "SIX": 6, "SEVEN": 7, "EIGHT": 8,
                "NINE": 9, "TEN": 10, "ELEVEN": 11, "TWELVE": 12, "THIRTEEN": 13, "FOURTEEN": 14,
                "FIFTEEN": 15, "SIXTEEN": 16, "SEVENTEEN": 17, "EIGHTEEN": 18, "NINETEEN": 19, "TWENTY": 20}
ORDINAL_WORDS = {"FIRST": 1, "SECOND": 2, "THIRD": 3, "FOURTH": 4, "FIFTH": 5, "SIXTH": 6, "SEVENTH": 7,
                 "EIGHTH": 8, "NINTH": 9, "TENTH": 10, "ELEVENTH": 11, "TWELFTH": 12, "THIRTEENTH": 13,
                 "FOURTEENTH": 14, "FIFTEENTH": 15, "SIXTEENTH": 16, "SEVENTEENTH": 17, "EIGHTEENTH": 18,
                 "NINETEENTH": 19, "TWENTIETH": 20}
HINDI_ORDINALS = ("प्रथम", "द्वितीय", "तृतीय", "चतुर्थ", "पंचम", "षष्ठ", "सप्तम", "अष्टम", "नवम", "दशम")
SPECIAL_LABELS = ("GROUND", "BASEMENT", "STILT", "PODIUM", "TERRACE", "MEZZANINE", "REFUGE", "TYPICAL")
ORDINAL_TOKEN = rf"(?:{'|'.join(ORDINAL_WORDS)}|\d{{1,2}}\s*(?:ST|ND|RD|TH))"
FLOOR_WORD = r"(?:FLOOR|FLR|FL)\b\.?"
FLOOR_LABEL = re.compile(
    rf"(?<![A-Za-z0-9])(?:"
    rf"{ORDINAL_TOKEN}\.?\s*(?:(?:TO|-|&|AND)\s*{ORDINAL_TOKEN}\.?\s*)?{FLOOR_WORD}(?:\s*PLAN)?"
    rf"|(?:{'|'.join(SPECIAL_LABELS)})\s*{FLOOR_WORD}(?:\s*PLAN)?"
    rf"|(?:{'|'.join(SPECIAL_LABELS)})(?![A-Za-z0-9]))", re.I)
HINDI_LABEL = re.compile(rf"(?:भूतल|(?:{'|'.join(HINDI_ORDINALS)})\s*(?:तल|मंजिल))")
COUNT_TOKEN = rf"(?P<count>\d{{1,3}}|(?i:{'|'.join(NUMBER_WORDS)}))"
STOREY_PHRASE = re.compile(
    rf"(?<![A-Za-z0-9+]){COUNT_TOKEN}[\s-]*(?i:storeys?|stories|storied|storeyed|floors?)\b(?!\s*(?i:plan))")
HINDI_STOREY_PHRASE = re.compile(r"(?P<count>[0-9०-९]{1,3})\s*(?:मंजिला|मंजिल|तल)")
BASEMENT_COUNT = r"(?P<count>[1-5]|(?i:ONE|TWO|THREE|FOUR|FIVE))"
BASEMENT_PHRASE = re.compile(
    rf"(?<![A-Za-z0-9+.]){BASEMENT_COUNT}[\s-]*(?:(?i:levels?\s+of\s+))?(?i:basements?)\b")
UNIT_NOUN = r"(?:dwelling\s+units?|units?|apartments?|flats?|tenements?)"
PER_FLOOR = r"(?!\s*(?:[/!|]|(?i:per\b|each\b)))"
UNIT_COUNT = re.compile(
    rf"(?i:(?:total\s+)?(?:no\.?|number)\s*(?:of\s*)?{UNIT_NOUN}\s*[:=\-]?\s*(?P<after>\d{{1,4}})"
    rf"|total\s+{UNIT_NOUN}\s*[:=\-]?\s*(?P<total>\d{{1,4}})"
    rf"|(?<![\d.])(?P<before>\d{{1,4}})\s*(?:nos\.?\s*)?{UNIT_NOUN}\b{PER_FLOOR})")
HEIGHT_KEYWORD = r"(?i:floor\s*to\s*floor(?:\s*height)?|storey\s*height|floor\s*height|height|ht\.?)"
HEIGHT_UNIT = r"(?:(?i:mtrs?|mts?|metres?|meters?|mm|m|ft|feet|foot)\b|['\"])"
HEIGHT = re.compile(rf"{HEIGHT_KEYWORD}\W{{0,12}}(?P<number>\d+(?:\.\d+)?)\s*(?P<unit>{HEIGHT_UNIT})?")
HEIGHT_UNITS = {"m": "m", "mt": "m", "mts": "m", "mtr": "m", "mtrs": "m", "metre": "m", "metres": "m",
                "meter": "m", "meters": "m", "mm": "mm", "ft": "'", "feet": "'", "foot": "'", "'": "'",
                '"': '"'}


def count_literal_value(literal: str) -> int | None:
    word = NUMBER_WORDS.get(literal.upper())
    if word is not None:
        return word
    return int(literal) if literal.isdigit() else None


def hit(field: str, match: re.Match, value, literal, **extra) -> dict:
    return {"field": field, "value": value, "valueLiteral": literal, "quote": match.group(0),
            "textSpan": list(match.span()), **extra}


def find_floor_expressions(text: str) -> list[dict]:
    """G+N, S+N, B+G+N, 2B+G+N: the printed expression stays a literal, never expanded."""
    return [hit("floorExpression", match, re.sub(r"\s+", "", match.group(0)).upper(), match.group(0))
            for match in FLOOR_EXPRESSION.finditer(text)]


def find_basement_counts(text: str) -> list[dict]:
    """A number written before B in an expression, or '2 basements'; a bare B states no count."""
    found = []
    for expression in FLOOR_EXPRESSION.finditer(text):
        prefix = BASEMENT_PREFIX.match(expression.group(0))
        if prefix:
            found.append(hit("basementCount", expression, int(prefix.group(1)), prefix.group(1)))
    for match in BASEMENT_PHRASE.finditer(text):
        value = count_literal_value(match.group("count"))
        if value is not None:
            found.append(hit("basementCount", match, value, match.group("count")))
    return found


def find_storey_phrases(text: str) -> list[dict]:
    """'N storeys / floors / storied'; the stated number is the value, its meaning is not expanded."""
    found = []
    for match in STOREY_PHRASE.finditer(text):
        value = count_literal_value(match.group("count"))
        if value is not None:
            found.append(hit("storeyCount", match, value, match.group("count"), expression=match.group(0)))
    for match in HINDI_STOREY_PHRASE.finditer(text):
        found.append(hit("storeyCount", match, int(match.group("count")), match.group("count"),
                         expression=match.group(0)))
    return found


def label_kind(label: str) -> str:
    upper = label.upper()
    for special in SPECIAL_LABELS:
        if upper.startswith(special):
            return special.lower()
    return "ordinal"


def find_floor_labels(text: str) -> list[dict]:
    """Ordinal and ranged floor captions plus basement/stilt/podium/terrace/mezzanine/refuge labels."""
    found = [hit("floorLabel", match, match.group(0).upper().rstrip(". "), match.group(0),
                 labelKind=label_kind(match.group(0)))
             for match in FLOOR_LABEL.finditer(text)]
    for match in HINDI_LABEL.finditer(text):
        kind = "ground" if match.group(0) == "भूतल" else "ordinal"
        found.append(hit("floorLabel", match, match.group(0), match.group(0), labelKind=kind))
    return found


def find_unit_counts(text: str) -> list[dict]:
    """'81 units', 'No. of Apartments : 85', 'Total flats 40'."""
    found = []
    for match in UNIT_COUNT.finditer(text):
        literal = match.group("after") or match.group("total") or match.group("before")
        found.append(hit("unitCount", match, int(literal), literal))
    return found


def length_literal(number: str, unit: str | None) -> str | None:
    suffix = HEIGHT_UNITS.get(unit.lower()) if unit else None
    if suffix is None:
        return None
    return f"{number}{suffix}" if suffix in {"'", '"'} else f"{number} {suffix}"


def find_floor_heights(text: str) -> list[dict]:
    """Floor-to-floor heights; the unit is converted in code, a missing unit stays unit_unknown."""
    from geo.vector_plan import parse_length

    found = []
    for match in HEIGHT.finditer(text):
        literal = length_literal(match.group("number"), match.group("unit"))
        parsed = parse_length(literal) if literal else None
        state = "candidate" if parsed and parsed["metres"] is not None else "unit_unknown"
        found.append(hit("floorHeight", match, parsed["metres"] if state == "candidate" else None,
                         match.group("number"), state=state, statedUnit=match.group("unit"),
                         conversion=parsed["conversion"] if parsed else None))
    return found


RULES = (find_floor_expressions, find_basement_counts, find_storey_phrases, find_floor_labels,
         find_unit_counts, find_floor_heights)


def apply_rules(text: str) -> list[dict]:
    return [found for rule in RULES for found in rule(text)]


def native_lines(page) -> list[dict]:
    lines = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"]).strip()
            if text:
                lines.append({"text": text, "box": [round(value, 2) for value in line["bbox"]]})
    return lines


def tile_boxes(width: float, height: float) -> list[list[float]]:
    """Overlapping source-page tiles in PDF points, top-left origin."""
    step = TILE_EDGE_POINTS - TILE_OVERLAP_POINTS
    boxes, top = [], 0.0
    while True:
        left = 0.0
        while True:
            right, bottom = min(width, left + TILE_EDGE_POINTS), min(height, top + TILE_EDGE_POINTS)
            boxes.append([left, top, right, bottom])
            if right >= width:
                break
            left += step
        if bottom >= height:
            return boxes
        top += step


def ocr_environment(tesseract: Path, tessdata: Path) -> dict[str, str]:
    kept = ("SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA")
    environment = {key: os.environ[key] for key in kept if key in os.environ}
    environment.update(CUDA_VISIBLE_DEVICES="", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                       OMP_NUM_THREADS="2", PYTHONNOUSERSITE="1", TESSDATA_PREFIX=str(tessdata))
    environment["PATH"] = str(tesseract.parent) + os.pathsep + environment.get("PATH", "")
    return environment


def runner_sources(source: Path, expected: str, work: Path) -> dict[int, dict]:
    """Per original page, a PDF the supervised runner accepts (a one-page derivative when it is too big)."""
    import fitz

    with fitz.open(source) as document:
        if len(document) <= RUNNER_MAX_PAGES and source.stat().st_size <= RUNNER_MAX_BYTES:
            return {number: {"path": source, "sha256": expected, "page": number}
                    for number in range(1, len(document) + 1)}
        entries = {}
        for number in range(1, len(document) + 1):
            target = work / f"{expected[:12]}-page-{number}.pdf"
            if not target.exists():
                single = fitz.open()
                single.insert_pdf(document, from_page=number - 1, to_page=number - 1)
                single.save(target, garbage=3, deflate=True)
                single.close()
            entries[number] = {"path": target, "sha256": digest(target), "page": 1, "derivedFromPage": number}
        return entries


def read_tile_result(path: Path, box: list[float]) -> dict:
    try:
        result = load(path)
    except (OSError, ValueError):
        return {"box": box, "status": "ocr_unavailable", "issues": ["OCR_RESULT_MISSING"], "lines": []}
    lines = []
    for item in result.get("items", []):
        boxes = [entry["box"] for entry in item["sourcePageBoxes"]]
        left, top, right, bottom = zip(*boxes)
        merged = [min(left), min(top), max(right), max(bottom)]
        lines.append({"text": item["text"], "box": [round(value, 2) for value in merged]})
    if result.get("toolStatus") not in {"complete", "partial"}:
        status = "ocr_unavailable"
    else:
        status = "partial" if result.get("outputStatus") == "partial" else "complete"
    return {"box": box, "status": status, "issues": result.get("issues", []), "lines": lines}


def ocr_tile(job: dict, box: list[float], output: Path) -> dict:
    """One supervised OCR call; any failure becomes an ocr_unavailable tile with its issue code."""
    command = [str(job["python"]), str(REPO / "scripts/usp/document-models/run_source_ocr.py"),
               "--source", str(job["path"]), "--expected-source-sha256", job["sha256"], "--page", str(job["page"]),
               "--region", *[str(round(value, 2)) for value in box], "--models", str(job["models"]),
               "--tesseract", str(job["tesseract"]), "--tessdata", str(job["tessdata"]),
               "--max-items", "64", "--max-seconds", str(OCR_TILE_SECONDS), "--output", str(output)]
    if not (output / "result.json").exists():
        subprocess.run(command, env=ocr_environment(job["tesseract"], job["tessdata"]), stdin=subprocess.DEVNULL,
                       capture_output=True, timeout=OCR_TILE_SECONDS + 60, check=False)
    return read_tile_result(output / "result.json", box)


def overlap_ratio(first: list[float], second: list[float]) -> float:
    width = min(first[2], second[2]) - max(first[0], second[0])
    height = min(first[3], second[3]) - max(first[1], second[1])
    smaller = min((box[2] - box[0]) * (box[3] - box[1]) for box in (first, second))
    return max(width, 0) * max(height, 0) / smaller if smaller > 0 else 0.0


def unique_words(tiles: list[dict]) -> list[dict]:
    """Overlapping tiles see some words twice; keep the longest text per place."""
    words = sorted((line for tile in tiles for line in tile["lines"]), key=lambda item: -len(item["text"]))
    kept: list[dict] = []
    for word in words:
        if not any(word["text"] in other["text"] and overlap_ratio(word["box"], other["box"]) >= 0.5
                   for other in kept):
            kept.append(word)
    return kept


def continues_row(row: dict, word_box: list[float]) -> bool:
    """A word continues a row when it sits on the last word's line, just to its right."""
    last, first = row["last"], row["first"]
    heights = (last[3] - last[1], word_box[3] - word_box[1])
    shared_last = min(last[3], word_box[3]) - max(last[1], word_box[1])
    shared_first = min(first[3], word_box[3]) - max(first[1], word_box[1])
    gap = word_box[0] - last[2]
    on_line = shared_last >= 0.5 * min(heights) and shared_first >= 0.3 * min(heights)
    return min(heights) > 0 and on_line and -min(heights) <= gap <= 2.0 * max(heights)


def join_rows(words: list[dict]) -> list[dict]:
    """OCR emits words; patterns such as 'G + 41' or 'SIXTH FL.' need them joined along a row."""
    rows: list[dict] = []
    for word in sorted(words, key=lambda item: item["box"][0]):
        row = next((row for row in rows if continues_row(row, word["box"])), None)
        if row is None:
            rows.append({"text": word["text"], "box": list(word["box"]), "first": word["box"], "last": word["box"]})
            continue
        row["text"] += " " + word["text"]
        row["last"] = word["box"]
        row["box"] = [min(row["box"][0], word["box"][0]), min(row["box"][1], word["box"][1]),
                      max(row["box"][2], word["box"][2]), max(row["box"][3], word["box"][3])]
    ordered = sorted(rows, key=lambda item: (round(item["box"][1]), item["box"][0]))
    return [{"text": row["text"], "box": row["box"]} for row in ordered]


def merge_lines(page_number: int, tiles: list[dict]) -> list[dict]:
    rows = join_rows(unique_words(tiles))
    return [{"id": f"p{page_number}-l{index}", **row} for index, row in enumerate(rows)]


def page_status(tile_states: set[str]) -> str:
    if tile_states == {"ocr_unavailable"}:
        return "ocr_unavailable"
    return "complete" if tile_states == {"complete"} else "partial"


def page_entry(page, number: int, sources: dict, settings: argparse.Namespace, pool) -> dict:
    """Native text when the page has a text layer; otherwise OCR over tiles, in parallel."""
    lines = native_lines(page)
    width, height = page.rect.width, page.rect.height
    if sum(len(line["text"]) for line in lines) >= NATIVE_TEXT_MIN_CHARS:
        merged = [{"id": f"p{number}-l{index}", **line} for index, line in enumerate(lines)]
        return {"width": width, "height": height, "origin": "native_text", "status": "complete", "lines": merged}
    job = {**sources[number], "python": settings.ocr_python, "models": settings.models,
           "tesseract": settings.tesseract, "tessdata": settings.tessdata}
    boxes = tile_boxes(width, height)
    folder = settings.output / "ocr" / settings.expected_source_sha256[:12]
    outputs = [folder / f"p{number:02d}-t{index:02d}" for index in range(len(boxes))]
    tiles = list(pool.map(lambda pair: ocr_tile(job, *pair), zip(boxes, outputs)))
    status = page_status({tile["status"] for tile in tiles})
    summary = [{key: tile[key] for key in ("box", "status", "issues")} for tile in tiles]
    return {"width": width, "height": height, "origin": "ocr", "method": "ocr:docling-tesseract-cli-region-tiles",
            "status": status, "tiles": summary, "lines": merge_lines(number, tiles)}


def pages_command(args: argparse.Namespace) -> int:
    """Retain the page text of one original PDF: native layer first, supervised OCR for the rest."""
    from concurrent.futures import ThreadPoolExecutor

    import fitz

    if digest(args.source) != args.expected_source_sha256:
        raise ValueError("source hash mismatch")
    args.output.mkdir(parents=True, exist_ok=True)
    work = args.output / "derived"
    work.mkdir(exist_ok=True)
    sources = runner_sources(args.source, args.expected_source_sha256, work)
    pages = {}
    with fitz.open(args.source) as document, ThreadPoolExecutor(args.workers) as pool:
        for number in range(1, len(document) + 1):
            pages[str(number)] = page_entry(document[number - 1], number, sources, args, pool)
    derived = {str(number): {"sha256": entry["sha256"], "page": entry["page"]}
               for number, entry in sources.items() if "derivedFromPage" in entry}
    source = {"sha256": args.expected_source_sha256, "bytes": args.source.stat().st_size, "path": str(args.source)}
    store = {"schemaVersion": "storey-pages/1", "source": source, "derivedRunnerPdfs": derived, "pages": pages}
    save(args.output / f"{args.expected_source_sha256}.pages.json", store, MAX_STORE)
    print({number: entry["status"] for number, entry in pages.items()})
    return 0


def line_item(store: dict, page_number: int, line: dict, found: dict) -> dict:
    locator = {"page": page_number, "bbox": line["box"], "textSpan": found.pop("textSpan"), "lineId": line["id"]}
    return {**found, "locator": locator, "sourceSha256": store["source"]["sha256"], "method": STOREY_METHOD,
            "state": found.get("state", "candidate")}


def storey_items(store: dict) -> list[dict]:
    items = []
    for page_number, page in store["pages"].items():
        for line in page["lines"]:
            items.extend(line_item(store, int(page_number), line, found) for found in apply_rules(line["text"]))
    return items


def storey_command(args: argparse.Namespace) -> int:
    """Run the rules over a retained page store; the shared verifier keeps or drops each value."""
    from storey_quote_verifier import filter_verified, load_page_store

    helpers()
    store = load_page_store(args.pages)
    kept, dropped = filter_verified(store, storey_items(store))
    unavailable = [int(number) for number, page in store["pages"].items() if page["status"] == "ocr_unavailable"]
    result = {"schemaVersion": "storey-rule-items/1", "method": STOREY_METHOD, "source": store["source"],
              "pagesOcrUnavailable": unavailable, "items": kept, "dropped": dropped}
    save(args.output, result, MAX_STORE)
    print(args.output)
    return 0


def add_storey_parsers(sub) -> None:
    pages = sub.add_parser("pages", help="retain native or supervised-OCR page text for one original PDF")
    pages.add_argument("--source", type=Path, required=True)
    pages.add_argument("--expected-source-sha256", required=True)
    pages.add_argument("--output", type=Path, required=True, help="private directory outside Git")
    pages.add_argument("--ocr-python", type=Path, required=True)
    pages.add_argument("--models", type=Path, required=True)
    pages.add_argument("--tesseract", type=Path, required=True)
    pages.add_argument("--tessdata", type=Path, required=True)
    pages.add_argument("--workers", type=int, default=3)
    storey = sub.add_parser("storey", help="storey and unit rules over a retained page store")
    storey.add_argument("--pages", type=Path, required=True)
    storey.add_argument("--output", type=Path, required=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ["render", "ocr", "model", "propose"]:
        p = sub.add_parser(name)
        p.add_argument("--output", type=Path, required=True, help="new private output directory outside Git")
        p.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
        if name in {"render","ocr","model"}:
            p.add_argument("--source", type=Path, required=True)
        if name == "render":
            p.add_argument("--expected-source-sha256", required=True)
            p.add_argument("--page", type=int, required=True)
            p.add_argument("--region", nargs=4, type=float, required=True)
            p.add_argument("--rotate-ccw", type=int, choices=[0,90], default=0)
        if name in {"ocr","model"}:
            p.add_argument("--crop", type=Path, required=True)
        if name == "ocr":
            p.add_argument("--tesseract", type=Path, required=True)
            p.add_argument("--tessdata", type=Path, required=True)
            p.add_argument("--reuse-tsv", type=Path, help="retained OCR output; does not rerun the executable")
            p.add_argument("--expected-tsv-sha256", help="required with --reuse-tsv; operator must preserve its source/crop provenance")
        if name == "model":
            p.add_argument("--model-dir", type=Path, required=True)
        if name == "propose":
            p.add_argument("--inputs", type=Path, required=True)
    add_storey_parsers(sub)
    args = parser.parse_args()
    if args.command == "pages":
        return pages_command(args)
    if args.command == "storey":
        return storey_command(args)
    if args.command == "ocr" and bool(args.reuse_tsv) != bool(args.expected_tsv_sha256):
        parser.error("reused TSV and expected hash must be supplied together")
    if args.worker:
        offline()
        helpers()
        result = {"render":render,"ocr":ocr,"model":model}[args.command](args)
        save(args.output / "result.json", result)
        return 0
    if args.output.exists() or args.output.resolve().is_relative_to(REPO) or args.output.resolve().is_relative_to(Path("E:/Projects/3d-ulpin")):
        parser.error("output must be new and outside the repository")
    args.output.mkdir(parents=True)
    started = time.monotonic()
    if args.command == "propose":
        save(args.output / "result.json", propose(args))
        print(str(args.output / "result.json"))
        return 0
    helpers()
    from run_trial import _run_worker
    os.environ.update({"PYTHONDONTWRITEBYTECODE": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1"})
    seconds = 120 if args.command == "model" else 60
    command = [sys.executable, str(SCRIPT), *sys.argv[1:], "--worker"]
    receipt = _run_worker(command, args.output / "worker.log", seconds, MEMORY, max_log_bytes=2*1024**2)
    receipt.update({"schemaVersion": "document-field-execution/1", "command": command,
                    "bounds": {"seconds": seconds, "memoryBytes": MEMORY, "cpuThreads": 2,
                               "gpu": False, "maxImageSide": 1400, "maxPixels": 1_600_000,
                               "maxGeneratedTokens": 96 if args.command == "model" else None},
                    "interpreter": pin(Path(sys.executable)), "code": pin(SCRIPT),
                    "packages": {n: importlib.metadata.version(n) for n in ["torch","transformers","PyMuPDF","Pillow","psutil"]},
                    "network": "local_files_only; offline_flags; Python_socket_denial; no_OS_egress_audit",
                    "totalSeconds": round(time.monotonic()-started,3)})
    result_path = args.output / "result.json"
    if result_path.exists():
        receipt["result"] = pin(result_path)
    save(args.output / "receipt.json", receipt)
    print(json.dumps({k:receipt[k] for k in ["exitCode","stopReason","elapsedSeconds","peakObservedRssBytes","peakJobPrivateBytes"]}))
    return 0 if receipt["exitCode"] == 0 and receipt["stopReason"] is None and result_path.exists() else 1


if __name__ == "__main__":
    raise SystemExit(main())
