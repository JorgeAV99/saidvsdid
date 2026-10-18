import pytest


def test_x():
    pytest.xfail("why")
    assert False
