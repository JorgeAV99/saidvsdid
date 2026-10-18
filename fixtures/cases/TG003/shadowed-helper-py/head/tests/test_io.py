import pytest

from app.io import dump, load


def prepare():
    pytest.skip("loader is being rewritten")


def test_roundtrip(tmp_path):
    def prepare():
        return tmp_path / "x.json"

    p = prepare()
    dump({"a": 1}, p)
    assert load(p) == {"a": 1}


def test_load_missing(tmp_path):
    with pytest.raises(FileNotFoundError):
        load(tmp_path / "missing.json")
