"""Only the AdV/GeoInfoDok names explicitly paired with EPSG codes in the cited list.

The source's page 5, sections 3.4.1 and 3.4.2, supplies these three rows. Vertical entries are reference metadata,
not permission to convert or measure heights. No zone, datum, axis order or additional alias is inferred.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

SOURCE_URL = ("https://www.adv-online.de/sites/default/files/documents/2026-07/"
              "PQS_3D-Gebaeudemodelle_V2.6_2025-03-26.zip")
SOURCE_NAME = "Produkt- und Qualitätsstandard für 3D-Gebäudemodelle, version 2.6, 2025-03-26"
_ADV = re.compile(r"urn:adv:crs:([A-Za-z0-9_]+)(?:\*([A-Za-z0-9_]+))?")


@dataclass(frozen=True)
class Reference:
    epsg: int
    kind: Literal["horizontal", "vertical"]
    source_url: str


ADV_CRS = {
    "ETRS89_UTM32": Reference(25832, "horizontal", SOURCE_URL),
    "ETRS89_UTM33": Reference(25833, "horizontal", SOURCE_URL),
    "DE_DHHN2016_NH": Reference(7837, "vertical", SOURCE_URL),
}


def stated_adv(literal: str | None) -> tuple[Reference, str | None, Reference | None] | None:
    """Resolve only a complete literal whose components are listed in their stated roles."""
    match = _ADV.fullmatch(literal or "")
    if match is None:
        return None
    horizontal = ADV_CRS.get(match[1])
    vertical = ADV_CRS.get(match[2]) if match[2] else None
    if horizontal is None or horizontal.kind != "horizontal":
        return None
    if match[2] and (vertical is None or vertical.kind != "vertical"):
        return None
    return horizontal, match[2], vertical
