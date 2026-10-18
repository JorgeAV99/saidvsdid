import pytest


@pytest.mark.skipif(True, condition=False, reason="why")
def test_x():
    assert True
