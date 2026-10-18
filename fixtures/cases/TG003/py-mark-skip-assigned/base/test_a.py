import pytest

pytest.mark.skip = lambda reason=None: (lambda fn: fn)


def test_adds():
    assert 1 + 1 == 2
