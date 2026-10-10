"""Test the exact profile predicate without loading assets or executing a model."""
from __future__ import annotations

import ast
import os
import unittest
from pathlib import Path
from unittest.mock import patch
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[4]


def load_predicate() -> Callable[[dict[str, Any]], bool]:
    path = ROOT / "services/geo/geo/spatial_ml.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    node = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_model_active")
    namespace: dict[str, Any] = {"os": os}
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec"), namespace)
    return namespace["_model_active"]


class ProfileActivationTests(unittest.TestCase):
    def test_explicit_allowlist_governs_inactive_models_not_a_hardcoded_profile(self) -> None:
        predicate = load_predicate()
        configured = {"active": False, "activeProfiles": ["fixture-only-authorised-profile"]}
        with patch.dict(os.environ, {"ULPIN_PROFILE": "fixture-only-authorised-profile"}):
            self.assertTrue(predicate(configured))
        with patch.dict(os.environ, {"ULPIN_PROFILE": "demo"}):
            self.assertFalse(predicate(configured))
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(predicate(configured))
            self.assertTrue(predicate({"active": True}))
        self.assertIs(configured["active"], False)


def main() -> None:
    unittest.main()


if __name__ == "__main__":
    main()
