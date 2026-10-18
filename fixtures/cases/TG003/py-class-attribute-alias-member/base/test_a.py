import pytest


class Actions:
    omit = pytest.skip


def test_adds():
    assert 1 + 1 == 2
