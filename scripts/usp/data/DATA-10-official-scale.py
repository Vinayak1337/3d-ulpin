#!/usr/bin/env python3
"""Offline DATA-10 checker for the pinned outside-Git KSRSAC district archive."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[3]
PACK = ROOT / "fixtures/usp/D3/official-scale-v1"
MANIFEST = PACK / "manifest.json"
OBSERVATIONS = PACK / "source-observations.json"
DEFAULT_ORIGINAL = Path("/Users/vinayak/.codex/task-data/ulpin-data-10/District.zip")
EXPECTED_MEMBERS = {
    "District.shp", "District.shx", "District.dbf", "District.prj",
    "District.cpg", "District.sbn", "District.sbx",
}
EXPECTED_FIELDS = [
    {"name": "KGISDistri", "type": "C", "width": 2},
    {"name": "LGD_Distri", "type": "N", "width": 10},
    {"name": "KGISDist_1", "type": "C", "width": 30},
    {"name": "BhuCodeDis", "type": "C", "width": 2},
    {"name": "SHAPE_STAr", "type": "F", "width": 19},
    {"name": "SHAPE_STLe", "type": "F", "width": 19},
]
EXPECTED_PRJ = (
    'PROJCS["WGS_1984_UTM_Zone_43N",GEOGCS["GCS_WGS_1984",'
    'DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],'
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],'
    'PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],'
    'PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",75.0],'
    'PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],'
    'UNIT["Meter",1.0]]'
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def need(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def inspect_shapefile(data: bytes) -> dict:
    need(len(data) >= 100, "SHP header is truncated")
    file_code = struct.unpack_from(">i", data, 0)[0]
    file_bytes = struct.unpack_from(">i", data, 24)[0] * 2
    version, shape_type = struct.unpack_from("<2i", data, 28)
    extent = list(struct.unpack_from("<4d", data, 36))
    need(file_code == 9994 and file_bytes == len(data) and version == 1000,
         "SHP header code, declared length or version changed")
    need(shape_type == 5, "SHP is not the observed 2D Polygon profile")
    need(all(math.isfinite(value) for value in extent), "SHP extent is not finite")

    offset = 100
    records = parts = positions = 0
    actual_bounds = [math.inf, math.inf, -math.inf, -math.inf]
    while offset < len(data):
        need(offset + 8 <= len(data), "SHP record header is truncated")
        record_number, content_words = struct.unpack_from(">2i", data, offset)
        offset += 8
        content_bytes = content_words * 2
        end = offset + content_bytes
        need(end <= len(data), "SHP record content is truncated")
        need(record_number == records + 1, "SHP record sequence changed")
        content = data[offset:end]
        need(len(content) >= 44, "Polygon record is shorter than its fixed header")
        record_type = struct.unpack_from("<i", content, 0)[0]
        need(record_type == 5, "Unexpected/null geometry record in district layer")
        part_count, point_count = struct.unpack_from("<2i", content, 36)
        need(part_count > 0 and point_count > 0, "Empty polygon record")
        point_start = 44 + part_count * 4
        need(point_start + point_count * 16 == len(content),
             "Polygon part or point table does not match record length")
        records += 1
        parts += part_count
        positions += point_count
        for index in range(point_count):
            x, y = struct.unpack_from("<2d", content, point_start + index * 16)
            need(math.isfinite(x) and math.isfinite(y), "Non-finite XY position")
            actual_bounds[0] = min(actual_bounds[0], x)
            actual_bounds[1] = min(actual_bounds[1], y)
            actual_bounds[2] = max(actual_bounds[2], x)
            actual_bounds[3] = max(actual_bounds[3], y)
        offset = end
    need(offset == len(data), "SHP parser did not consume the complete file")
    need(all(math.isclose(a, b, rel_tol=0, abs_tol=1e-7)
             for a, b in zip(extent, actual_bounds)),
         "SHP header extent differs from its coordinate records")
    return {
        "fileCode": file_code, "fileBytes": file_bytes, "version": version,
        "shapeType": shape_type, "recordCount": records, "partCount": parts,
        "positionCount": positions, "extent": extent,
    }


def inspect_dbf(data: bytes, expected_encoding: str) -> dict:
    need(len(data) >= 33, "DBF header is truncated")
    count, header_bytes, record_bytes = struct.unpack_from("<IHH", data, 4)
    need(header_bytes >= 33 and record_bytes >= 1 and header_bytes <= len(data),
         "DBF header length is invalid")
    fields = []
    offset = 32
    while offset < header_bytes and data[offset] != 0x0D:
        need(offset + 32 <= header_bytes, "DBF field descriptor is truncated")
        descriptor = data[offset:offset + 32]
        name = descriptor[:11].split(b"\0", 1)[0].decode("ascii")
        fields.append({"name": name, "type": chr(descriptor[11]),
                       "width": descriptor[16]})
        offset += 32
    need(offset < header_bytes and data[offset] == 0x0D,
         "DBF field descriptor terminator is missing")
    need(fields == EXPECTED_FIELDS, "DBF native field names/types/widths changed")
    need(sum(field["width"] for field in fields) + 1 == record_bytes,
         "DBF field widths do not match record width")
    need(expected_encoding.upper() == "UTF-8", "DBF encoding label changed")
    need(header_bytes + count * record_bytes <= len(data), "DBF rows are truncated")

    rows = []
    row_offset = header_bytes
    for _ in range(count):
        record = data[row_offset:row_offset + record_bytes]
        row_offset += record_bytes
        need(len(record) == record_bytes and record[0:1] != b"*",
             "DBF record is deleted or truncated")
        cursor = 1
        row = {}
        for field in fields:
            width = field["width"]
            value = record[cursor:cursor + width].decode(expected_encoding).strip()
            row[field["name"]] = value
            cursor += width
        rows.append(row)
    tail = data[row_offset:]
    need(tail in (b"", b"\x1a"), "Unexpected bytes follow DBF records")

    key_summary = {}
    for field in ("KGISDistri", "LGD_Distri"):
        values = [row[field] for row in rows]
        nonblank = [value for value in values if value]
        key_summary[field] = {
            "nonblank": len(nonblank),
            "distinct": len(set(nonblank)),
            "sampleValues": values[:5],
            "values": sorted(nonblank),
        }
    return {
        "recordCount": count, "headerBytes": header_bytes,
        "recordBytes": record_bytes, "fields": fields,
        "keySummary": key_summary,
    }


def compare_observations(archive: Path, manifest_path: Path, observations_path: Path) -> dict:
    manifest_bytes = manifest_path.read_bytes()
    observations_bytes = observations_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    observations = json.loads(observations_bytes)
    need(manifest["schemaVersion"] == "usp-data-pack/1" and manifest["packId"] == "D3",
         "Unexpected DATA-10 pack schema or ID")
    need(observations["schemaVersion"] == "data-10-source-observations/1",
         "Unexpected DATA-10 source observation schema")
    original = observations["original"]
    original_bytes = archive.read_bytes()
    original_hash = sha256(original_bytes)
    need(len(original_bytes) == original["bytes"], "Original archive byte count changed")
    need(original_hash == original["sha256"], "Original archive SHA-256 changed")
    need(original["preservedOutsideGit"] is True, "Original retention location is not recorded")

    assets = {asset["id"]: asset for asset in manifest["assets"]}
    source_asset = assets["karnataka-district-boundaries-original"]
    source_provenance = source_asset["provenance"]
    need(source_asset["permission"]["state"] == "unconfirmed",
         "Unconfirmed source permission was promoted")
    need(source_provenance["licenceFamily"] is None
         and source_provenance["trainingPermission"]["state"] == "unconfirmed",
         "Unknown licence or training permission was promoted")
    need(source_provenance["original"] == {
        "sha256": original_hash, "bytes": len(original_bytes)
    }, "Manifest original pin differs from inspected archive")
    need(source_asset["content"]["state"] == "unavailable",
         "Outside-Git original was misrepresented as a pack byte")
    need(all(source_asset["verification"][stage]["status"] == "not_run"
             for stage in ("bytes_preserved", "parsed", "rendered", "workflow_verified")),
         "Unavailable original was given a pack-local verification pass")

    observation_asset = assets["karnataka-district-source-observations"]
    need(observation_asset["content"]["state"] == "available"
         and observation_asset["content"]["path"] == manifest["expectedPath"] == "source-observations.json",
         "Source observation asset is not the declared pack expected path")
    need(observation_asset["content"]["bytes"] == len(observations_bytes)
         and observation_asset["content"]["sha256"] == sha256(observations_bytes),
         "Source observation asset byte pin changed")
    need(observations["accessAndRights"]["usePermission"] == "unconfirmed"
         and observations["accessAndRights"]["redistributionPermission"] == "unconfirmed"
         and observations["accessAndRights"]["licenceFamily"] is None,
         "Source rights were incorrectly promoted")
    need(observations["source"]["directDownloadUrl"] == source_asset["origin"]["url"],
         "Source locator differs between manifest and inspection receipt")

    with ZipFile(archive) as zipped:
        infos = zipped.infolist()
        names = {entry.filename for entry in infos}
        need(names == EXPECTED_MEMBERS and len(infos) == len(EXPECTED_MEMBERS),
             "Archive file set changed or contains duplicate member names")
        expected_by_name = {entry["name"]: entry for entry in observations["archiveMembers"]}
        need(set(expected_by_name) == names, "Receipt archive member set changed")
        actual_members = []
        member_bytes = {}
        for entry in infos:
            data = zipped.read(entry.filename)
            actual = {
                "name": entry.filename, "bytes": entry.file_size,
                "compressedBytes": entry.compress_size,
                "crc32": f"{entry.CRC:08x}", "sha256": sha256(data),
                "memberTimestamp": list(entry.date_time),
            }
            need(actual == expected_by_name[entry.filename],
                 f"Archive member pin changed: {entry.filename}")
            actual_members.append(actual)
            member_bytes[entry.filename] = data
    shape = inspect_shapefile(member_bytes["District.shp"])
    dbf = inspect_dbf(member_bytes["District.dbf"],
                      member_bytes["District.cpg"].decode("ascii").strip())
    prj = member_bytes["District.prj"].decode("ascii").strip()
    need(prj == observations["geometry"]["projectionWkt"] == EXPECTED_PRJ,
         "Projection file differs from its exact recorded WKT")
    geometry_expected = observations["geometry"]
    need(shape["shapeType"] == geometry_expected["shapeTypeCode"]
         and shape["recordCount"] == geometry_expected["recordCount"]
         and shape["partCount"] == geometry_expected["partCount"]
         and shape["positionCount"] == geometry_expected["positionCount"]
         and shape["fileBytes"] == geometry_expected["shapefileBytes"]
         and shape["extent"] == geometry_expected["extentProjected"],
         "SHP geometry counts, size or source extent changed")
    attributes_expected = observations["attributes"]
    need(dbf["recordCount"] == attributes_expected["dbfRecordCount"]
         and dbf["headerBytes"] == attributes_expected["dbfHeaderBytes"]
         and dbf["recordBytes"] == attributes_expected["dbfRecordBytes"]
         and dbf["fields"] == attributes_expected["fields"],
         "DBF record count or native fields changed")
    key_summaries = dbf["keySummary"]
    for field in ("KGISDistri", "LGD_Distri"):
        expected_key = next(item for item in attributes_expected["nativeKeysObserved"]
                            if item["field"] == field)
        actual_key = key_summaries[field]
        need(actual_key["nonblank"] == expected_key["nonblank"]
             and actual_key["distinct"] == expected_key["distinct"]
             and actual_key["sampleValues"] == expected_key["sampleValues"],
             f"Native key observation changed: {field}")
        need(actual_key["nonblank"] == dbf["recordCount"]
             and actual_key["distinct"] == dbf["recordCount"],
             f"Native key is blank or duplicated in this file: {field}")

    return {
        "schemaVersion": "data-10-source-check/1",
        "status": "source_archive_and_pack_inventory_verified",
        "manifestSha256": sha256(manifest_bytes),
        "observationsSha256": sha256(observations_bytes),
        "original": {
            "path": str(archive), "sha256": original_hash,
            "bytes": len(original_bytes), "memberCount": len(actual_members),
        },
        "geometry": shape,
        "attributes": dbf,
        "permission": {
            "access": "public_download_observed",
            "use": "unconfirmed",
            "redistribution": "unconfirmed",
            "training": "unconfirmed",
            "licenceFamily": None,
        },
        "qualification": {
            "supported": "2D administrative district polygon inventory and bounded source-byte inspection only",
            "runtimeUse": "not qualified",
            "gfScale1": "open; no authorized runtime profile or service-budget measurement",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify local pins and source observations")
    parser.add_argument("--original", type=Path, default=DEFAULT_ORIGINAL,
                        help="path to the preserved original ZIP (default is this task's private retention path)")
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--observations", type=Path, default=OBSERVATIONS)
    args = parser.parse_args()
    if not args.check:
        parser.error("--check is required")
    try:
        result = compare_observations(args.original, args.manifest, args.observations)
    except (OSError, ValueError, KeyError, TypeError, struct.error, json.JSONDecodeError) as exc:
        print(f"DATA-10 source check failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
