"""Test-only masks and OCR literals; no inference or evaluation truth."""
import base64
import hashlib
import io
import json
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest
from PIL import Image

from geo import raster_plan
from geo.intake_plan import plan_reading, plan_readiness
from geo.validation import InputError

MODEL = {"id": "test-only", "sha256": "a" * 64, "profileVersion": "test-only"}


def segmentation(render_scale: float = 1) -> raster_plan.Segmentation:
    component = {"id": "test-only-room", "className": "kitchen", "score": 0.5,
                 "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]]}}
    transform = {"pdfRenderScale": render_scale, "sourceWidth": 40, "sourceHeight": 40,
                 "pdfPagePoints": [40 / render_scale, 40 / render_scale],
                 "pixelToSource": [2, 0, 0, 0, 2, 0]}
    return raster_plan.Segmentation(np.zeros((20, 20)), Image.new("RGB", (20, 20)), transform,
                                    [component], [], {}, {}, "test_only")


def observations() -> list[dict]:
    return [{"literal": "KITCHEN", "bboxPt": [2, 2, 8, 8], "method": "test_only",
             "tile": 0, "item": 0, "state": "candidate"}]


def request(mime: str = "image/png") -> dict:
    return {"sourceId": "10000000-0000-4000-8000-000000000002",
            "jobId": "10000000-0000-4000-8000-000000000001",
            "sourceSha256": hashlib.sha256(b"test_only").hexdigest(), "page": 1,
            "mimeType": mime, "base64": base64.b64encode(b"test_only").decode("ascii"),
            "observations": observations(), "expectedModelSha256": "a" * 64,
            "ocrFrame": {"rotation": 0, "width": 20, "height": 20}}


def panel(lines: list[raster_plan.DimensionLine] | None = None, labels: list[dict] | None = None) -> dict:
    selection = raster_plan.PlanSelection("10000000-0000-4000-8000-000000000002", Path("unused"), "b" * 64,
                                          1, "test-only-panel", (0, 0, 20, 20), "test_only")
    with patch.object(raster_plan, "installed_model", return_value=MODEL):
        return raster_plan.panel_result(selection, segmentation(2), labels or observations(), lines)


def test_panel_shape_keeps_pixels_contained_literals_and_unknown_scale() -> None:
    result = panel()
    assert result["state"] == "candidate"
    assert result["scale"]["state"] == "no_scale"
    assert result["rooms"][0]["metric"] is None
    assert result["rooms"][0]["literalClass"] == "kitchen"
    assert result["rooms"][0]["containedOcrLiterals"] == observations()
    assert result["rooms"][0]["geometryPagePixels"]["coordinates"][0][1] == (40, 0)
    outside = {**observations()[0], "literal": "BED ROOM", "bboxPt": [100, 100, 110, 110]}
    assert panel(labels=observations() + [outside])["rooms"][0]["literalClass"] == "kitchen"


def test_metric_geometry_requires_consistent_page_dimension_text_on_verified_lines() -> None:
    labels = [{**observations()[0], "literal": "10'0\"", "bboxPt": [4, 0, 6, 1]},
              {**observations()[0], "literal": "6'0\"", "bboxPt": [10, 2, 11, 4], "item": 1}]
    lines = [raster_plan.DimensionLine("test_only_x", (0, 10), (10, 10), (3, 0, 7, 1), True),
             raster_plan.DimensionLine("test_only_y", (10, 0), (10, 6), (10, 1, 12, 5), True)]
    result = panel(lines, labels)
    assert result["scale"]["state"] == "candidate"
    # 40 page pixels / render scale 2 = 20 page points; written dimensions set 0.3048 metres per point.
    assert result["rooms"][0]["metric"]["areaM2"] == pytest.approx((20 * 0.3048)**2)
    assert "no_scale" not in result["gaps"]
    assert panel(lines[:1], labels)["rooms"][0]["metric"] is None
    assert panel(lines, [{**labels[0], "literal": "100'0\""}, labels[1]])["scale"]["state"] == "no_scale"
    refreshed = raster_plan.refresh_panel_ocr(result, observations())
    assert refreshed["scale"]["state"] == "no_scale"
    assert refreshed["rooms"][0]["metric"] is None
    assert "no_scale" in refreshed["gaps"]


def test_image_glue_reuses_segmentation_and_emits_a_real_overlay_without_inventing_photo_ocr() -> None:
    with patch.object(raster_plan, "installed_model", return_value=MODEL), \
            patch.object(raster_plan, "segment_bytes", return_value=segmentation()) as segment:
        result = plan_reading(request())
    segment.assert_called_once()
    assert result["sourceCitation"]["locator"]["unit"] == "pixel"
    assert result["rooms"][0]["metric"] is None
    assert result["rooms"][0]["containedOcrLiterals"] == []
    assert result["rooms"][0]["literalClass"] is None
    assert "image_ocr_unavailable" in result["gaps"]
    raw = base64.b64decode(result["overlay"]["base64"])
    assert hashlib.sha256(raw).hexdigest() == result["overlay"]["sha256"]
    with Image.open(io.BytesIO(raw)) as image:
        assert image.format == "PNG"
        assert image.size == (20, 20)


def test_pdf_glue_keeps_the_accepted_ocr_frame_and_labels() -> None:
    with patch.object(raster_plan, "installed_model", return_value=MODEL), \
            patch.object(raster_plan, "segment_bytes", return_value=segmentation(2)):
        result = plan_reading(request("application/pdf"))
        assert result["rooms"][0]["containedOcrLiterals"] == observations()
        assert result["rooms"][0]["literalClass"] == "kitchen"
        changed = request("application/pdf")
        changed["ocrFrame"]["width"] = 21
        with pytest.raises(InputError, match="OCR page frame"):
            plan_reading(changed)


def test_bad_source_hash_and_changed_model_never_run_segmentation() -> None:
    with patch.object(raster_plan, "segment_bytes") as segment:
        changed = {**request(), "sourceSha256": "c" * 64}
        with pytest.raises(InputError, match="retained hash"):
            plan_reading(changed)
        with patch.object(raster_plan, "installed_model", return_value={**MODEL, "sha256": "c" * 64}):
            with pytest.raises(InputError, match="model is not installed"):
                plan_reading(request())
        segment.assert_not_called()


def test_missing_or_unpinned_model_is_not_offered(tmp_path: Path) -> None:
    with patch.object(raster_plan.spatial_ml, "_model_dir", return_value=tmp_path):
        assert plan_readiness() == {"available": False, "modelSha256": None,
                                    "reason": "The plan reader's model is not installed in this build."}
        # test_only invalid bytes, not weights: a present but unpinned file must also fail closed.
        (tmp_path / "floor.onnx").write_bytes(b"test_only_unpinned")
        assert plan_readiness()["available"] is False


def test_public_development_plans_refuse_honestly_without_installed_weights(tmp_path: Path) -> None:
    root = Path("E:/BhuAayam-data/task-data/association-sources-20260929")
    names = ["bihar-magnolia-sanctioned-layout-original.pdf", "haryana-2831-tower3-plan1.pdf"]
    if not all((root / name).is_file() for name in names):
        pytest.skip("Public development originals are not installed on this machine.")
    provenance = json.loads(Path("scripts/plans/source-provenance.json").read_text(encoding="utf-8"))
    with patch.object(raster_plan.spatial_ml, "_model_dir", return_value=tmp_path), \
            patch.object(raster_plan, "segment_bytes") as segment:
        for name in names:
            raw = (root / name).read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            assert digest == provenance[name]["sha256"]
            value = {**request("application/pdf"), "base64": base64.b64encode(raw).decode("ascii"),
                     "sourceSha256": digest}
            with pytest.raises(InputError, match="model is not installed"):
                plan_reading(value)
            assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest
        segment.assert_not_called()
