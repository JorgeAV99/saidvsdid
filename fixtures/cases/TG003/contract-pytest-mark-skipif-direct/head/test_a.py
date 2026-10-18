import pytest


def test_other():
    assert 1 + 1 == 2


@pytest.mark.skipif(True, reason="later")
def test_adds():
    assert 1 + 1 == 2
