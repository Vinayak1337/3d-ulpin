"""Numerical control of the utility corridor reach used by package context selection."""
from __future__ import annotations

import inspect
import json
import math
from pathlib import Path

import shapely
from shapely.geometry import LineString, Point


MARGIN_METRES = 255


def test_utility_corridor_margin() -> dict:
    root = Path(__file__).resolve().parents[5]
    requirements = (root / "services" / "geo" / "requirements.txt").read_text(encoding="utf-8")
    pin_line, pin = next((index, line.split("==")[1]) for index, line in enumerate(
        requirements.splitlines(), 1) if line.startswith("Shapely=="))
    assert shapely.__version__ == pin
    default = inspect.signature(LineString.buffer).parameters["mitre_limit"].default
    assert default == 5.0, f"Unexpected default mitre limit: {default}"
    angles = [0.001, 0.01, 0.1] + [index / 4 for index in range(1, 720)] + [179.999, 180.0]
    maximum = 0.0
    sharp_over_half_width = 0
    for angle in angles:
        radians = math.radians(angle)
        line = LineString([(-1000, 0), (0, 0), (-1000 * math.cos(radians), 1000 * math.sin(radians))])
        corridor = line.buffer(50, cap_style=2, join_style=2)
        reach = max(Point(point).distance(line) for point in corridor.exterior.coords)
        assert reach <= MARGIN_METRES, f"{angle} degrees reached {reach} m"
        maximum = max(maximum, reach)
        sharp_over_half_width += reach > 50.000001
    assert maximum > 250
    assert sharp_over_half_width > 0
    return {"shapely": shapely.__version__, "pinnedVersion": pin, "requirementsLine": pin_line,
            "defaultMitreLimit": default, "angles": len(angles), "maximumReachMetres": round(maximum, 6),
            "anglesOverHalfWidth": sharp_over_half_width, "marginMetres": MARGIN_METRES,
            "derivedBoundMetres": round(50 * math.sqrt(1 + default ** 2), 6)}


def main() -> None:
    print(json.dumps(test_utility_corridor_margin(), separators=(",", ":")))


if __name__ == "__main__":
    main()
