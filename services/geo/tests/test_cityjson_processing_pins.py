"""Exercise the actual pin checks without importing Shapely or accessing storage."""
import ast
import hashlib
from pathlib import Path
import re
import unittest
from typing import Any

from geo.native_cityjson import MAX_INPUT_BYTES

GEO = Path(__file__).resolve().parents[1] / "geo"
SOURCE = Path(__file__).resolve().parents[3] / "fixtures/usp/D1/single-roof/original.json"


def isolated_pin_checks() -> dict[str, Any]:
    """Compile the unchanged guard statements up to the first storage branch."""
    processor = GEO / "cityjson_processing.py"
    tree = ast.parse(processor.read_bytes(), filename=str(processor))
    definitions = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "KEY" for target in node.targets
        ):
            definitions.append(node)
        if isinstance(node, ast.FunctionDef) and node.name in {"reader_sha", "process_cityjson"}:
            if node.name == "process_cityjson":
                storage_start = next(
                    index for index, statement in enumerate(node.body)
                    if isinstance(statement, ast.If) and ast.unparse(statement.test) == "s3 is None"
                )
                node.body = node.body[:storage_start]
            definitions.append(node)
    validation = ast.parse((GEO / "validation.py").read_bytes())
    error = next(node for node in validation.body if isinstance(node, ast.ClassDef) and node.name == "InputError")
    module = ast.Module(body=[error, *definitions], type_ignores=[])
    namespace = {"__file__": str(processor), "Path": Path, "hashlib": hashlib, "re": re,
                 "MAX_INPUT_BYTES": MAX_INPUT_BYTES}
    exec(compile(module, str(processor), "exec"), namespace)
    return namespace


class CityJSONPinTest(unittest.TestCase):
    def setUp(self) -> None:
        self.checks = isolated_pin_checks()
        raw = SOURCE.read_bytes()
        source_id = "00000000-0000-4000-8000-000000000001"
        digest = hashlib.sha256(raw).hexdigest()
        self.pins = {"sourceId": source_id, "objectKey": f"large-originals/{source_id}/{digest}",
                     "sha256": digest, "bytes": len(raw), "readerSha256": self.checks["reader_sha"](),
                     "selection": "complete_bounded_source"}

    def test_upload_and_legacy_keys_pass_all_pin_checks(self) -> None:
        for prefix in ("large-originals", "sources"):
            with self.subTest(prefix=prefix):
                pins = {**self.pins, "objectKey": f"{prefix}/{self.pins['sourceId']}/{self.pins['sha256']}"}
                self.assertIsNone(self.checks["process_cityjson"](pins))

    def test_upload_key_still_requires_matching_id_and_sha(self) -> None:
        for field, value in (("sourceId", "00000000-0000-4000-8000-000000000002"), ("sha256", "0" * 64)):
            with self.subTest(field=field):
                with self.assertRaisesRegex(self.checks["InputError"], "CITYJSON_SOURCE_PINS"):
                    self.checks["process_cityjson"]({**self.pins, field: value})

    def test_other_key_namespaces_still_fail(self) -> None:
        key = self.pins["objectKey"].replace("large-originals/", "uploads/", 1)
        with self.assertRaisesRegex(self.checks["InputError"], "CITYJSON_SOURCE_PINS"):
            self.checks["process_cityjson"]({**self.pins, "objectKey": key})

    def test_upload_keeps_size_reader_and_selection_checks(self) -> None:
        controls = (("bytes", 0, "CITYJSON_INPUT_LIMIT"),
                    ("bytes", MAX_INPUT_BYTES + 1, "CITYJSON_INPUT_LIMIT"),
                    ("readerSha256", "0" * 64, "CITYJSON_READER_MISMATCH"),
                    ("selection", "partial", "CITYJSON_READER_MISMATCH"))
        for field, value, code in controls:
            with self.subTest(field=field, value=value):
                with self.assertRaisesRegex(self.checks["InputError"], code):
                    self.checks["process_cityjson"]({**self.pins, field: value})


if __name__ == "__main__":
    unittest.main()
