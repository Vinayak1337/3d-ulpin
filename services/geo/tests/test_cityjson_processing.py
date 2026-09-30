"""Only source-bound transport controls; accepted structural reader tests are reused."""
import hashlib
import json
from pathlib import Path
import unittest

from geo.cityjson_processing import process_cityjson, reader_sha
from geo.validation import InputError

SOURCE = Path(__file__).resolve().parents[3] / "fixtures/usp/D1/single-roof/original.json"


class Body:
    def __init__(self, raw):
        self.raw, self.closed, self.reads = raw, False, 0

    def iter_chunks(self, chunk_size):
        self.reads += 1
        yield self.raw

    def close(self):
        self.closed = True


class Store:
    def __init__(self, raw, size=None):
        self.body = Body(raw)
        self.size = len(raw) if size is None else size
        self.calls = 0

    def get_object(self, **kwargs):
        self.calls += 1
        return {"Body": self.body, "ContentLength": self.size}


class CityJSONTransportTest(unittest.TestCase):
    def pins(self, raw):
        # Memory-only application storage reference; no official ID is invented.
        source_id = "00000000-0000-4000-8000-000000000001"
        sha = hashlib.sha256(raw).hexdigest()
        return {"sourceId": source_id, "objectKey": f"sources/{source_id}/{sha}",
                "sha256": sha, "bytes": len(raw), "readerSha256": reader_sha(),
                "selection": "complete_bounded_source"}

    def test_unchanged_source_through_bounded_child(self):
        import base64
        raw = SOURCE.read_bytes()
        store = Store(raw)
        result = process_cityjson(self.pins(raw), store)
        native = json.loads(base64.b64decode(result["artifactBase64"]))
        self.assertEqual(native["sourceDocument"], json.loads(raw))
        self.assertEqual(result["summary"]["vertexCount"], 62)
        self.assertEqual(native["sourceSha256"], self.pins(raw)["sha256"])
        self.assertTrue(store.body.closed)

    def test_reader_mismatch_fails_before_storage(self):
        raw = SOURCE.read_bytes()
        pins, store = self.pins(raw), Store(raw)
        pins["readerSha256"] = "0" * 64
        with self.assertRaisesRegex(InputError, "CITYJSON_READER_MISMATCH"):
            process_cityjson(pins, store)
        self.assertEqual(store.calls, 0)

    def test_wrong_receipt_length_closes_before_read(self):
        raw = SOURCE.read_bytes()
        store = Store(raw, len(raw) + 1)
        with self.assertRaisesRegex(InputError, "CITYJSON_SOURCE_INTEGRITY"):
            process_cityjson(self.pins(raw), store)
        self.assertTrue(store.body.closed)
        self.assertEqual(store.body.reads, 0)

    def test_malformed_source_has_recoverable_code_and_closed_body(self):
        raw = SOURCE.read_bytes().replace(b'"feature":', b'"feature":null,"feature":', 1)
        store = Store(raw)
        with self.assertRaisesRegex(InputError, "CITYJSON_MALFORMED"):
            process_cityjson(self.pins(raw), store)
        self.assertTrue(store.body.closed)


if __name__ == "__main__":
    unittest.main()
