"""test_only: tiny LAS/LAZ sources authored from literal values, not survey truth."""
import base64
from collections.abc import Iterator
import hashlib
import io
from pathlib import Path
import time

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
    content[107:111] = (point_batch.MAX_SOURCE_POINTS + 1).to_bytes(4, "little")
    with pytest.raises(InputError, match="Point count exceeds"):
        StoredSource(bytes(content)).read()
    source.add_extra_dim(laspy.ExtraBytesParams(name="test_dimension", type="uint16"))
    path = tmp_path / "extra.las"
    source.write(path)
    with pytest.raises(InputError, match="without extra dimensions"):
        StoredSource(path.read_bytes()).read()
    pins = {**stored.pins, "bytes": point_batch.MAX_SOURCE_BYTES + 1}
    with pytest.raises(InputError, match="at most 1 GiB"):
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
        stored.read({"start": 0, "count": point_batch.MAX_BATCH_POINTS + 1})
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


@pytest.mark.parametrize("step", [0, 1.5, True, 65_537])
def test_thinned_invalid_step_is_refused(tmp_path: Path, step: object) -> None:
    stored, _ = literal_source(tmp_path, "1.2", 0)
    with pytest.raises(InputError, match="bounded reader profile"):
        stored.read({"start": 0, "count": 1, "step": step})


def test_thinned_last_point_and_chunk_boundary(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = laspy.LasData(laspy.LasHeader(version="1.2", point_format=0))
    source.X = np.arange(1_048_581, dtype=np.int32)
    path = tmp_path / "test-only-chunks.las"
    source.write(path)
    stored = StoredSource(path.read_bytes())
    iterator = laspy.LasReader.chunk_iterator
    lengths = []

    def checked_chunks(reader: laspy.LasReader, size: int) -> Iterator:
        assert size <= 1_048_576
        for chunk in iterator(reader, size):
            lengths.append(len(chunk))
            yield chunk
            del chunk

    monkeypatch.setattr(laspy.LasReader, "chunk_iterator", checked_chunks)
    batch = {"start": 4, "count": 17, "step": 65_536}
    result = stored.read(batch)
    assert result["metadata"]["batch"] == batch
    assert lengths == [1_048_576, 1]
    assert base64.b64decode(result["artifactBase64"]) == source.points.array[4::65_536].tobytes()
    with pytest.raises(InputError, match="outside the retained source point count"):
        stored.read({**batch, "count": 18})


class FileBody(io.BufferedReader):
    iter_chunks = Body.iter_chunks


class StoredFile(StoredSource):
    def __init__(self, path: Path) -> None:
        self.path = path
        with path.open("rb") as content:
            digest = hashlib.file_digest(content, "sha256").hexdigest()
        self.pins = {"sourceId": SOURCE_ID, "objectKey": f"large-originals/{SOURCE_ID}/{digest}",
                     "sha256": digest, "bytes": path.stat().st_size, "batch": None}
        self.downloaded = 0

    def get_object(self, Bucket: str, Key: str) -> dict:
        assert Key == self.pins["objectKey"]
        stored = self

        class MeasuredBody(FileBody):
            def iter_chunks(self, chunk_size: int) -> Iterator[bytes]:
                for block in super().iter_chunks(chunk_size):
                    stored.downloaded += len(block)
                    yield block

        return {"Body": MeasuredBody(self.path.open("rb"))}


NYC = Path("E:/BhuAayam-data/task-data/nyc-10013-multimodal")


def test_thinned_nyc_copc_whole_cloud(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from geo import settings

    path = NYC / "originals/20170504_980200.copc.laz"
    if not path.is_file():
        pytest.skip("The public test_only NYC COPC is absent from the data drive.")
    monkeypatch.setattr(settings, "VERIFIED_CACHE_DIR", str(tmp_path / "cold-cache"))
    stored = StoredFile(path)
    started = time.perf_counter()
    result = stored.read()
    elapsed = time.perf_counter() - started
    print(f"NYC COPC cold download + decode + thin: {elapsed:.3f} s; {stored.pins['bytes']} bytes")
    assert elapsed < 120, "The cold point read needs headroom inside the absolute 150 s operation."
    assert stored.downloaded == stored.pins["bytes"]
    metadata = result["metadata"]
    assert metadata["sourcePointCount"] == 12_036_869
    assert metadata["batch"] == {"start": 0, "count": 32_709, "step": 368}
    assert metadata["recordLength"] == 30
    records = base64.b64decode(result["artifactBase64"])
    assert len(records) == 32_709 * 30
    assert hashlib.sha256(records).hexdigest() == result["artifactSha256"]
    with laspy.open(path, laz_backend=laspy.LazBackend.Lazrs) as source:
        decoded = laspy.ScaleAwarePointRecord(np.frombuffer(records, dtype=source.header.point_format.dtype()),
                                             source.header.point_format, metadata["scale"], metadata["offset"])
        bounds = metadata["sourceBounds"]
        for axis, low, high in zip((decoded.x, decoded.y, decoded.z), bounds[:3], bounds[3:]):
            assert np.all(axis >= low) and np.all(axis <= high)
        # Independent chunk boundaries verify source indices without lazrs' broken variable-chunk seeks.
        samples = {index * 368: index for index in (0, 1, 17, 2849, 2850, 16_354, 32_708)}
        offset = 0
        for chunk in source.chunk_iterator(131_071):
            for at, index in samples.items():
                if offset <= at < offset + len(chunk):
                    expected = chunk.array[at - offset:at - offset + 1].tobytes()
                    assert records[index * 30:(index + 1) * 30] == expected
            offset += len(chunk)
            del chunk
    tail = stored.read({"start": 2849 * 368, "count": 3, "step": 368})
    assert base64.b64decode(tail["artifactBase64"]) == records[2849 * 30:2852 * 30]


def test_thinned_nyc_explicit_batch_matches_base_reader() -> None:
    path = NYC / "upload/nyc-10013-lidar-2017.laz"
    if not path.is_file():
        pytest.skip("The public test_only NYC upload LAZ is absent from the data drive.")
    result = StoredFile(path).read({"start": 0, "count": 8192})
    records = base64.b64decode(result["artifactBase64"])
    with laspy.open(path, laz_backend=laspy.LazBackend.LazrsParallel) as source:
        assert records == source.read_points(8192).array.tobytes()
    assert result["artifactSha256"] == "83286b0b5d8edf731d469b0cce1b768ba5a9af22abcb905ab294cbbb6a8dcaec"
