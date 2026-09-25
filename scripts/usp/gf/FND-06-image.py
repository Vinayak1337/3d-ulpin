"""Unchanged official PNG metadata check; no images or personal values are emitted."""
import base64
import hashlib
import io
import json
from pathlib import Path
import sys
import PIL
import shapely
from PIL import Image
from geo.image_derivative import crop_image

assert PIL.__version__ == "11.2.1"
assert shapely.__version__ == "2.0.7"
source = Path(sys.argv[1])
original = source.read_bytes()
digest = hashlib.sha256(original).hexdigest()
assert digest == "11d6143dddceb1af3e5f9786bce2227abd5242e74875b8fcb8ab23eb1752c212"
with Image.open(io.BytesIO(original)) as image:
    source_exif = len(image.getexif())
    source_metadata_keys = len(image.info)
result = crop_image({"format": "png", "base64": base64.b64encode(original).decode(),
                     "region": {"x": 0, "y": 0, "width": 1, "height": 1}})
derivative = base64.b64decode(result["base64"])
with Image.open(io.BytesIO(derivative)) as image:
    assert not image.info and not image.getexif()
offset = 8
chunks = []
while offset < len(derivative):
    size = int.from_bytes(derivative[offset:offset+4], "big")
    chunks.append(derivative[offset+4:offset+8].decode("ascii"))
    offset += 12+size
assert set(chunks) == {"IHDR", "IDAT", "IEND"}
assert result["visualRedaction"] == "unqualified"
assert result["sourceSha256"] == digest
assert hashlib.sha256(source.read_bytes()).hexdigest() == digest
print(json.dumps({"status": "PASSED", "sourceUrl": "https://www.data.gov.in/_nuxt/img/logo-nic.bd517ce.png",
    "sourceSha256": digest, "sourceBytes": len(original), "sourceExifEntryCount": source_exif,
    "sourceMetadataKeyCount": source_metadata_keys, "derivativeChunks": sorted(set(chunks)),
    "derivativeSha256": result["sha256"], "originalUnchanged": True, "Pillow": PIL.__version__, "Shapely": shapely.__version__,
    "permission": "Official publicly served NIC logo linked from OGD page; local integrity/metadata verification only, no image republication, training or model calls.",
    "limitations": "No visual PII qualification; no EXIF-bearing official case if sourceExifEntryCount is zero."}))
