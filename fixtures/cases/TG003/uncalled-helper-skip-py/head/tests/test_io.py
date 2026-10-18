import pytest

from app.io import dump, load


def _skip_module():
    pytest.skip("debugging only", allow_module_level=True)


def test_roundtrip(tmp_path):
    p = tmp_path / "x.json"
    dump({"a": 1}, p)
    assert load(p) == {"a": 1}


def test_load_missing(tmp_path):
    with pytest.raises(FileNotFoundError):
        load(tmp_path / "missing.json")
