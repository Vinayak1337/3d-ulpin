"""The B9 launch gate of plan amendment 2: it passes the measured smoke and refuses each failed fact."""

from __future__ import annotations

import copy
import unittest

from launch_extra_train import child_environment, require_launch_gate

BUDGET = 6 * 1024**3
# The measured smoke b9-smoke-memory-three-regions-20261010.
MEASURED = {
    "launch_gate": {
        "peak_reserved_bytes": 5165285376,
        "smoke_chip_losses": 195,
        "non_finite_chip_losses": 0,
        "same_chips": {
            "mean_loss_before": 28.276,
            "mean_loss_after": 24.845,
            "chips_with_roofs": 27,
            "chips_with_roofs_and_lower_loss": 26,
        },
    }
}


def smoke(**changes: float) -> dict:
    """The measured smoke with gate facts replaced; same-chip facts are addressed by their own names."""
    changed = copy.deepcopy(MEASURED)
    gate = changed["launch_gate"]
    for key, value in changes.items():
        (gate if key in gate else gate["same_chips"])[key] = value
    return changed


class LaunchGate(unittest.TestCase):
    def assert_refused(self, reason: str, **changes: float) -> None:
        with self.assertRaisesRegex(ValueError, reason):
            require_launch_gate(smoke(**changes), BUDGET)

    def test_the_measured_smoke_passes(self) -> None:
        self.assertEqual(require_launch_gate(MEASURED, BUDGET), MEASURED["launch_gate"])

    def test_two_thirds_of_the_roofed_chips_is_enough(self) -> None:
        require_launch_gate(smoke(chips_with_roofs_and_lower_loss=18), BUDGET)

    def test_memory_over_the_budget_is_refused(self) -> None:
        self.assert_refused("memory exceeds the budget", peak_reserved_bytes=BUDGET + 1)

    def test_a_non_finite_smoke_loss_is_refused(self) -> None:
        self.assert_refused("not finite", non_finite_chip_losses=1)

    def test_a_mean_loss_that_did_not_fall_is_refused(self) -> None:
        self.assert_refused("did not fall", mean_loss_after=28.276)
        self.assert_refused("did not fall", mean_loss_after=float("nan"))

    def test_a_lower_loss_on_too_few_roofed_chips_is_refused(self) -> None:
        self.assert_refused("fewer than two thirds", chips_with_roofs_and_lower_loss=17)
        self.assert_refused("fewer than two thirds", chips_with_roofs=0, chips_with_roofs_and_lower_loss=0)

    def test_children_start_with_bytecode_writing_off(self) -> None:
        self.assertEqual(child_environment()["PYTHONDONTWRITEBYTECODE"], "1")


if __name__ == "__main__":
    unittest.main()
