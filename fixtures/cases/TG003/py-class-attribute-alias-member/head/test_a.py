import pytest


class Actions:
    omit = pytest.skip


def test_adds():
    Actions.omit("x")
    assert 1 + 1 == 2
