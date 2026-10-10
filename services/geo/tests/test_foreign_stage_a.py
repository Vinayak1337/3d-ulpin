"""Exact foreign development split controls; no teacher label or real training run is produced."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from geo.usp_learning.stage_a import REPO, development_families, load_examples
from test_stage_a import examples


def split_control(tmp_path: Path, family: str, split: str) -> Path:
    row = examples()[0]
    link = {**row, "family": family, "split": split}
    example = {"profileHash": row["profileHash"], "columnProfile": {"name": row["sourceField"]},
               "target": "unknown", "verified": True, "labelKind": "pseudo_label",
               "method": "model:software-split-control"}
    path = tmp_path / "examples.jsonl"
    with path.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(example) + "\n")
    with (tmp_path / "profile-links.jsonl").open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(link) + "\n")
    return path


def test_verified_opf_d02_development_example_is_admitted(tmp_path: Path) -> None:
    rows = load_examples(split_control(tmp_path, "opf-d02", "dev"))
    assert len(rows) == 1 and rows[0]["family"] == "opf-d02" and rows[0]["split"] == "dev"


def test_unlisted_foreign_development_family_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="STAGE_A_TRAINING_SPLIT_DENIED"):
        load_examples(split_control(tmp_path, "opf-unlisted-software-control", "dev"))


@pytest.mark.parametrize("family", ["opf-d02", "opf-unlisted-software-control"])
def test_foreign_pool_example_is_refused(tmp_path: Path, family: str) -> None:
    with pytest.raises(ValueError, match="STAGE_A_TRAINING_SPLIT_DENIED"):
        load_examples(split_control(tmp_path, family, "pool"))


def test_both_manifest_heldout_lists_exclude_families(monkeypatch: pytest.MonkeyPatch) -> None:
    original_read = Path.read_text

    def controlled_read(path: Path, *args: object, **kwargs: object) -> str:
        text = original_read(path, *args, **kwargs)
        if path.as_posix().endswith("D8-open-property-foreign/manifest.json"):
            manifest = json.loads(text)
            manifest["heldout"] = [{"id": "opf-d02"}]
            return json.dumps(manifest)
        return text

    monkeypatch.setattr(Path, "read_text", controlled_read)
    families = development_families()
    assert "opf-d02" not in families
    indian = json.loads(original_read(REPO / "fixtures/usp/D8-messy-india/manifest.json", encoding="utf-8"))
    assert not families.intersection(family["id"] for family in indian["heldout"])
