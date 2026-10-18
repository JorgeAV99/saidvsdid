import pytest


def test_x():
    pytest.xfail("why")
    pytest.skip("why")
