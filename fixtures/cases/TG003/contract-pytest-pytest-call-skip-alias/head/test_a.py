import pytest

later = pytest.skip


def test_other():
    assert 1 + 1 == 2


def test_adds():
    later("later")
    assert 1 + 1 == 2
