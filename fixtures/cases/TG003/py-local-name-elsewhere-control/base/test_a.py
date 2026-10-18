import pytest


def helper(pytest):
    return pytest


def other():
    pytest = 1
    return pytest


def test_adds():
    assert 1 + 1 == 2
