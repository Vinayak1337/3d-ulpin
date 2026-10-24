"""Technical byte controls for verified-copy integrity, reuse and disk budgets."""
import hashlib
import io
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from geo import settings, verified_cache
from geo.validation import InputError
from geo.verified_cache import verified_source


class Body(io.BytesIO):
    def iter_chunks(self, chunk_size):
        while block := self.read(chunk_size):
            yield block


@pytest.fixture(autouse=True)
def cache(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "VERIFIED_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "VERIFIED_CACHE_BYTES", 8)
    monkeypatch.setattr(settings, "VERIFIED_CACHE_FREE_BYTES", 0)
    return tmp_path


def test_second_read_does_not_download_and_bad_receipt_cannot_reuse(cache):
    calls = []

    def download():
        calls.append(1)
        return Body(b"original")

    digest = hashlib.sha256(b"original").hexdigest()
    for _ in range(2):
        with verified_source(8, digest, download) as path:
            assert path.read_bytes() == b"original"
    assert len(calls) == 1
    (cache / digest).write_bytes(b"cut")
    with verified_source(8, digest, download) as repaired:
        assert repaired.read_bytes() == b"original"
    assert len(calls) == 2
    with pytest.raises(InputError, match="exceeds its retained byte receipt"):
        with verified_source(7, digest, download):
            pytest.fail("A mismatched byte receipt was served.")
    assert len(calls) == 3
    assert not (cache / digest).exists()


@pytest.mark.parametrize("data,size", [(b"bad", 3), (b"extra", 3), (b"x", 3)])
def test_wrong_hash_or_size_leaves_no_cache_copy(cache, data, size):
    with pytest.raises(InputError, match="retained"):
        with verified_source(size, "a" * 64, lambda: Body(data)):
            pytest.fail("Unverified bytes were served.")
    assert [p.name for p in cache.iterdir()] == [".lock"]


@pytest.mark.parametrize("free_floor", [0, 94])
def test_lru_eviction_keeps_total_bound_and_free_space_floor(cache, monkeypatch, free_floor):
    monkeypatch.setattr(settings, "VERIFIED_CACHE_FREE_BYTES", free_floor)
    monkeypatch.setattr(verified_cache.shutil, "disk_usage", lambda root: SimpleNamespace(
        free=100 - sum(p.stat().st_size for p in Path(root).iterdir() if len(p.name) == 64)))
    paths = []
    for content in (b"one", b"two"):
        with verified_source(3, hashlib.sha256(content).hexdigest(), lambda: Body(content)) as path:
            paths.append(path)
    os.utime(paths[1], ns=(1, paths[1].stat().st_mtime_ns))
    with verified_source(3, hashlib.sha256(b"new").hexdigest(), lambda: Body(b"new")):
        assert paths[0].exists() and not paths[1].exists()
    assert sum(p.stat().st_size for p in cache.iterdir() if len(p.name) == 64) == 6
    monkeypatch.setattr(settings, "VERIFIED_CACHE_FREE_BYTES", 101)
    with pytest.raises(InputError, match="not enough free space"):
        with verified_source(3, "b" * 64, lambda: pytest.fail("No space: must not download.")):
            pytest.fail("No space: must not serve.")


def test_original_larger_than_cache_is_refused_before_download(cache):
    with pytest.raises(InputError, match="larger than the private cache budget"):
        with verified_source(9, "a" * 64, lambda: pytest.fail("Must not download.")):
            pytest.fail("Over-budget bytes were served.")
