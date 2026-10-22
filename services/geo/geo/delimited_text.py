"""The deterministic table reading policy, mirrored by ingestion/delimited-text.ts."""
import csv
import io
from itertools import islice


def decode_table(raw: bytes) -> tuple[str, str]:
    if raw.startswith(b"\xff\xfe"):
        return raw[2:].decode("utf-16le"), "utf-16le"
    if raw.startswith(b"\xfe\xff"):
        return raw[2:].decode("utf-16be"), "utf-16be"
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    try:
        return raw.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        # WHATWG preserves undefined Windows-1252 slots as their C1 code points.
        translation = {byte: bytes([byte]).decode("cp1252") for byte in range(128, 256)
                       if byte not in (0x81, 0x8d, 0x8f, 0x90, 0x9d)}
        text = raw.decode("latin1").translate(translation)
        return text, "windows-1252"


def choose_delimiter(text: str, name: str = "") -> str:
    candidates = []
    for delimiter in (",", ";", "\t", "|"):
        reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True)
        try:
            records = list(islice((row for row in reader if any(cell.strip() for cell in row)), 2))
            first = len(records[0]) if records else 0
            consistent = len(records) < 2 or len(records[1]) == first
        except csv.Error:
            first, consistent = 0, False
        candidates.append((delimiter, first, consistent))
    tab = candidates[2]
    if name.lower().endswith(".tsv") and tab[1] >= 2 and tab[2]:
        return "\t"
    consistent = [item for item in candidates if item[1] >= 2 and item[2]]
    if not consistent:
        return ","
    return max(consistent, key=lambda item: item[1])[0]


def table_reading(raw: bytes, name: str = "") -> tuple[str, dict[str, str]]:
    text, encoding = decode_table(raw)
    return text, {"encoding": encoding, "delimiter": choose_delimiter(text, name)}


def table_dict_reader(text: str, delimiter: str) -> csv.DictReader:
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True)
    skipped = 0
    for header in reader:
        if any(cell.strip() for cell in header):
            break
        skipped += 1
    # Reuse DictReader's row validation and physical line counter after the leading blanks.
    result = csv.DictReader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True)
    for _ in range(skipped):
        next(result.reader)
    return result
