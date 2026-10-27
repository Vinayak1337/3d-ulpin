"""Focused image-selection privacy controls; technical pixels, never source facts."""
import hashlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest

directory = Path(__file__).resolve().parents[1] / 'scripts/usp/document-models'
sys.path.insert(0, str(directory))
import run_image_region as regions
from PIL import Image, PngImagePlugin


class ImageRegionControls(unittest.TestCase):
    def crop(self, image, selection, root, **metadata):
        encoded = io.BytesIO()
        image.save(encoded, format='PNG', **metadata)
        data = encoded.getvalue()
        source = root / 'technical-original.png'
        source.write_bytes(data)
        return regions.inspect_region(source, hashlib.sha256(data).hexdigest(), 'png', selection, root)

    def test_oriented_inward_crop_matches_only_approved_pixels_and_strips_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = Image.new('RGBA', (4, 3))
            source.putdata([(i*20, i*10, i*5, 80+i*10) for i in range(12)])
            exif = Image.Exif(); exif[274] = 6; exif[270] = 'technical private comment'
            text = PngImagePlugin.PngInfo(); text.add_text('private', 'technical excluded metadata')
            selection = {'frame': {'kind': 'image_oriented_top_left_pixels', 'width': 3, 'height': 4,
                'orientation': {'exifValue': 6, 'applied': 6, 'provenance': 'source_exif'}},
                'coordinates': 'oriented_original_pixel_edges/1', 'region': [.2, .2, 2.9, 3.9], 'selectionAcknowledged': True}
            result = self.crop(source, selection, root, exif=exif, pnginfo=text, dpi=(72, 72))
            self.assertEqual(result['transform']['includedPixelBounds'], [1, 1, 2, 3])
            self.assertEqual(result['output']['mode'], 'RGBA')
            with Image.open(root / 'image.png') as output:
                self.assertEqual(output.size, (1, 2)); self.assertEqual(output.info, {}); self.assertFalse(output.getexif())
                self.assertEqual(list(output.getdata()), [source.getpixel((1, 1)), source.getpixel((2, 1))])
            wrong = {**selection, 'frame': {**selection['frame'], 'width': 4}}
            with self.assertRaisesRegex(regions.images.ImageError, 'FRAME_MISMATCH'):
                self.crop(source, wrong, root, exif=exif)
            with self.assertRaisesRegex(regions.images.ImageError, 'DISPLAY_PROFILE_UNSUPPORTED'):
                self.crop(source, selection, root, exif=exif, icc_profile=b'technical unsupported profile')

    def test_downscaled_excerpt_is_independent_of_pixels_outside_approval(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            selection = {'frame': {'kind': 'image_oriented_top_left_pixels', 'width': 3200, 'height': 4,
                'orientation': {'exifValue': None, 'applied': 1, 'provenance': 'specification_default'}},
                'coordinates': 'oriented_original_pixel_edges/1', 'region': [700.2, 0, 2201.9, 4], 'selectionAcknowledged': True}
            outputs = []
            for excluded in [(255, 0, 0), (0, 255, 0)]:
                source = Image.new('RGB', (3200, 4), excluded)
                for y in range(4):
                    for x in range(701, 2201):
                        source.putpixel((x, y), (x % 256, y*60, (x//3) % 256))
                result = self.crop(source, selection, root)
                self.assertEqual(result['transform']['includedPixelBounds'], [701, 0, 2201, 4])
                self.assertEqual(result['output']['pixels'], [1400, 3])
                self.assertEqual(result['transform']['resampling'], 'lanczos')
                with Image.open(root / 'image.png') as output:
                    outputs.append(output.tobytes())
            self.assertEqual(outputs[0], outputs[1], 'excluded original pixels cannot enter the resampling kernel')
            with self.assertRaisesRegex(regions.images.ImageError, 'REGION_EMPTY'):
                self.crop(source, {**selection, 'region': [.1, .1, .9, .9]}, root)


if __name__ == '__main__':
    unittest.main()
