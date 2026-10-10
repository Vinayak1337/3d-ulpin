"""Read eight real ZIP members through native readers; injected memory body, no network or retained source."""
from __future__ import annotations

import base64
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import zipfile

SCRATCH = Path("E:/BhuAayam-data/task-data/lv0")
PACK = Path("E:/BhuAayam-data/datasets/nyc-10013/nyc-10013-multimodal.zip")


class MemoryBody(io.BytesIO):
    def iter_chunks(self, chunk_size: int):
        while chunk := self.read(chunk_size):
            yield chunk


class MemorySource:
    """Test adapter only: no S3, key lookup, mutation or provider use."""
    def __init__(self, raw: bytes):
        self.raw = raw

    def get_object(self, **unused):
        return {"Body": MemoryBody(self.raw)}


def read_member(name: str, raw: bytes, expected_sha256: str) -> dict:
    from geo.gis_inspection import inspect_gis
    from geo.point_batch import read_point_batch
    from geo.raster_window import read_raster_window
    from geo.validation import InputError

    digest = hashlib.sha256(raw).hexdigest()
    if digest != expected_sha256:
        raise RuntimeError("Original member differs from the admitted profile hash")
    output = {"name": name, "bytes": len(raw), "sha256": digest}
    # Zero UUID is a memory-adapter control, never a source/property/application identity.
    control = "00000000-0000-0000-0000-000000000000"
    pins = {"sourceId": control, "objectKey": f"sources/{control}/{digest}", "sha256": digest, "bytes": len(raw)}
    try:
        if name.endswith(".geojson"):
            result = inspect_gis({"base64": base64.b64encode(raw).decode("ascii")})
            quarantine = result.get("quarantine", {})
            output.update(reader="inspect_gis", features=result["featureCount"], fields=len(result["fields"]),
                          accepted=quarantine.get("accepted", result["featureCount"]),
                          rejected=quarantine.get("rejected", 0), outcome="inspected")
        elif name.endswith(".laz"):
            result = read_point_batch({**pins, "batch": None}, MemorySource(raw))
            meta = result["metadata"]
            output.update(reader="read_point_batch", outcome="first_batch", points=meta["sourcePointCount"],
                          selected=meta["batch"]["count"], artifactBytes=result["artifactBytes"])
        else:
            result = read_raster_window({**pins, "window": None}, MemorySource(raw))
            meta = result["metadata"]
            output.update(reader="read_raster_window", outcome="first_window", width=meta["sourceWidth"],
                          height=meta["sourceHeight"], bands=meta["sourceBands"], window=meta["window"],
                          artifactBytes=result["artifactBytes"])
    except InputError as error:
        output.update(outcome="refused", code=str(error))
    return output


def main() -> None:
    sys.path.insert(0, str(Path("services/geo").resolve()))
    tempfile.tempdir = str(SCRATCH)
    profile = json.loads(Path("scripts/demo-import/nyc-profile.json").read_text(encoding="utf-8"))
    measured = json.loads(Path("docs/evidence/gf5/lv0/lag.json").read_text(encoding="utf-8"))["input"]
    if hashlib.sha256(PACK.read_bytes()).hexdigest() != measured["sha256"]:
        raise RuntimeError("Original ZIP differs from the accepted Part A input")
    with zipfile.ZipFile(PACK) as archive:
        members = [read_member(layer["name"], archive.read("layers/" + layer["name"]), layer["sha256"])
                   for layer in profile["layers"]]
        inventory_count = len(archive.infolist())
    if len(members) != 8:
        raise RuntimeError("The admitted profile no longer has eight layers")
    result = {"members": members, "zipMembers": inventory_count, "profileLayers": 8, "networkCalls": 0,
              "databaseAccess": False, "storingRequests": 0,
              "scope": "Real native readers, memory adapter only; HTTP outcomes are code-derived in readers.json"}
    Path("docs/evidence/gf5/lv0/eight.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
