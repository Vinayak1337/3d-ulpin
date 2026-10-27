#!/usr/bin/env python3
"""Deterministic quote check shared by the storey rules and the storey agent output.

A cited value is kept only when its quote occurs at its locator in the original's retained
text (native text layer or retained OCR) and, for numeric values, its number occurs in that
quote. Everything else is dropped with a code, never repaired.

Written in Python, not TypeScript, because both the rule baseline and the scoring run in Python
and read the same retained page store. The TypeScript agent only emits {partId, quote} pairs;
the scorer resolves each partId to a locator and calls this module.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any

JsonDict = dict[str, Any]
QUOTE_NOT_AT_LOCATOR = "QUOTE_NOT_AT_LOCATOR"
VALUE_NOT_IN_QUOTE = "VALUE_NOT_IN_QUOTE"
PAGE_STORE_SCHEMA = "storey-pages/1"
MAX_STORE_BYTES = 8 * 1024**2


def normalise(text: str) -> str:
    """NFKC with every whitespace run collapsed to one space."""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text)).strip()


def load_page_store(path: Path) -> JsonDict:
    if not 0 < path.stat().st_size <= MAX_STORE_BYTES:
        raise ValueError("page store exceeds the bounded profile")
    store = json.loads(path.read_text(encoding="utf-8"))
    if store.get("schemaVersion") != PAGE_STORE_SCHEMA:
        raise ValueError("unsupported page store")
    return store


def boxes_intersect(first: list[float], second: list[float]) -> bool:
    return first[0] < second[2] and second[0] < first[2] and first[1] < second[3] and second[1] < first[3]


def within_stored_region(entry: JsonDict, bbox: list[float] | None) -> bool:
    """A page read from a selected OCR region answers only for a cited box that lies in that region.

    Exactly; or, when the OCR result states its region edge, within one rendered pixel of it. The allowance
    is the result's own scale, never a number typed here. Same answer as the TypeScript quote check, which
    asks the contract's measureOcrRegionEdge; a test runs both on the same inputs.
    """
    region = entry.get("storedRegion")
    if region is None:
        return True
    if bbox is None:
        return False
    edge = entry.get("regionEdge")
    allowed = 1 / edge["renderScalePxPerPt"] if edge else 0
    return not (bbox[0] < region[0] - allowed or bbox[1] < region[1] - allowed
                or bbox[2] > region[2] + allowed or bbox[3] > region[3] + allowed)


def region_text(store: JsonDict, page: int, bbox: list[float] | None) -> str | None:
    """Normalised text of the lines on a page that touch the box; None for an unknown page or a box
    outside the page's stored OCR region."""
    entry = store["pages"].get(str(page))
    if entry is None or not within_stored_region(entry, bbox):
        return None
    lines = entry["lines"]
    if bbox is not None:
        lines = [line for line in lines if boxes_intersect(line["box"], bbox)]
    return normalise(" ".join(line["text"] for line in lines))


def digit_groups(text: str) -> list[str]:
    return re.findall(r"\d+", unicodedata.normalize("NFKC", text))


def number_is_in_quote(value_literal: Any, quote: str) -> bool:
    """Every number written in the value must be written in its own quote."""
    wanted = digit_groups(str(value_literal))
    available = set(digit_groups(quote))
    return all(group in available for group in wanted)


def verify_item(store: JsonDict, item: JsonDict) -> list[str]:
    """Return the drop codes for one cited item; an empty list means it is kept."""
    locator = item.get("locator") or {}
    quote = item.get("quote")
    if item.get("sourceSha256") != store["source"]["sha256"] or not quote:
        return [QUOTE_NOT_AT_LOCATOR]
    text = region_text(store, locator.get("page"), locator.get("bbox"))
    if text is None or normalise(quote) not in text:
        return [QUOTE_NOT_AT_LOCATOR]
    literal = item.get("valueLiteral", item.get("value"))
    if not number_is_in_quote(literal, quote):
        return [VALUE_NOT_IN_QUOTE]
    return []


def filter_verified(store: JsonDict, items: list[JsonDict]) -> tuple[list[JsonDict], list[JsonDict]]:
    kept, dropped = [], []
    for item in items:
        codes = verify_item(store, item)
        if codes:
            dropped.append({**item, "dropCodes": codes})
        else:
            kept.append({**item, "verifier": {"status": "quote_at_locator", "checked": "normalised_nfkc_region"}})
    return kept, dropped
