"""Small in-memory pixel/metadata controls, never operational source fixtures."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from PIL import Image

helper = Path(__file__).resolve().parents[1] / 'scripts/usp/document-models/run_image_inspection.py'
spec = importlib.util.spec_from_file_location('image_helper', helper)
images = importlib.util.module_from_spec(spec)
spec.loader.exec_module(images)


class ImageControls(unittest.TestCase):
    def inspect(self, encoded, directory, raster=True, format='png'):
        source = directory / 'technical-input'
        source.write_bytes(encoded)
        return images.inspect_image(source, hashlib.sha256(encoded).hexdigest(), format, raster, directory)

    def test_orientation_affine_maps_source_pixel_centers_to_actual_stripped_raster(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            source = Image.new('RGB', (3, 2))
            source.putdata([(i * 30, i * 20, i * 10) for i in range(6)])
            for orientation in range(1, 9):
                exif = Image.Exif(); exif[274] = orientation; exif[270] = 'technical private comment'
                encoded = io.BytesIO(); source.save(encoded, format='PNG', exif=exif)
                result = self.inspect(encoded.getvalue(), directory)
                info = result['image']
                self.assertEqual(info['orientation']['exifValue'], orientation)
                self.assertEqual(info['orientation']['provenance'], 'source_exif')
                a, b, c, d, e, f = info['display']['sourceToRaster']
                with Image.open(directory / 'image.png') as output:
                    self.assertFalse(output.getexif()); self.assertNotIn('exif', output.info)
                    for y in range(2):
                        for x in range(3):
                            ox, oy = int(a*(x+.5)+b*(y+.5)+c), int(d*(x+.5)+e*(y+.5)+f)
                            self.assertEqual(output.getpixel((ox, oy)), source.getpixel((x, y)))
            for invalid in (0, 9, '6', True):
                with self.assertRaisesRegex(images.ImageError, 'ORIENTATION_UNSUPPORTED'):
                    images._orientation(invalid)

    def test_absent_orientation_unmanaged_pixels_and_explicit_unsupported_profile(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            source = Image.new('RGBA', (2, 2), (1, 2, 3, 128))
            data = io.BytesIO(); source.save(data, format='PNG')
            result = self.inspect(data.getvalue(), directory)
            self.assertEqual(result['image']['orientation'], {'exifValue': None, 'applied': 1, 'provenance': 'specification_default'})
            self.assertEqual(result['image']['display']['mode'], 'RGBA')
            self.assertEqual(result['image']['densityDeclarations'], [])
            density = io.BytesIO(); source.save(density, format='PNG', dpi=(72, 72))
            declaration = self.inspect(density.getvalue(), directory, raster=False)['image']['densityDeclarations'][0]
            self.assertEqual(declaration, {'kind': 'png_phys', 'unitCode': 1, 'x': [2835, 1], 'y': [2835, 1],
                                          'status': 'supplied', 'qualification': 'not_calibrated'})
            profile = io.BytesIO(); source.save(profile, format='PNG', icc_profile=b'technical unsupported ICC marker')
            info = self.inspect(profile.getvalue(), directory, raster=False)['image']
            self.assertIsNone(info['display']); self.assertEqual(info['unsupportedReason'], 'unsupported_color_profile')
            with self.assertRaisesRegex(images.ImageError, 'DISPLAY_PROFILE_UNSUPPORTED'):
                self.inspect(profile.getvalue(), directory)

    def test_header_frame_decompression_and_truncation_bounds_prevent_partial_publication(self):
        class Header:
            size = (5001, 5001)
            n_frames = 1
        with self.assertRaisesRegex(images.ImageError, 'DECODE_LIMIT'):
            images._source_bounds(Header())
        Header.size = (3, 2); Header.n_frames = 2
        with self.assertRaisesRegex(images.ImageError, 'MULTIFRAME_UNSUPPORTED'):
            images._source_bounds(Header())
        plan = images._display_plan(5000, 5000, 6, 'RGB')
        self.assertLessEqual(plan['frame']['width'] * plan['frame']['height'], 1_600_000)
        with self.assertRaisesRegex(images.ImageError, 'RASTER_LIMIT'):
            images._BoundedPng().write(b'0' * (images.MAX_PNG + 1))
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            data = io.BytesIO(); Image.new('RGB', (8, 8)).save(data, format='JPEG')
            with self.assertRaises(Exception):
                self.inspect(data.getvalue()[:-10], directory, format='jpeg')
            self.assertFalse((directory / 'image.png').exists())
            data = io.BytesIO(); Image.new('RGB', (3, 2)).save(data, format='PNG', save_all=True,
                append_images=[Image.new('RGB', (3, 2), (30, 40, 50))])
            with self.assertRaisesRegex(images.ImageError, 'MULTIFRAME_UNSUPPORTED'):
                self.inspect(data.getvalue(), directory)
            self.assertFalse((directory / 'image.png').exists())


if __name__ == '__main__':
    unittest.main()
