import pytest


def add(a, b):
    return a + b


def test_adds():
    assert add(1, 1) == 2


def test_other():
    assert add(2, 2) == 4
