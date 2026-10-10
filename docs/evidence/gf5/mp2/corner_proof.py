"""MP2 Step 0: which corner order puts the retained picture under its own roofprints.

Reads the Karnataka area's canonical read and one overlay's PNG from the demo (GET only), then draws the
chip's two roofprint candidates over the picture under each of the eight orders the four corners can be
given to the scene in. Writes shots/corner-orders.png: one panel per order, the order's name on top.

    python docs/evidence/gf5/mp2/corner_proof.py
"""

import io
import json
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

DEMO = "http://127.0.0.1:3194"
AREA = "cb24dc86-2b91-4793-9586-24e8a443b8d8"
ITEM = "0092d536-2800-45f4-95d9-e28801a3d195"
HERE = Path(__file__).resolve().parent
SCALE = 2

# Index into the read's corners (NW, NE, SE, SW) for each scene slot (SW, SE, NE, NW).
ORDERS = {
    "reversed (NW,NE,SE,SW -> SW,SE,NE,NW)": (3, 2, 1, 0),
    "reversed, turned 90": (2, 1, 0, 3),
    "reversed, turned 180": (1, 0, 3, 2),
    "reversed, turned 270": (0, 3, 2, 1),
    "as read (no mapping)": (0, 1, 2, 3),
    "as read, turned 90": (1, 2, 3, 0),
    "as read, turned 180": (2, 3, 0, 1),
    "as read, turned 270": (3, 0, 1, 2),
}

Point = tuple[float, float]


def get(path: str) -> bytes:
    with urllib.request.urlopen(f"{DEMO}{path}") as response:
        return response.read()


def chip_inputs() -> tuple[list[Point], Image.Image, list[list[Point]]]:
    area = json.loads(get(f"/api/v1/areas/{AREA}/canonical"))
    roofs = [c for c in area["candidates"] if ITEM in c["outputRef"]]
    source = roofs[0]["citations"][0]["sourceId"]
    overlay = next(o for o in area["overlays"] if o["id"] == source)
    picture = Image.open(io.BytesIO(get(overlay["originalUrl"]))).convert("RGB")
    rings = [polygon[0] for roof in roofs for polygon in roof["polygons"]]
    return overlay["corners"], picture, rings


def to_pixel(point: Point, slots: list[Point], size: tuple[int, int]) -> Point:
    """Where the scene puts a local point on the picture: uv over SW->SE and SW->NW, rows flipped."""
    (sx, sy), (ex, ey), _, (nx, ny) = slots
    ax, ay, bx, by = ex - sx, ey - sy, nx - sx, ny - sy
    px, py = point[0] - sx, point[1] - sy
    det = ax * by - ay * bx
    u = (px * by - py * bx) / det
    v = (ax * py - ay * px) / det
    return u * size[0], (1 - v) * size[1]


def panel(picture: Image.Image, slots: list[Point], rings: list[list[Point]], title: str) -> Image.Image:
    size = picture.size
    image = picture.resize((size[0] * SCALE, size[1] * SCALE), Image.NEAREST)
    draw = ImageDraw.Draw(image)
    for ring in rings:
        pixels = [to_pixel(p, slots, size) for p in ring]
        draw.line([(x * SCALE, y * SCALE) for x, y in pixels], fill=(255, 0, 200), width=3)
    draw.rectangle((0, 0, image.width, 18), fill=(255, 255, 255))
    draw.text((4, 3), title, fill=(0, 0, 0))
    return image


def main() -> None:
    corners, picture, rings = chip_inputs()
    width, height = picture.size[0] * SCALE, picture.size[1] * SCALE
    sheet = Image.new("RGB", (width * 4, height * 2), (255, 255, 255))
    for index, (name, order) in enumerate(ORDERS.items()):
        slots = [corners[i] for i in order]
        sheet.paste(panel(picture, slots, rings, name), ((index % 4) * width, (index // 4) * height))
    (HERE / "shots").mkdir(exist_ok=True)
    sheet.save(HERE / "shots" / "corner-orders.png", optimize=True)


if __name__ == "__main__":
    main()
