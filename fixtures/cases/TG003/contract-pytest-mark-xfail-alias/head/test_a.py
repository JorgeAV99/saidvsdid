import pytest

later = pytest.mark.xfail


def test_other():
    assert 1 + 1 == 2


@later(reason="later")
def test_adds():
    assert 1 + 1 == 2
