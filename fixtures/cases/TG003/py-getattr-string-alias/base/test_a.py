import pytest

omit = getattr(pytest, "skip")


def test_adds():
    assert 1 + 1 == 2
