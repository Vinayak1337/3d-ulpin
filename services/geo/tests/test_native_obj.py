"""Focused source-literal checks over two unchanged published graphics samples.

Technical mutations below test index safety and byte provenance, never facts,
operational records, geometry qualification or a new source family.
"""
import hashlib
import io
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'services/geo'))
from geo import native_obj as reader


class NativeObjTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = os.environ.get('OBJ_TEST_SOURCE_ROOT')
        if not root:
            raise unittest.SkipTest('Retained unchanged published OBJ originals are required.')
        cls.raw = (Path(root) / 'no_material.obj').read_bytes()
        cls.partial = (Path(root) / 'missing_material_file.obj').read_bytes()
        if hashlib.sha256(cls.raw).hexdigest() != 'a57a1c5b94c28f37b6a049e73d6efe1cb293946e9b727b6dd733cc70dcd1974c':
            raise AssertionError('Original mesh hash changed.')
        if hashlib.sha256(cls.partial).hexdigest() != '0011861ed58098a3524e973547549c4b73f05e3e00eec02d2e98e450a342e988':
            raise AssertionError('Original partial sample hash changed.')

    def spans(self, raw, value):
        count = 0
        if isinstance(value, dict):
            locator = value.get('locator')
            if locator:
                span = raw[locator['byteStart']:locator['byteEnd']]
                self.assertEqual(hashlib.sha256(span).hexdigest(), locator['spanSha256'])
                if 'literal' in value:
                    self.assertEqual(span.decode('utf-8'), value['literal'])
                expected_line = raw[:locator['byteStart']].count(b'\n') + 1
                self.assertEqual(locator.get('line', locator.get('lineStart')), expected_line)
                count += 1
            for child in value.values():
                count += self.spans(raw, child)
        elif isinstance(value, list):
            for child in value:
                count += self.spans(raw, child)
        return count

    def error(self, raw, code):
        with self.assertRaises(reader.ObjError) as caught:
            reader.inspect_obj(raw)
        self.assertEqual(caught.exception.code, code)

    def test_real_complete_and_missing_material_context(self):
        result = reader.inspect_obj(self.raw)
        self.assertEqual(result['status'], 'inspected_local')
        self.assertEqual(result['counts']['vertices'], 76)
        self.assertEqual(result['counts']['faces'], 18)
        self.assertEqual(result['counts']['faceReferences'], 72)
        self.assertEqual(result['geometryProjectionStatus'], 'available')
        self.assertEqual([r['vertex']['resolvedIndex'] for r in result['faces'][3]['references']], [12, 13, 14, 15])
        self.assertEqual(result['faces'][3]['populationsAtDeclaration']['vertex'], 16)
        self.assertEqual(result['declarations'][0]['arguments'], ['floor'])
        self.assertEqual(result['qualification']['propertyIdentity'], False)
        self.assertEqual(result['qualification']['units'], 'unknown')
        self.assertGreater(self.spans(self.raw, result), 450)
        partial = reader.inspect_obj(self.partial)
        self.assertEqual(partial['status'], 'inspected_partial')
        self.assertEqual(partial['counts']['vertices'], 76)
        self.assertEqual(partial['counts']['faces'], 18)
        self.assertTrue(partial['resources'])
        self.assertTrue(all(r['state'] == 'needs_input' for r in partial['resources']))
        self.assertEqual(partial['geometryProjectionStatus'], 'available')
        self.spans(self.partial, partial)

    def test_index_forms_and_original_spans_in_technical_derivatives(self):
        # Texture/normal values are verbatim existing coordinate tokens; these
        # declarations are source mutations solely to exercise separate streams.
        coords = next(line[2:] for line in self.raw.splitlines() if line.startswith(b'v '))
        tail = (b'\nvt ' + coords + b'\nvn ' + coords +
                b'\ng floor light\nf 1/1 2/1 3/1\nf 1//1 2//1 3//1\nf 1/1/1 2/1/1 \\\n 3/1/1\n')
        mutated = self.raw + tail
        result = reader.inspect_obj(mutated)
        self.assertEqual([f['references'][0]['form'] for f in result['faces'][-3:]], ['v/vt', 'v//vn', 'v/vt/vn'])
        self.assertEqual(result['faces'][-1]['references'][2]['normal']['resolvedIndex'], 0)
        self.assertEqual(result['declarations'][-1]['arguments'], ['floor', 'light'])
        self.spans(mutated, result)
        unknown = reader.inspect_obj(self.raw + b'\ncstype bspline\ncall companion.obj\ncsh echo blocked\n')
        self.assertEqual(unknown['status'], 'inspected_partial')
        self.assertEqual(len(unknown['unsupported']), 3)
        self.assertEqual(unknown['geometryProjectionStatus'], 'unavailable')
        self.assertEqual(unknown['counts']['eligiblePolygons'], 0)

    def test_invalid_indices_nonfinite_and_bounds_refuse_without_usable_geometry(self):
        for original, replacement, code in [(b'f 1 2 3 4', b'f 0 2 3 4', 'INDEX_ZERO'),
                (b'f -4 -3 -2 -1', b'f -999 -3 -2 -1', 'INDEX_RANGE'),
                (b'f 1 2 3 4', b'f 999 2 3 4', 'INDEX_RANGE'),
                (b'v 552.8', b'v 1e999', 'NONFINITE_VALUE')]:
            self.assertIn(original, self.raw)
            self.error(self.raw.replace(original, replacement, 1), code)
        with patch.object(reader, 'MAX_VERTICES', 75):
            self.error(self.raw, 'VERTEX_LIMIT')
        with patch.object(reader, 'MAX_FACE_REFERENCES', 71):
            self.error(self.raw, 'FACE_LIMIT')
        with patch.object(reader, 'MAX_OUTPUT_BYTES', 128):
            with self.assertRaises(reader.ObjError) as caught:
                reader.write_inspection(reader.inspect_obj(self.raw), io.BytesIO())
            self.assertEqual(caught.exception.code, 'OUTPUT_LIMIT')


if __name__ == '__main__':
    unittest.main()
