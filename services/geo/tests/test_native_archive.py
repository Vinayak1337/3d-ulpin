"""Small protocol controls; no invented operational property records."""

import io
import unittest
import zipfile

from geo.native_archive import inventory_archive


def archive_of(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name, body in entries:
            bundle.writestr(name, body)
    return output.getvalue()


class ArchiveInventoryChecks(unittest.TestCase):
    def test_complete_companions_and_inert_script(self):
        raw = archive_of([("district.shp", b"a"), ("district.shx", b"b"),
                          ("district.dbf", b"c"), ("district.prj", b"d"),
                          ("run.py", b"raise RuntimeError('must remain inert')")])
        result = inventory_archive(raw)
        self.assertEqual(result["coverage"], "complete")
        self.assertEqual(result["memberCount"], 5)
        self.assertEqual([member["ordinal"] for member in result["members"]], list(range(5)))
        self.assertEqual({member["companion"] for member in result["members"][:4]}, {"complete"})
        self.assertEqual(result["members"][-1]["issue"], "SCRIPT_INERT")
        self.assertEqual(result["members"][-1]["actualBytes"], len(b"raise RuntimeError('must remain inert')"))
        self.assertTrue(all(member["crc"] == "match" for member in result["members"]))

    def test_missing_companion_and_unsafe_path_remain_explicit(self):
        raw = archive_of([("district.shp", b"a"), ("../escape.shx", b"b"),
                          ("inner.zip", b"not recursively opened")])
        result = inventory_archive(raw)
        self.assertEqual(result["coverage"], "incomplete")
        self.assertEqual(result["issue"], "MEMBER_ISSUES")
        self.assertEqual(result["members"][0]["companion"], "incomplete")
        self.assertEqual(result["members"][1]["issue"], "UNSAFE_PATH")
        self.assertTrue(result["members"][1]["pathLabel"].startswith("sha256:"))
        self.assertEqual(result["members"][2]["issue"], "NESTED_ARCHIVE")

    def test_unknown_central_directory_and_corrupt_member_are_not_complete(self):
        unknown = inventory_archive(b"PK\x03\x04invalid")
        self.assertEqual((unknown["coverage"], unknown["issue"], unknown["memberCount"]),
                         ("unknown", "CORRUPT_CENTRAL_DIRECTORY", None))
        # Stored bytes make this a precise CRC mismatch control.
        with io.BytesIO() as output:
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as bundle:
                bundle.writestr("a.csv", b"UNIQUE_CONTENT_FOR_CRC")
            plain = bytearray(output.getvalue())
        offset = plain.find(b"UNIQUE_CONTENT_FOR_CRC")
        plain[offset] ^= 1
        member = inventory_archive(bytes(plain))["members"][0]
        self.assertEqual((member["issue"], member["crc"], member["sha256"]),
                         ("CORRUPT_MEMBER", "unchecked", None))

    def test_member_count_limit_has_explicit_incomplete_coverage(self):
        raw = archive_of([(f"member-{index}.csv", b"a") for index in range(257)])
        result = inventory_archive(raw)
        self.assertEqual((result["coverage"], result["issue"], result["memberCount"]),
                         ("incomplete", "MEMBER_COUNT_LIMIT", 257))
        self.assertEqual(result["members"], [])
        self.assertIsNone(result["declaredExpandedBytes"])


if __name__ == "__main__":
    unittest.main()
