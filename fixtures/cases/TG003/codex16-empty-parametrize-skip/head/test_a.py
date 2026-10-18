import pytest


@pytest.mark.parametrize("x", [])
@pytest.mark.skip
def test_x(x):
    assert False
