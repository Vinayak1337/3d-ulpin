"""Regression for Windows autocrlf breaking a committed holdout guard.

Uses mocked Git blobs and temporary generated state; no model/held-out imagery.
"""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import eval_buildings as evaluate


class CommittedGuardRegression(unittest.TestCase):
    def test_correct_empty_chips_do_not_rank_as_worst(self):
        rows = [({"chip_id": "empty", "object_f1": None}, None, None),
                ({"chip_id": "missed", "object_f1": 0.0}, None, None),
                ({"chip_id": "matched", "object_f1": 1.0}, None, None)]
        selected = evaluate.select_contact_rows(rows)
        self.assertEqual([x[0]["chip_id"] for x in selected], ["missed", "matched"])

    def test_crlf_checkout_is_same_git_blob_but_json_mutation_is_rejected(self):
        with tempfile.TemporaryDirectory(dir="E:/BhuAayam-data/ml") as root:
            repo = Path(root)
            path = repo / "preregistration.json"
            blob = b'{\n  "status": "frozen"\n}\n'
            path.write_bytes(blob.replace(b"\n", b"\r\n"))
            def git(*args):
                return blob if args[0] == "show" else b"abc123\n"
            with patch.object(evaluate, "REPO", repo), patch.object(evaluate, "git", git):
                self.assertEqual(evaluate.committed(path), "abc123")
                self.assertEqual(evaluate.repo_sha(path), __import__("hashlib").sha256(blob).hexdigest())
                path.write_bytes(blob.replace(b"frozen", b"pending"))
                with self.assertRaisesRegex(ValueError, "differs from committed"):
                    evaluate.committed(path)

    def test_two_reserved_attempts_deny_before_model_loading(self):
        with tempfile.TemporaryDirectory(dir="E:/BhuAayam-data/ml") as root:
            evidence = Path(root)
            prereg = evidence / "preregistration.json"
            holdout = {"chip_ids_sha256": "chips", "cluster_ids": ["cell"], "cluster_ids_sha256": "cells"}
            prereg.write_text(json.dumps({"building_mask": {"status": "frozen", "split_sha256": "split", "holdout": holdout, "baseline": {"sha256": "weights"}}}), encoding="utf-8")
            starts = [{"event": "started", "run_id": "one", "role": "baseline"}, {"event": "started", "run_id": "two", "role": "final_candidate"}]
            (evidence / "holdout-runs.jsonl").write_text("\n".join(json.dumps(x) for x in starts) + "\n", encoding="utf-8")
            args = __import__("argparse").Namespace(holdout_role="final_candidate", run_id="three")
            with patch.object(evaluate, "EVIDENCE", evidence), patch.object(evaluate, "PREREG", prereg), patch.object(evaluate, "committed", return_value="abc"):
                with self.assertRaisesRegex(ValueError, "two attempts already reserved"):
                    evaluate.holdout_reserve(args, {"splits": {"holdout": holdout}}, "weights", "split")
            self.assertFalse((evidence / "holdout-runs.lock").exists())
            self.assertEqual(len((evidence / "holdout-runs.jsonl").read_text().splitlines()), 2)


if __name__ == "__main__":
    unittest.main()
