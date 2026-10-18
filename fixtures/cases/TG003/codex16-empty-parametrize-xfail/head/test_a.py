import pytest


@pytest.mark.parametrize("x", [])
@pytest.mark.xfail
def test_x(x):
    assert False
