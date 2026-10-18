import pytest


def helper(pytest):
    return pytest


def other():
    pytest = 1
    return pytest


def test_adds():
    pytest.skip("later")
    assert 1 + 1 == 2
