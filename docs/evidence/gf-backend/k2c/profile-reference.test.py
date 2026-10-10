"""Focused runtime invariants; no source/model execution, scoring or synthetic registry writes."""
from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from geo import spatial_ml
from geo.area import _analysis_crs
from geo.validation import InputError


class ProfileReferenceTests(unittest.TestCase):
    def test_candidate_is_active_only_under_demo(self) -> None:
        model = next(row for row in spatial_ml._manifest()["models"]
                     if row["id"] == "rfdetr-ramp-ka-seg-medium-b3-v1")
        self.assertIs(model["active"], False)
        for profile, expected in (("demo", True), ("production", False), ("", False)):
            with self.subTest(profile=profile), patch.dict(os.environ, {"ULPIN_PROFILE": profile}):
                self.assertEqual(spatial_ml._model_active(model), expected)
        self.assertIs(model["active"], False)

    def test_equal_area_uses_explicit_metre_axes_and_preserves_utm(self) -> None:
        for code in ("EPSG:6933", "EPSG:32643"):
            crs = _analysis_crs(code)
            self.assertEqual(f"EPSG:{crs.to_epsg()}", code)
            self.assertTrue(all(axis.unit_name == "metre" for axis in crs.axis_info))
        with self.assertRaises(InputError):
            _analysis_crs("EPSG:3857")


if __name__ == "__main__":
    unittest.main()
