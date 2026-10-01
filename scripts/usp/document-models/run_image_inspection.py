#!/usr/bin/env python3
"""Bounded retained PNG/JPEG inspection; decode only in the supervised worker."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import sys
import warnings

SCRIPT = Path(__file__).resolve()
REPO = SCRIPT.parents[3]
sys.path.insert(0, str(REPO / 'services' / 'geo'))
MAX_SOURCE = 16 * 1024**2
MAX_PIXELS = 25_000_000
MAX_SIDE = 25_000
MAX_RESULT = 128 * 1024
MAX_PNG = 8 * 1024**2
MEMORY = 2 * 1024**3


class ImageError(Exception):
    pass


def _encode(value: dict) -> bytes:
    data = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()
    if len(data) > MAX_RESULT:
        raise ImageError('DOCUMENT_IMAGE_METADATA_LIMIT')
    return data


def _offline_worker() -> None:
    import socket
    def denied(*args, **kwargs):
        raise ImageError('DOCUMENT_IMAGE_NETWORK_DENIED')
    socket.socket = denied
    socket.create_connection = denied
    socket.getaddrinfo = denied
    # These Python restrictions are defense in depth, not OS egress enforcement.
    if os.name != 'nt':
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (MEMORY, MEMORY))
        resource.setrlimit(resource.RLIMIT_CPU, (30, 30))


def _source_bounds(image) -> None:
    w, h = image.size
    if not 0 < w <= MAX_SIDE or not 0 < h <= MAX_SIDE or w * h > MAX_PIXELS:
        raise ImageError('DOCUMENT_IMAGE_DECODE_LIMIT')
    if getattr(image, 'n_frames', 1) != 1:
        raise ImageError('DOCUMENT_IMAGE_MULTIFRAME_UNSUPPORTED')


def _orientation(value) -> tuple[int | None, int]:
    if value is None:
        return None, 1
    if type(value) is not int or not 1 <= value <= 8:
        raise ImageError('DOCUMENT_IMAGE_ORIENTATION_UNSUPPORTED')
    return value, value


def _display_plan(width: int, height: int, orientation: int, mode: str) -> dict:
    matrices = {
        1: [1, 0, 0, 0, 1, 0], 2: [-1, 0, width, 0, 1, 0],
        3: [-1, 0, width, 0, -1, height], 4: [1, 0, 0, 0, -1, height],
        5: [0, 1, 0, 1, 0, 0], 6: [0, -1, height, 1, 0, 0],
        7: [0, -1, height, -1, 0, width], 8: [0, 1, 0, -1, 0, width],
    }
    w, h = (height, width) if orientation >= 5 else (width, height)
    scale = min(1.0, 1400 / w, 1400 / h, math.sqrt(1_600_000 / (w * h)))
    rw, rh = max(1, math.floor(w * scale)), max(1, math.floor(h * scale))
    matrix = matrices[orientation]
    return {'frame': {'kind': 'image_display_top_left_pixels', 'width': rw, 'height': rh},
            'sourceToRaster': [v * (rw / w if i < 3 else rh / h) for i, v in enumerate(matrix)],
            'coordinateConvention': 'pixel_edges/1', 'mode': mode,
            'resampling': 'none' if (rw, rh) == (w, h) else 'lanczos',
            'colorInterpretation': 'encoded_samples_unmanaged'}


def _density_declarations(original: bytes, image, exif) -> list[dict]:
    """Retain source density/unit codes; never consult Pillow's derived/default DPI."""
    values = []
    def rational(value):
        if value is None:
            return None
        n, d = (value.numerator, value.denominator) if hasattr(value, 'numerator') else (value, 1)
        if type(n) is not int or type(d) is not int or not 0 <= n <= 0xffffffff or not 0 <= d <= 0xffffffff:
            return None
        return [n, d]
    def add(kind, unit, x, y):
        unit = unit if type(unit) is int and 0 <= unit <= 0xffffffff else None
        known_units = {'png_phys': (0, 1), 'jpeg_jfif': (0, 1, 2), 'exif_resolution': (1, 2, 3)}
        values.append({'kind': kind, 'unitCode': unit, 'x': x, 'y': y,
                       'status': 'supplied' if unit in known_units[kind] and x is not None and y is not None
                                 and x[1] > 0 and y[1] > 0 else 'unsupported',
                       'qualification': 'not_calibrated'})
    if image.format == 'PNG':
        offset = 8
        while offset + 12 <= len(original):
            size = int.from_bytes(original[offset:offset+4], 'big')
            if offset + 12 + size > len(original):
                break  # verify() already rejects invalid chunks.
            kind = original[offset+4:offset+8]
            if kind == b'pHYs':
                if size == 9:
                    data = original[offset+8:offset+17]
                    add('png_phys', data[8], [int.from_bytes(data[:4], 'big'), 1], [int.from_bytes(data[4:8], 'big'), 1])
                else:
                    add('png_phys', None, None, None)
                break
            offset += size + 12
    elif 'jfif_unit' in image.info:
        density = image.info.get('jfif_density', ())
        add('jpeg_jfif', image.info['jfif_unit'], rational(density[0]) if len(density) == 2 else None,
            rational(density[1]) if len(density) == 2 else None)
    if any(key in exif for key in (282, 283, 296)):
        add('exif_resolution', exif.get(296), rational(exif.get(282)), rational(exif.get(283)))
    return values


class _BoundedPng(io.BytesIO):
    def write(self, data):
        if self.tell() + len(data) > MAX_PNG:
            raise ImageError('DOCUMENT_IMAGE_RASTER_LIMIT')
        return super().write(data)


def inspect_image(source: Path, expected_hash: str, expected_format: str, raster: bool, output: Path) -> dict:
    from PIL import Image, ImageFile, PngImagePlugin
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    PngImagePlugin.MAX_TEXT_CHUNK = 64 * 1024
    PngImagePlugin.MAX_TEXT_MEMORY = MAX_RESULT
    warnings.simplefilter('error', Image.DecompressionBombWarning)
    if not source.is_file() or not 0 < source.stat().st_size <= MAX_SOURCE:
        raise ImageError('DOCUMENT_IMAGE_SOURCE_LIMIT')
    with source.open('rb') as stream:
        original = stream.read(MAX_SOURCE + 1)
    if len(original) > MAX_SOURCE or hashlib.sha256(original).hexdigest() != expected_hash:
        raise ImageError('DOCUMENT_IMAGE_SOURCE_INTEGRITY')
    with Image.open(io.BytesIO(original), formats=['PNG', 'JPEG']) as image:
        _source_bounds(image)  # Inspect header dimensions/frame count before load.
        if image.format.lower() != expected_format:
            raise ImageError('DOCUMENT_IMAGE_FORMAT_MISMATCH')
        image.verify()
    # Reopen the same verified bytes; no resource/file/plugin/URL lookup is used.
    with Image.open(io.BytesIO(original), formats=['PNG', 'JPEG']) as image:
        _source_bounds(image)
        w, h = image.size
        mode = image.mode
        exif = image.getexif()
        supplied, applied = _orientation(exif.get(274))
        colorspace = exif.get(40961)
        if colorspace is None and 34665 in exif:
            colorspace = exif.get_ifd(34665).get(40961)
        png_srgb = image.info.get('srgb')
        declared_srgb = True if png_srgb is not None or colorspace == 1 else False if colorspace is not None else None
        icc = bool(image.info.get('icc_profile'))
        transparent = 'transparency' in image.info or mode in ('RGBA', 'LA')
        reason = ('unsupported_color_profile' if icc or declared_srgb is False else
                  'unsupported_pixel_mode' if mode not in ('RGB', 'RGBA', 'L', 'LA', 'P', '1') else None)
        display_mode = 'RGBA' if transparent else 'RGB'
        plan = None if reason else _display_plan(w, h, applied, display_mode)
        image.load()  # Metadata never publishes an unverified/truncated decode.
        info = {'format': expected_format, 'mode': mode,
                'frame': {'kind': 'image_source_top_left_pixels', 'width': w, 'height': h}, 'frameCount': 1,
                'orientation': {'exifValue': supplied, 'applied': applied,
                                'provenance': 'specification_default' if supplied is None else 'source_exif'},
                'densityDeclarations': _density_declarations(original, image, exif),
                'color': {'embeddedIcc': icc, 'declaredSrgb': declared_srgb,
                          'transparency': 'supplied' if transparent else 'absent'},
                'display': plan, 'unsupportedReason': reason}
        render = None
        if raster:
            if reason:
                raise ImageError('DOCUMENT_IMAGE_DISPLAY_PROFILE_UNSUPPORTED')
            transpose = {2: Image.Transpose.FLIP_LEFT_RIGHT, 3: Image.Transpose.ROTATE_180,
                         4: Image.Transpose.FLIP_TOP_BOTTOM, 5: Image.Transpose.TRANSPOSE,
                         6: Image.Transpose.ROTATE_270, 7: Image.Transpose.TRANSVERSE,
                         8: Image.Transpose.ROTATE_90}
            oriented = image.transpose(transpose[applied]) if applied in transpose else image
            converted = oriented.convert(display_mode)
            # Create fresh pixels so EXIF/GPS, comments, ICC, text and URLs cannot
            # leak into the display PNG through Pillow's inherited info dictionary.
            clean = Image.frombytes(display_mode, converted.size, converted.tobytes())
            size = (plan['frame']['width'], plan['frame']['height'])
            if clean.size != size:
                clean = clean.resize(size, Image.Resampling.LANCZOS)
            png = _BoundedPng()
            clean.save(png, format='PNG')
            data = png.getvalue()
            (output / 'image.png').write_bytes(data)
            render = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    return {'version': 'document-image-local/1', 'sourceSha256': expected_hash,
            'sourceBytes': len(original), 'image': info, 'render': render}


def worker(args) -> int:
    _offline_worker()
    try:
        result = inspect_image(args.source, args.sha256, args.format, args.raster, args.output)
        data = _encode(result)
    except Exception as error:
        code = str(error) if isinstance(error, ImageError) else 'DOCUMENT_IMAGE_DECODE_FAILED'
        data = _encode({'version': 'document-image-failure/1', 'code': code})
        (args.output / 'result.json').write_bytes(data)
        return 1
    (args.output / 'result.json').write_bytes(data)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--format', choices=('png', 'jpeg'), required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--raster', action='store_true')
    parser.add_argument('--seconds', type=int, default=25)
    parser.add_argument('--worker', action='store_true')
    args = parser.parse_args()
    if not (1 <= args.seconds <= 25 and len(args.sha256) == 64
            and all(c in '0123456789abcdef' for c in args.sha256)):
        parser.error('unsupported image pin or bounds')
    if args.worker:
        return worker(args)
    from run_trial import _run_worker
    args.output.mkdir(mode=0o700, parents=False, exist_ok=False)
    command = [sys.executable, str(SCRIPT), *sys.argv[1:], '--worker']
    execution = _run_worker(command, args.output / 'worker.log', args.seconds, MEMORY, 64 * 1024)
    path = args.output / 'result.json'
    result_hash = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() and path.stat().st_size <= MAX_RESULT else None
    receipt = {'version': 'document-image-execution/1', 'seconds': args.seconds, 'memoryBytes': MEMORY,
               'worker': execution, 'resultSha256': result_hash}
    (args.output / 'receipt.json').write_bytes(_encode(receipt))
    return 0 if execution['exitCode'] == 0 and execution['stopReason'] is None and result_hash else 1


if __name__ == '__main__':
    raise SystemExit(main())
