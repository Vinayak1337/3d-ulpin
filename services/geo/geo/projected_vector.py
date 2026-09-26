"""One qualified NWIC ZIP/member profile; bounded Feature reads, no repair or arbitrary CRS."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import re
import resource
import tempfile
import time
import uuid
import zipfile
import subprocess
import sys
import logging

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
import numpy as np
import pyproj
from pyproj import CRS, datadir, network
from pyproj.enums import TransformDirection
from pyproj.transformer import TransformerGroup
import shapely
from shapely.geometry import shape
from shapely.validation import explain_validity

from . import settings
from .validation import InputError

VERSION = 'nwic-district-vector/1'
NAMESPACE = 'nwic:district-boundary:8d9aa2e9-9806-4f26-a4ac-48ba21e9b96d'
ZIP_BYTES, MEMBER_BYTES = 71238839, 168356689
ZIP_HASH = '44c734cc72139f2447dcebfe2791cac862dc5ba265e158912d797cf3410d5c37'
MEMBER_HASH = '2b27a478e24d8c51b0655e74ce3f4f880e75c752e4597550d6fc925ed06ac201'
PROJ_HASH = '79b660eb3c09f50c0f251e958db7cbf9a2d5d18d2836e99082095b31c7e029c5'
PIPELINE = 'proj=pipeline step inv proj=lcc lat_0=24 lon_0=80 lat_1=12.472955 lat_2=35.1728044444444 x_0=4000000 y_0=4000000 ellps=WGS84 step proj=unitconvert xy_in=rad xy_out=deg'
MEMBER = 'district_nwic.GeoJSON'
FEATURE_BYTES, GEO_BYTES, INDEX_BYTES, OUTPUT_BYTES = 1048576, 2097152, 1048576, 402653184
SPECIAL = re.compile(rb'[{}"\\]')


def fail(message):
    raise InputError(message)


def pairs(values):
    result = {}
    for key, value in values:
        if key in result:
            fail('Duplicate JSON member in qualified source.')
        result[key] = value
    return result


def decode(raw):
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda value: fail('Non-finite JSON value.'))


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')


class MemberReader:
    """One bounded chunk plus one Feature, with exact decompressed offsets and hash."""
    def __init__(self, body, deadline):
        self.body, self.deadline = body, deadline
        self.buffer, self.position, self.base, self.count = b'', 0, 0, 0
        self.digest = hashlib.sha256()

    @property
    def offset(self):
        return self.base + self.position

    def available(self):
        if time.monotonic() > self.deadline:
            fail('Projected reader exceeded its 100-second execution budget.')
        if self.position == len(self.buffer):
            self.base += len(self.buffer)
            self.buffer = self.body.read(1048576)
            self.position = 0
            self.count += len(self.buffer)
            if self.count > MEMBER_BYTES:
                fail('Expanded member exceeded its qualified byte bound.')
            self.digest.update(self.buffer)
        return memoryview(self.buffer)[self.position:]

    def byte(self):
        block = self.available()
        return block[0] if block else None

    def take(self, length):
        result = bytearray()
        while length:
            block = self.available()
            if not block:
                fail('Truncated member.')
            amount = min(length, len(block))
            result.extend(block[:amount]); self.position += amount; length -= amount
        return bytes(result)

    def whitespace(self):
        while self.byte() in (9, 10, 13, 32):
            self.position += 1

    def feature(self):
        self.whitespace(); start = self.offset
        if self.byte() != 123:
            fail('Expected a complete Feature object.')
        raw, depth, string = bytearray(), 0, False
        while True:
            block = self.available()
            if not block:
                fail('Truncated Feature.')
            match = SPECIAL.search(block)
            amount = match.start() + 1 if match else len(block)
            if len(raw) + amount > FEATURE_BYTES:
                fail('Feature exceeds the qualified 1 MiB raw bound.')
            raw.extend(block[:amount]); self.position += amount
            if not match:
                continue
            token = raw[-1]
            if string:
                if token == 92:
                    raw.extend(self.take(1))  # Consume the actual escaped byte, including non-special bytes.
                elif token == 34:
                    string = False
            elif token == 34:
                string = True
            elif token == 123:
                depth += 1
                if depth > 32:
                    fail('Feature nesting exceeds the qualified bound.')
            elif token == 125:
                depth -= 1
                if depth == 0:
                    if len(raw) > FEATURE_BYTES:
                        fail('Feature exceeds the qualified raw bound.')
                    return bytes(raw), start, self.offset


def transformer(parser_hash):
    os.environ['PROJ_NETWORK'] = 'OFF'; network.set_network_enabled(False)
    if pyproj.__version__ != '3.6.1' or pyproj.proj_version_str != '9.3.0' or shapely.__version__ != '2.0.7':
        fail('Projected library versions differ from the qualified profile.')
    proj_db = Path(datadir.get_data_dir()) / 'proj.db'
    if hashlib.sha256(proj_db.read_bytes()).hexdigest() != PROJ_HASH:
        fail('PROJ database differs from the qualified offline transform.')
    group = TransformerGroup(CRS.from_epsg(7755), CRS.from_epsg(4326), always_xy=True, allow_ballpark=False)
    if len(group.transformers) != 1 or not group.best_available or group.unavailable_operations:
        fail('Offline transform inventory differs from the qualified profile.')
    operation = group.transformers[0]
    if operation.definition != PIPELINE:
        fail('Offline transform definition differs from the qualified profile.')
    provenance = dict(sourceCrs='EPSG:7755', targetCrs='EPSG:4326', axisOrder='always_xy', sourceUnit='metre', targetUnit='degree',
        verticalReference=None, pyproj='3.6.1', proj='9.3.0', shapely='2.0.7', projDatabaseSha256=PROJ_HASH,
        definition=PIPELINE, network=False, ballpark=False, grids=[], parserSha256=parser_hash,
        accuracyQualification='numerical_transform_only_not_survey_accuracy')
    return operation, provenance


def geometry(feature, operation):
    native = feature.get('geometry')
    if feature.get('type') != 'Feature' or not isinstance(native, dict) or native.get('type') != 'MultiPolygon':
        fail('Qualified profile requires complete MultiPolygon Features.')
    polygons = native.get('coordinates')
    if not isinstance(polygons, list) or not 1 <= len(polygons) <= 128:
        fail('Polygon count exceeds the qualified feature bound.')
    transformed, positions, rings, residual = [], 0, 0, 0.0
    for polygon in polygons:
        if not isinstance(polygon, list) or not polygon:
            fail('Missing polygon rings.')
        output = []
        for ring in polygon:
            rings += 1
            if rings > 128 or not isinstance(ring, list) or not 4 <= len(ring) <= 17000 or ring[0] != ring[-1]:
                fail('Ring count/length/closure differs from the qualified profile.')
            for point in ring:
                if not isinstance(point, list) or len(point) != 2 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in point):
                    fail('Only finite source-supplied 2D XY positions are admitted.')
            positions += len(ring)
            if positions > 18000:
                fail('Feature position count exceeds the qualified bound.')
            xy = np.asarray(ring, dtype=np.float64)
            lon, lat = operation.transform(xy[:, 0], xy[:, 1], errcheck=True)
            if not (np.isfinite(lon).all() and np.isfinite(lat).all() and (np.abs(lon) <= 180).all() and (np.abs(lat) <= 90).all()):
                fail('Projected coordinates are outside finite geographic bounds.')
            x, y = operation.transform(lon, lat, direction=TransformDirection.INVERSE, errcheck=True)
            residual = max(residual, float(np.hypot(x-xy[:, 0], y-xy[:, 1]).max()))
            output.append(np.column_stack((lon, lat)).tolist())
        transformed.append(output)
    if residual > 0.000001:
        fail('Numerical round-trip diagnostic differs from the qualified bound; not a survey test.')
    geographic = {'type':'MultiPolygon', 'coordinates':transformed}
    native_shape, geographic_shape = shape(native), shape(geographic)
    reason = None
    if not native_shape.is_valid:
        reason = 'native_topology: ' + explain_validity(native_shape)
    elif not geographic_shape.is_valid:
        reason = 'geographic_topology: ' + explain_validity(geographic_shape)
    return geographic, positions, list(native_shape.bounds), list(geographic_shape.bounds), reason, native_shape.is_valid, residual


def process_projected(data: dict, s3=None) -> dict:
    started = time.monotonic(); deadline = started + 100
    parser_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    if data.get('kind') != 'retained_source' or data.get('version') != VERSION or data.get('parserSha256') != parser_hash:
        fail('Unsupported projected source/profile/parser pin.')
    for key in ['jobId', 'caseId', 'sourceId', 'sourceFamilyId']:
        try:
            if str(uuid.UUID(data[key])) != data[key]: fail('Noncanonical job/source identity.')
        except (ValueError, KeyError, TypeError): fail('Missing job/source identity.')
    if data.get('sha256') != ZIP_HASH or data.get('bytes') != ZIP_BYTES or data.get('objectKey') != f"large-originals/{data['sourceId']}/{ZIP_HASH}":
        fail('This converter only admits the exact qualified retained NWIC original.')
    if not re.fullmatch('[a-f0-9]{64}', data.get('inputFingerprint', '')):
        fail('Missing immutable job input fingerprint.')
    operation, transform = transformer(parser_hash)
    s3 = s3 or boto3.client('s3', endpoint_url=settings.S3_ENDPOINT, aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY, region_name=settings.S3_REGION,
        config=Config(signature_version='s3v4', s3={'addressing_style':'path'}, connect_timeout=5, read_timeout=10, retries={'max_attempts':0}))
    prefix = f'projected-vectors/{parser_hash}/{ZIP_HASH}'
    output_bytes = 0

    def put(raw, path, bound):
        nonlocal output_bytes
        if not 0 < len(raw) <= bound or time.monotonic() > deadline:
            fail('Projected artifact exceeds its byte/time bound.')
        output_bytes += len(raw)
        if output_bytes > OUTPUT_BYTES:
            fail('Projected artifact generation exceeded its total byte bound.')
        digest = hashlib.sha256(raw).hexdigest(); key = f'{prefix}/{path}-{digest}.json'
        try:
            s3.put_object(Bucket=settings.S3_BUCKET, Key=key, Body=raw, ContentLength=len(raw), ContentType='application/json', IfNoneMatch='*', Metadata={'sha256':digest})
        except ClientError as error:
            if error.response.get('ResponseMetadata', {}).get('HTTPStatusCode') != 412:
                raise
            head = s3.head_object(Bucket=settings.S3_BUCKET, Key=key)
            if head['ContentLength'] != len(raw) or head.get('Metadata', {}).get('sha256') != digest:
                fail('Existing immutable artifact differs from its content address.')
        return {'key':key, 'bytes':len(raw), 'sha256':digest}

    entries, keys, positions, invalid, admitted, maximum = [], set(), 0, 0, 0, 0.0
    with tempfile.TemporaryDirectory(prefix='ulpin-projected-') as folder:
        archive = Path(folder) / 'original.zip'; obj = s3.get_object(Bucket=settings.S3_BUCKET, Key=data['objectKey'])
        if obj.get('ContentLength') != ZIP_BYTES:
            obj['Body'].close(); fail('Retained ZIP size differs from its qualified receipt.')
        digest, count = hashlib.sha256(), 0
        try:
            with archive.open('xb') as target:
                while chunk := obj['Body'].read(1048576):
                    count += len(chunk)
                    if count > ZIP_BYTES or time.monotonic() > deadline:
                        fail('Retained ZIP exceeds its bounded receipt.')
                    digest.update(chunk); target.write(chunk)
        finally:
            obj['Body'].close()
        if count != ZIP_BYTES or digest.hexdigest() != ZIP_HASH:
            fail('Retained ZIP checksum differs from its qualified receipt.')
        with zipfile.ZipFile(archive) as bundle:
            members = bundle.infolist()
            if len(members) != 1:
                fail('Qualified archive requires exactly one member; no companion/traversal admission.')
            info = members[0]
            if info.filename != MEMBER or info.file_size != MEMBER_BYTES or info.compress_size != 71238699 or info.compress_type != zipfile.ZIP_DEFLATED or info.flag_bits != 0:
                fail('Archive member path/compression/expanded size differs from the qualified profile.')
            if info.file_size > 4 * info.compress_size or (info.external_attr >> 16) & 0o170000 == 0o120000:
                fail('Archive expansion ratio or symlink is outside the qualified profile.')
            with bundle.open(info) as body:
                reader = MemberReader(body, deadline)
                header = decode(reader.take(152) + b']}')
                expected = {'type':'FeatureCollection','name':'district_nwic','crs':{'type':'name','properties':{'name':'urn:ogc:def:crs:EPSG::7755'}},'features':[]}
                if header != expected:
                    fail('Qualified member header/declared CRS differs; no guessing is allowed.')
                for index in range(733):
                    raw, start, end = reader.feature(); feature = decode(raw); props = feature.get('properties')
                    if not isinstance(props, dict) or not isinstance(props.get('id'), int) or isinstance(props['id'], bool) or abs(props['id']) > 9007199254740991 or props.get('objectid') != props['id'] or not isinstance(props.get('district'), str):
                        fail('Qualified numeric native identity/property schema differs.')
                    if props['id'] in keys: fail('Duplicate typed native identity in qualified source.')
                    keys.add(props['id'])
                    geographic, count, native_box, geo_box, reason, native_valid, residual = geometry(feature, operation)
                    positions += count; invalid += not native_valid; maximum = max(maximum, residual)
                    ref = put(raw, f'native/{index:04}', FEATURE_BYTES)
                    geo_ref = None
                    if reason is None:
                        geo_ref = put(encode({'type':'Feature','properties':props,'geometry':geographic}), f'geographic/{index:04}', GEO_BYTES)
                        admitted += 1
                    entries.append(dict(index=index,start=start,end=end,key={'type':'number','value':props['id']},positions=count,
                        disposition='quarantined' if reason else 'admitted',reason=reason,nativeBounds=native_box,
                        geographicBounds=None if reason else geo_box,raw=ref,geographic=geo_ref))
                    reader.whitespace(); separator = reader.take(1)
                    if separator != (b',' if index < 732 else b']'):
                        fail('Feature count or complete-record separator differs from the qualified profile.')
                reader.whitespace()
                if reader.take(1) != b'}': fail('Unexpected member trailer.')
                reader.whitespace()
                if reader.byte() is not None or reader.count != MEMBER_BYTES or reader.digest.hexdigest() != MEMBER_HASH:
                    fail('Unchanged expanded-member size/hash or EOF failed.')
    if positions != 3125505 or invalid != 13:
        fail('Source position/native-topology disposition totals differ from the qualified profile.')
    totals = dict(features=733,positions=positions,nativeValid=720,nativeInvalid=13,admitted=admitted,quarantined=733-admitted)
    manifest = dict(version=VERSION,namespace=NAMESPACE,jobId=data['jobId'],sourceId=data['sourceId'],inputFingerprint=data['inputFingerprint'],
        zipSha256=ZIP_HASH,memberSha256=MEMBER_HASH,memberBytes=MEMBER_BYTES,transform=transform,totals=totals,
        numericalRoundTrip={'maximumMetres':maximum,'positions':positions},entries=entries)
    index = put(encode(manifest), f"index/{data['jobId']}", INDEX_BYTES)
    return dict(version=VERSION,jobId=data['jobId'],sourceId=data['sourceId'],inputFingerprint=data['inputFingerprint'],index=index,
        totals=totals,parserSha256=parser_hash,execution={'seconds':time.monotonic()-started,
        'peakResidentBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024,'outputBytes':output_bytes})


def run_projected(data):
    """A resource-bounded child inside the existing Celery task, not another queue."""
    raw = encode(data)
    if len(raw) > 8192:
        fail('Projected job input exceeds its private metadata bound.')
    env = dict(os.environ, PROJ_NETWORK='OFF', OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1', MKL_NUM_THREADS='1')
    result = subprocess.run([sys.executable, '-m', 'geo.projected_vector'], input=raw, capture_output=True,
        timeout=108, env=env, start_new_session=True)
    if result.returncode or len(result.stdout) > 8192:
        logging.getLogger(__name__).warning('Projected child failed: %s', result.stderr.decode('utf-8', errors='replace')[:1000])
        fail('Bounded projected child failed; original remains unchanged. Inspect private worker logs.')
    return decode(result.stdout)


if __name__ == '__main__':
    resource.setrlimit(resource.RLIMIT_AS, (2*1024**3, 2*1024**3))
    resource.setrlimit(resource.RLIMIT_CPU, (100, 105))
    resource.setrlimit(resource.RLIMIT_FSIZE, (80*1024**2, 80*1024**2))
    try:
        raw = sys.stdin.buffer.read(8193)
        if len(raw) > 8192: fail('Projected job input exceeded its bound.')
        print(encode(process_projected(decode(raw))).decode('utf-8'))
    except Exception as error:
        print(f'projected child failed ({type(error).__name__}): {str(error)[:400]}', file=sys.stderr)
        sys.exit(1)
