import pytest

from app.io import dump, load

# TODO: do not @pytest.mark.skip this, fix it instead.


@pytest.fixture
def skip_db():
    return {"skip": True}


def test_roundtrip(tmp_path, skip_db):
    p = tmp_path / "x.json"
    dump({"a": 1, "note": "pytest.skip() is not called here"}, p)
    assert load(p) == {"a": 1, "note": "pytest.skip() is not called here"}


def test_load_missing(tmp_path):
    with pytest.raises(FileNotFoundError):
        load(tmp_path / "missing.json")


def test_skip_flag_is_respected(skip_db):
    assert skip_db["skip"] is True
