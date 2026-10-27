"""REH14 act 2: the judges' unknown files, written once as test_only derivatives of public originals.

Every derived file copies rows, features or coordinates from a named public original; nothing is invented. The
drive holds no mixed-geometry GeoJSON, no semicolon or Windows-1252 CSV and no ready ZIP of the asked kinds, so
those four are written here. The other act 2 files are dropped as they are. Usage: python -I act2-files.py
"""
import csv
import io
import json
import zipfile
from pathlib import Path

DATASETS = Path("E:/BhuAayam-data/datasets")
OUT = Path("E:/BhuAayam-data/task-data/reh14/act2")
NYC_BOX = DATASETS / "nyc-second-area/nyc-office-of-technology-and-innovation"
SMALL_BOX = NYC_BOX / "5zhs-2jue-box-w74.003-s40.732-e73.992-n40.740.geojson"
LARGE_BOX = NYC_BOX / "5zhs-2jue-box-w74.025-s40.700-e73.940-n40.800.geojson"
NYCHA = DATASETS / "open-property-foreign/dev/d1f/opf-d03/nycha-addresses-prefix-128.csv"
HERITAGE = DATASETS / "open-property-foreign/dev/d1f/opf-d06/edmonton-heritage-prefix-128.csv"
BUS_STOPS = DATASETS / "messy-india/pool-bengaluru-bus-stop-audit-data/c72a236f-d324-4b3f-96e1-f9fc1ce53cef.csv"
KML = Path("E:/BhuAayam-data/task-data/desktop-kml-native/originals/kmlsamples.kml")


def read_rows(path: Path, count: int) -> tuple[list[str], list[list[str]]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        header = next(reader)
        return header, [row for _, row in zip(range(count), reader)]


def feature_collection(features: list[dict], crs: dict | None) -> dict:
    value = {"type": "FeatureCollection", "features": features}
    if crs:
        value["crs"] = crs
    return value


def mixed_geojson() -> Path:
    """Five NYC footprints, three NYCHA address pins and two footprint rings copied as lines."""
    box = json.loads(SMALL_BOX.read_text(encoding="utf-8"))
    polygons = box["features"][:5]
    header, rows = read_rows(NYCHA, 3)
    lat, lon = header.index("LATITUDE"), header.index("LONGITUDE")
    pins = [{"type": "Feature", "properties": {"address": row[header.index("ADDRESS")]},
             "geometry": {"type": "Point", "coordinates": [float(row[lon]), float(row[lat])]}} for row in rows]
    lines = [{"type": "Feature", "properties": {"ring_of": feature["properties"].get("bin")},
              "geometry": {"type": "LineString", "coordinates": feature["geometry"]["coordinates"][0][0]}}
             for feature in polygons[:2]]
    path = OUT / "mx1-mixed-points-lines-polygons.geojson"
    path.write_text(json.dumps(feature_collection(polygons + pins + lines, box.get("crs"))), encoding="utf-8")
    return path


def keyed_mixed_geojson() -> Path:
    """The same kinds, each feature keyed by its own published BIN: pins carry NYCHA's BIN; lines are rings 6-7."""
    box = json.loads(SMALL_BOX.read_text(encoding="utf-8"))
    polygons = box["features"][:5]
    header, rows = read_rows(NYCHA, 3)
    lat, lon, bin_ = header.index("LATITUDE"), header.index("LONGITUDE"), header.index("BIN")
    pins = [{"type": "Feature", "properties": {"bin": row[bin_]},
             "geometry": {"type": "Point", "coordinates": [float(row[lon]), float(row[lat])]}} for row in rows]
    lines = [{"type": "Feature", "properties": {"bin": feature["properties"].get("bin")},
              "geometry": {"type": "LineString", "coordinates": feature["geometry"]["coordinates"][0][0]}}
             for feature in box["features"][5:7]]
    path = OUT / "mx1-keyed-points-lines-polygons.geojson"
    path.write_text(json.dumps(feature_collection(polygons + pins + lines, box.get("crs"))), encoding="utf-8")
    return path


def zip_layers() -> Path:
    """The first 2,100 footprints of the large NYC box, the KML samples and the NYCHA address CSV."""
    box = json.loads(LARGE_BOX.read_text(encoding="utf-8"))
    layer = json.dumps(feature_collection(box["features"][:2100], box.get("crs")))
    path = OUT / "zp1-geojson-kml-csv.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("nyc-footprints-2100.geojson", layer)
        archive.write(KML, "kmlsamples.kml")
        archive.write(NYCHA, "nycha-addresses-prefix-128.csv")
    return path


def semicolon_csv() -> Path:
    """Five Edmonton heritage rows with semicolons and decimal commas in latitude and longitude."""
    header, rows = read_rows(HERITAGE, 5)
    keep = [header.index(name) for name in
            ("Building Address", "Construction Completion Year", "Name of Historic Resource", "Latitude", "Longitude")]
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    writer.writerow([header[index] for index in keep])
    for row in rows:
        writer.writerow([row[index].replace(".", ",") if index in keep[-2:] else row[index] for index in keep])
    path = OUT / "csv2-edmonton-heritage-semicolon-decimal-comma.csv"
    path.write_text(buffer.getvalue(), encoding="utf-8", newline="")
    return path


def windows_1252_csv() -> Path:
    """Six Bengaluru bus stop rows in Windows-1252: the condition column holds an en dash (byte 0x96)."""
    header, rows = read_rows(BUS_STOPS, 6)
    keep = [header.index(name) for name in ("Date and Time", "_Survey Location_latitude",
                                            "_Survey Location_longitude", "Condition of Bus Shelter")]
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow([header[index] for index in keep])
    writer.writerows([[row[index] for index in keep] for row in rows])
    path = OUT / "csv2-bengaluru-bus-stops-windows-1252.csv"
    path.write_bytes(buffer.getvalue().encode("cp1252"))
    return path


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for path in (mixed_geojson(), keyed_mixed_geojson(), zip_layers(), semicolon_csv(), windows_1252_csv()):
        print(path, path.stat().st_size)


if __name__ == "__main__":
    main()
