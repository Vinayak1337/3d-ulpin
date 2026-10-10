"""Real-input regressions for the D1f acquisition helper; no labels or fabricated source facts."""
from __future__ import annotations

import csv
import importlib.util
import json
from pathlib import Path
from typing import Any

import pytest

DATA_ROOT = Path("E:/BhuAayam-data/datasets/open-property-foreign/dev/d1f")


def helper() -> Any:
    path = Path(__file__).with_name("acquire-d1f.py")
    spec = importlib.util.spec_from_file_location("d1f_acquisition", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_native_export_schema_excludes_portal_computed_region_columns() -> None:
    directory = DATA_ROOT / "opf-d06"
    if not directory.is_dir():
        pytest.skip("Immutable D1f real input is retained outside Git")
    metadata = json.loads((directory / "edmonton-heritage-dictionary.json").read_bytes())
    with (directory / "edmonton-heritage-prefix-128.csv").open(encoding="utf-8-sig", newline="") as handle:
        headers = next(csv.reader(handle))
    native = helper().native_columns(metadata)
    assert headers == [column["name"] for column in native]
    assert len([column for column in metadata["columns"] if column["position"] >= 0]) > len(headers)


def test_owner_colon_with_space_is_detected_without_requiring_a_following_word_boundary() -> None:
    assert helper().OWNER_RISK.search("owner: [withheld]")


def test_task_local_credential_path_is_rejected_before_any_read() -> None:
    module = helper()
    with pytest.raises(ValueError, match="D1F_INPUT_PATH_DENIED"):
        module.checked_task_path(module.TASK_ROOT / ".env")


def test_quoted_native_geometry_prefix_is_byte_identical_and_never_overwritten(tmp_path: Path) -> None:
    directory = DATA_ROOT / "opf-d07"
    if not directory.is_dir():
        pytest.skip("Immutable D1f difficult input is retained outside Git")
    module = helper()
    original = directory / "baton-footprint.csv"
    original_hash = module.digest(original)
    output = tmp_path / "prefix.csv"
    result = module.prefix(original, output)
    assert result["rows"] == 128 and result["rowBoundary"] is True
    assert output.read_bytes() == (directory / "baton-footprint-prefix-128.csv").read_bytes()
    with pytest.raises(FileExistsError):
        module.prefix(original, output)
    assert module.digest(original) == original_hash
