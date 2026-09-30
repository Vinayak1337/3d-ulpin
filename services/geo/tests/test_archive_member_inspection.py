"""Technical admission guards: a filename is insufficient to select GeoJSON."""
import base64
import hashlib
import io
import unittest
import zipfile

from geo.archive_member_inspection import inspect_archive_member
from geo.validation import InputError


def request(name, content):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(name, content)
    raw = buffer.getvalue()
    return {"base64": base64.b64encode(raw).decode(), "outerSha256": hashlib.sha256(raw).hexdigest(),
            "ordinal": 0, "memberSha256": hashlib.sha256(content).hexdigest(), "memberBytes": len(content)}


class AdmissionChecks(unittest.TestCase):
    def test_filename_cannot_admit_metadata_or_arcgis_json(self):
        for content in (b'{"metadata":true}', b'{"features":[{"attributes":{},"geometry":{"x":0,"y":0}}]}'):
            with self.subTest(content=content), self.assertRaises(InputError) as caught:
                inspect_archive_member(request("technical.geojson", content))
            self.assertIn(str(caught.exception), ("ARCHIVE_GIS_UNSUPPORTED", "ARCHIVE_MEMBER_PROFILE_UNSUPPORTED"))

    def test_json_route_remains_unsupported_and_integrity_precedes_profile(self):
        payload = request("technical.json", b'{"type":"FeatureCollection","features":[]}')
        with self.assertRaisesRegex(InputError, '^ARCHIVE_MEMBER_PROFILE_UNSUPPORTED$'):
            inspect_archive_member(payload)
        payload["memberSha256"] = "0" * 64
        with self.assertRaisesRegex(InputError, '^ARCHIVE_MEMBER_REFERENCE_MISMATCH$'):
            inspect_archive_member(payload)
