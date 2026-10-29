"""Synthetic literal-profile stress controls, not surveyed buildings or topology truth."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import sysconfig
import time
from types import ModuleType

import pytest

from geo.native_citygml import DEFAULT_LIMITS, CoordinateValues, Limits, encode_result, extract

ROOT = Path(__file__).resolve().parents[3]
MODES = ("dense_lod1", "dense_lod2", "many_small", "few_huge")
OPEN = (b'<CityModel xmlns="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" '
        b'xmlns:b="http://www.opengis.net/citygml/building/2.0" srsName="EPSG:25832" srsDimension="3">')


def medium_control(path: Path, mode: str) -> dict:
    repeats = 2500 if mode.startswith("dense") else 100
    positions = b"0 0 7 1 0 7 1 1 7 0 1 7 " * repeats + b"0 0 7"
    polygon = (b"<gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>" + positions
               + b"</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>")
    surfaces = 4500 if mode == "few_huge" else 1
    geometry = b"<gml:MultiSurface>" + polygon * surfaces + b"</gml:MultiSurface>"
    if mode == "dense_lod1":
        geometry = (b"<b:lod0FootPrint>" + geometry + b"</b:lod0FootPrint><b:lod1Solid><gml:Solid>"
                    b"<gml:exterior><gml:CompositeSurface>" + polygon
                    + b"</gml:CompositeSurface></gml:exterior></gml:Solid></b:lod1Solid>")
    else:
        geometry = (b"<b:boundedBy><b:GroundSurface><b:lod2MultiSurface>" + geometry
                    + b"</b:lod2MultiSurface></b:GroundSurface></b:boundedBy>")
    size, buildings = len(OPEN) + len(b"</CityModel>"), 0
    with path.open("xb") as stream:
        stream.write(OPEN)
        while True:
            member = (b'<cityObjectMember><b:Building gml:id="synthetic-' + str(buildings).encode() + b'">'
                      + geometry + b"</b:Building></cityObjectMember>")
            if size + len(member) > DEFAULT_LIMITS.input_bytes:
                break
            stream.write(member)
            size += len(member)
            buildings += 1
        padding = DEFAULT_LIMITS.input_bytes - size
        filler = b"<!--" + b" " * (padding - 7) + b"-->" if padding >= 7 else b" " * padding
        stream.write(filler + b"</CityModel>")
    return {"buildings": buildings, "surfaces": buildings * surfaces,
            "coordinateValues": buildings * (2 if mode == "dense_lod1" else surfaces) * (repeats * 12 + 3)}


# The parent enforces the same memory, wall-time and processing-CPU ceilings as
# the desktop lane. Only a small measurement reply crosses the process boundary.
CHILD = r'''
import hashlib, json, sys, time
from pathlib import Path
if sys.stdin.buffer.read(1) != b'1': raise SystemExit(3)
sys.path[:0] = sys.argv[1:3]
if sys.platform != 'win32':
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
    resource.setrlimit(resource.RLIMIT_CPU, (60, 61))
from geo.native_citygml import extract, encode_result, CityGMLError
from geo.native_gis import convert_native_file
import psutil
path, folder = map(Path, sys.argv[3:])
started = time.perf_counter()
raw = path.read_bytes()
digest = hashlib.sha256(raw).hexdigest()
reading = extract(raw)
counts = reading['counts']
try:
    encode_result(reading)
except CityGMLError as error:
    assert error.code == 'OUTPUT_LIMIT'
else:
    raise AssertionError('stress inventory unexpectedly fits the small native artifact')
del reading, raw
[layer] = convert_native_file(path, 'citygml', folder, digest)
assert layer['state'] == 'converted' and layer['notWritten'] == 0
read_seconds = time.perf_counter() - started
info = psutil.Process().memory_info()
peak_private = getattr(info, 'peak_pagefile', None)
peak_working_set = getattr(info, 'peak_wset', None)
surfaces, output_values = 0, 0
# One GeoJSON feature is written on the single collection line. Decode only in
# this bounded child; the product writes the derivative one building at a time.
collection = json.loads(Path(layer['geojson']['path']).read_bytes())
for index, feature in enumerate(collection['features']):
    assert feature['properties']['gml:id'] == f'synthetic-{index}'
    surfaces += len(feature['properties']['geometryLocators'])
    geometry = feature['geometry']
    polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
    output_values += sum(len(ring) * 3 for polygon in polygons for ring in polygon)
assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
print(json.dumps({'counts': counts, 'features': layer['features'], 'surfaces': surfaces,
                  'outputBytes': layer['geojson']['bytes'], 'outputCoordinateValues': output_values,
                  'readSeconds': read_seconds, 'peakReadPrivateBytes': peak_private,
                  'peakReadWorkingSetBytes': peak_working_set, 'seconds': time.perf_counter() - started}))
'''


def desktop_reader() -> ModuleType:
    spec = importlib.util.spec_from_file_location("medium_cli", ROOT / "scripts/usp/desktop-citygml-read.py")
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    return cli


def bounded_conversion(path: Path, folder: Path, cli: ModuleType) -> dict:
    psutil = pytest.importorskip("psutil")
    env = {**os.environ, **{key: str(path.parent) for key in ("TMP", "TEMP", "TMPDIR")}}
    env.update({key: "1" for key in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS")})
    command = [sys._base_executable, "-I", "-S", "-B", "-c", CHILD, str(ROOT / "services/geo"),
               sysconfig.get_path("purelib"), str(path), str(folder)]
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    job = None
    started = time.monotonic()
    try:
        if os.name == "nt":
            job = cli.WindowsJob(process, DEFAULT_LIMITS)
        observed = psutil.Process(process.pid)
        observed.cpu_affinity(observed.cpu_affinity()[:DEFAULT_LIMITS.threads])
        stdout, stderr = process.communicate(b"1", timeout=DEFAULT_LIMITS.seconds)
        assert process.returncode == 0, stderr.decode()
        assert time.monotonic() - started < DEFAULT_LIMITS.seconds
        if job:
            assert job.peak_bytes() <= DEFAULT_LIMITS.memory_bytes
        result = json.loads(stdout)
        result["peakPrivateBytes"] = job.peak_bytes() if job else None
        return result
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=3)
        if job:
            job.close()


@pytest.mark.parametrize("mode", MODES)
def test_byte_ceiling_models_convert_whole_within_process_bounds(tmp_path: Path, mode: str) -> None:
    cli = desktop_reader()
    path, folder = tmp_path / f"{mode}.gml", tmp_path / "out"
    folder.mkdir()
    expected = medium_control(path, mode)
    assert path.stat().st_size == DEFAULT_LIMITS.input_bytes
    result = bounded_conversion(path, folder, cli)
    assert result["counts"]["decodedCoordinateValues"] == expected["coordinateValues"]
    assert result["features"] == expected["buildings"]
    assert result["surfaces"] == expected["surfaces"]
    divisor = 2 if mode == "dense_lod1" else 1
    assert result["outputCoordinateValues"] == expected["coordinateValues"] // divisor
    assert result["outputBytes"] > DEFAULT_LIMITS.output_bytes
    result.update({"mode": mode, "inputBytes": path.stat().st_size,
                   "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    # The real desktop gate must reach inventory overflow (the existing
    # server queues outline conversion for that code), not a count stop.
    started = time.monotonic()
    with pytest.raises(cli.CityGMLError) as raised:
        cli.supervise(path, tmp_path / "inventory.json")
    assert raised.value.code == "OUTPUT_LIMIT"
    result["nativeSeconds"] = time.monotonic() - started
    (tmp_path / "measurement.json").write_text(json.dumps(result), encoding="utf-8")


def test_desktop_gate_keeps_the_input_byte_stop(tmp_path: Path) -> None:
    cli = desktop_reader()
    path = tmp_path / "over-limit.gml"
    with path.open("xb") as stream:
        stream.truncate(DEFAULT_LIMITS.input_bytes + 1)
    with pytest.raises(cli.CityGMLError) as raised:
        cli.supervise(path, tmp_path / "inventory.json")
    assert raised.value.code == "INPUT_LIMIT"


def test_numeric_records_keep_spelling_and_exact_spans_without_eager_dicts() -> None:
    raw = OPEN + b'<gml:posList>+0 1.00 7e0</gml:posList></CityModel>'
    reading = extract(raw)
    values = reading["coordinates"][0]["values"]
    assert isinstance(values, CoordinateValues)
    assert len(values) == 3 and values[-1]["literal"] == "7e0"
    assert list(values.numbers()) == [0, 1, 7]
    assert values == list(values) and values != []
    assert values[1:] == list(values)[1:] and values[::-1] == list(values)[::-1]
    assert json.loads(json.dumps(values)) == list(values)
    assert json.loads(encode_result(reading))["coordinates"][0]["values"] == list(values)
    for value in values:
        span = value["locator"]
        assert raw[span["byteStart"]:span["byteEnd"]].decode() == value["literal"]
    with pytest.raises(ValueError, match="only be reduced"):
        Limits(coordinate_values=DEFAULT_LIMITS.coordinate_values + 1)
