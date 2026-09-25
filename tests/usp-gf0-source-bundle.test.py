import importlib.util
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/usp/data/gf0-source-bundle.py'
spec = importlib.util.spec_from_file_location('gf0_source_bundle', SCRIPT)
gf0 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gf0)


class SourceBundleTests(unittest.TestCase):
    def test_current_sources_and_d7_are_bounded(self):
        result = gf0.check()
        self.assertEqual(result['status'], 'candidate_for_review')
        self.assertEqual(result['context']['featureCount'], 9)
        self.assertEqual(result['structuredCodes']['rowCount'], 785)
        self.assertEqual(result['d7']['reason'], 'permission_required')

    def test_csv_parser_preserves_literal_zeroes_empties_and_quoted_names(self):
        headers, rows = gf0.csv_rows(b'state_census2011_code,district_name_local\n09,"A, B"\n08,\n')
        self.assertEqual(headers, ['state_census2011_code', 'district_name_local'])
        self.assertEqual(rows[0]['state_census2011_code'], '09')
        self.assertEqual(rows[0]['district_name_local'], 'A, B')
        self.assertEqual(rows[1]['district_name_local'], '')

    def test_hash_change_is_rejected_before_parsing(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'source.csv'
            path.write_bytes(b'id\n09\n')
            expected = gf0.digest(path.read_bytes())
            self.assertEqual(gf0.verify_asset(path, expected, path.stat().st_size), b'id\n09\n')
            path.write_bytes(b'id\n9\n')
            with self.assertRaisesRegex(ValueError, 'bytes/hash changed'):
                gf0.verify_asset(path, expected, 6)

    def test_permission_cannot_be_promoted_by_missing_metadata(self):
        manifest = {'assets': [{'id': 'codes.csv'}]}
        provenance = {'licenceFamily': 'GODL-India', 'licenceFamilyByAsset': {'codes.csv': 'GODL-India'},
                      'trainingPermission': 'not assessed', 'stages': {'tested': 'pending_execution'},
                      'missingCapabilities': ['geometry'], 'purpose': 'test_only'}
        gf0.validate_provenance(provenance, manifest, 'codes.csv', 'GODL-India')
        provenance['trainingPermission'] = 'approved'
        with self.assertRaisesRegex(ValueError, 'Training permission'):
            gf0.validate_provenance(provenance, manifest, 'codes.csv', 'GODL-India')


if __name__ == '__main__':
    unittest.main()
