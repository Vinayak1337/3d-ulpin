"""test_only: tiny LAS/LAZ sources authored from literal values, not survey truth."""
import base64
from collections.abc import Iterator
import hashlib
import io
from pathlib import Path

import laspy
import numpy as np
from pyproj import CRS
import pytest

from geo import point_batch
from geo.point_batch import read_point_batch
from geo.validation import InputError

SOURCE_ID = "30000000-0000-4000-8000-000000000001"


class Body(io.BytesIO):
    def iter_chunks(self, chunk_size: int) -> Iterator[bytes]:
        while block := self.read(chunk_size):
            yield block


class StoredSource:
    def __init__(self, content: bytes) -> None:
        self.content = content
        digest = hashlib.sha256(content).hexdigest()
        self.pins = {"sourceId": SOURCE_ID, "objectKey": f"large-originals/{SOURCE_ID}/{digest}",
                     "sha256": digest, "bytes": len(content), "batch": None}

    def get_object(self, Bucket: str, Key: str) -> dict:
        assert Key == self.pins["objectKey"]
        return {"Body": Body(self.content)}

    def read(self, batch: dict | None = None) -> dict:
        return read_point_batch({**self.pins, "batch": batch}, s3=self)


def literal_source(tmp_path: Path, version: str, fmt: int, compressed: bool = False,
                   with_crs: bool = True) -> tuple[StoredSource, laspy.LasData]:
    header = laspy.LasHeader(version=version, point_format=fmt)
    header.scales = np.array([0.01, 0.02, 0.05])
    header.offsets = np.array([500, 1000, -10])
    if with_crs:
        header.add_crs(CRS.from_epsg(32643))
    points = laspy.LasData(header)
    points.x, points.y, points.z = [501.25, 502.5], [1001, 1003], [-8.5, -7]
    points.classification = [2, 5]
    points.return_number, points.number_of_returns = [1, 2], [2, 2]
    dimensions = set(header.point_format.dimension_names)
    if "gps_time" in dimensions:
        points.gps_time = [12345.25, 12346.5]
    if "red" in dimensions:
        points.red, points.green, points.blue = [100, 200], [300, 400], [500, 600]
    path = tmp_path / ("literal.laz" if compressed else "literal.las")
    points.write(path, do_compress=compressed, laz_backend=laspy.LazBackend.LazrsParallel)
    return StoredSource(path.read_bytes()), points


@pytest.mark.parametrize("version,fmt,compressed", [
    ("1.2", 1, False), ("1.3", 3, False), ("1.4", 6, True),
    ("1.2", 0, False), ("1.2", 2, True), ("1.4", 7, False), ("1.4", 8, True),
])
def test_native_records_preserve_source_dimensions_and_values(
        tmp_path: Path, version: str, fmt: int, compressed: bool) -> None:
    stored, source = literal_source(tmp_path, version, fmt, compressed)
    result = stored.read()
    metadata = result["metadata"]
    assert (metadata["lasVersion"], metadata["pointFormatId"], metadata["recordLength"]) == (
        version, fmt, source.point_format.size)
    assert metadata["recordEncoding"] == f"las-{version}-point-format-{fmt}-le"
    assert metadata["dimensions"] == list(source.point_format.dimension_names)
    records = base64.b64decode(result["artifactBase64"])
    assert records == source.points.array.tobytes()
    assert result["artifactBytes"] == 2 * source.point_format.size
    assert result["artifactSha256"] == hashlib.sha256(records).hexdigest()
    decoded = laspy.ScaleAwarePointRecord(np.frombuffer(records, dtype=source.point_format.dtype()),
                                         source.point_format, metadata["scale"], metadata["offset"])
    assert list(decoded.x) == list(source.x)
    assert list(decoded.y) == list(source.y)
    assert list(decoded.z) == list(source.z)
    assert list(decoded.classification) == [2, 5]
    assert list(decoded.return_number) == [1, 2]
    for name in ("red", "green", "blue", "gps_time"):
        if name in metadata["dimensions"]:
            assert list(decoded[name]) == list(source[name])
        else:
            assert name not in decoded.array.dtype.names
            assert name not in [field["name"] for field in metadata["recordFields"]]
    assert metadata["gpsTimeType"] == ("week_time" if "gps_time" in metadata["dimensions"] else None)
    assert metadata["horizontalAuthority"] == "EPSG:32643"
    assert metadata["verticalReferenceStatus"] == "unknown"
    tail = stored.read({"start": 1, "count": 1})
    assert base64.b64decode(tail["artifactBase64"]) == source.points.array[1:].tobytes()


def test_no_crs_stays_unknown(tmp_path: Path) -> None:
    stored, _ = literal_source(tmp_path, "1.2", 0, with_crs=False)
    metadata = stored.read()["metadata"]
    assert metadata["crsWkt"] is None
    assert metadata["horizontalAuthority"] is None
    assert metadata["verticalReference"] is None
    assert metadata["verticalReferenceStatus"] == "unknown"
    assert metadata["gpsTimeType"] is None
    assert not {"gps_time", "red", "green", "blue"}.intersection(metadata["dimensions"])


def test_waveform_format_is_refused_with_words(tmp_path: Path) -> None:
    stored, _ = literal_source(tmp_path, "1.3", 4)
    with pytest.raises(InputError, match="waveform formats 4/5/9/10"):
        stored.read()


@pytest.mark.parametrize("compressed", [False, True])
def test_temp_suffix_uses_header_compression(tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
                                           compressed: bool) -> None:
    stored, _ = literal_source(tmp_path, "1.2", 1, compressed)
    reader = point_batch._read_native_batch

    def checked_read(path: Path, requested: dict | None) -> dict:
        assert path.suffix == (".laz" if compressed else ".las")
        return reader(path, requested)

    monkeypatch.setattr(point_batch, "_read_native_batch", checked_read)
    stored.read()


def test_old_versions_extra_dimensions_and_over_limit_counts_stay_refused(tmp_path: Path) -> None:
    stored, _ = literal_source(tmp_path, "1.1", 0)
    with pytest.raises(InputError, match="Only LAS 1.2, 1.3 or 1.4"):
        stored.read()
    stored, source = literal_source(tmp_path, "1.2", 1)
    content = bytearray(stored.content)
    content[107:111] = (5_000_001).to_bytes(4, "little")
    with pytest.raises(InputError, match="Point count exceeds"):
        StoredSource(bytes(content)).read()
    source.add_extra_dim(laspy.ExtraBytesParams(name="test_dimension", type="uint16"))
    path = tmp_path / "extra.las"
    source.write(path)
    with pytest.raises(InputError, match="without extra dimensions"):
        StoredSource(path.read_bytes()).read()
    pins = {**stored.pins, "bytes": 16 * 1024 * 1024 + 1}
    with pytest.raises(InputError, match="at most 16 MiB"):
        read_point_batch(pins, s3=stored)


def test_limits_and_integrity_still_apply(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from geo import settings

    monkeypatch.setattr(settings, "VERIFIED_CACHE_DIR", str(tmp_path / "verified"))
    downloads = []
    chunks = Body.iter_chunks

    def counted(body: Body, chunk_size: int) -> Iterator[bytes]:
        downloads.append(1)
        yield from chunks(body, chunk_size)

    monkeypatch.setattr(Body, "iter_chunks", counted)
    stored, _ = literal_source(tmp_path, "1.2", 1)
    with pytest.raises(InputError, match="outside the retained source point count"):
        stored.read({"start": 1, "count": 2})
    with pytest.raises(InputError, match="bounded reader profile"):
        stored.read({"start": 0, "count": 8193})
    stored.read()
    assert len(downloads) == 1
    stored.content += b"changed"
    stored.read()  # The already verified original, not the changed remote body, is reused.
    assert len(downloads) == 1
    empty_cache = tmp_path / "cache-miss"
    monkeypatch.setattr(settings, "VERIFIED_CACHE_DIR", str(empty_cache))
    with pytest.raises(InputError, match="exceeds its retained byte receipt"):
        stored.read()
    assert len(downloads) == 2
    assert [path.name for path in empty_cache.iterdir()] == [".lock"]
