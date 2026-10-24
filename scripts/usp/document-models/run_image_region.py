#!/usr/bin/env python3
"""Original-oriented image crop, executed only in the existing gated image worker."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys

# The unchanged Job gate uses runpy.run_path, which does not add this directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_image_inspection as images

SCRIPT = Path(__file__).resolve()


def recipe() -> dict:
    return {'version': 'packet-image-region-recipe/1',
            'workerSha256': hashlib.sha256(SCRIPT.read_bytes()).hexdigest(),
            'decoderSha256': hashlib.sha256(images.SCRIPT.read_bytes()).hexdigest(),
            'supervisorSha256': hashlib.sha256((SCRIPT.parent / 'run_trial.py').read_bytes()).hexdigest(),
            'crop': 'oriented_original_before_resampling/1', 'rounding': 'inward_complete_pixels/1',
            'metadataPolicy': 'fresh_rgb_or_rgba_pixels_only/1'}


def region_plan(selection: dict, info: dict) -> tuple[dict, tuple[int, int]]:
    """Pixel-edge coordinates; include only whole original pixels inside approval."""
    if (not isinstance(selection, dict) or set(selection) != {'frame', 'coordinates', 'region', 'selectionAcknowledged'}
            or selection['coordinates'] != 'oriented_original_pixel_edges/1' or selection['selectionAcknowledged'] is not True):
        raise images.ImageError('DOCUMENT_IMAGE_REGION_SELECTION_INVALID')
    w, h = info['frame']['width'], info['frame']['height']
    orientation = info['orientation']['applied']
    ow, oh = (h, w) if orientation >= 5 else (w, h)
    expected_frame = {'kind': 'image_oriented_top_left_pixels', 'width': ow, 'height': oh,
                      'orientation': info['orientation']}
    if selection['frame'] != expected_frame:
        raise images.ImageError('DOCUMENT_IMAGE_REGION_FRAME_MISMATCH')
    box = selection['region']
    if (not isinstance(box, list) or len(box) != 4 or
            any(type(v) not in (int, float) or not math.isfinite(v) for v in box) or
            not (0 <= box[0] < box[2] <= ow and 0 <= box[1] < box[3] <= oh)):
        raise images.ImageError('DOCUMENT_IMAGE_REGION_SELECTION_INVALID')
    x0, y0, x1, y1 = math.ceil(box[0]), math.ceil(box[1]), math.floor(box[2]), math.floor(box[3])
    cw, ch = x1-x0, y1-y0
    if min(cw, ch) < 1:
        raise images.ImageError('DOCUMENT_IMAGE_REGION_EMPTY')
    scale = min(1.0, 1400/cw, 1400/ch, math.sqrt(1_600_000/(cw*ch)))
    rw, rh = max(1, math.floor(cw*scale)), max(1, math.floor(ch*scale))
    sx, sy = rw/cw, rh/ch
    source_to_oriented = {
        1: [1, 0, 0, 0, 1, 0], 2: [-1, 0, w, 0, 1, 0],
        3: [-1, 0, w, 0, -1, h], 4: [1, 0, 0, 0, -1, h],
        5: [0, 1, 0, 1, 0, 0], 6: [0, -1, h, 1, 0, 0],
        7: [0, -1, h, -1, 0, w], 8: [0, 1, 0, -1, 0, w],
    }[orientation]
    a, b, c, d, e, f = source_to_oriented
    return {'includedPixelBounds': [x0, y0, x1, y1], 'includedOrientedRegion': [x0, y0, x1, y1],
            'sourceToOriented': source_to_oriented, 'orientedToOutput': [sx, 0, -x0*sx, 0, sy, -y0*sy],
            'sourceToOutput': [a*sx, b*sx, (c-x0)*sx, d*sy, e*sy, (f-y0)*sy],
            'outputToOriented': [1/sx, 0, x0, 0, 1/sy, y0],
            'coordinateConvention': 'pixel_edges/1', 'rounding': 'inward_complete_pixels/1',
            'resampling': 'none' if (rw, rh) == (cw, ch) else 'lanczos'}, (rw, rh)


def inspect_region(source: Path, expected_hash: str, expected_format: str, selection: dict, output: Path) -> dict:
    def render(oriented, info, source_hash, source_bytes, directory):
        from PIL import Image, features, __version__ as pillow_version
        transform, size = region_plan(selection, info)
        # Crop the oriented original before conversion/fresh allocation/resizing.
        cropped = oriented.crop(tuple(transform['includedPixelBounds']))
        mode = 'RGBA' if info['color']['transparency'] == 'supplied' else 'RGB'
        result = images._write_clean_png(cropped.convert(mode), size, directory)
        runtime = {'python': sys.version.split()[0], 'pillow': pillow_version,
                   'jpegCodec': features.version('jpg'), 'libjpegTurbo': features.version('libjpeg_turbo'),
                   'zlibCodec': features.version('zlib'),
                   'pythonSha256': hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest(),
                   'launcherSha256': hashlib.sha256(Path(os.environ.get('ULPIN_TRIAL_PYTHON', sys.executable)).read_bytes()).hexdigest(),
                   'pillowImageSha256': hashlib.sha256(Path(Image.__file__).read_bytes()).hexdigest(),
                   'imagingSha256': hashlib.sha256(Path(Image.core.__file__).read_bytes()).hexdigest()}
        return {'version': 'packet-image-region-local/1', 'sourceSha256': source_hash, 'sourceBytes': source_bytes,
                'sourceImage': {k: v for k, v in info.items() if k != 'display'}, 'selection': selection,
                'recipe': recipe(), 'runtime': runtime, 'transform': transform,
                'output': {**result, 'pixels': list(size), 'format': 'png', 'mode': mode,
                           'colorInterpretation': 'encoded_samples_unmanaged',
                           'metadataPolicy': 'fresh_rgb_or_rgba_pixels_only/1'}}
    return images.inspect_image(source, expected_hash, expected_format, True, output, render_region=render)


def worker(args) -> int:
    images._offline_worker()
    try:
        if not 0 < args.selection.stat().st_size <= 4096:
            raise images.ImageError('DOCUMENT_IMAGE_REGION_SELECTION_INVALID')
        selection = json.loads(args.selection.read_bytes())
        data = images._encode(inspect_region(args.source, args.sha256, args.format, selection, args.output))
    except Exception as error:
        code = str(error) if isinstance(error, images.ImageError) else 'DOCUMENT_IMAGE_DECODE_FAILED'
        (args.output / 'result.json').write_bytes(images._encode({'version': 'document-image-failure/1', 'code': code}))
        return 1
    (args.output / 'result.json').write_bytes(data)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--format', choices=('png', 'jpeg'), required=True)
    parser.add_argument('--selection', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--seconds', type=int, default=25)
    parser.add_argument('--worker', action='store_true')
    args = parser.parse_args()
    if not (1 <= args.seconds <= 25 and len(args.sha256) == 64 and all(c in '0123456789abcdef' for c in args.sha256)):
        parser.error('unsupported image pin or bounds')
    if args.worker:
        return worker(args)
    from run_trial import _run_worker
    args.output.mkdir(mode=0o700, parents=False, exist_ok=False)
    command = [sys.executable, str(SCRIPT), *sys.argv[1:], '--worker']
    execution = _run_worker(command, args.output / 'worker.log', args.seconds, images.MEMORY, 64*1024)
    path = args.output / 'result.json'
    result_hash = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() and path.stat().st_size <= images.MAX_RESULT else None
    (args.output / 'receipt.json').write_bytes(images._encode({'version': 'document-image-execution/1',
        'seconds': args.seconds, 'memoryBytes': images.MEMORY, 'worker': execution, 'resultSha256': result_hash}))
    return 0 if execution['exitCode'] == 0 and execution['stopReason'] is None and result_hash else 1


if __name__ == '__main__':
    raise SystemExit(main())
