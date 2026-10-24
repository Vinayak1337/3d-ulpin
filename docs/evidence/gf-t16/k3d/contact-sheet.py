"""Private contact sheet for visual navigation, not a measurement or absence proof."""
from __future__ import annotations

import argparse
from pathlib import Path
from PIL import Image, ImageDraw


def contact(directory: Path, rotation: int, target: Path) -> None:
    if target.exists():
        raise ValueError("Contact sheet exists")
    paths = sorted(directory.glob("page-*-overview.png"))
    canvas = Image.new("RGB", (1200, 470 * ((len(paths) + 1) // 2)), "white")
    for index, path in enumerate(paths):
        with Image.open(path) as original:
            image = original.rotate(rotation, expand=True)
            image.thumbnail((590, 440))
            position = (600 * (index % 2), 470 * (index // 2))
            canvas.paste(image, (position[0], position[1] + 25))
            ImageDraw.Draw(canvas).text(position, path.name, fill="black")
    canvas.save(target)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--rotate", type=int, default=0)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    contact(args.directory, args.rotate, args.out)


if __name__ == "__main__":
    main()
