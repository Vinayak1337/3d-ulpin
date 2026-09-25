import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/usp/data/gf0-plan-bundle.py'
spec = importlib.util.spec_from_file_location('gf0_plan_bundle', SCRIPT)
plan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plan)


class PlanBundleTests(unittest.TestCase):
    def test_pack_keeps_foreign_vector_and_unlicensed_plans_separate(self):
        result = plan.check()
        self.assertEqual(result['status'], 'candidate_for_review')
        self.assertEqual(result['foreignVector']['sampleRows'], 81)
        self.assertEqual(result['foreignVector']['unitIds'], ['23024', '23025'])
        self.assertEqual(result['publicPlans']['sourcePermission'], 'unconfirmed')
        self.assertTrue(all('privateOriginalVerified' not in source for source in result['publicPlans']['externalSources']))

    def test_swiss_range_must_match_pinned_bytes_before_subset(self):
        with self.assertRaisesRegex(ValueError, 'source byte range changed'):
            plan.derive_swiss_sample(b'a' * plan.RANGE_BYTES)

    def test_polygon_ring_rejects_open_and_degenerate_geometries(self):
        plan.check_polygon('POLYGON ((0 0, 1 0, 1 1, 0 0))')
        with self.assertRaisesRegex(ValueError, 'Open or too-small'):
            plan.check_polygon('POLYGON ((0 0, 1 0, 1 1, 0 1))')
        with self.assertRaisesRegex(ValueError, 'Degenerate'):
            plan.check_polygon('POLYGON ((0 0, 1 0, 2 0, 0 0))')

    def test_private_plan_pins_do_not_become_available_fixture_bytes(self):
        manifest, _ = plan.manifest_bytes(plan.ROOT / plan.PUBLIC)
        sources = [asset for asset in manifest['assets'] if asset['origin']['kind'] == 'external']
        self.assertEqual(len(sources), 5)
        for source in sources:
            self.assertEqual(source['content']['state'], 'unavailable')
            self.assertEqual(source['permission']['state'], 'unconfirmed')
            self.assertEqual(source['provenance']['stages']['qualified']['status'], 'not_run')
            self.assertIsNotNone(source['provenance']['original'])


if __name__ == '__main__':
    unittest.main()
