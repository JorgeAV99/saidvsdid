import unittest

import pytest

from app.io import dump, load


@pytest.mark.skipif(False, reason="was flaky")
def test_roundtrip(tmp_path):
    p = tmp_path / "x.json"
    dump({"a": 1}, p)
    assert load(p) == {"a": 1}


@unittest.skipUnless(True, "always")
@pytest.mark.xfail(False, reason="fixed")
def test_load_missing(tmp_path):
    if False:
        pytest.skip("debugging")
    with pytest.raises(FileNotFoundError):
        load(tmp_path / "missing.json")
