"""Read-only selected-page renderer checks; no OCR accuracy or runtime qualification claim."""
from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory

from geo.usp_document_candidates.docling_tesseract import SourceOcrError, render_pdf_selection

ROOT = Path(__file__).resolve().parents[3]


def main() -> None:
    earlier = json.loads((ROOT / "docs/evidence/pl1/result.json").read_text(encoding="utf-8"))
    good, difficult = earlier["realInputs"]
    source = Path(good["path"])
    with TemporaryDirectory(prefix="po1-real-", dir="E:/ulpin-tmp") as temporary:
        output = Path(temporary) / "selected.png"
        frame = render_pdf_selection(source, good["sha256"], 3, None, output, selected_page=True)
        assert frame["source"]["bytes"] == good["bytes"]
        assert frame["pageNumber"] == 3
        good_result = {"kind": "good", "path": str(source), **frame["source"], "page": 3,
                       "frame": frame["pageFrame"], "pixels": frame["render"]["pixels"],
                       "permission": "unconfirmed", "scope": "renderer only; no OCR text read"}
        large = Path(difficult["path"])
        assert large.stat().st_size == difficult["bytes"]
        try:
            render_pdf_selection(large, difficult["sha256"], 1, None, output, selected_page=True)
        except SourceOcrError as error:
            assert error.code == "source_missing_or_over_byte_limit"
            difficult_result = {"kind": "difficult", "path": str(large), "bytes": large.stat().st_size,
                                "refusal": error.code, "scope": "refused before original bytes are read"}
        else:
            raise AssertionError("An original over the renderer bound must be refused")
    print(json.dumps({"inputs": [good_result, difficult_result]}, separators=(",", ":")))


if __name__ == "__main__":
    main()
