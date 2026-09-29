"""Technical ZIP-header controls for document versus bundle recovery status."""

import base64
import io
import unittest
import zipfile

from geo.area import extract_document
from geo.validation import InputError


def encrypted_zip(names):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name in names:
            archive.writestr(name, b"technical control")
    raw = bytearray(output.getvalue())
    for signature, offset in ((b"PK\x03\x04", 6), (b"PK\x01\x02", 8)):
        cursor = 0
        while (cursor := raw.find(signature, cursor)) >= 0:
            flags = int.from_bytes(raw[cursor + offset:cursor + offset + 2], "little") | 1
            raw[cursor + offset:cursor + offset + 2] = flags.to_bytes(2, "little")
            cursor += 4
    return {"format": "archive", "base64": base64.b64encode(raw).decode("ascii")}


class DocumentArchiveDispatchChecks(unittest.TestCase):
    def test_encrypted_word_and_workbook_keep_document_recovery_status(self):
        for name in ("word/document.xml", "xl/workbook.xml"):
            with self.subTest(name=name), self.assertRaisesRegex(InputError, "Encrypted document archive"):
                extract_document(encrypted_zip([name]))

    def test_encrypted_generic_or_ambiguous_zip_remains_inventory(self):
        for names in (["map.csv"], ["word/document.xml", "xl/workbook.xml"]):
            with self.subTest(names=names):
                result = extract_document(encrypted_zip(names))
                self.assertEqual((result["format"], result["status"], result["code"]),
                                 ("archive", "unsupported", "ARCHIVE_INVENTORY_INCOMPLETE"))
                self.assertTrue(all(member["issue"] == "ENCRYPTED" for member in result["archiveInventory"]["members"]))


if __name__ == "__main__":
    unittest.main()
