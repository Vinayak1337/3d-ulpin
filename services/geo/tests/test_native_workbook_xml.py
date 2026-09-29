"""The native workbook XML guard must see declarations in every supported encoding."""

import io
import unittest
import zipfile

from geo.native_workbook import _xml
from geo.validation import InputError


class NativeWorkbookXmlGuardTest(unittest.TestCase):
    def read_member(self, content):
        container = io.BytesIO()
        with zipfile.ZipFile(container, "w") as archive:
            archive.writestr("xl/workbook.xml", content)
        container.seek(0)
        with zipfile.ZipFile(container) as archive:
            return _xml(archive, "xl/workbook.xml")

    def test_utf16_doctype_is_rejected_before_entity_expansion(self):
        document = ('<?xml version="1.0" encoding="UTF-16"?>'
                    '<!DOCTYPE workbook [<!ENTITY title "expanded">]>'
                    '<workbook name="&title;"/>').encode("utf-16")
        with self.assertRaisesRegex(InputError, "NATIVE_WORKBOOK_INVALID"):
            self.read_member(document)

    def test_normal_utf16_workbook_xml_remains_readable(self):
        document = '<?xml version="1.0" encoding="UTF-16"?><workbook name="original"/>'.encode("utf-16")
        self.assertEqual(self.read_member(document).get("name"), "original")


if __name__ == "__main__":
    unittest.main()
