"""Read one source-pinned ZIP member without admitting it as interpreted evidence."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import io
import re
import time
import zipfile
import zlib

from .native_archive import (CHUNK, COMPANIONS, MAX_EXPANDED, MAX_MEMBER, MAX_MEMBERS,
                             MAX_SECONDS, inventory_archive)


MAX_NATIVE_BYTES = 10 * 1024 * 1024
ADMITTED_ROUTES = frozenset({"shapefile", "pdf", "csv", "text", "docx", "xlsx",
                             "json", "geojson", "raster", "point_cloud", "image"})
HASH = re.compile(r"[a-f0-9]{64}\Z")


class ArchiveMemberError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class ArchiveMemberResult:
    data: bytes
    lineage: dict


def read_archive_member(raw: bytes, expected_outer_sha256: str, ordinal: int,
                        expected_member_sha256: str, expected_member_bytes: int) -> ArchiveMemberResult:
    """Verify original, current inventory and exact member before returning bounded bytes."""
    if type(raw) is not bytes or not raw or len(raw) > MAX_NATIVE_BYTES:
        raise ArchiveMemberError("SOURCE_BYTE_LIMIT")
    if (not isinstance(expected_outer_sha256, str) or not HASH.fullmatch(expected_outer_sha256)
            or not isinstance(expected_member_sha256, str) or not HASH.fullmatch(expected_member_sha256)
            or type(ordinal) is not int or ordinal < 0 or ordinal >= MAX_MEMBERS
            or type(expected_member_bytes) is not int or not 0 <= expected_member_bytes <= MAX_MEMBER):
        raise ArchiveMemberError("INVALID_MEMBER_REFERENCE")
    started = time.monotonic()
    outer_sha256 = hashlib.sha256(raw).hexdigest()
    if outer_sha256 != expected_outer_sha256:
        raise ArchiveMemberError("SOURCE_HASH_MISMATCH")

    inventory = inventory_archive(raw)
    if time.monotonic() - started > MAX_SECONDS:
        raise ArchiveMemberError("TIME_LIMIT")
    if (inventory["sourceSha256"] != outer_sha256 or inventory["coverage"] == "unknown"
            or inventory["memberCount"] is None or inventory["memberCount"] > MAX_MEMBERS
            or len(inventory["members"]) != inventory["memberCount"]):
        raise ArchiveMemberError("INVENTORY_UNAVAILABLE")
    if ordinal >= inventory["memberCount"]:
        raise ArchiveMemberError("MEMBER_NOT_FOUND")
    member = inventory["members"][ordinal]
    if member["ordinal"] != ordinal:
        raise ArchiveMemberError("INVENTORY_REFERENCE_MISMATCH")
    if member["issue"] is not None:
        raise ArchiveMemberError("MEMBER_" + member["issue"])
    if member["routeHint"] not in ADMITTED_ROUTES:
        raise ArchiveMemberError("MEMBER_UNSUPPORTED_FORMAT")
    if member["routeHint"] == "shapefile" and member["companion"] != "complete":
        raise ArchiveMemberError("COMPANION_INCOMPLETE")
    if (member["crc"] != "match" or member["sha256"] is None
            or member["actualBytes"] != member["declaredBytes"]):
        raise ArchiveMemberError("MEMBER_INTEGRITY_UNVERIFIED")
    if member["sha256"] != expected_member_sha256 or member["actualBytes"] != expected_member_bytes:
        raise ArchiveMemberError("MEMBER_REFERENCE_MISMATCH")
    if inventory["declaredExpandedBytes"] is None or inventory["declaredExpandedBytes"] > MAX_EXPANDED:
        raise ArchiveMemberError("EXPANSION_LIMIT")

    output = bytearray()
    digest = hashlib.sha256()
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            if len(entries) != inventory["memberCount"]:
                raise ArchiveMemberError("INVENTORY_REFERENCE_MISMATCH")
            info = entries[ordinal]  # ZipInfo, never a caller-supplied path.
            # The inventory flags later duplicate entries; the first spelling is unsafe too.
            selected_key = info.filename.rstrip("/").casefold()
            if sum(entry.filename.rstrip("/").casefold() == selected_key for entry in entries) != 1:
                raise ArchiveMemberError("MEMBER_DUPLICATE_PATH")
            if member["routeHint"] == "shapefile":
                selected_stem = selected_key.rpartition(".")[0]
                suffixes = set()
                for entry, sibling in zip(entries, inventory["members"]):
                    stem, _, extension = entry.filename.rstrip("/").casefold().rpartition(".")
                    suffix = "." + extension
                    if stem != selected_stem or suffix not in COMPANIONS:
                        continue
                    if (suffix in suffixes or sibling["issue"] is not None
                            or sibling["crc"] != "match" or sibling["sha256"] is None
                            or sibling["actualBytes"] != sibling["declaredBytes"]):
                        raise ArchiveMemberError("COMPANION_INELIGIBLE")
                    suffixes.add(suffix)
            if (info.file_size != member["declaredBytes"] or f"{info.CRC:08x}" != member["declaredCrc32"]):
                raise ArchiveMemberError("INVENTORY_REFERENCE_MISMATCH")
            with archive.open(info) as stream:
                while True:
                    if time.monotonic() - started > MAX_SECONDS:
                        raise ArchiveMemberError("TIME_LIMIT")
                    chunk = stream.read(CHUNK)
                    if not chunk:
                        break
                    if len(output) + len(chunk) > expected_member_bytes or len(output) + len(chunk) > MAX_MEMBER:
                        raise ArchiveMemberError("MEMBER_SIZE_LIMIT")
                    output.extend(chunk)
                    digest.update(chunk)
    except (zipfile.BadZipFile, RuntimeError, EOFError, OSError, zlib.error) as error:
        raise ArchiveMemberError("MEMBER_CORRUPT") from error
    if time.monotonic() - started > MAX_SECONDS:
        raise ArchiveMemberError("TIME_LIMIT")
    if len(output) != expected_member_bytes or digest.hexdigest() != expected_member_sha256:
        raise ArchiveMemberError("MEMBER_REFERENCE_MISMATCH")

    unselected_issues = [{"ordinal": entry["ordinal"], "issue": entry["issue"],
                          "companion": entry["companion"]}
                         for entry in inventory["members"] if entry["ordinal"] != ordinal and
                         (entry["issue"] is not None or entry["companion"] == "incomplete")]
    lineage = {"version": "archive-member/1", "outerSha256": outer_sha256,
               "ordinal": ordinal, "memberSha256": expected_member_sha256,
               "memberBytes": expected_member_bytes, "pathLabel": member["pathLabel"],
               "routeHint": member["routeHint"], "declaredCrc32": member["declaredCrc32"],
               "crc": "match", "companion": member["companion"],
               "inventoryCoverage": inventory["coverage"], "inventoryIssue": inventory["issue"],
               "unselectedIssues": unselected_issues}
    return ArchiveMemberResult(bytes(output), lineage)
