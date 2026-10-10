"""Regressions: curated evidence loss, stale generated-field overrides, externally stored assets."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("dataset_catalog", ROOT / "scripts/api/build-dataset-catalog.py")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class CatalogueRoundTrip(unittest.TestCase):
    def test_reviewed_history_and_current_source_fields(self):
        published = json.loads((ROOT / "docs/api/datasets.json").read_text(encoding="utf-8"))
        packs = {pack["manifest"]: pack for pack in published["packs"]}
        selected = (
            "fixtures/usp/D1/single-roof/manifest.json",
            "fixtures/usp/D4/gf0-structured-codes-v1/manifest.json",
            "fixtures/usp/D5/gf0-public-plans-v1/manifest.json",
        )
        preserved = 0
        for path in selected:
            manifest = json.loads((ROOT / path).read_text(encoding="utf-8"))
            # Read only source metadata. Content checking is already exercised
            # by normal generation, not repeated as a source/hash campaign here.
            generated = [{key: deepcopy(asset[key]) for key in BUILDER.ASSET_SOURCE_FIELDS if key in asset}
                         for asset in manifest["assets"]]
            previous = deepcopy(packs[path]["assets"])
            originals = {asset["id"]: asset for asset in previous}
            for index, asset in enumerate(generated):
                asset["content"] = deepcopy(originals[asset["id"]]["content"])
                asset["manifestVerification"] = deepcopy(manifest["assets"][index].get("verification", {}))
            changed_id = generated[0]["id"]
            generated[0]["sourceVersion"] = "controlled new manifest version"
            generated[0]["content"]["sha256"] = "0" * 64
            generated[0].pop("permission", None)  # An optional source-field removal is current.
            result = BUILDER.curated_assets(path, list(reversed(generated)), previous)
            by_id = {asset["id"]: asset for asset in result}
            self.assertEqual(by_id[changed_id]["sourceVersion"], "controlled new manifest version")
            self.assertEqual(by_id[changed_id]["content"]["sha256"], "0" * 64)
            self.assertNotIn("permission", by_id[changed_id])
            for asset in previous:
                for field in asset.keys() & BUILDER.CURATED_ASSET_FIELDS:
                    self.assertEqual(by_id[asset["id"]][field], asset[field])
                    preserved += 1
        self.assertEqual(preserved, 17)

        d1_path = selected[0]
        previous = deepcopy(packs[d1_path]["assets"])
        fresh = [{key: deepcopy(value) for key, value in asset.items() if key in BUILDER.ASSET_GENERATED_FIELDS}
                 for asset in previous]
        removed = deepcopy(previous)
        del removed[0]["privateControlReviewEvidence"]
        self.assertNotIn("privateControlReviewEvidence", BUILDER.curated_assets(d1_path, deepcopy(fresh), removed)[0])
        with self.assertRaisesRegex(ValueError, "Curated asset removed"):
            BUILDER.curated_assets(d1_path, [], previous)
        unknown = deepcopy(previous)
        unknown[0]["unclassifiedAnnotation"] = {"reason": "needs an explicit authority"}
        with self.assertRaisesRegex(ValueError, "Unclassified catalogue fields"):
            BUILDER.curated_assets(d1_path, deepcopy(fresh), unknown)

        runtime = json.loads((ROOT / "docs/api/runtime-qualification.json").read_text(encoding="utf-8"))
        lgd = packs[selected[1]]
        expected = {key: lgd[key] for key in ("apiInstallation", "runtimeVerified", "runtimeEvidence")}
        self.assertEqual(BUILDER.qualification(runtime, selected[1], lgd), expected)
        self.assertNotIn("additionalReceipts", expected["runtimeEvidence"])  # Current-read run stays separate.
        withdrawn = deepcopy(runtime)
        selected_receipt = lgd["runtimeEvidence"]["receipt"]
        withdrawn["additionalRuns"] = [run for run in withdrawn["additionalRuns"] if run["receipt"] != selected_receipt]
        with self.assertRaisesRegex(ValueError, "no longer supports"):
            BUILDER.qualification(withdrawn, selected[1], lgd)
        ordered = BUILDER.published_order({"sourceVersion": "new", "content": {"sha256": "new"}},
                                          {"content": {"sha256": "old"}, "sourceVersion": "old", "removedField": True})
        self.assertEqual(ordered, {"content": {"sha256": "new"}, "sourceVersion": "new"})


class ExternalAssets(unittest.TestCase):
    MANIFEST = ROOT / "fixtures/usp/example/manifest.json"

    def test_asset_without_content_is_listed_by_its_pin_and_never_read(self):
        opened = AssertionError("the catalogue opened external bytes")
        with tempfile.TemporaryDirectory() as folder:
            outside = Path(folder) / "original.csv"
            outside.write_bytes(b"bytes that do not match the stated pin")
            pin = {"externalPath": outside.as_posix(), "sha256": "0" * 64, "bytes": 7}
            asset = {"id": "outside.csv", "split": "dev", "purpose": "test_only",
                     "permission": {"state": "unconfirmed"}, "original": pin}
            with (mock.patch.object(Path, "open", side_effect=opened),
                  mock.patch.object(Path, "read_bytes", side_effect=opened),
                  mock.patch.object(Path, "stat", side_effect=opened)):
                entry = BUILDER.asset_entry(self.MANIFEST, asset)
                unhashed = BUILDER.asset_entry(self.MANIFEST, {"id": "unhashed", "original": {"externalPath": "x"}})
        self.assertEqual(entry["content"], {"state": "external", **pin, "repositoryBytesVerified": False})
        self.assertEqual((entry["split"], entry["purpose"]), ("dev", "test_only"))
        self.assertNotIn("acquiredAt", entry)  # A field the manifest does not state stays absent.
        self.assertEqual(unhashed["content"],
                         {"state": "external", "externalPath": "x", "repositoryBytesVerified": False})
        with self.assertRaisesRegex(ValueError, "neither repository content nor an external pin"):
            BUILDER.asset_entry(self.MANIFEST, {"id": "nothing-stated"})

    def test_generation_keeps_sources_authored_only_in_the_published_catalogue(self):
        maintained = [{"id": "kept-current", "note": "new"}, {"manifest": "no-id.json"},
                      {"id": "demo", "apiInstallation": "local-opt-in-demo-only"}]
        published = [{"id": "catalogue-only"}, {"id": "kept-current", "note": "old"}, {"manifest": "no-id.json"},
                     {"id": "demo"}]
        self.assertEqual(BUILDER.retained_external_sources(maintained, published),
                         [{"id": "catalogue-only"}, {"id": "kept-current", "note": "new"}, {"manifest": "no-id.json"}])


if __name__ == "__main__":
    unittest.main()
