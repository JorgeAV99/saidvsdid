import pytest as pt

omit = pt.skip.__call__


def test_adds():
    assert 1 + 1 == 2
