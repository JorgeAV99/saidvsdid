import pytest


@pytest.mark.parametrize("x", [1, pytest.param(2, marks=pytest.mark.xfail)])
def test_x(x):
    assert x == 1
