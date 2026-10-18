import pytest


@pytest.mark.xfail(strict=True, reason="why")
def test_x():
    assert True
