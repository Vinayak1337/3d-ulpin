"""Read only the rehearsal's downloaded card, rendering one local judge view on CPU."""
import argparse
from pathlib import Path

import fitz


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", required=True, choices=["ulpin-reh-01"])
    parser.parse_args()
    root = Path("E:/BhuAayam-data/task-data/reh1")
    target = root / "card-revision-1.png"
    with fitz.open(root / "card-revision-1.pdf") as document:
        assert len(document) == 1
        page = document[0]
        text = page.get_text()
        assert "UNIT-3B" in text
        assert "2ND FLOOR PLAN" in text
        assert "P3-GS0J76ZSTEXDYMEF1V9H-YD" in text
        image = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
        with target.open("xb") as output:
            output.write(image.tobytes("png"))
        print("PASS one-page card: cited unit and floor, assigned application code; rendered on CPU.")


if __name__ == "__main__":
    main()
