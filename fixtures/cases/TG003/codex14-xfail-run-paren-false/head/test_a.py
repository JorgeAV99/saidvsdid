import pytest


@pytest.mark.xfail(run=(False), reason="why")
def test_x():
    print("ran")
    assert False
