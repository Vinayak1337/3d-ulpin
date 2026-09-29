"""Run pypdf native-text parsing behind a per-process memory ceiling.

pypdf 5.5.0 decodes page contents in ``get_contents()`` and also decodes
object/xref streams, font maps and forms while resolving/extracting pages. A
page-length check in the caller cannot bound those allocations. Keep all PDF
parsing in this expendable child; never relax this to an in-process fallback.
"""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import subprocess
import sys

_MEMORY_LIMIT_BYTES = 384 * 1024 * 1024
_TIMEOUT_SECONDS = 45
_MAX_REPLY_BYTES = 4 * 1024 * 1024
_MAX_INPUT_BYTES = 10 * 1024 * 1024

_ERRORS = {
    "encrypted": "Encrypted PDFs require an explicitly decrypted source.",
    "page_count": "Native PDF extraction supports at most 100 pages.",
    "page_content": "A PDF page exceeds the native extraction content limit.",
    "text": "Native document text exceeds 250,000 characters; split the source into explicit parts.",
    "filter": "PDF native text uses an unsupported stream filter; preserve the source and use an explicit assisted workflow.",
    "resource": "PDF native extraction exceeded its isolated resource limit; preserve the source and use an explicit assisted workflow.",
    "isolation": "PDF native extraction cannot enforce its process memory limit on this host.",
    "parse": "PDF native text could not be parsed; preserve the source and use an explicit assisted workflow.",
}


def extract_native_pdf_pages(raw: bytes, *, max_pages: int, max_page_content_bytes: int,
                             max_text_chars: int) -> list[str]:
    """Return page text only after the whole parser has run under a hard ceiling."""
    from .validation import InputError

    command = [sys.executable, "-m", "geo.native_pdf", "--worker",
               str(max_pages), str(max_page_content_bytes), str(max_text_chars)]
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        process = subprocess.Popen(
            command, cwd=Path(__file__).resolve().parent.parent,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            creationflags=creationflags,
        )
        try:
            output, _ = process.communicate(input=raw, timeout=_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise InputError(_ERRORS["resource"]) from None
    except OSError:
        raise InputError(_ERRORS["isolation"]) from None
    if process.returncode != 0 or len(output) > _MAX_REPLY_BYTES:
        raise InputError(_ERRORS["resource"])
    try:
        result = json.loads(output)
    except (ValueError, UnicodeDecodeError):
        raise InputError(_ERRORS["parse"]) from None
    if not isinstance(result, dict):
        raise InputError(_ERRORS["parse"])
    if result.get("error"):
        raise InputError(_ERRORS.get(result["error"], _ERRORS["parse"]))
    pages = result.get("pages")
    if (not isinstance(pages, list) or len(pages) > max_pages or
            any(not isinstance(text, str) for text in pages) or
            sum(map(len, pages)) > max_text_chars):
        raise InputError(_ERRORS["parse"])
    return pages


def _install_memory_limit(limit_bytes: int) -> None:
    """Install an OS-enforced limit before the child accepts source bytes."""
    if sys.platform == "linux":
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (limit_bytes, limit_bytes))
        return
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        class BasicLimit(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64),
                        ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", wintypes.DWORD),
                        ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t),
                        ("ActiveProcessLimit", wintypes.DWORD),
                        ("Affinity", ctypes.c_size_t),
                        ("PriorityClass", wintypes.DWORD),
                        ("SchedulingClass", wintypes.DWORD)]

        class IoCounters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in (
                "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

        class ExtendedLimit(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", BasicLimit),
                        ("IoInfo", IoCounters),
                        ("ProcessMemoryLimit", ctypes.c_size_t),
                        ("JobMemoryLimit", ctypes.c_size_t),
                        ("PeakProcessMemoryUsed", ctypes.c_size_t),
                        ("PeakJobMemoryUsed", ctypes.c_size_t)]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR)
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes = (wintypes.HANDLE, ctypes.c_int,
                                                    ctypes.c_void_p, wintypes.DWORD)
        kernel.SetInformationJobObject.restype = wintypes.BOOL
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        kernel.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
        kernel.AssignProcessToJobObject.restype = wintypes.BOOL
        job = kernel.CreateJobObjectW(None, None)
        if not job:
            raise OSError(ctypes.get_last_error(), "CreateJobObjectW failed")
        limits = ExtendedLimit()
        limits.BasicLimitInformation.LimitFlags = 0x100  # JOB_OBJECT_LIMIT_PROCESS_MEMORY
        limits.ProcessMemoryLimit = limit_bytes
        if not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise OSError(ctypes.get_last_error(), "SetInformationJobObject failed")
        if not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
            raise OSError(ctypes.get_last_error(), "AssignProcessToJobObject failed")
        # Keep the job handle alive for the entire PDF parse.
        global _WINDOWS_JOB
        _WINDOWS_JOB = job
        return
    raise OSError("No native PDF process memory ceiling on this platform")


def _reply(payload: dict) -> None:
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if len(encoded) > _MAX_REPLY_BYTES:
        encoded = b'{"error":"resource"}'
    sys.stdout.buffer.write(encoded)


def _worker() -> None:
    try:
        _install_memory_limit(_MEMORY_LIMIT_BYTES)
    except (OSError, ValueError):
        _reply({"error": "isolation"})
        return
    try:
        max_pages, page_limit, text_limit = (int(value) for value in sys.argv[2:5])
        raw = sys.stdin.buffer.read(_MAX_INPUT_BYTES + 1)
        if not raw or len(raw) > _MAX_INPUT_BYTES:
            _reply({"error": "parse"})
            return
        # Import only after the limit is installed; reader construction and
        # page-tree resolution can themselves decode compressed PDF streams.
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw), strict=True)
        if reader.is_encrypted:
            _reply({"error": "encrypted"})
            return
        if len(reader.pages) > max_pages:
            _reply({"error": "page_count"})
            return
        pages = []
        total_text = 0
        for page in reader.pages:
            contents = page.get_contents()
            if contents is not None and len(contents.get_data()) > page_limit:
                _reply({"error": "page_content"})
                return
            text = page.extract_text() or ""
            total_text += len(text)
            if total_text > text_limit:
                _reply({"error": "text"})
                return
            pages.append(text)
        _reply({"pages": pages})
    except MemoryError:
        _reply({"error": "resource"})
    except NotImplementedError:
        _reply({"error": "filter"})
    except Exception:
        _reply({"error": "parse"})


if __name__ == "__main__" and sys.argv[1:2] == ["--worker"]:
    _worker()
