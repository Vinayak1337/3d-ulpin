"""Bounded ZIP member inventory; never extracts or interprets member content."""

from __future__ import annotations

import hashlib
import io
import re
import stat
import time
import zipfile
import zlib


MAX_MEMBERS = 256
MAX_NAME = 256
MAX_MEMBER = 8 * 1024 * 1024
MAX_EXPANDED = 30 * 1024 * 1024
MAX_RATIO = 1000
MAX_SECONDS = 15
MAX_SAFE_INTEGER = (1 << 53) - 1
CHUNK = 64 * 1024
COMPANIONS = {".shp", ".shx", ".dbf", ".prj", ".cpg", ".sbn", ".sbx"}
REQUIRED = {".shp", ".shx", ".dbf", ".prj"}
SCRIPTS = {".py", ".js", ".mjs", ".sh", ".bat", ".cmd", ".ps1", ".exe", ".dll"}
NESTED = {".zip", ".7z", ".rar", ".tar", ".gz", ".jar"}
ROUTES = {".pdf": "pdf", ".csv": "csv", ".txt": "text", ".docx": "docx", ".xlsx": "xlsx",
          ".json": "json", ".geojson": "geojson", ".tif": "raster", ".tiff": "raster",
          ".las": "point_cloud", ".laz": "point_cloud", ".png": "image", ".jpg": "image", ".jpeg": "image"}


def _name(raw: str):
    """Return a safe display label, normalized grouping key, and issue if any."""
    if (not raw or len(raw) > MAX_NAME or raw.startswith(("/", "\\")) or "\\" in raw
            or re.match(r"^[A-Za-z]:", raw) or any(ord(ch) < 32 or ord(ch) == 127 for ch in raw)
            or any(part in ("", ".", "..") for part in raw.rstrip("/").split("/"))):
        return "sha256:" + hashlib.sha256(raw.encode("utf-8", "surrogatepass")).hexdigest(), None, "UNSAFE_PATH"
    path = raw.rstrip("/")
    return path, path.casefold(), None


def _route(path: str):
    suffix = "." + path.rsplit(".", 1)[-1].lower() if "." in path else ""
    if suffix in COMPANIONS:
        return "shapefile", suffix
    if suffix in SCRIPTS:
        return "none", suffix
    if suffix in NESTED:
        return "none", suffix
    return ROUTES.get(suffix, "none"), suffix


def inventory_archive(raw: bytes):
    """Return a complete or explicitly incomplete receipt, never a content part."""
    source_hash = hashlib.sha256(raw).hexdigest()
    base = {"sourceSha256": source_hash, "coverage": "unknown", "issue": "CORRUPT_CENTRAL_DIRECTORY",
            "memberCount": None, "declaredExpandedBytes": None, "observedExpandedBytes": 0, "members": []}
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_MEMBERS:
                return {**base, "coverage": "incomplete", "issue": "MEMBER_COUNT_LIMIT",
                        "memberCount": len(entries)}
            declared = sum(info.file_size for info in entries)
            if declared > MAX_SAFE_INTEGER:
                return {**base, "coverage": "incomplete", "issue": "DECLARED_SIZE_LIMIT",
                        "memberCount": len(entries)}
            start = time.monotonic()
            seen = set()
            groups = {}
            observed = 0
            members = []
            for ordinal, info in enumerate(entries):
                label, key, unsafe = _name(info.filename)
                route, suffix = _route(label) if key else ("none", "")
                mode = (info.external_attr >> 16) & 0o170000
                issue = unsafe
                if key is not None:
                    if key in seen:
                        issue = "DUPLICATE_PATH"
                    seen.add(key)
                if not issue and mode not in (0, stat.S_IFREG, stat.S_IFDIR):
                    issue = "SPECIAL_ENTRY"
                if not issue and (info.is_dir() or mode == stat.S_IFDIR):
                    issue = "DIRECTORY"
                if not issue and info.flag_bits & 1:
                    issue = "ENCRYPTED"
                if not issue and info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    issue = "UNSUPPORTED_COMPRESSION"
                inert = "NESTED_ARCHIVE" if suffix in NESTED else "SCRIPT_INERT" if suffix in SCRIPTS else \
                    "UNSUPPORTED_FORMAT" if route == "none" else None
                if not issue and (info.file_size > MAX_MEMBER or declared > MAX_EXPANDED
                                  or info.file_size > max(1, info.compress_size) * MAX_RATIO):
                    issue = "EXPANSION_LIMIT"
                if not issue and time.monotonic() - start > MAX_SECONDS:
                    issue = "TIME_LIMIT"
                actual = None
                digest = None
                crc = "unchecked"
                if not issue:
                    h = hashlib.sha256()
                    count = 0
                    try:
                        with archive.open(info) as stream:
                            while True:
                                if time.monotonic() - start > MAX_SECONDS:
                                    issue = "TIME_LIMIT"
                                    break
                                chunk = stream.read(CHUNK)
                                if not chunk:
                                    break
                                count += len(chunk)
                                if count > info.file_size or count > MAX_MEMBER or observed + count > MAX_EXPANDED:
                                    issue = "EXPANSION_LIMIT"
                                    break
                                h.update(chunk)
                        if not issue and count != info.file_size:
                            issue = "SIZE_MISMATCH"
                        if not issue:
                            actual, digest, crc = count, h.hexdigest(), "match"
                            observed += count
                    except (zipfile.BadZipFile, RuntimeError, EOFError, OSError, zlib.error):
                        issue = "CORRUPT_MEMBER"
                if not issue:
                    issue = inert
                member = {"ordinal": ordinal, "pathLabel": label, "declaredBytes": info.file_size,
                          "actualBytes": actual, "sha256": digest, "declaredCrc32": f"{info.CRC:08x}",
                          "crc": crc, "routeHint": route, "issue": issue, "companion": "not_applicable"}
                if key and suffix in COMPANIONS:
                    stem = key[:-len(suffix)]
                    groups.setdefault(stem, []).append((member, suffix))
                members.append(member)
            for group in groups.values():
                present = {suffix for member, suffix in group if member["issue"] is None}
                state = "complete" if REQUIRED <= present else "incomplete"
                for member, _ in group:
                    member["companion"] = state
            complete = all(member["issue"] is None or member["issue"] in
                           ("DIRECTORY", "SCRIPT_INERT", "NESTED_ARCHIVE", "UNSUPPORTED_FORMAT") for member in members)
            companions_complete = all(member["companion"] != "incomplete" for member in members)
            return {"sourceSha256": source_hash, "coverage": "complete" if complete and companions_complete else "incomplete",
                    "issue": None if complete and companions_complete else
                        "COMPANION_INCOMPLETE" if complete else "MEMBER_ISSUES", "memberCount": len(entries),
                    "declaredExpandedBytes": declared,
                    "observedExpandedBytes": observed, "members": members}
    except (zipfile.BadZipFile, ValueError, OSError, EOFError):
        return base
