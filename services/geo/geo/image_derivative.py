"""Bounded local image crops for explicitly selected evidence regions."""
import base64
import binascii
import hashlib
import io
import math
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

from .validation import InputError

MAX_SOURCE_BYTES = 16 * 1024 * 1024
MAX_SOURCE_PIXELS = 40_000_000
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
MAX_OUTPUT_PIXELS = 4_000_000


def crop_image(data):
    if not isinstance(data, dict) or data.get("format") not in ("png", "jpeg"):
        raise InputError("Image crops support PNG/JPEG only; PDF rasterization requires a separate tested adapter.")
    encoded = data.get("base64")
    if not isinstance(encoded, str) or len(encoded) > (MAX_SOURCE_BYTES + 2) // 3 * 4:
        raise InputError("Image source must be base64 with at most 16 MiB of original bytes.")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise InputError("Image source base64 is invalid.") from None
    if not raw or len(raw) > MAX_SOURCE_BYTES:
        raise InputError("Image source must contain 1 byte–16 MiB.")
    region = data.get("region")
    if not isinstance(region, dict) or set(region) != {"x", "y", "width", "height"}:
        raise InputError("Select an explicit normalized image region; whole-image requests use x=0,y=0,width=1,height=1.")
    for value in region.values():
        if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
            raise InputError("Image region coordinates must be finite numbers.")
    x, y, width, height = (region[key] for key in ("x", "y", "width", "height"))
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > 1 or y + height > 1:
        raise InputError("The selected region must lie within normalized image bounds.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                expected = "PNG" if data["format"] == "png" else "JPEG"
                if source.format != expected or source.width * source.height > MAX_SOURCE_PIXELS or getattr(source, "n_frames", 1) != 1:
                    raise InputError("Image format does not match, source exceeds 40 megapixels, or image is animated/multipart.")
                source.load()
                upright = ImageOps.exif_transpose(source)
                original_size = [upright.width, upright.height]
                pixels = [math.floor(x * upright.width), math.floor(y * upright.height), math.ceil((x + width) * upright.width), math.ceil((y + height) * upright.height)]
                cropped = upright.crop(tuple(pixels)).convert("RGB")
                ratio = min(1, math.sqrt(MAX_OUTPUT_PIXELS / (cropped.width * cropped.height)))
                if ratio < 1:
                    cropped = cropped.resize((max(1, int(cropped.width * ratio)), max(1, int(cropped.height * ratio))), Image.Resampling.LANCZOS)
                for _ in range(12):
                    output = io.BytesIO()
                    cropped.save(output, format="PNG", optimize=True)
                    derivative = output.getvalue()
                    if len(derivative) <= MAX_OUTPUT_BYTES:
                        break
                    cropped = cropped.resize((max(1, int(cropped.width * .75)), max(1, int(cropped.height * .75))), Image.Resampling.LANCZOS)
                else:
                    raise InputError("Image derivative could not meet the 4 MiB output bound.")
    except InputError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise InputError("Image bytes cannot be safely decoded within native crop bounds.") from None
    return {"format": "png", "base64": base64.b64encode(derivative).decode(), "width": cropped.width, "height": cropped.height,
            "sourceSha256": hashlib.sha256(raw).hexdigest(), "sha256": hashlib.sha256(derivative).hexdigest(),
            "region": region, "sourcePixels": original_size, "pixelRegion": pixels, "orientation": "exif-normalized",
            "method": "native-image-crop-v1", "bytes": len(derivative)}
