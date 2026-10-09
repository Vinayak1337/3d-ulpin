"""Small regression checks for the repaired RF-DETR root-assignment bridge."""

import hashlib
import json
from pathlib import Path
import runpy
import tempfile
import unittest


SOURCE = Path(__file__).with_name("rfdetr_runtime_profile.py")


class RepairedRootAssignmentBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = runpy.run_path(str(SOURCE), run_name="bridge_test")
        cls.contract = cls.module["REPAIRED_ROOT_ASSIGNMENT_CONTRACT"]

    def execute_contract(self, initial):
        contract = self.contract
        assignment = initial.get("rootAssignment")
        if isinstance(assignment, dict):
            contract = contract.replace(
                "'/inputs/pilot/root-fit-assignment.json'", repr(assignment["path"])
            )
        namespace = {
            "Path": Path,
            "hashlib": hashlib,
            "json": json,
            "initial": initial,
            "need": lambda value, message: None if value else (_ for _ in ()).throw(RuntimeError(message)),
        }
        exec(contract, namespace)
        return namespace["root"]

    def test_dict_pin_is_read_and_validated(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "root-fit-assignment.json"
            release_sha = "a" * 64
            raw = json.dumps({"rootInstruction": {"sha256": release_sha}}, separators=(",", ":")).encode()
            path.write_bytes(raw)
            root = self.execute_contract({
                "rootAssignment": {"path": str(path), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()},
                "rootAssignmentSha256": release_sha,
            })
            self.assertEqual(root["rootInstruction"]["sha256"], release_sha)

    def test_mismatched_declared_pin_refuses(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "root-fit-assignment.json"
            raw = b'{"rootInstruction":{"sha256":"' + b"b" * 64 + b'"}}'
            path.write_bytes(raw)
            with self.assertRaisesRegex(RuntimeError, "Root assignment pin mismatch"):
                self.execute_contract({
                    "rootAssignment": {"path": str(path), "bytes": len(raw), "sha256": "c" * 64},
                    "rootAssignmentSha256": "b" * 64,
                })

    def test_generated_repaired_bridge_uses_contract(self):
        bridge = self.module["pilot_bridge"](repaired=True)
        self.assertIn("Root assignment pin malformed", bridge)
        self.assertNotIn("initial['rootAssignment'].encode", bridge)


if __name__ == "__main__":
    unittest.main()
