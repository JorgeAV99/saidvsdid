import pytest


def add(a, b):
    return a + b


def test_adds():
    pytest.raises(ValueError)
    add(1, 1)


def test_other():
    assert add(2, 2) == 4
