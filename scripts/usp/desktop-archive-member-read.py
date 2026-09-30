"""Write one verified ZIP member to fixed names in a fresh private directory."""

import argparse
import hashlib
import json
from pathlib import Path
import sys


REPOSITORY = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY / "services" / "geo"))
from geo.native_archive_member import ArchiveMemberError, MAX_NATIVE_BYTES, read_archive_member  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--outer-sha256", required=True)
    parser.add_argument("--ordinal", required=True, type=int)
    parser.add_argument("--member-sha256", required=True)
    parser.add_argument("--member-bytes", required=True, type=int)
    parser.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    out_dir = args.out_dir.resolve(strict=False)
    if (out_dir.is_relative_to(REPOSITORY) or out_dir.exists() or not out_dir.parent.is_dir()
            or any((ancestor / ".git").exists() for ancestor in out_dir.parents)):
        raise ArchiveMemberError("OUTPUT_DIRECTORY_NOT_NEW_OR_PRIVATE")
    with source.open("rb") as original:
        raw = original.read(MAX_NATIVE_BYTES + 1)
    result = read_archive_member(raw, args.outer_sha256, args.ordinal,
                                 args.member_sha256, args.member_bytes)
    receipt = json.dumps(result.lineage, sort_keys=True, indent=2).encode("utf-8") + b"\n"
    if len(receipt) > 128 * 1024:
        raise ArchiveMemberError("LINEAGE_BYTE_LIMIT")
    out_dir.mkdir(mode=0o700)
    with (out_dir / "member.bin").open("xb") as target:
        target.write(result.data)
    with (out_dir / "lineage.json").open("xb") as target:
        target.write(receipt)
    print(json.dumps({"member": str(out_dir / "member.bin"),
                      "lineage": str(out_dir / "lineage.json"),
                      "lineageSha256": hashlib.sha256(receipt).hexdigest(),
                      "outerSha256": result.lineage["outerSha256"],
                      "ordinal": result.lineage["ordinal"],
                      "memberSha256": result.lineage["memberSha256"],
                      "memberBytes": result.lineage["memberBytes"]}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ArchiveMemberError, OSError) as error:
        print(error.code if isinstance(error, ArchiveMemberError) else "LOCAL_IO_ERROR", file=sys.stderr)
        raise SystemExit(2) from None
