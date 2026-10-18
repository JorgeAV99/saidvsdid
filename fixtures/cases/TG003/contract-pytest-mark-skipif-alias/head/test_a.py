import pytest

later = pytest.mark.skipif


def test_other():
    assert 1 + 1 == 2


@later(True, reason="later")
def test_adds():
    assert 1 + 1 == 2
