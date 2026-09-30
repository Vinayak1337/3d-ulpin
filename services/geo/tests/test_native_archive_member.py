"""Selected-member integrity controls; no operational records are generated."""

import io
import unittest
import warnings
import zipfile

from geo.native_archive import inventory_archive
from geo.native_archive_member import ArchiveMemberError, read_archive_member


def technical_zip(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, value in entries:
            archive.writestr(name, value)
    return output.getvalue()


def reference(raw, ordinal=0):
    inventory = inventory_archive(raw)
    member = inventory["members"][ordinal]
    return (inventory["sourceSha256"], ordinal, member["sha256"], member["actualBytes"])


class SelectedMemberChecks(unittest.TestCase):
    def test_source_and_member_references_are_bound_to_bytes(self):
        raw = technical_zip([("source.csv", b"header\nvalue\n")])
        outer, ordinal, member_hash, member_bytes = reference(raw)
        result = read_archive_member(raw, outer, ordinal, member_hash, member_bytes)
        self.assertEqual(result.data, b"header\nvalue\n")
        self.assertEqual((result.lineage["ordinal"], result.lineage["memberSha256"]),
                         (ordinal, member_hash))
        for values, code in [(("0" * 64, ordinal, member_hash, member_bytes), "SOURCE_HASH_MISMATCH"),
                             ((outer, ordinal, "0" * 64, member_bytes), "MEMBER_REFERENCE_MISMATCH"),
                             ((outer, ordinal, member_hash, member_bytes + 1), "MEMBER_REFERENCE_MISMATCH")]:
            with self.subTest(code=code, values=values), self.assertRaises(ArchiveMemberError) as caught:
                read_archive_member(raw, *values)
            self.assertEqual(caught.exception.code, code)

    def test_script_and_incomplete_shapefile_are_not_admitted(self):
        for entries, code in [([("run.py", b"never execute")], "MEMBER_SCRIPT_INERT"),
                              ([("district.shp", b"incomplete group")], "COMPANION_INCOMPLETE")]:
            with self.subTest(code=code):
                raw = technical_zip(entries)
                with self.assertRaises(ArchiveMemberError) as caught:
                    read_archive_member(raw, *reference(raw))
                self.assertEqual(caught.exception.code, code)

    def test_first_duplicate_path_is_denied_too(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            raw = technical_zip([("same.csv", b"first"), ("same.csv", b"second")])
        with self.assertRaises(ArchiveMemberError) as caught:
            read_archive_member(raw, *reference(raw, 0))
        self.assertEqual(caught.exception.code, "MEMBER_DUPLICATE_PATH")

    def test_ineligible_shapefile_sibling_denies_only_its_group(self):
        group = [("district" + suffix, suffix.encode())
                 for suffix in (".shp", ".shx", ".dbf", ".prj")]
        for sibling in [("DISTRICT.dbf", b"ambiguous attributes"), ("district.cpg/", b"")]:
            with self.subTest(sibling=sibling[0]):
                raw = technical_zip(group + [sibling])
                self.assertEqual(inventory_archive(raw)["members"][1]["companion"], "complete")
                with self.assertRaises(ArchiveMemberError) as caught:
                    read_archive_member(raw, *reference(raw, 1))
                self.assertEqual(caught.exception.code, "COMPANION_INELIGIBLE")
        raw = technical_zip(group + [("other.dbf", b"first"), ("OTHER.dbf", b"second")])
        result = read_archive_member(raw, *reference(raw, 1))
        self.assertEqual(result.data, b".shx")
        self.assertTrue(result.lineage["unselectedIssues"])


if __name__ == "__main__":
    unittest.main()
