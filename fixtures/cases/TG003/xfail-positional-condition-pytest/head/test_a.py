import pytest


@pytest.mark.xfail(True, reason="bug 3")
def test_adds():
    assert 1 + 1 == 2


def test_other():
    assert 2 + 2 == 4
