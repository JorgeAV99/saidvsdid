import pytest


@pytest.mark.xfail(run=0, reason="why")
def test_x():
    print("ran")
    assert False
