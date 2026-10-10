"""Regression for the encoder hook being overwritten by the selected-query classifier call."""

from __future__ import annotations

from types import SimpleNamespace
from typing import cast
import unittest

import torch

from diagnose_building_parity import IntermediateExport


class EncoderCaptureRegression(unittest.TestCase):
    def test_encoder_scores_keep_the_pre_selection_call(self) -> None:
        capture = cast(IntermediateExport, SimpleNamespace(captured={}))
        encoder_scores = torch.tensor([1.0])
        selected_query_scores = torch.tensor([2.0])
        IntermediateExport.capture(capture, "encoder_scores", None, (), encoder_scores)
        IntermediateExport.capture(capture, "encoder_scores", None, (), selected_query_scores)
        self.assertIs(capture.captured["encoder_scores"], encoder_scores)


if __name__ == "__main__":
    unittest.main()
