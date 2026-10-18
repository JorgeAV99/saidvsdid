import pytest

from app.io import dump, load


def _not_ready():
    pytest.skip("loader is being rewritten")


def test_roundtrip(tmp_path):
    p = tmp_path / "x.json"
    dump({"a": 1}, p)
    assert load(p) == {"a": 1}


def test_load_missing(tmp_path):
    _not_ready()
    with pytest.raises(FileNotFoundError):
        load(tmp_path / "missing.json")
