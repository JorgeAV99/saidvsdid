import pytest


def add(a, b):
    return a + b


def test_adds():
    add(1, 1)


def test_other():
    assert add(2, 2) == 4
