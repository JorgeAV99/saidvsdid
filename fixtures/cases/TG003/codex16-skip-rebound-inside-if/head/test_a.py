import pytest


@pytest.mark.skip
def test_x():
    assert True


if True:
    test_x = None
