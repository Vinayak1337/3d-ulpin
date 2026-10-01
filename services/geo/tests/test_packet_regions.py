"""Pixel leakage, frame and source checks for the new private crop leaf."""
import hashlib
import io
import unittest
from pathlib import Path
import fitz
from PIL import Image
from geo.usp_packet_regions import extract_region, RegionError

REPO = Path(__file__).resolve().parents[3]


def control(rotation=0):
    # Technical colour fields and hidden metadata only, never property evidence.
    with fitz.open() as document:
        page = document.new_page(width=100, height=80)
        page.draw_rect(fitz.Rect(0, 0, 100, 80), color=None, fill=(1, 0, 0))
        page.draw_rect(fitz.Rect(30, 0, 70, 80), color=None, fill=(0, 1, 0))
        annotation = page.add_rect_annot(fitz.Rect(35, 25, 65, 55))
        annotation.set_colors(stroke=(0, 0, 1), fill=(0, 0, 1))
        annotation.update()
        document.set_metadata({"title": "NEVER_PRIVATE_METADATA"})
        document.embfile_add("NEVER_ATTACHMENT", b"NEVER_ATTACHMENT_PAYLOAD")
        page.set_cropbox(fitz.Rect(10, 20, 90, 60))
        page.set_rotation(rotation)
        original = document.tobytes()
    with fitz.open(stream=original, filetype="pdf") as document:
        page = document[0]
        selection = {"frame": {"kind": "pdf_display_page_top_left_points", "width": float(page.rect.width),
                     "height": float(page.rect.height), "rotation": page.rotation},
            "mediaBox": list(page.mediabox), "cropBox": list(page.cropbox),
            "boxConvention": "pymupdf_page_rectangles/1", "coordinates": "displayed_cropbox_normalized_top_left/1",
            "region": [0, .25, 1, .75] if rotation in (90, 270) else [.25, 0, .75, 1],
            "selectionAcknowledged": True}
    return original, selection


class PacketRegionTests(unittest.TestCase):
    def test_nonzero_cropbox_rotated_crop_excludes_neighbour_pixels_and_metadata(self):
        for rotation in (0, 90):
            with self.subTest(rotation=rotation):
                original, selection = control(rotation)
                before = hashlib.sha256(original).hexdigest()
                result, png = extract_region(original, before, 1, selection, REPO)
                self.assertEqual(hashlib.sha256(original).hexdigest(), before)
                with Image.open(io.BytesIO(png)) as output:
                    self.assertEqual(output.mode, "RGB")
                    self.assertEqual(output.info, {})
                    self.assertEqual(output.getextrema(), ((0, 0), (255, 255), (0, 0)))
                    self.assertLessEqual(output.width*output.height, 1_600_000)
                self.assertNotIn(b"NEVER", png)
                self.assertNotIn(b"%PDF", png)
                self.assertEqual(result["output"]["metadataPolicy"], "fresh_rgb_pixels_only/1")
                self.assertEqual(result["selection"], selection)
                actual = result["transform"]["includedNormalizedRegion"]
                wanted = selection["region"]
                self.assertTrue(wanted[0] <= actual[0] < actual[2] <= wanted[2])
                self.assertTrue(wanted[1] <= actual[1] < actual[3] <= wanted[3])

    def test_hash_page_and_frame_mismatch_abstain(self):
        original, selection = control()
        hash_value = hashlib.sha256(original).hexdigest()
        with self.assertRaisesRegex(RegionError, "PACKET_REGION_SOURCE_INTEGRITY"):
            extract_region(original, "0"*64, 1, selection, REPO)
        with self.assertRaisesRegex(RegionError, "PACKET_REGION_PAGE_NOT_FOUND"):
            extract_region(original, hash_value, 2, selection, REPO)
        selection["cropBox"][0] += 1
        with self.assertRaisesRegex(RegionError, "PACKET_REGION_FRAME_MISMATCH"):
            extract_region(original, hash_value, 1, selection, REPO)

    def test_active_and_unacknowledged_input_abstains(self):
        original, selection = control()
        selection["selectionAcknowledged"] = False
        with self.assertRaisesRegex(RegionError, "PACKET_REGION_SELECTION"):
            extract_region(original, hashlib.sha256(original).hexdigest(), 1, selection, REPO)
        selection["selectionAcknowledged"] = True
        with fitz.open(stream=original, filetype="pdf") as document:
            xref = document.get_new_xref()
            document.update_object(xref, '<< /S /JavaScript /JS (app.alert("NO")) >>')
            document.xref_set_key(document.pdf_catalog(), "OpenAction", f"{xref} 0 R")
            active = document.tobytes()
        with self.assertRaisesRegex(RegionError, "PACKET_REGION_ACTIVE_OR_EXTERNAL_UNSUPPORTED"):
            extract_region(active, hashlib.sha256(active).hexdigest(), 1, selection, REPO)
        with fitz.open(stream=original, filetype="pdf") as document:
            document.xref_set_key(document.pdf_catalog(), "AcroForm", "<< /Fields [] >>")
            form = document.tobytes()
        with self.assertRaisesRegex(RegionError, "PACKET_REGION_FORMS_UNSUPPORTED"):
            extract_region(form, hashlib.sha256(form).hexdigest(), 1, selection, REPO)


if __name__ == "__main__":
    unittest.main()
