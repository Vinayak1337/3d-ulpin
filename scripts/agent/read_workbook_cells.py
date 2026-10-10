"""Return bounded native XLSX/ODS cell references without evaluating formulas."""

import json
from pathlib import Path
import sys
from typing import Any
import zipfile

MAX_ARCHIVE_MEMBERS = 512
MAX_EXPANDED_BYTES = 20_000_000


def read_workbook_cells(services_geo_path: Path, file_path: Path) -> dict[str, Any]:
    """Reuse the application's native readers and their XML/cell limits."""
    sys.path.insert(0, str(services_geo_path.resolve()))
    from geo.native_ods import extract_native_ods, is_ods_archive
    from geo.native_workbook import extract_native_workbook

    with zipfile.ZipFile(file_path) as archive:
        members = archive.infolist()
        if len(members) > MAX_ARCHIVE_MEMBERS:
            raise ValueError("COLUMN_WORKBOOK_LIMIT")
        if sum(member.file_size for member in members) > MAX_EXPANDED_BYTES:
            raise ValueError("COLUMN_WORKBOOK_LIMIT")
        if is_ods_archive(archive):
            return extract_native_ods(archive)
        return extract_native_workbook(archive)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: read_workbook_cells.py <services-geo-path> <file-path>")
    result = read_workbook_cells(Path(sys.argv[1]), Path(sys.argv[2]))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
