"""The PDF child must cap decoder allocation before handling source bytes."""
import subprocess
import sys
import unittest
from pathlib import Path
import zlib


class NativePdfResourceTest(unittest.TestCase):
    def test_child_hard_ceiling_rejects_byte_level_inflation(self):
        # A tiny compressed byte string exercises the same OS ceiling used by
        # pypdf without inventing an operational document or property record.
        encoder = zlib.compressobj()
        compressed = b"".join(encoder.compress(b"x" * (1024 * 1024)) for _ in range(128))
        compressed += encoder.flush()
        script = (
            "import sys,zlib; from geo.native_pdf import _install_memory_limit; "
            "_install_memory_limit(64*1024*1024); "
            "data=sys.stdin.buffer.read(); "
            "\ntry: zlib.decompress(data); print('expanded')"
            "\nexcept MemoryError: print('bounded')"
        )
        result = subprocess.run(
            [sys.executable, "-c", script], input=compressed,
            cwd=Path(__file__).resolve().parent.parent,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
        self.assertEqual(result.stdout.strip(), b"bounded")


if __name__ == "__main__":
    unittest.main()
