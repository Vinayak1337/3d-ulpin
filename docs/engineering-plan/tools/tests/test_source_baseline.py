"""Synthetic Git-fixture tests; none of these test the 3d-ulpin application."""
from __future__ import annotations
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[1] / "collect_source_baseline.py"
spec = importlib.util.spec_from_file_location("source_baseline", MODULE_PATH)
assert spec and spec.loader
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo = self.base / "repo"
        self.repo.mkdir()
        self.g("init", "-q")
        self.g("config", "user.name", "Synthetic fixture")
        self.g("config", "user.email", "fixture@example.invalid")
        self.g("remote", "add", "origin", "https://github.com/Vinayak1337/3d-ulpin.git")
        self.put("AGENTS.md", "Synthetic test fixture only.\n")
        self.put("package.json", json.dumps({"scripts": {"test": "echo DO_NOT_EXECUTE_OR_REPORT"}}))
        self.put("packages/contracts/src/area.ts", "export type Version = 'ulpin-canonical/2';\n")
        self.put("tests/example.test.ts", "// synthetic\n")
        self.commit()

    def g(self, *args):
        return subprocess.run(["git", "-C", str(self.repo), *args],
                              check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout

    def put(self, name, content):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def commit(self):
        self.g("add", ".")
        self.g("commit", "-qm", "synthetic fixture")

    def collect(self, **kwargs):
        return m.collect(self.repo, expected_repository="Vinayak1337/3d-ulpin", **kwargs)[1]

    def test_clean_committed_hash_and_no_application_claim(self):
        report = self.collect()
        item = next(x for x in report["source_files"] if x["path"] == "packages/contracts/src/area.ts")
        self.assertEqual(item["sha256"], hashlib.sha256(b"export type Version = 'ulpin-canonical/2';\n").hexdigest())
        self.assertTrue(report["checkout_clean"])
        self.assertFalse(report["application_tests_run"])
        self.assertFalse(report["t001_accepted"])
        self.assertFalse(report["remote_freshness_verified"])

    def test_dirty_rejected_by_default(self):
        self.put("scratch.txt", "not committed")
        with self.assertRaisesRegex(m.BaselineError, "changes"):
            self.collect()

    def test_allow_dirty_uses_committed_bytes(self):
        self.put("packages/contracts/src/area.ts", "different\n")
        report = self.collect(require_clean=False)
        item = next(x for x in report["source_files"] if x["path"] == "packages/contracts/src/area.ts")
        self.assertEqual(item["sha256"], hashlib.sha256(b"export type Version = 'ulpin-canonical/2';\n").hexdigest())
        self.assertFalse(report["checkout_clean"])

    def test_detached_ci_checkout_is_supported(self):
        self.g("checkout", "--detach", "-q", "HEAD")
        report = self.collect()
        self.assertTrue(report["detached_head"])
        self.assertIsNone(report["branch"])

    def test_nested_workdir_resolves_root(self):
        root, report = m.collect(self.repo / "packages/contracts")
        self.assertEqual(root, self.repo.resolve())
        self.assertEqual(report["head"], self.g("rev-parse", "HEAD").decode().strip())

    def test_wrong_repository_rejected(self):
        self.g("remote", "set-url", "origin", "https://github.com/another/repository.git")
        with self.assertRaisesRegex(m.BaselineError, "Origin"):
            self.collect()

    def test_remote_credentials_not_reported(self):
        self.g("remote", "set-url", "origin", "https://user:PRIVATE_TEST_TOKEN@github.com/Vinayak1337/3d-ulpin.git")
        report = self.collect()
        self.assertNotIn("PRIVATE_TEST_TOKEN", json.dumps(report))
        self.assertEqual(report["repository"], "Vinayak1337/3d-ulpin")

    def test_scripts_not_executed_or_printed(self):
        self.put("package.json", json.dumps({"scripts": {"test": "touch HARMFUL_TEST_MARKER; echo PRIVATE_SECRET"}}))
        self.commit()
        report = self.collect()
        self.assertFalse((self.repo / "HARMFUL_TEST_MARKER").exists())
        self.assertNotIn("PRIVATE_SECRET", json.dumps(report))
        self.assertEqual(report["package_script_inventory"][0]["script_names"], ["test"])

    def test_env_files_excluded_even_when_committed(self):
        self.put(".env", "PRIVATE_SECRET=test")
        self.put("apps/web/lib/server/.env", "PRIVATE_SECRET=other")
        self.commit()
        report = self.collect()
        self.assertNotIn("PRIVATE_SECRET", json.dumps(report))
        self.assertFalse(any(".env" in x["path"] for x in report["source_files"]))

    def test_tracked_symlink_source_rejected(self):
        # The collector reads committed blobs. A Git symlink entry is the actual
        # input, independently of whether the host can create native symlinks.
        self.g("config", "core.symlinks", "false")
        target = self.repo / "packages/contracts/src/area.ts"
        target.write_bytes(str(self.base / "private-file").encode("utf-8"))
        oid = self.g("hash-object", "-w", str(target)).decode().strip()
        self.g("update-index", "--cacheinfo", "120000," + oid + ",packages/contracts/src/area.ts")
        self.g("commit", "-qm", "synthetic committed symlink")
        with self.assertRaisesRegex(m.BaselineError, "links"):
            self.collect()

    def test_oversize_source_explicitly_not_read(self):
        self.put("packages/contracts/src/area.ts", "x" * (m.MAX_BLOB + 1))
        self.commit()
        report = self.collect()
        self.assertTrue(any(x.get("reason") == "blob_size_limit" for x in report["notices"]))

    def test_malformed_package_is_not_hidden(self):
        self.put("package.json", "{not json")
        self.commit()
        report = self.collect()
        self.assertTrue(any(x.get("status") == "invalid_package_manifest" for x in report["notices"]))

    def test_output_cannot_be_inside_checkout(self):
        with self.assertRaisesRegex(m.BaselineError, "outside"):
            m.write_report(self.repo / "baseline.json", self.repo.resolve(), self.collect())

    def test_output_no_overwrite(self):
        path = self.base / "baseline.json"
        report = self.collect()
        m.write_report(path, self.repo.resolve(), report)
        before = path.read_bytes()
        with self.assertRaisesRegex(m.BaselineError, "exists"):
            m.write_report(path, self.repo.resolve(), report)
        self.assertEqual(path.read_bytes(), before)

    def test_output_symlink_rejected(self):
        path = self.base / "baseline.json"
        try:
            path.symlink_to(self.base / "other.json")
        except OSError as exc:
            if getattr(exc, "winerror", None) == 1314:
                self.skipTest("Native Windows symlink privilege is unavailable; rejection branch is separately unit-tested.")
            raise
        with self.assertRaisesRegex(m.BaselineError, "symlink"):
            m.write_report(path, self.repo.resolve(), self.collect())

    def test_output_symlink_detection_rejects_before_writing(self):
        path = self.base / "baseline.json"
        report = self.collect()
        with patch.object(Path, "is_symlink", return_value=True):
            with self.assertRaisesRegex(m.BaselineError, "symlink"):
                m.write_report(path, self.repo.resolve(), report)
        self.assertFalse(path.exists())

    def test_shared_spatial_modules_are_in_the_baseline(self):
        content = b"// synthetic spatial runtime\n"
        target = self.repo / "apps/web/features/spatial/engine/runtime.ts"
        target.parent.mkdir(parents=True)
        target.write_bytes(content)
        self.commit()
        report = self.collect()
        item = next(x for x in report["source_files"] if x["path"] == "apps/web/features/spatial/engine/runtime.ts")
        self.assertEqual(item["sha256"], hashlib.sha256(content).hexdigest())

    def test_stability_change_rejected(self):
        original = m.git
        calls = 0
        def changing(repo, *args, **kwargs):
            nonlocal calls
            result = original(repo, *args, **kwargs)
            if args and args[0] == "status":
                calls += 1
                if calls == 2:
                    return b"?? changed.txt\x00"
            return result
        with patch.object(m, "git", side_effect=changing):
            with self.assertRaisesRegex(m.BaselineError, "changed during"):
                self.collect()

    def test_unborn_repository_rejected(self):
        empty = self.base / "empty"
        empty.mkdir()
        subprocess.run(["git", "-C", str(empty), "init", "-q"], check=True)
        with self.assertRaises(m.BaselineError):
            m.collect(empty)

    def test_cli_outputs_only_collection_claim(self):
        result = subprocess.run([sys.executable, str(MODULE_PATH), "--repo", str(self.repo),
                                 "--output", str(self.base / "cli.json"),
                                 "--expected-repository", "Vinayak1337/3d-ulpin"],
                                capture_output=True, text=True, check=True)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["status"], "COLLECTED")
        self.assertFalse(summary["t001_accepted"])
        self.assertFalse(summary["application_tests_run"])


if __name__ == "__main__":
    unittest.main()
