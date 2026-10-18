import pytest


@pytest.mark.xfail(reason="[NOTRUN] ordinary reason")
def test_x():
    print("body ran")
    assert False
