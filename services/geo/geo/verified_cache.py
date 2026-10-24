"""Private, bounded copies; only hash-verified originals become cache entries."""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import time
from typing import Any, Callable, Iterator

from . import settings
from .validation import InputError

_LOCK = threading.Lock()
_HASH = re.compile(r"^[0-9a-f]{64}$")


@contextmanager
def _locked(root: Path) -> Iterator[None]:
    # Keep eviction and readers mutually exclusive across service processes too.
    with _LOCK, (root / ".lock").open("a+b") as lock:
        if os.name == "nt":
            import msvcrt
            if lock.tell() == 0:
                lock.write(b"\0")
                lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == "nt":
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _reserve(root: Path, size: int) -> None:
    ceiling, floor = settings.VERIFIED_CACHE_BYTES, settings.VERIFIED_CACHE_FREE_BYTES
    if size > ceiling:
        raise InputError("The original is larger than the private cache budget.")
    entries = sorted((p for p in root.iterdir() if _HASH.fullmatch(p.name) and p.is_file()),
                     key=lambda p: p.stat().st_atime_ns)
    total = sum(p.stat().st_size for p in entries)
    while total + size > ceiling or shutil.disk_usage(root).free - size < floor:
        if not entries:
            raise InputError("There is not enough free space for a verified original; the original remains kept.")
        victim = entries.pop(0)
        total -= victim.stat().st_size
        victim.unlink()


def _download(root: Path, path: Path, size: int, digest: str, body: Any) -> None:
    count, hashed = 0, hashlib.sha256()
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=root, prefix="copy-", suffix=".part", delete=False) as target:
            temporary = Path(target.name)
            for block in body.iter_chunks(chunk_size=1024 * 1024):
                count += len(block)
                if count > size:
                    raise InputError("Source exceeds its retained byte receipt.")
                hashed.update(block)
                target.write(block)
            if count != size or hashed.hexdigest() != digest:
                raise InputError("Source hash or byte count differs from its retained receipt.")
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    except OSError:
        raise InputError("The private cache could not store the verified original; check free space.") from None
    finally:
        body.close()
        if temporary is not None:
            temporary.unlink(missing_ok=True)


@contextmanager
def verified_source(size: int, digest: str, download: Callable[[], Any]) -> Iterator[Path]:
    """Lease a verified path. A cache hit does not open the remote object body."""
    if (not isinstance(digest, str) or not _HASH.fullmatch(digest)
            or isinstance(size, bool) or not isinstance(size, int) or size < 1):
        raise InputError("The private cache needs an exact source hash and byte receipt.")
    root = Path(settings.VERIFIED_CACHE_DIR)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    with _locked(root):
        path = root / digest
        # Interrupted downloads are never eligible hits and still consume the disk budget.
        for partial in root.glob("copy-*.part"):
            partial.unlink()
        if path.exists() and path.stat().st_size != size:
            path.unlink()
        if not path.exists():
            _reserve(root, size)
            _download(root, path, size, digest, download())
        os.utime(path, (time.time(), path.stat().st_mtime))
        yield path
