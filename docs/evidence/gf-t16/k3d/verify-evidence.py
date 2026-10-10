"""Offline evidence check: source/crop pins, complete page coverage and exact cited height arithmetic."""
from __future__ import annotations

from fractions import Fraction
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ALLOWED = {"RERAP2311201700019-3", "haryana-2831", "RERAP01282025205138-1",
           "RERAP279201800923-1", "RERAP285201800427-9"}


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def hash_matches(path: Path, expected: str) -> None:
    assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, path.name


def check_sources(inventory: dict, private: Path) -> None:
    assert inventory["originalCount"] == 8
    assert inventory["pagesSearched"] == 28
    assert sum(source["ocrTiles"] for source in inventory["originals"]) == 680
    for source in inventory["originals"]:
        original = Path(source["original"])
        assert original.parent.name in ALLOWED
        hash_matches(original, source["sha256"])
        assert original.stat().st_size == source["bytes"]
        assert len(source["pages"]) == source["pageCount"]
        assert [page["page"] for page in source["pages"]] == list(range(1, source["pageCount"] + 1))
        assert all(page["status"] == "complete" for page in source["pages"])
        store = private / source["pageStoreDirectory"] / source["pageStoreFile"]
        hash_matches(store, source["pageStoreSha256"])
        assert set(load(store)["pages"]) == {str(page["page"]) for page in source["pages"]}


def required_views(value: object) -> set[str]:
    if isinstance(value, dict):
        direct = {item for item in value.values() if isinstance(item, str) and item.endswith(".png")}
        return direct.union(*(required_views(item) for item in value.values()))
    if isinstance(value, list):
        return set().union(*(required_views(item) for item in value))
    return set()


def check_views(inventory: dict, findings: dict, private: Path) -> None:
    files = {view["file"] for view in inventory["views"]}
    assert required_views(findings) <= files
    originals = {source["sha256"]: source for source in inventory["originals"]}
    for view in inventory["views"]:
        hash_matches(private / view["file"], view["sha256"])
        receipt = load(private / view["receipt"])
        assert receipt["pngSha256"] == view["sha256"]
        assert receipt["sha256"] == view["sourceSha256"]
        assert receipt["page"] == view["page"]
        assert receipt["regionPt"] == view["regionPt"]
        page = originals[view["sourceSha256"]]["pages"][view["page"] - 1]
        left, top, right, bottom = view["regionPt"]
        assert 0 <= left < right <= page["pagePt"][0]
        assert 0 <= top < bottom <= page["pagePt"][1]


def check_limits(findings: dict, private: Path) -> None:
    assert findings["magnolia"]["heightEvidence"]["datumLiteral"] == "FFL \u00b100 / GROUND"
    assert findings["tower3"]["heightEvidence"]["datumLiteral"] == "ROAD / LVL. \u00b100"
    levels = findings["magnolia"]["reviewedLevels"]
    lower = [Fraction(18, 12), Fraction(138, 12), Fraction(265, 12)]
    upper = [Fraction(138, 12), Fraction(265, 12), Fraction(390, 12)]
    foot = Fraction("0.3048")
    for index, level in enumerate(levels):
        assert Fraction(level["lowerM"]) == lower[index] * foot
        assert Fraction(level["upperM"]) == upper[index] * foot
        assert Fraction(level["heightM"]) == (upper[index] - lower[index]) * foot
    assert levels[2]["admissibleHeight"] is None
    assert upper[2] - lower[2] != Fraction(127, 12)  # Printed 10'7" conflicts with FFL difference.
    assert Fraction("3.81") * Fraction("3.0988") == Fraction("11.806428")
    assert Fraction("3.03") + 6 * Fraction("3.66") == Fraction("24.99")
    assert not findings["step1"]["run"] and not findings["step1"]["fixtureCreated"]
    assert findings["step1"]["databaseWrites"] == 0
    for identifier in ["6f95d04e-2067-4ac8-a3c2-6cc21ea46325", "e8777ffc-9409-4129-bacf-f680160d8795"]:
        canonical = load(private / "canonical-01" / f"{identifier}.json")
        for level in canonical["levels"]:
            assert level["lowerM"]["value"] is None and level["lowerM"]["state"] == "unknown"
            assert level["upperM"]["value"] is None and level["upperM"]["state"] == "unknown"


def main() -> None:
    inventory = load(HERE / "inventory.json")
    findings = load(HERE / "findings.json")
    private = Path(inventory["privateRoot"])
    check_sources(inventory, private)
    check_views(inventory, findings, private)
    check_limits(findings, private)
    print(json.dumps({"originals": 8, "pages": 28, "ocrTiles": 680, "views": len(inventory["views"]),
                      "pinsAndCoverage": "pass", "exactArithmetic": "pass", "prismBuilt": False}))


if __name__ == "__main__":
    main()
