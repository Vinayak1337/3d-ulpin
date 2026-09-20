"""Boundary tests. Mocked inference below is not evidence of model accuracy."""
import hashlib
import importlib.util
import io
from copy import deepcopy
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image
from shapely.geometry import shape

from geo import spatial_ml as ml


def image_bytes(size=(80, 40), mode="RGB", color="white"):
    stream = io.BytesIO()
    Image.new(mode, size, color).save(stream, format="PNG")
    return stream.getvalue()


def request(raw=None):
    raw = raw or image_bytes()
    model = ml._manifest()["models"][0]
    return {"schemaVersion": ml.SCHEMA, "inputFingerprint": "a" * 64, "task": "floor-plan", "modelId": model["id"], "expectedModelSha256": model["sha256"], "expectedProfileVersion": model["profileVersion"], "source": {"id": "test-original", "objectKey": "sources/test/original.png", "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "mimeType": "image/png"}, "page": 1}


class Storage:
    def __init__(self, raw):
        self.body = io.BytesIO(raw)

    def get_object(self, **kwargs):
        return {"Body": self.body}


def test_changed_queued_model_and_nonfinite_crop_fail_before_reading_sources():
    data = request()
    data["expectedModelSha256"] = "b" * 64
    with pytest.raises(ml.SpatialInferenceError) as error:
        ml._validate_request(data)
    assert error.value.code == "MODEL_MISMATCH"
    for profile in (None, "superseded-profile"):
        with pytest.raises(ml.SpatialInferenceError) as error:
            ml._validate_request({**request(), "expectedProfileVersion": profile})
        assert error.value.code == "MODEL_MISMATCH"
    for region in [{"x": float("nan"), "y": 0, "width": 1, "height": 1}, {"x": .8, "y": 0, "width": .5, "height": 1}, {"x": True, "y": 0, "width": 1, "height": 1}]:
        with pytest.raises(ml.SpatialInferenceError):
            ml._validate_request({**request(), "region": region})


def test_source_limits_formats_and_image_page_are_explicit():
    data = request()
    for change in [{"bytes": ml.MAX_SOURCE_BYTES + 1}, {"bytes": True}, {"mimeType": "image/tiff"}, {"objectKey": "https://outside.example/image.png"}, {"objectKey": "sources/../other"}]:
        invalid = deepcopy(data)
        invalid["source"].update(change)
        with pytest.raises(ml.SpatialInferenceError):
            ml._validate_request(invalid)
    with pytest.raises(ml.SpatialInferenceError):
        ml._validate_request({**data, "page": 2})


def test_exact_original_hash_and_size_are_verified_and_stream_closed():
    raw = image_bytes()
    source = request(raw)["source"]
    storage = Storage(raw)
    assert ml._read_source(source, storage) == raw
    assert storage.body.closed
    storage = Storage(raw + b"modified")
    with pytest.raises(ml.SpatialInferenceError) as error:
        ml._read_source(source, storage)
    assert error.value.code == "SOURCE_INTEGRITY"
    assert storage.body.closed


def test_crop_and_downsample_keep_a_reversible_pixel_transform():
    region = {"x": .25, "y": .25, "width": .5, "height": .5}
    image, transform = ml._source_raster(image_bytes((1600, 800)), "image/png", 1, region, "floor-plan")
    assert image.size == (768, 384)
    assert transform["sourceWidth"] == 1600
    assert transform["pixelRegion"] == [400, 200, 1200, 600]
    assert transform["pixelToSource"] == [800 / 768, 0, 400, 0, 400 / 384, 200]
    assert transform["unit"] == "pixel"


def test_image_format_spoofing_tiny_crop_and_large_aerial_region_fail():
    whole = {"x": 0, "y": 0, "width": 1, "height": 1}
    for raw, mime, task in [(image_bytes(), "image/jpeg", "floor-plan"), (image_bytes((8, 8)), "image/png", "floor-plan"), (image_bytes((2049, 256)), "image/png", "building"), (image_bytes((2048, 2048)), "image/png", "building")]:
        with pytest.raises(ml.SpatialInferenceError):
            ml._source_raster(raw, mime, 1, whole, task)
    image, transform = ml._source_raster(image_bytes((2048, 1900)), "image/png", 1, whole, "building")
    assert image.size == (2048, 1900)
    assert transform["pixelToSource"] == [1, 0, 0, 0, 1, 0]


def test_invisible_pixel_content_is_flattened_onto_white():
    image, _ = ml._source_raster(image_bytes((32, 32), "RGBA", (255, 0, 0, 0)), "image/png", 1, {"x": 0, "y": 0, "width": 1, "height": 1}, "building")
    assert image.getpixel((0, 0)) == (255, 255, 255)


@pytest.mark.skipif(importlib.util.find_spec("pypdfium2") is None, reason="optional local PDF rasterizer")
def test_pdf_page_is_rendered_locally_with_page_coordinate_receipt():
    from pypdf import PdfWriter
    writer, stream = PdfWriter(), io.BytesIO()
    writer.add_blank_page(width=300, height=200)
    writer.write(stream)
    image, transform = ml._source_raster(stream.getvalue(), "application/pdf", 1, {"x": 0, "y": 0, "width": 1, "height": 1}, "floor-plan")
    assert image.size == (768, 512)
    assert transform["sourceWidth"] == 600
    assert transform["pdfPagePoints"] == [300, 200]
    assert transform["pdfRenderScale"] == 2
    with pytest.raises(ml.SpatialInferenceError):
        ml._source_raster(stream.getvalue(), "application/pdf", 2, {"x": 0, "y": 0, "width": 1, "height": 1}, "floor-plan")


@pytest.mark.skipif(importlib.util.find_spec("rasterio") is None, reason="optional pixel polygonizer")
def test_polygonization_preserves_pixel_edges_holes_and_deterministic_identity():
    labels = np.zeros((32, 32), np.uint8)
    labels[2:26, 3:27] = 5
    labels[8:14, 9:15] = 0
    result, omissions = ml._components(labels, np.full(labels.shape, .8, np.float32), {5: "bedroom"}, "a" * 64)
    polygon = shape(result[0]["geometry"])
    assert polygon.is_valid
    assert polygon.bounds == (3, 2, 27, 26)
    assert polygon.area == 24 * 24 - 6 * 6
    assert len(polygon.interiors) == 1
    assert result[0]["score"] == .8
    assert result == ml._components(labels, np.full(labels.shape, .8, np.float32), {5: "bedroom"}, "a" * 64)[0]
    assert sum(omissions.values()) == 0


@pytest.mark.skipif(importlib.util.find_spec("rasterio") is None, reason="optional pixel polygonizer")
def test_component_cap_reports_omissions_without_truncating_raster():
    labels = np.zeros((120, 120), np.uint8)
    for i in range(110):
        x, y = (i % 11) * 10, (i // 11) * 10
        labels[y:y + 4, x:x + 4] = 3
    result, omissions = ml._components(labels, np.ones(labels.shape, np.float32), {3: "kitchen"}, "a" * 64)
    assert len(result) == 100
    assert omissions["capacity"] == 10
    assert (labels > 0).sum() == 110 * 16


def test_model_readiness_refuses_missing_or_changed_artifacts(tmp_path, monkeypatch):
    monkeypatch.setenv("ML_MODEL_DIR", str(tmp_path))
    result = ml.spatial_ml_readiness()
    assert not result["available"]
    assert all(row["profileVersion"] for row in result["models"])
    model = ml._manifest()["models"][0]
    (tmp_path / model["filename"]).write_bytes(b"not a model")
    with pytest.raises(ml.SpatialInferenceError) as error:
        ml._verified_path(model)
    assert error.value.code == "MODEL_MISMATCH"


def test_missing_native_library_blocks_readiness_and_inference_before_storage(monkeypatch):
    def broken_native_import(name):
        if name == "rasterio":
            raise ImportError("libexpat.so.1: cannot open shared object file")
        return object()

    monkeypatch.setattr(ml.importlib, "import_module", broken_native_import)
    monkeypatch.setattr(ml, "_verified_path", lambda model: (None, None))
    readiness = ml.spatial_ml_readiness()
    assert readiness["available"] is False
    assert all(not row["ready"] and "rasterio" in row["reason"] for row in readiness["models"])
    with pytest.raises(ml.SpatialInferenceError) as error:
        ml.infer_spatial(request(), object())
    assert error.value.code == "DEPENDENCY_UNAVAILABLE"
    assert "rasterio" in str(error.value)


@pytest.mark.skipif(any(importlib.util.find_spec(x) is None for x in ("onnxruntime", "rasterio")), reason="optional model runtime")
def test_empty_output_still_retains_exact_raster_and_mask_receipts(monkeypatch):
    raw = image_bytes()
    monkeypatch.setattr(ml, "_verified_path", lambda model: (None, None))
    monkeypatch.setattr(ml, "_run_model", lambda model, image: (np.zeros((image.height, image.width), np.uint8), np.zeros((image.height, image.width), np.float32), {0: "background"}, "mock_for_boundary_test"))
    result = ml.infer_spatial(request(raw), Storage(raw))
    assert set(result) == {"schemaVersion", "inputFingerprint", "task", "status", "model", "raster", "mask", "components", "receipt"}
    assert result["status"] == "empty"
    assert result["components"] == []
    assert result["raster"]["width"] == result["mask"]["width"]
    assert result["receipt"]["sourceSha256"] == hashlib.sha256(raw).hexdigest()
    assert result["receipt"]["spatialAuthority"] is False
    assert result["receipt"]["coordinateUnit"] == "pixel"


@pytest.mark.skipif(importlib.util.find_spec("rasterio") is None, reason="optional pixel polygonizer")
def test_tiled_buildings_union_seams_in_source_coordinates_with_max_confidence(monkeypatch):
    model = ml._manifest()["models"][1]
    monkeypatch.setattr(ml, "_verified_path", lambda model: ("unused", SimpleNamespace(st_size=1, st_mtime_ns=1)))
    monkeypatch.setattr(ml, "_session", lambda *args: None)
    pixels = np.zeros((32, 1024, 3), np.uint8)
    pixels[:, :, 0] = np.arange(1024) % 256
    pixels[:, :, 1] = np.arange(1024) // 256
    image = Image.fromarray(pixels)
    seen = []

    def tile_inference(session, tile):
        pixel = tile.getpixel((0, 0))
        origin = pixel[0] + pixel[1] * 256
        seen.append(origin)
        x = np.arange(tile.width) + origin
        labels = np.zeros((tile.height, tile.width), np.uint8)
        labels[4:12, ((x >= 500) & (x < 540)) | ((x >= 900) & (x < 920))] = 7
        confidence = {0: .6, 384: .7, 512: .8}[origin]
        return labels, np.where(labels > 0, confidence, 0).astype(np.float32), {0: "background", 7: "building"}, "instance_sigmoid"

    monkeypatch.setattr(ml, "_building_tile", tile_inference)
    labels, scores, palette, kind = ml._run_model(model, image)
    assert seen == [0, 384, 512]
    assert labels.shape == (32, 1024)
    assert int(labels.sum()) == (40 + 20) * 8
    assert scores[5, 505] == pytest.approx(.7)
    assert scores[5, 520] == pytest.approx(.8)
    assert kind == "max_overlapping_instance_sigmoid"
    components, omissions = ml._components(labels, scores, palette, "b" * 64)
    assert [shape(c["geometry"]).bounds for c in components] == [(500, 4, 540, 12), (900, 4, 920, 12)]
    assert components[0]["score"] == pytest.approx(.77)
    assert sum(omissions.values()) == 0
    assert ml._building_layout(image)[1]["tileToRaster"] == [1, 0, 384, 0, 1, 0]
    # The qualified single-tile path keeps its instance IDs, confidence and size.
    single = ml._run_model(model, image.crop((0, 0, 512, 32)))
    assert single[0][5, 505] == 7
    assert single[1][5, 505] == pytest.approx(.6)
    assert single[3] == "instance_sigmoid"


@pytest.mark.skipif(any(importlib.util.find_spec(x) is None for x in ("onnxruntime", "rasterio")), reason="optional model runtime")
def test_empty_tiled_receipt_retains_all_tile_transforms_and_same_size_masks(monkeypatch):
    model = ml._manifest()["models"][1]
    raw = image_bytes((768, 600))
    data = request(raw)
    data.update(task="building", modelId=model["id"], expectedModelSha256=model["sha256"], expectedProfileVersion=model["profileVersion"])
    monkeypatch.setattr(ml, "_verified_path", lambda model: ("unused", SimpleNamespace(st_size=1, st_mtime_ns=1)))
    monkeypatch.setattr(ml, "_session", lambda *args: None)
    monkeypatch.setattr(ml, "_building_tile", lambda session, image: (np.zeros((image.height, image.width), np.uint8), np.zeros((image.height, image.width), np.float32), {0: "background"}, "instance_sigmoid"))
    result = ml.infer_spatial(data, Storage(raw))
    assert result["status"] == "empty"
    assert result["raster"]["width"] == result["mask"]["width"] == 768
    assert result["raster"]["height"] == result["mask"]["height"] == 600
    tiling = result["receipt"]["tiling"]
    assert tiling["enabled"] is True
    assert [(tile["x"], tile["y"]) for tile in tiling["tiles"]] == [(0, 0), (256, 0), (0, 88), (256, 88)]
    assert tiling["tiles"][-1]["tileToRaster"] == [1, 0, 256, 0, 1, 88]
    assert result["receipt"]["maskEncoding"] == "class"
    assert result["receipt"]["profileVersion"] == model["profileVersion"]
