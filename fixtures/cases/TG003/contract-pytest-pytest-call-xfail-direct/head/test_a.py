import pytest


def test_other():
    assert 1 + 1 == 2


def test_adds():
    pytest.xfail("later")
    assert 1 + 1 == 2
