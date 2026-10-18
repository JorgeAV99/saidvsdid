import pytest

omit = pytest.mark.skip(reason="later")


def test_adds():
    assert 1 + 1 == 2
