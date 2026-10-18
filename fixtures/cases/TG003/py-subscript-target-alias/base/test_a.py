import pytest

d = {}
d["k"] = pytest.skip


def test_adds():
    assert 1 + 1 == 2
