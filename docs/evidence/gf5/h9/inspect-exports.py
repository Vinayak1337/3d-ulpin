"""Open the generated workbook and PDF, preserving only headers and the relevant absence."""
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

import fitz


HERE = Path(__file__).parent
NAMESPACE = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def cell_value(cell: ET.Element) -> str | None:
    text = cell.find("x:is/x:t", NAMESPACE)
    if text is not None:
        return text.text
    value = cell.find("x:v", NAMESPACE)
    return value.text if value is not None else None


def workbook_headers(path: Path) -> dict[str, list[str | None]]:
    with ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        names = [sheet.attrib["name"] for sheet in workbook.find("x:sheets", NAMESPACE)]
        headers = {}
        for index, name in enumerate(names, 1):
            sheet = ET.fromstring(archive.read(f"xl/worksheets/sheet{index}.xml"))
            rows = sheet.find("x:sheetData", NAMESPACE)
            headers[name] = [cell_value(cell) for cell in rows[0]]
            if name == "Building":
                headers["building_fields"] = [cell_value(row[0]) for row in rows[1:]]
        return headers


def main() -> None:
    headers = workbook_headers(HERE / "tower3-register.xlsx")
    with fitz.open(HERE / "tower3-register.pdf") as document:
        text = "".join(page.get_text() for page in document)
        for index, page in enumerate(document):
            page.get_pixmap().save(HERE / f"after/export-opened-{index + 1}.png")
        result = {
            "workbook": headers,
            "pdf_pages": len(document),
            "pdf_header": ["Unit", "Carpet m²", "Share %", "Registered owners", "Residents", "Occupancy"],
            "pdf_contains_project_code": "Project code" in text,
            "workbook_contains_building_project_code": "Project code" in headers["building_fields"],
            "opened_by": "zipfile + ElementTree (all workbook headers); PyMuPDF (PDF text and page image)",
        }
    (HERE / "export-inspection.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
