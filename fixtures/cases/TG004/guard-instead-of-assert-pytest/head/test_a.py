import pytest


def add(a, b):
    return a + b


def test_adds():
    if add(1, 1) != 2:
        raise AssertionError('sum')


def test_other():
    assert add(2, 2) == 4
