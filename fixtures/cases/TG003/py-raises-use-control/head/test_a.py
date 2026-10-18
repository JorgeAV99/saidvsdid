import pytest


def test_div():
    with pytest.raises(ZeroDivisionError) as excinfo:
        1 / 0
    assert excinfo.type is ZeroDivisionError


def test_adds():
    pytest.skip("later")
    assert 1 + 1 == 2
